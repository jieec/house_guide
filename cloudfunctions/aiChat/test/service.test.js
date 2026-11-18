const test = require('node:test')
const assert = require('node:assert/strict')
const { createValuationService } = require('../lib/service')
const { generateEstimate } = require('../lib/providers')
const { createRepository } = require('../lib/repository')
const { memoryDb } = require('./helpers/memory-db')

const NOW = new Date('2026-11-17T08:00:00Z')
const request = (extras = {}) => ({ action: 'createEvaluation', targetType: 'house', houseId: 'h1', requestId: 'request-1', ...extras })
function seed() {
  return {
    communities: [{ _id: 'c1', city: '珠海', community: '演示小区', propertyType: '住宅', price: { price: 20000 }, updated_at: '2026-11-16' }],
    houses: [{ _id: 'h1', communityId: 'c1', city: '珠海', community: '演示小区', category: '二手房', area_sqm: 90,
      floor: 5, total_floors: 20, rooms: '3室', orientation: '南', decoration: '普通装修', unit_price: 22000, tel: 'PRIVATE_CONTACT' },
    { _id: 'h2', city: '珠海', community: '演示小区', category: '二手房', unit_price: 20000, updated_at: '2026-11-16' }],
    ai_config: [{ _id: 'main', maxDeviationRatio: 0.1 }],
    ai_knowledge: [{ _id: 'k1', enabled: true, city: '珠海', title: '市场评估', content: '使用可比成交和挂牌判断。', sourceUrl: 'https://example.com/knowledge' }]
  }
}
function estimate(context, baseline) {
  return { unitPrice: baseline.unitPrice, priceRange: { low: baseline.unitPrice * 0.95, high: baseline.unitPrice * 1.05 },
    adjustments: [], evidenceIds: [context.evidence.find(item => item.kind !== 'rent').id],
    buyerAdvice: '核实现场情况后比较报价。', disposalAdvice: '明确交付条件并参考市场报价。', missingFields: [], summary: '基于给定价格证据形成参考估值。' }
}
function setup(extra = {}) {
  const db = memoryDb(seed())
  let calls = 0
  const service = createValuationService({ db, environment: { DEEPSEEK_KEY: 'TEST_SECRET' }, now: () => NOW,
    generate: async args => {
      calls++
      return generateEstimate(args, async options => {
        assert.equal(options.body.response_format.type, 'json_object')
        assert.equal(options.body.messages[1].content.includes('PRIVATE_CONTACT'), false)
        return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(estimate(args.context, args.baseline)) } }], usage: { total_tokens: 200 } } }
      })
    }, ...extra })
  return { db, service, modelCalls: () => calls }
}

test('full pipeline reads server data, validates JSON, stores a snapshot, and returns a report', async () => {
  const { db, service, modelCalls } = setup()
  const result = await service.handle(request(), 'owner-a')
  assert.equal(result.ok, true)
  assert.equal(result.report.status, 'model_estimate')
  assert.equal(result.report.effectiveUnitPrice, 19000)
  assert.equal(result.report.totalPriceYuan, 1710000)
  assert.equal(result.report.baseline.basis, 'listings')
  assert.equal(result.report.versions.rule, 'baseline-v2')
  assert.equal(result.report.effectiveSource, 'model')
  assert.equal(modelCalls(), 1)
  const stored = db.records.valuation_reports[0]
  assert.equal(stored.owner, 'owner-a')
  assert.equal(stored.inputSnapshot.target.areaSqm, 90)
  assert.equal(stored.usage.total_tokens, 200)
  assert.match(stored.inputHash, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(stored).includes('TEST_SECRET'), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE_CONTACT'), false)
  assert.equal(JSON.stringify(result).includes('owner-a'), false)
})

test('same request ID reuses immutable result, even if model config is subsequently broken', async () => {
  const { db, service, modelCalls } = setup()
  const first = await service.handle(request(), 'owner-a')
  db.records.ai_config[0].provider = 'invalid'
  const second = await service.handle(request(), 'owner-a')
  assert.deepEqual(second, first)
  assert.equal(modelCalls(), 1)
  assert.equal(db.records.valuation_reports.length, 1)
  const conflict = await service.handle(request({ overrides: { areaSqm: 100 } }), 'owner-a')
  assert.equal(conflict.code, 'REQUEST_ID_CONFLICT')
})

test('read uses caller identity and does not expose snapshots or other owners', async () => {
  const { service } = setup()
  const first = await service.handle(request(), 'owner-a')
  const query = { action: 'getEvaluation', valuationId: first.report.valuationId }
  const own = await service.handle(query, 'owner-a')
  assert.deepEqual(own.report, first.report)
  assert.equal('inputSnapshot' in own.report, false)
  const other = await service.handle(query, 'owner-b')
  assert.equal(other.code, 'REPORT_NOT_FOUND')
  const missing = await service.handle({ ...query, valuationId: 'v_' + '0'.repeat(30) }, 'owner-b')
  assert.deepEqual(missing, other)
})

test('simultaneous requests reserve once and call the model once', async () => {
  let unblock, notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const wait = new Promise(resolve => { unblock = resolve })
  let calls = 0
  const { service } = setup({ generate: async ({ context, baseline }) => {
    calls++; notifyStarted(); await wait
    return { estimate: estimate(context, baseline), usage: {}, model: 'test', provider: 'deepseek' }
  } })
  const pending = service.handle(request(), 'owner-a')
  await started
  const duplicate = await service.handle(request(), 'owner-a')
  assert.equal(duplicate.report.status, 'processing')
  unblock()
  assert.equal((await pending).report.status, 'model_estimate')
  assert.equal(calls, 1)
})

test('no key produces an explicit rule result without a remote call', async () => {
  const { service, modelCalls } = setup({ environment: {} })
  const { report } = await service.handle(request(), 'owner-a')
  assert.equal(report.status, 'rule_only')
  assert.equal(report.fallbackReason, 'MODEL_NOT_CONFIGURED')
  assert.equal(report.modelUnitPrice, null)
  assert.equal(report.effectiveSource, 'rule')
  assert.equal(modelCalls(), 0)
})

test('disabled model and malformed output both fall back with distinct reasons', async () => {
  const disabled = setup()
  disabled.db.records.ai_config[0].enabled = false
  assert.equal((await disabled.service.handle(request(), 'owner-a')).report.fallbackReason, 'MODEL_DISABLED')
  const bad = setup({ generate: async () => ({ estimate: { unitPrice: -1 }, usage: {} }) })
  const result = await bad.service.handle(request(), 'owner-a')
  assert.equal(result.report.status, 'rule_only')
  assert.equal(result.report.fallbackReason, 'MODEL_VALIDATION_FAILED')
  assert.equal(result.report.modelEstimate, null)
})

test('provider errors return stable codes without leaking raw error messages', async () => {
  const { service } = setup({ generate: async () => { throw Object.assign(new Error('TEST_SECRET private response'), { code: 'MODEL_TIMEOUT' }) } })
  const result = await service.handle(request(), 'owner-a')
  assert.equal(result.report.status, 'rule_only')
  assert.equal(result.report.fallbackReason, 'MODEL_TIMEOUT')
  assert.equal(JSON.stringify(result).includes('TEST_SECRET'), false)
})

test('uncalibrated model candidate is retained for review, without becoming the effective price', async () => {
  const { db, service } = setup({ generate: async ({ context, baseline }) => ({ estimate: { ...estimate(context, baseline), unitPrice: 19800 }, usage: {} }) })
  db.records.ai_config[0].maxDeviationRatio = null
  const { report } = await service.handle(request(), 'owner-a')
  assert.equal(report.status, 'needs_review')
  assert.equal(report.modelUnitPrice, 19800)
  assert.equal(report.effectiveUnitPrice, 19000)
  assert.equal(report.effectiveSource, 'rule')
  assert.equal(report.priceRange, null)
  assert.equal(report.modelEstimate.priceRange.high, 19950)
})

test('candidate above the filing ceiling stays available for review without becoming the effective price', async () => {
  const { db, service } = setup({
    generate: async ({ context, baseline }) => ({ estimate: { ...estimate(context, baseline), unitPrice: 18500 }, usage: {} })
  })
  db.records.communities[0].reference = { beian_price: 18000 }
  const { report } = await service.handle(request(), 'owner-a')
  assert.equal(report.status, 'needs_review')
  assert.equal(report.modelUnitPrice, 18500)
  assert.equal(report.baseline.cappedByFiling, true)
  assert.equal(report.effectiveUnitPrice, 18000)
  assert.equal(report.totalPriceYuan, 1620000)
  assert.match(report.reviewReasons.join(''), /备案价上限/)
})

test('missing area never borrows average community area or fabricates a total', async () => {
  const { db, service } = setup()
  delete db.records.houses[0].area_sqm
  db.records.communities[0].base = { averageArea: 100 }
  const { report } = await service.handle(request(), 'owner-a')
  assert.equal(report.status, 'needs_review')
  assert.equal(report.totalPriceYuan, null)
  assert.ok(report.missingFields.includes('areaSqm'))
  assert.equal(report.modelEstimate.totalPriceYuan, null)
})

test('community result has no single-house area or total', async () => {
  const { service } = setup()
  const { report } = await service.handle(request({ targetType: 'community', communityId: 'c1', houseId: undefined }), 'owner-a')
  assert.equal(report.target.type, 'community')
  assert.equal(report.target.areaSqm, null)
  assert.equal(report.totalPriceYuan, null)
})

test('no market evidence returns insufficient_data and no zero-valued estimate', async () => {
  const { db, service, modelCalls } = setup()
  db.records.houses.splice(1)
  db.records.communities[0].price = {}
  const { report } = await service.handle(request(), 'owner-a')
  assert.equal(report.status, 'insufficient_data')
  assert.equal(report.effectiveUnitPrice, null)
  assert.equal(report.totalPriceYuan, null)
  assert.equal(modelCalls(), 0)
})

test('bad input and caller-supplied prices/owner are rejected before a model call', async () => {
  const { service, modelCalls } = setup()
  for (const event of [null, [], {}, request({ context: { evaluation: 1 } }), request({ owner: 'other' }), request({ overrides: { areaSqm: -1 } }), request({ overrides: { floor: 10, totalFloors: 5 } }), request({ purpose: 'unknown' }), request({ requestId: ' ' }), request({ action: 'admin' })]) {
    assert.equal((await service.handle(event, 'owner-a')).code, 'INVALID_REQUEST')
  }
  assert.equal((await service.handle(request(), null)).code, 'UNAUTHORIZED')
  assert.equal(modelCalls(), 0)
})

test('database failure is a failed report, never an apparently empty market', async () => {
  const { db, service } = setup({ readData: async () => { throw Object.assign(new Error('permission denied'), { code: 'DATA_QUERY_FAILED' }) } })
  const result = await service.handle(request(), 'owner-a')
  assert.equal(result.code, 'DATA_READ_FAILED')
  assert.equal(db.records.valuation_reports[0].status, 'failed')
})

test('missing targets and configuration errors are exposed as stable business codes', async () => {
  const { db, service } = setup()
  assert.equal((await service.handle(request({ houseId: 'unknown' }), 'owner-a')).code, 'TARGET_NOT_FOUND')
  db.records.ai_config[0].provider = 'unknown'
  assert.equal((await service.handle(request({ requestId: 'request-2' }), 'owner-a')).code, 'CONFIG_INVALID')
})

test('an expired lease cannot silently start a second assessment with the same request ID', async () => {
  const { db, service, modelCalls } = setup()
  const first = await service.handle(request(), 'owner-a')
  const row = db.records.valuation_reports[0]
  row.status = 'processing'; row.expiresAt = '2026-11-16T00:00:00Z'; delete row.result
  const result = await service.handle({ action: 'getEvaluation', valuationId: first.report.valuationId }, 'owner-a')
  assert.equal(result.report.status, 'failed')
  assert.equal(result.report.failureReason, 'PROCESSING_EXPIRED')
  assert.equal((await service.handle(request(), 'owner-a')).report.retryWithNewRequestId, true)
  assert.equal(modelCalls(), 1)
})

test('failed persistence cannot return a successful model report', async () => {
  const db = memoryDb(seed())
  const repository = createRepository(db)
  repository.finish = async () => { throw Object.assign(new Error('write failed'), { code: 'REPORT_WRITE_FAILED' }) }
  const { service } = setup({ db, repository })
  assert.equal((await service.handle(request(), 'owner-a')).code, 'REPORT_WRITE_FAILED')
})

test('storage operations have bounded waits, including initial reads and final saves', async () => {
  const hanging = () => new Promise(() => {})
  const slowRead = setup({ storageBudgetMs: 10, repository: { get: hanging } })
  assert.equal((await slowRead.service.handle(request(), 'owner-a')).code, 'REPORT_READ_FAILED')
  assert.equal((await slowRead.service.handle({ action: 'getEvaluation', valuationId: 'v_' + '1'.repeat(30) }, 'owner-a')).code, 'REPORT_READ_FAILED')
  const db = memoryDb(seed())
  const repository = createRepository(db)
  repository.finish = hanging
  const slowSave = setup({ db, repository, storageBudgetMs: 10 })
  assert.equal((await slowSave.service.handle(request(), 'owner-a')).code, 'REPORT_WRITE_FAILED')
})
