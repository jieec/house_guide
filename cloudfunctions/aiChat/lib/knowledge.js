const crypto = require('crypto')

const PAGE_SIZE = 50
const MAX_PER_SCOPE = 200
const MAX_ITEMS = 10
const MAX_CONTENT = 2000
const MAX_TEXT_BUDGET = 8000

function knowledgeError(message) {
  const error = new Error(message)
  error.code = 'KNOWLEDGE_READ_FAILED'
  return error
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function parseBoundary(value, end) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = Date.parse(value + 'T00:00:00+08:00')
    // Date.parse normalizes impossible dates such as February 30; reject them.
    if (!Number.isFinite(start) || new Date(start + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) !== value) return NaN
    return end ? start + 24 * 60 * 60 * 1000 - 1 : start
  }
  if (value instanceof Date || typeof value === 'number' || typeof value === 'string') return new Date(value).getTime()
  return NaN
}

function propertyApplies(scope, propertyType) {
  if (!scope || scope === '全部' || scope === '通用') return true
  const scopes = (Array.isArray(scope) ? scope : String(scope).split(/[，,、|/]/)).map(v => text(v)).filter(Boolean)
  if (!scopes.length || scopes.includes('全部') || scopes.includes('通用')) return true
  if (!propertyType) return false
  return scopes.some(v => v === '全部' || v === '通用' || v === propertyType || propertyType.includes(v))
}

async function queryScope(db, cityFilter, warnings, label) {
  const records = []
  for (let offset = 0; offset < MAX_PER_SCOPE; offset += PAGE_SIZE) {
    const response = await db.collection('ai_knowledge')
      .where({ enabled: true, city: cityFilter }).orderBy('_id', 'asc')
      .skip(offset).limit(PAGE_SIZE).get()
    if (!response || !Array.isArray(response.data)) throw knowledgeError('知识库响应格式错误')
    records.push(...response.data)
    if (response.data.length < PAGE_SIZE) return records
  }
  warnings.push('KNOWLEDGE_SCOPE_TRUNCATED:' + label)
  return records
}

async function loadKnowledge(db, options = {}) {
  const now = options.now === undefined ? new Date() : new Date(options.now)
  if (!Number.isFinite(now.getTime())) throw knowledgeError('知识检索时间无效')
  const city = text(options.city).replace(/市$/, '')
  const propertyType = text(options.propertyType)
  const limit = Number.isInteger(options.limit) ? Math.max(0, Math.min(MAX_ITEMS, options.limit)) : 5
  const warnings = []
  const scopes = []
  if (city && city !== '全国') scopes.push([city, city], [city + '市', city + '市'])
  scopes.push(['全国', '全国'], ['', '空城市'], [null, 'null城市'])
  let batches
  try {
    if (!db.command || typeof db.command.exists !== 'function') throw knowledgeError('数据库不支持缺省城市查询')
    scopes.push([db.command.exists(false), '缺省城市'])
    batches = await Promise.all(scopes.map(([filter, label]) => queryScope(db, filter, warnings, label)))
  } catch (error) {
    throw knowledgeError('无法读取适用城市的知识库')
  }
  const keywordInput = Array.isArray(options.keywords) ? options.keywords : [options.keywords]
  const keywords = [...new Set(['估价', '评估', '成交', '法拍', '处置', '市场比较', '收益还原']
    .concat(keywordInput.filter(v => typeof v === 'string').flatMap(v => v.split(/[\s,，。；;、]+/)))
    .map(v => text(v, 40)).filter(v => v.length >= 2))].slice(0, 30)
  const records = new Map()
  for (const row of batches.flat()) {
    const id = text(row && row._id, 128)
    if (!id) { warnings.push('KNOWLEDGE_ID_MISSING'); continue }
    if (!records.has(id)) records.set(id, row)
  }
  const candidates = []
  for (const [id, row] of records) {
    const from = parseBoundary(row.effectiveFrom, false)
    const to = parseBoundary(row.effectiveTo, true)
    if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to)) {
      warnings.push('KNOWLEDGE_DATE_INVALID:' + id)
      continue
    }
    if ((from !== null && from > now.getTime()) || (to !== null && to < now.getTime())) continue
    if (!propertyApplies(row.propertyType || row.property_type, propertyType)) continue
    const title = text(row.title)
    const content = text(row.content, MAX_CONTENT)
    if (!content) continue
    const tags = Array.isArray(row.tags) ? row.tags.map(v => text(v)).join(' ') : text(row.tags)
    const topic = text(row.topic)
    const searchable = [title, content, tags, topic].join(' ')
    const score = keywords.reduce((sum, word) => sum + (searchable.includes(word) ? 1 : 0), 0)
    const general = !topic || /^(通用|一般|general)$/i.test(topic)
    if (!score && !general) continue
    let sourceUrl = text(row.sourceUrl || row.source_url, 1000)
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      warnings.push('KNOWLEDGE_SOURCE_URL_INVALID:' + id)
      sourceUrl = ''
    }
    const source = text(row.source)
    const item = {
      id, title, content, sourceUrl, source,
      version: text(row.version, 64) || 'unversioned',
      city: text(row.city) || '全国',
      propertyType: Array.isArray(row.propertyType) ? row.propertyType.map(v => text(v)).filter(Boolean) : text(row.propertyType || row.property_type),
      topic, effectiveFrom: from === null ? null : new Date(from).toISOString(),
      effectiveTo: to === null ? null : new Date(to).toISOString()
    }
    candidates.push({ item, score, local: item.city.replace(/市$/, '') === city, sourceMissing: !source && !sourceUrl,
      truncated: typeof row.content === 'string' && row.content.trim().length > MAX_CONTENT })
  }
  candidates.sort((a, b) => b.score - a.score || Number(b.local) - Number(a.local) || a.item.id.localeCompare(b.item.id))
  const items = []
  let used = 0
  for (const entry of candidates) {
    if (items.length >= limit) break
    const cost = entry.item.title.length + entry.item.content.length
    if (used + cost > MAX_TEXT_BUDGET) { warnings.push('KNOWLEDGE_TEXT_BUDGET'); continue }
    items.push(entry.item)
    used += cost
    if (entry.sourceMissing) warnings.push('KNOWLEDGE_SOURCE_MISSING:' + entry.item.id)
    if (entry.truncated) warnings.push('KNOWLEDGE_CONTENT_TRUNCATED:' + entry.item.id)
  }
  warnings.sort()
  const version = 'knowledge-' + crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16)
  return { items, warnings: [...new Set(warnings)], version }
}

module.exports = { loadKnowledge }
