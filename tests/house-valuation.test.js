const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SCENARIOS = [
  { key: 'normal', label: '正常估价' }, { key: 'review', label: '待复核' },
  { key: 'timeout', label: '模型超时' }, { key: 'missing_area', label: '缺少面积' },
  { key: 'insufficient', label: '数据不足' }, { key: 'error', label: '请求失败' }
]
const listing = extras => ({ _id: 'h1', category: '二手房', city: '示例城市', community: '演示小区', title: '演示房源', area_sqm: 90, unit_price: 28000, total_price: 252, ...extras })
const report = extras => ({ valuationId: 'demo-valuation-1', status: 'model_estimate', effectiveSource: 'model',
  baselineUnitPrice: 25000, modelUnitPrice: 26000, effectiveUnitPrice: 26000, totalPriceYuan: 2340000,
  target: { type: 'house', id: 'h1', areaSqm: 90 }, missingFields: [], ...extras })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(overrides = {}) {
  let definition
  const calls = [], exports = [], toasts = []
  const app = { globalData: {} }
  const client = {
    SCENARIOS, newRequestId: () => 'request-' + calls.length,
    loadHouse: async (id, options) => { calls.push(['load', id, options]); return listing({ _id: id }) },
    createEvaluation: async (request, options) => { calls.push(['create', request, options]); return report({ target: { type: 'house', id: request.houseId, areaSqm: request.overrides ? request.overrides.areaSqm : 90 } }) },
    getEvaluation: async (id, options) => { calls.push(['get', id, options]); return report() },
    ...overrides
  }
  const wx = { showToast: value => toasts.push(value), switchTab: value => calls.push(['tab', value]), makePhoneCall() {} }
  const requireStub = name => {
    if (name.endsWith('/banks.js')) return []
    if (name.endsWith('/valuation-client.js')) return client
    if (name.endsWith('/report-export.js')) return { exportReport: async page => { exports.push(JSON.parse(JSON.stringify(page.data))); return { ok: true } } }
    throw new Error('Unexpected module: ' + name)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/houses/analyze/analyze.js'), 'utf8'), {
    Page: value => { definition = value }, require: requireStub, wx, getApp: () => app, console
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, client, calls, exports, toasts, app }
}
function input(field, value) { return { currentTarget: { dataset: { field } }, detail: { value } } }


test('listing prices do not become appraisals and house-type ranges do not become measured area', () => {
  const { page } = harness()
  const parsed = page.parseListing(listing({ area_sqm: undefined, house_types: '80~100平米' }))
  assert.equal(parsed.evalPer, '')
  assert.equal(parsed.area, '')
  assert.equal(parsed.salePer, '28000')
  assert.equal(page.parseListing(listing({ unit_price: { $numberInt: '28000' }, area_sqm: { $numberDouble: '90' } })).area, '90')
})

test('live mode loads real property without silently running a model or enabling demo', async () => {
  const { page, calls } = harness()
  await page.onLoad({ id: 'h1', demo: '0' })
  assert.equal(page.data.demoMode, false)
  assert.equal(page.data.item._id, 'h1')
  assert.equal(page.data.evalPer, '')
  assert.equal(page.data.canExport, false)
  assert.deepEqual(calls.map(c => c[0]), ['load'])
  assert.equal(calls[0][2].demo, false)
})

test('explicit demo mode loads and generates one report without cloud access', async () => {
  const { page, calls } = harness()
  await page.onLoad({ demo: '1' })
  assert.equal(page.data.demoMode, true)
  assert.equal(page.data.item._id, 'demo-house-001')
  assert.equal(page.data.valuationReport.target.id, 'demo-house-001')
  assert.equal(page.data.evalPer, '26000')
  assert.equal(page.data.canExport, true)
  assert.deepEqual(calls.map(c => c[0]), ['load', 'create'])
  assert.equal(calls[0][2].demo, true)
  assert.equal(calls[1][2].demo, true)
})

test('failed live load shows an error and never creates a demo property', async () => {
  let creates = 0
  const { page } = harness({ loadHouse: async () => { throw new Error('Environment not found') }, createEvaluation: async () => { creates++ } })
  await page.onLoad({ id: 'real-house' })
  assert.equal(page.data.item, null)
  assert.equal(page.data.loadError, 'Environment not found')
  assert.equal(page.data.demoMode, false)
  assert.equal(page.data.canExport, false)
  assert.equal(creates, 0)
})

test('review calculations use adopted rule price, not the model candidate or editable evalPer', async () => {
  const { page } = harness({ createEvaluation: async () => report({ status: 'needs_review', effectiveSource: 'rule', effectiveUnitPrice: 25000, modelUnitPrice: 28000, totalPriceYuan: 2250000 }) })
  await page.onLoad({ id: 'h1' })
  await page.runValuation()
  assert.equal(page.data.evalPer, '25000')
  assert.equal(page.data.loanAmount, '1912500')
  page.onInput(input('evalPer', '1'))
  assert.equal(page.data.evalPer, '25000')
  assert.equal(page.data.loanAmount, '1912500')
})

test('missing area clears previous financial values and does not fabricate a total', async () => {
  const { page } = harness({ createEvaluation: async () => report({ status: 'needs_review', target: { type: 'house', id: 'h1', areaSqm: null }, totalPriceYuan: null, missingFields: ['areaSqm'] }) })
  await page.onLoad({ id: 'h1' })
  page.setData({ monthly: 'stale', loanAmount: 'stale', totalTax: 'stale' })
  await page.runValuation()
  assert.equal(page.data.area, '')
  assert.equal(page.data.monthly, '')
  assert.equal(page.data.loanAmount, '')
  assert.equal(page.data.totalTax, '')
  assert.equal(page.data.valuationReport.totalPriceYuan, null)
  assert.equal(page.data.canExport, true)
  assert.match(page.data.missingTip, /房源面积/)
})

test('editing area invalidates the old snapshot and submits explicit manual area on regeneration', async () => {
  const { page, calls } = harness()
  await page.onLoad({ id: 'h1' }); await page.runValuation()
  page.onInput(input('area', '100'))
  assert.equal(page.data.valuationReport, null)
  assert.equal(page.data.valuationDirty, true)
  assert.equal(page.data.canExport, false)
  assert.equal(page.data.monthly, '')
  await page.runValuation()
  assert.equal(calls.filter(c => c[0] === 'create')[1][1].overrides.areaSqm, 100)
  assert.equal(page.data.valuationDirty, false)
  assert.equal(page.data.area, '100')
})

test('changing purpose during a request discards the old result', async () => {
  const pending = deferred()
  const { page } = harness({ createEvaluation: () => pending.promise })
  await page.onLoad({ id: 'h1' })
  const run = page.runValuation()
  page.onPurpose({ detail: { value: '2' } })
  pending.resolve(report())
  await run
  assert.equal(page.data.purposeIndex, 2)
  assert.equal(page.data.valuationReport, null)
  assert.equal(page.data.canExport, false)
  assert.equal(page.data.valuationDirty, true)
  assert.equal(page.data.monthly, '')
})

test('a response from a previous demo scenario cannot replace the newer scenario', async () => {
  const old = deferred()
  let count = 0
  const { page } = harness({ createEvaluation: async request => {
    count++
    if (count === 1) return old.promise
    return report({ valuationId: 'new-scenario', target: { type: 'house', id: request.houseId, areaSqm: 90 } })
  } })
  await page.onLoad({ id: 'h1' })
  page.setData({ demoMode: true })
  const first = page.runValuation()
  await page.onDemoScenario({ detail: { value: '1' } })
  old.resolve(report({ valuationId: 'old-scenario' }))
  await first
  assert.equal(page.data.demoScenario, 'review')
  assert.equal(page.data.valuationReport.valuationId, 'new-scenario')
})

test('request errors clear stale results and disable export', async () => {
  const { page } = harness({ createEvaluation: async () => { throw new Error('模拟请求失败') } })
  await page.onLoad({ id: 'h1' })
  page.setData({ valuationReport: report(), monthly: '1000', canExport: true })
  await page.runValuation()
  assert.equal(page.data.valuationReport, null)
  assert.equal(page.data.monthly, '')
  assert.equal(page.data.valuationError, '模拟请求失败')
  assert.equal(page.data.canExport, false)
})

test('processing is queried using the same valuation ID instead of creating a second assessment', async () => {
  let creates = 0, gets = 0
  const { page } = harness({ createEvaluation: async () => { creates++; return { valuationId: 'pending-id', status: 'processing' } },
    getEvaluation: async id => { gets++; assert.equal(id, 'pending-id'); return report() } })
  await page.onLoad({ id: 'h1' })
  await page.runValuation()
  assert.equal(page.data.canExport, false)
  assert.equal(page.data.valuationReport.status, 'processing')
  await page.runValuation()
  assert.equal(creates, 1)
  assert.equal(gets, 1)
  assert.equal(page.data.canExport, true)
})

test('export is blocked while dirty/loading/error and then receives exactly the displayed report', async () => {
  const { page, exports } = harness()
  await page.onLoad({ id: 'h1' })
  await page.exportPdf()
  assert.equal(exports.length, 0)
  await page.runValuation()
  const valuationId = page.data.valuationReport.valuationId
  await page.exportPdf()
  assert.equal(exports.length, 1)
  assert.equal(exports[0].valuationReport.valuationId, valuationId)
  assert.equal(page.data.exportingReport, false)
  page.onInput(input('area', '110'))
  await page.exportPdf()
  assert.equal(exports.length, 1)
})

test('unloading prevents late requests from updating the page', async () => {
  const pending = deferred()
  const { page } = harness({ createEvaluation: () => pending.promise })
  await page.onLoad({ id: 'h1' })
  const run = page.runValuation()
  page.onUnload()
  pending.resolve(report())
  await run
  assert.equal(page.data.valuationReport, null)
})

test('rental calculator remains separate and invalid input clears its old result', async () => {
  const { page } = harness({ loadHouse: async () => listing({ category: '租房', rent_month: 4500 }) })
  await page.onLoad({ id: 'h1' })
  assert.equal(page.data.isRent, true)
  page.setData({ pricePerSqm: '25000' })
  page.calcRentRatio()
  assert.equal(page.data.annualReturn, '2.40%')
  page.setData({ pricePerSqm: '0' })
  page.calcRentRatio()
  assert.equal(page.data.annualReturn, '')
})

test('guide demo handoff is explicit and contains no location or cloud setting mutation', () => {
  const { page, app, calls } = harness()
  page.goGuideDemo()
  assert.equal(calls.length, 0)
  page.setData({ demoMode: true })
  page.goGuideDemo()
  assert.equal(app.globalData.valuationDemo, true)
  assert.equal(calls[0][0], 'tab')
})

test('an ambiguous client timeout retries the original request ID', async () => {
  const sent = []
  const { page } = harness({ createEvaluation: async request => {
    sent.push(request)
    if (sent.length === 1) throw Object.assign(new Error('network timed out'), { code: 'CLIENT_TIMEOUT' })
    return report()
  } })
  await page.onLoad({ id: 'h1' })
  await page.runValuation()
  await page.runValuation()
  assert.equal(sent.length, 2)
  assert.equal(sent[0].requestId, sent[1].requestId)
  assert.equal(page.data.canExport, true)
})

test('measured and manually entered area reject ranges instead of extracting their first number', async () => {
  const { page, calls } = harness()
  for (const area_sqm of ['80~100㎡', '80-100㎡', '约90㎡', '90㎡或100㎡']) {
    assert.equal(page.parseListing(listing({ area_sqm })).area, '')
  }
  assert.equal(page.parseListing(listing({ area_sqm: '89.5平方米' })).area, '89.5')
  await page.onLoad({ id: 'h1' })
  page.onInput(input('area', '80~100'))
  await page.runValuation()
  assert.equal(calls.some(row => row[0] === 'create'), false)
  assert.equal(page.data.canExport, false)
  assert.equal(page.data.valuationDirty, true)
  assert.match(page.data.missingTip, /有效面积/)
})

test('budget tax basis follows current sale unit price and report area, not the old listed total', async () => {
  const { page } = harness()
  await page.onLoad({ id: 'h1' }); await page.runValuation()
  page.onInput(input('salePer', '30000'))
  // Existing fixture's listing total is 252万; edited budget is 30000 × 90 = 270万.
  assert.equal(page.data.deedTax, '27000')
  assert.equal(page.data.incomeTax, '27000')
  page.onInput(input('area', '100'))
  await page.runValuation()
  assert.equal(page.data.area, '100')
  assert.equal(page.data.deedTax, '45000')
  assert.equal(page.data.incomeTax, '30000')
})

test('re-entering the generation method while loading does not issue duplicate model requests', async () => {
  const pending = deferred()
  let requests = 0
  const { page } = harness({ createEvaluation: () => { requests++; return pending.promise } })
  await page.onLoad({ id: 'h1' })
  const first = page.runValuation()
  await page.runValuation()
  assert.equal(requests, 1)
  pending.resolve(report())
  await first
  assert.equal(page.data.canExport, true)
})
