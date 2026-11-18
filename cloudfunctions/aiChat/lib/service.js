const { loadValuationData } = require('./data')
const { computeBaseline } = require('./baseline')
const { loadConfig } = require('./config')
const { loadKnowledge } = require('./knowledge')
const { generateEstimate } = require('./providers')
const { validateEstimate } = require('./validate')
const { PROMPT_VERSION } = require('./prompt')
const { createRepository, canonical, digest, reportId } = require('./repository')

const PURPOSES = ['investment', 'rigid', 'improvement']
const OVERRIDES = {
  areaSqm: [0.01, 1000000], floor: [-10, 300], totalFloors: [1, 300],
  rooms: [0, 100], buildYear: [1800, 2200], orientation: 60, decoration: 120,
  occupancy: 120, deliveryStatus: 200, elevator: 'boolean'
}
const ERRORS = {
  UNAUTHORIZED: '无法确认当前微信用户身份', INVALID_REQUEST: '请求参数不正确',
  REPORT_NOT_FOUND: '评估记录不存在或无权访问', REPORT_READ_FAILED: '评估记录读取失败',
  REPORT_WRITE_FAILED: '评估记录保存失败', REQUEST_ID_CONFLICT: '同一 requestId 已用于其他评估参数',
  CONFIG_INVALID: '后台估价配置无效', CONFIG_READ_FAILED: '后台估价配置读取失败',
  TARGET_NOT_FOUND: '目标房源或小区不存在', COMMUNITY_NOT_FOUND: '关联小区不存在',
  COMMUNITY_MISMATCH: '房源与小区不匹配', COMMUNITY_AMBIGUOUS: '房源对应多个小区，请提供准确的小区编号',
  DATA_READ_FAILED: '房产数据读取失败', INVALID_OVERRIDE: '补录的房产属性无效',
  DATA_READ_TIMEOUT: '房产数据读取超时', INSUFFICIENT_DATA: '目标房产缺少城市或小区等必要信息',
  INTERNAL_ERROR: '评估服务暂不可用'
}
const ERROR_ALIASES = {
  INVALID_INPUT: 'INVALID_REQUEST', TARGET_MISMATCH: 'COMMUNITY_MISMATCH',
  COMMUNITY_REQUIRED: 'COMMUNITY_NOT_FOUND', AMBIGUOUS_COMMUNITY: 'COMMUNITY_AMBIGUOUS',
  DATA_QUERY_FAILED: 'DATA_READ_FAILED'
}
function safeCode(error) {
  const code = error && (ERROR_ALIASES[error.code] || error.code)
  return Object.prototype.hasOwnProperty.call(ERRORS, code) ? code : 'INTERNAL_ERROR'
}
function fail(code) { return Object.assign(new Error(code), { code }) }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype }
function text(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.length <= max }
function allowKeys(v, keys) { if (Object.keys(v).some(key => !keys.includes(key))) throw fail('INVALID_REQUEST') }
async function withinDeadline(work, deadline, now, code) {
  let timer
  const remaining = deadline - now().getTime()
  if (remaining <= 0) throw fail(code)
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail(code)), remaining)
    })])
  } finally { clearTimeout(timer) }
}

function normalizeRequest(event, currentYear) {
  if (!isObject(event)) throw fail('INVALID_REQUEST')
  if (event.action === 'getEvaluation') {
    allowKeys(event, ['action', 'valuationId'])
    if (!/^v_[a-f0-9]{30}$/.test(event.valuationId || '')) throw fail('INVALID_REQUEST')
    return { action: event.action, valuationId: event.valuationId }
  }
  allowKeys(event, ['action', 'targetType', 'houseId', 'communityId', 'purpose', 'requestId', 'overrides'])
  if (event.action !== 'createEvaluation' || !['house', 'community'].includes(event.targetType) || !text(event.requestId, 128)) throw fail('INVALID_REQUEST')
  const result = { action: event.action, targetType: event.targetType, requestId: event.requestId.trim(), purpose: event.purpose || 'investment', overrides: {} }
  if (!PURPOSES.includes(result.purpose)) throw fail('INVALID_REQUEST')
  for (const name of ['houseId', 'communityId']) {
    if (event[name] !== undefined) {
      if (!text(event[name], 128) || /[\u0000-\u001f/]/.test(event[name])) throw fail('INVALID_REQUEST')
      result[name] = event[name].trim()
    }
  }
  if (result.targetType === 'house' ? !result.houseId : !result.communityId || result.houseId) throw fail('INVALID_REQUEST')
  if (event.overrides !== undefined) {
    if (!isObject(event.overrides) || result.targetType !== 'house') throw fail('INVALID_REQUEST')
    allowKeys(event.overrides, Object.keys(OVERRIDES))
    for (const [key, value] of Object.entries(event.overrides)) {
      const rule = OVERRIDES[key]
      if (Array.isArray(rule)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < rule[0] || value > rule[1] || (key !== 'areaSqm' && !Number.isInteger(value))) throw fail('INVALID_REQUEST')
        if (key === 'buildYear' && value > currentYear + 10) throw fail('INVALID_REQUEST')
      } else if (rule === 'boolean') {
        if (typeof value !== 'boolean') throw fail('INVALID_REQUEST')
      } else if (!text(value, rule)) throw fail('INVALID_REQUEST')
      result.overrides[key] = typeof value === 'string' ? value.trim() : value
    }
    if (result.overrides.floor !== undefined && result.overrides.totalFloors !== undefined && result.overrides.floor > result.overrides.totalFloors) throw fail('INVALID_REQUEST')
  }
  return result
}

function publicReport(row, now) {
  if (row.status === 'processing') {
    const expired = new Date(row.expiresAt).getTime() <= now.getTime()
    return { valuationId: row._id, status: expired ? 'failed' : 'processing',
      ...(expired ? { failureReason: 'PROCESSING_EXPIRED', retryWithNewRequestId: true } : {}), createdAt: row.createdAt }
  }
  if (row.status === 'failed') return { valuationId: row._id, status: 'failed', failureReason: row.failureReason, createdAt: row.createdAt, retryWithNewRequestId: true }
  return { valuationId: row._id, ...row.result }
}

function createValuationService(options) {
  const { db, environment = process.env, now = () => new Date(), readData = loadValuationData,
    baselineFor = computeBaseline, readConfig = loadConfig, readKnowledge = loadKnowledge,
    generate = generateEstimate, validate = validateEstimate, repository = createRepository(db), storageBudgetMs = 5000 } = options
  const storage = (work, deadline, code) => withinDeadline(work, Math.min(deadline, now().getTime() + storageBudgetMs), now, code)

  async function getResult(request, caller) {
    const row = await storage(() => repository.get(request.valuationId), now().getTime() + storageBudgetMs, 'REPORT_READ_FAILED')
    if (!row || row.owner !== caller) throw fail('REPORT_NOT_FOUND')
    return { ok: true, report: publicReport(row, now()) }
  }
  async function create(request, caller) {
    const start = now()
    // Idempotent retries return their original immutable result even if configuration
    // has subsequently changed or been disabled. A fresh assessment uses a new ID.
    const existing = await storage(() => repository.get(reportId(caller, request.requestId)), start.getTime() + storageBudgetMs, 'REPORT_READ_FAILED')
    if (existing) {
      if (existing.owner !== caller || existing.requestHash !== digest(canonical(request))) throw fail('REQUEST_ID_CONFLICT')
      return { ok: true, report: publicReport(existing, now()) }
    }
    const config = await storage(() => readConfig(db), start.getTime() + 10000, 'CONFIG_READ_FAILED')
    const budget = config.requestBudgetMs
    const deadline = start.getTime() + budget
    const reserveMs = Math.min(2000, Math.floor(budget / 5))
    const saveDeadline = deadline + storageBudgetMs
    const reserved = await storage(() => repository.reserve(caller, request, start, budget + 15000), deadline - reserveMs, 'REPORT_WRITE_FAILED')
    if (!reserved.created) return { ok: true, report: publicReport(reserved.row, now()) }
    const id = reserved.row._id
    try {
      const context = await withinDeadline(() => readData(db, request, now()), deadline - reserveMs, now, 'DATA_READ_TIMEOUT')
      const baseline = baselineFor(context)
      const warnings = [...(context.warnings || []), ...(baseline.warnings || [])]
      let knowledge = { items: [], version: 'none', warnings: [] }
      let modelResult = null, accepted = null, status = 'insufficient_data', fallbackReason = null, reviewReasons = []
      const hasPriceEvidence = (context.evidence || []).some(item => item.kind !== 'rent' && Number.isFinite(item.unitPrice) && item.unitPrice > 0)
      if (hasPriceEvidence) {
        if (!config.enabled) fallbackReason = 'MODEL_DISABLED'
        else if (!environment.DEEPSEEK_KEY) fallbackReason = 'MODEL_NOT_CONFIGURED'
        else {
          try {
            knowledge = await withinDeadline(() => readKnowledge(db, { city: context.target.city, propertyType: context.target.propertyType, now: now(), limit: 5 }), deadline - reserveMs, now, 'KNOWLEDGE_READ_FAILED')
            warnings.push(...(knowledge.warnings || []))
            const remainingMs = deadline - now().getTime() - reserveMs
            if (remainingMs <= 0) throw fail('MODEL_TIMEOUT')
            modelResult = await withinDeadline(() => generate({ context, baseline, knowledge: knowledge.items, config, apiKey: environment.DEEPSEEK_KEY, remainingMs }), deadline - reserveMs, now, 'MODEL_TIMEOUT')
            const checked = validate(modelResult.estimate, { context, baseline, config, knowledge: knowledge.items })
            if (!checked.valid) { fallbackReason = 'MODEL_VALIDATION_FAILED'; warnings.push(...checked.errors) }
            else { accepted = checked.value; reviewReasons = checked.reviewReasons || []; status = checked.needsReview ? 'needs_review' : 'model_estimate' }
          } catch (error) {
            const code = String(error.code || '')
            fallbackReason = /^MODEL_[A-Z_]+$/.test(code) || code === 'KNOWLEDGE_READ_FAILED' ? code : 'MODEL_FAILED'
          }
        }
      } else fallbackReason = 'NO_PRICE_EVIDENCE'
      if (!accepted) status = baseline.unitPrice > 0 ? 'rule_only' : 'insufficient_data'
      const useModel = status === 'model_estimate'
      const effective = useModel ? accepted.unitPrice : (baseline.unitPrice > 0 ? baseline.unitPrice : null)
      const area = context.target.type === 'house' ? context.target.areaSqm : null
      const result = {
        schemaVersion: '1.0', status, target: context.target, purpose: request.purpose,
        baselineUnitPrice: baseline.unitPrice, modelUnitPrice: accepted ? accepted.unitPrice : null,
        effectiveUnitPrice: effective, effectiveSource: effective === null ? null : useModel ? 'model' : 'rule',
        totalPriceYuan: effective && area > 0 ? Math.round(effective * area) : null,
        priceRange: useModel ? accepted.priceRange : null, modelEstimate: accepted,
        buyerAdvice: useModel ? accepted.buyerAdvice : null, disposalAdvice: useModel ? accepted.disposalAdvice : null,
        summary: useModel ? accepted.summary : null, evidence: context.evidence,
        missingFields: [...new Set([...(context.missingFields || []), ...(accepted ? accepted.missingFields : [])])],
        warnings: [...new Set(warnings)], reviewReasons, fallbackReason, dataQuality: context.dataQuality, baseline,
        versions: { prompt: PROMPT_VERSION, rule: baseline.ruleVersion, config: config.configVersion || 'default',
          knowledge: knowledge.version || 'none', provider: config.provider, model: config.model },
        knowledgeUsed: knowledge.items.map(item => ({ id: item.id, title: item.title, version: item.version || '', sourceUrl: item.sourceUrl || '' })),
        generatedAt: now().toISOString()
      }
      // Persist explicit fields only. Never expose raw provider responses or secrets.
      const snapshot = { target: context.target, market: context.market, evidence: context.evidence,
        missingFields: context.missingFields, knowledge: knowledge.items, config: { ...config, apiKey: undefined } }
      const safeSnapshot = JSON.parse(JSON.stringify(snapshot))
      await storage(() => repository.finish(id, { status, result, inputSnapshot: safeSnapshot, inputHash: digest(canonical(safeSnapshot)),
        usage: modelResult && modelResult.usage || null, durationMs: now().getTime() - start.getTime(), completedAt: result.generatedAt }), saveDeadline, 'REPORT_WRITE_FAILED')
      return { ok: true, report: { valuationId: id, ...result } }
    } catch (error) {
      const code = safeCode(error)
      // A timed-out write may still complete at the database. Do not race it with
      // another write replacing a successful report with a failure marker.
      if (code !== 'REPORT_WRITE_FAILED') {
        try { await storage(() => repository.finish(id, { status: 'failed', failureReason: code, completedAt: now().toISOString() }), saveDeadline, 'REPORT_WRITE_FAILED') }
        catch (saveError) { /* An expired lease is exposed by getEvaluation. */ }
      }
      throw fail(code)
    }
  }
  return {
    async handle(event, caller) {
      try {
        if (!text(caller, 256)) throw fail('UNAUTHORIZED')
        const request = normalizeRequest(event, now().getUTCFullYear())
        return request.action === 'getEvaluation' ? await getResult(request, caller) : await create(request, caller)
      } catch (error) {
        const code = safeCode(error)
        return { ok: false, code, error: ERRORS[code] }
      }
    }
  }
}
module.exports = { createValuationService, normalizeRequest, publicReport }
