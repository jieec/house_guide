const test = require('node:test')
const assert = require('node:assert/strict')
const client = require('../utils/valuation-client')
const { toValuationView } = require('../utils/valuation-result')

test('explicit local scenarios use synthetic data and never touch cloud', async () => {
  let called = 0
  global.wx = { cloud: { callFunction() { called++; throw new Error('unexpected cloud call') }, database() { called++; throw new Error('unexpected database call') } } }
  for (const scenario of client.SCENARIOS.filter(item => item.key !== 'error')) {
    const item = await client.loadHouse('demo-house-001', { demo: true, scenario: scenario.key })
    assert.match(item.title, /演示/)
    const report = await client.createEvaluation({ targetType: 'house', houseId: item._id }, { demo: true, scenario: scenario.key })
    assert.equal(report.isDemo, true)
    assert.match(report.demoLabel, /非真实模型估价/)
    const saved = await client.getEvaluation(report.valuationId, { demo: true })
    assert.deepEqual(saved, report)
    saved.effectiveUnitPrice = 1
    assert.notEqual((await client.getEvaluation(report.valuationId, { demo: true })).effectiveUnitPrice, 1)
  }
  assert.equal(called, 0)
  await assert.rejects(client.createEvaluation({ targetType: 'house' }, { demo: true, scenario: 'error' }), { code: 'DEMO_REQUEST_FAILED' })
  delete global.wx
})

test('normal, review and timeout preserve adopted-versus-candidate semantics', async () => {
  const create = scenario => client.createEvaluation({ targetType: 'house' }, { demo: true, scenario })
  const normal = await create('normal')
  assert.equal(normal.effectiveUnitPrice, 26000)
  assert.equal(normal.totalPriceYuan, 2340000)
  const review = await create('review')
  assert.equal(review.modelUnitPrice, 28000)
  assert.equal(review.effectiveUnitPrice, 25000)
  assert.equal(review.totalPriceYuan, 2250000)
  assert.equal(review.priceRange, null)
  const timeout = await create('timeout')
  assert.equal(timeout.status, 'rule_only')
  assert.equal(timeout.fallbackReason, 'MODEL_TIMEOUT')
  assert.equal(timeout.modelEstimate, null)
})

test('missing area and insufficient evidence never fabricate a zero/average total', async () => {
  const missing = await client.createEvaluation({ targetType: 'house' }, { demo: true, scenario: 'missing_area' })
  assert.equal(missing.target.areaSqm, null)
  assert.equal(missing.totalPriceYuan, null)
  assert.equal(toValuationView(missing).totalPrice, '暂无')
  const community = await client.createEvaluation({ targetType: 'community' }, { demo: true })
  assert.equal(community.target.areaSqm, null)
  assert.equal(community.totalPriceYuan, null)
  const insufficient = await client.createEvaluation({ targetType: 'house' }, { demo: true, scenario: 'insufficient' })
  assert.equal(insufficient.effectiveUnitPrice, null)
  assert.equal(toValuationView(insufficient).effectivePrice, '暂无')
})

test('live failure never silently falls back to a local report', async () => {
  let called = 0
  global.wx = { cloud: { callFunction: async () => { called++; throw new Error('Environment not found') } } }
  await assert.rejects(client.createEvaluation({ targetType: 'house', houseId: 'live-id' }), /Environment not found/)
  assert.equal(called, 1)
  delete global.wx
})

test('legacy cloud response and accidental demo response are rejected in live mode', async () => {
  global.wx = { cloud: { callFunction: async () => ({ result: { ok: true, content: '旧接口' } }) } }
  await assert.rejects(client.createEvaluation({ targetType: 'house', houseId: 'live-id' }), { code: 'INVALID_REPORT' })
  const demo = await client.createEvaluation({ targetType: 'house' }, { demo: true })
  global.wx.cloud.callFunction = async () => ({ result: { ok: true, report: demo } })
  await assert.rejects(client.createEvaluation({ targetType: 'house', houseId: 'live-id' }), { code: 'INVALID_REPORT_SOURCE' })
  await assert.rejects(client.getEvaluation(demo.valuationId), { code: 'INVALID_REPORT_SOURCE' })
  delete global.wx
})

test('live calls submit only the new action and unwrap the validated report', async () => {
  const report = await client.createEvaluation({ targetType: 'community' }, { demo: true })
  delete report.isDemo
  report.valuationId = 'v_' + 'a'.repeat(30)
  let request
  global.wx = { cloud: { callFunction: async options => { request = options; return { result: { ok: true, report } } } } }
  const response = await client.createEvaluation({ targetType: 'community', communityId: 'c1', requestId: 'fixed-request' })
  assert.equal(request.name, 'aiChat')
  assert.equal(request.data.action, 'createEvaluation')
  assert.equal(request.data.requestId, 'fixed-request')
  assert.deepEqual(response, report)
  delete global.wx
})
