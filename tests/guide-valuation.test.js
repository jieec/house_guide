const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const scenarios = ['normal', 'review', 'timeout', 'missing_area', 'insufficient', 'error'].map(key => ({ key, label: key }))
function doc(id = 'demo-community-001') {
  return { _id: id, community: '演示花园', city: '演示市', district: '演示区', propertyType: '住宅',
    base: { averageArea: 90, completionTime: '2018' },
    price: { price: 25000, listingPrice: 27800, recentDealPrice: 25200, rentPerSqm: 50 } }
}
function market() {
  return { sales: [{ unit_price: 27800, area_sqm: 90, total_price: '250.2万', rooms: '3室2厅' }], rents: [], auctionDeals: [], cityResult: { price: 23000 }, policies: [], competitorStats: [] }
}
function report(id = 'demo-community-001', extras = {}) {
  return { valuationId: 'demo-report-' + id, status: 'model_estimate', target: { id, type: 'community', name: '演示花园', areaSqm: null },
    effectiveUnitPrice: 26000, effectiveSource: 'model', baselineUnitPrice: 25000, modelUnitPrice: 26000,
    totalPriceYuan: null, missingFields: [], warnings: [], evidence: [], ...extras }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
function setup(clientOverrides = {}) {
  let definition, requests = [], cloudCalls = 0, exports = 0, requestCount = 0
  const app = { globalData: { location: { province: '广东省', city: '广州市', district: '海珠区' } } }
  const client = {
    SCENARIOS: scenarios, newRequestId: () => 'new-request-' + (++requestCount),
    getDemoCommunity: () => doc(), getDemoMarket: () => market(),
    async createEvaluation(request, options) { requests.push({ request, options }); return report(request.communityId) },
    async getEvaluation() { throw new Error('unexpected poll') }, ...clientOverrides
  }
  const wx = {
    cloud: { database() { cloudCalls++; throw new Error('Cloud must not be used by demo') } },
    showToast() {}, navigateTo() {}
  }
  const source = fs.readFileSync(path.join(__dirname, '../pages/guide/guide.js'), 'utf8')
  vm.runInNewContext(source, { getApp: () => app, wx, Page: page => { definition = page },
    require: name => {
      if (name.endsWith('valuation-client.js')) return client
      if (name.endsWith('valuation-result.js')) return { canExportValuation: value => !!(value && ['model_estimate', 'needs_review', 'rule_only', 'insufficient_data'].includes(value.status)) }
      if (name.endsWith('report-export.js')) return { exportReport: async page => { exports++; return { ok: true, valuationId: page.data.valuationReport.valuationId } } }
      throw new Error('unexpected dependency ' + name)
    }, console, Date, setTimeout, clearTimeout, encodeURIComponent })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = patch => Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.')
    let cursor = page.data
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {}
    cursor[parts[parts.length - 1]] = value
  })
  function facts(id = 'demo-community-001') {
    const selected = doc(id)
    page.data.selectedCommunity = selected
    page._reportFacts = { doc: selected, market: market() }
    page.rebuildReport()
  }
  return { page, app, wx, client, requests, facts, cloudCalls: () => cloudCalls, exports: () => exports }
}

test('explicit guide demo consumes handoff, never queries cloud, and preserves actual location', async () => {
  const ctx = setup()
  ctx.app.globalData.valuationDemo = true
  await ctx.page.onShow()
  assert.equal(ctx.app.globalData.valuationDemo, undefined)
  assert.equal(ctx.app.globalData.location.city, '广州市')
  assert.equal(ctx.cloudCalls(), 0)
  assert.equal(ctx.requests.length, 1)
  assert.equal(ctx.requests[0].options.demo, true)
  assert.equal(ctx.page.data.valuationReport.target.type, 'community')
  assert.equal(ctx.page.data.report.evaluation, 26000)
  assert.equal(ctx.page.data.report.evaluationDisplay, '26000')
  assert.equal(ctx.page.data.report.prices.find(item => item.key === 'evaluation').amount, 26000)
  assert.equal(ctx.page.data.report.evalDeviation, '-6.5%')
  assert.equal(ctx.page.data.valuationExportable, true)
})

test('ordinary mode does not turn a cloud error into demonstration data', async () => {
  const ctx = setup({ createEvaluation: async () => { throw new Error('Environment not found') } })
  ctx.facts('real-community')
  await ctx.page.runValuation()
  assert.equal(ctx.page.data.demoMode, false)
  assert.equal(ctx.page.data.valuationReport, null)
  assert.match(ctx.page.data.valuationError, /Environment not found/)
  assert.equal(ctx.page.data.valuationExportable, false)
  await ctx.page.exportPdf()
  assert.equal(ctx.exports(), 0)
})

test('insufficient server result stays null and never falls back to local price or zero', () => {
  const { page, facts } = setup()
  facts()
  const result = page.rebuildReport(report('demo-community-001', { status: 'insufficient_data', effectiveUnitPrice: null, effectiveSource: null }))
  assert.equal(result.evaluation, null)
  assert.equal(result.evaluationDisplay, '—')
  assert.equal(result.prices.find(item => item.key === 'evaluation').amount, null)
  assert.equal(result.prices.find(item => item.key === 'evaluation').hasData, false)
  assert.equal(result.evalDeviation, '暂无数据')
})

test('review candidate never replaces adopted rule price in charts or advice inputs', () => {
  const { page, facts } = setup()
  facts()
  let adviceEvaluation
  const original = page.buildAdvice
  page.buildAdvice = function (data) { adviceEvaluation = data.evaluation; return original.call(this, data) }
  const valuation = report('demo-community-001', { status: 'needs_review', effectiveUnitPrice: 25000, effectiveSource: 'rule', modelUnitPrice: 28000 })
  const result = page.rebuildReport(valuation)
  assert.equal(result.evaluation, 25000)
  assert.equal(result.evaluationDisplay, '25000')
  assert.equal(result.prices.find(item => item.key === 'evaluation').amount, 25000)
  assert.equal(adviceEvaluation, 25000)
  assert.match(result.evaluationNote, /公式参考价/)
})

test('late result from another community cannot replace current valuation', async () => {
  const first = deferred(), second = deferred()
  const ctx = setup({ createEvaluation: request => request.communityId === 'A' ? first.promise : second.promise })
  ctx.facts('A')
  const old = ctx.page.runValuation()
  ctx.page.clearSelection()
  ctx.facts('B')
  const current = ctx.page.runValuation()
  second.resolve(report('B', { effectiveUnitPrice: 27000 }))
  await current
  first.resolve(report('A', { effectiveUnitPrice: 10000 }))
  await old
  assert.equal(ctx.page.data.valuationReport.target.id, 'B')
  assert.equal(ctx.page.data.report.evaluation, 27000)
})

test('late error from a previous community cannot clear the new report', async () => {
  const first = deferred(), second = deferred()
  const ctx = setup({ createEvaluation: request => request.communityId === 'A' ? first.promise : second.promise })
  ctx.facts('A')
  const old = ctx.page.runValuation()
  ctx.page.clearSelection(); ctx.facts('B')
  const current = ctx.page.runValuation()
  second.resolve(report('B')); await current
  first.reject(new Error('old cloud error')); await old
  assert.equal(ctx.page.data.valuationReport.target.id, 'B')
  assert.equal(ctx.page.data.valuationError, '')
})

test('clearing search invalidates the current result and pending request', async () => {
  const pending = deferred()
  const ctx = setup({ createEvaluation: () => pending.promise })
  ctx.facts()
  const request = ctx.page.runValuation()
  ctx.page.onKeyword({ detail: { value: '' } })
  pending.resolve(report()); await request
  assert.equal(ctx.page.data.selectedCommunity, null)
  assert.equal(ctx.page.data.valuationReport, null)
  assert.equal(ctx.page.data.valuationLoading, false)
  assert.equal(ctx.page.data.valuationExportable, false)
})

test('exit demo and unload discard in-flight results without touching real location', async () => {
  const pending = deferred()
  const ctx = setup({ createEvaluation: () => pending.promise })
  const request = ctx.page.enterDemo()
  await Promise.resolve()
  ctx.page.exitDemo()
  pending.resolve(report()); await request
  assert.equal(ctx.page.data.demoMode, false)
  assert.equal(ctx.page.data.selectedCommunity, null)
  assert.equal(ctx.page.data.valuationReport, null)
  assert.equal(ctx.page.data.location.city, '广州市')
  ctx.facts()
  const next = deferred()
  ctx.client.createEvaluation = () => next.promise
  const current = ctx.page.runValuation()
  ctx.page.onUnload()
  next.resolve(report()); await current
  assert.equal(ctx.page.data.valuationReport, null)
})

test('demo scenario switch replaces old data and resets export until completion', async () => {
  const ctx = setup({ createEvaluation: async (request, options) => report(request.communityId, options.scenario === 'timeout' ? { status: 'rule_only', effectiveUnitPrice: 25000, effectiveSource: 'rule', modelUnitPrice: null } : {}) })
  await ctx.page.enterDemo()
  await ctx.page.onDemoScenarioChange({ detail: { value: '2' } })
  assert.equal(ctx.page.data.demoScenario, 'timeout')
  assert.equal(ctx.page.data.valuationReport.status, 'rule_only')
  assert.equal(ctx.page.data.report.evaluation, 25000)
  assert.equal(ctx.cloudCalls(), 0)
})

test('processing results poll the same valuation ID instead of creating new reports', async () => {
  let creates = 0, polls = 0
  const ctx = setup({ createEvaluation: async () => { creates++; return { status: 'processing', valuationId: 'pending-id' } },
    getEvaluation: async id => { polls++; assert.equal(id, 'pending-id'); return report() } })
  ctx.facts()
  await ctx.page.runValuation()
  assert.equal(ctx.page.data.valuationReport.status, 'processing')
  assert.equal(ctx.page.data.valuationExportable, false)
  assert.equal(ctx.page.data.report.evaluation, null)
  await ctx.page.runValuation()
  assert.equal(creates, 1)
  assert.equal(polls, 1)
  assert.equal(ctx.page.data.valuationReport.status, 'model_estimate')
})

test('export is blocked for busy, dirty, error, absent and processing reports', async () => {
  const ctx = setup()
  ctx.facts()
  for (const patch of [
    { valuationReport: null },
    { valuationReport: report(), valuationLoading: true },
    { valuationReport: report(), valuationDirty: true },
    { valuationReport: report(), valuationError: 'error' },
    { valuationReport: { status: 'processing', valuationId: 'pending-id' } }
  ]) {
    ctx.page.setData({ valuationLoading: false, valuationDirty: false, valuationError: '', ...patch })
    await ctx.page.exportPdf()
  }
  assert.equal(ctx.exports(), 0)
  ctx.page.setData({ valuationReport: report(), valuationLoading: false, valuationDirty: false, valuationError: '' })
  const exported = await ctx.page.exportPdf()
  assert.equal(exported.valuationId, ctx.page.data.valuationReport.valuationId)
  assert.equal(ctx.exports(), 1)
})

test('live market reads finishing after selection clear cannot bring stale report back', async () => {
  const wait = deferred()
  const ctx = setup()
  ctx.wx.cloud.database = () => ({ command: { or: values => values }, collection: () => ({ where: () => ({ limit: () => ({ get: () => wait.promise }) }) }) })
  ctx.page.queryCityAverage = async () => ({})
  ctx.page.queryCompetitors = async () => []
  ctx.page.queryAuctionDeals = async () => []
  ctx.page.data.selectedCommunity = doc('A')
  const pending = ctx.page.loadReport(ctx.page.data.selectedCommunity)
  ctx.page.clearSelection()
  wait.resolve({ data: [] }); await pending
  assert.equal(ctx.page.data.selectedCommunity, null)
  assert.equal(ctx.page.data.loading, false)
  assert.equal(ctx.page.data.valuationReport, null)
  assert.equal(ctx.page._reportFacts, null)
})

test('original guide preview can still instantiate Page without loading client modules', () => {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/guide/guide.js'), 'utf8'), {
    getApp: () => ({ globalData: {} }), require: () => ({}), Page: value => { page = value }, console, Date, setTimeout, clearTimeout
  })
  const result = page.buildReport(doc(), market(), {}, [], [])
  assert.ok(result.evaluation > 0)
  assert.match(result.evaluationNote, /本地公式参考/)
})

test('guide integrates with real shared local fixtures for all six scenarios without cloud access', async () => {
  let pageDefinition
  const app = { globalData: {} }
  let cloudCalls = 0
  const wx = { cloud: { database() { cloudCalls++; throw new Error('unexpected cloud read') }, callFunction() { cloudCalls++; throw new Error('unexpected cloud function') } }, showToast() {} }
  const actualClient = require('../utils/valuation-client')
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/guide/guide.js'), 'utf8'), {
    getApp: () => app, wx, Page: value => { pageDefinition = value },
    require: name => name.endsWith('valuation-client.js') ? actualClient : name.endsWith('valuation-result.js') ? require('../utils/valuation-result') : { exportReport: async () => ({ ok: true }) },
    console, Date, setTimeout, clearTimeout, encodeURIComponent
  })
  const page = { ...pageDefinition, data: JSON.parse(JSON.stringify(pageDefinition.data)), setData(patch) { Object.assign(this.data, patch) } }
  for (const key of ['normal', 'review', 'timeout', 'missing_area', 'insufficient', 'error']) {
    await page.enterDemo(key)
    assert.equal(page.data.demoMode, true)
    if (key === 'error') {
      assert.equal(page.data.valuationReport, null)
      assert.ok(page.data.valuationError)
      assert.equal(page.data.valuationExportable, false)
    } else {
      const result = page.data.valuationReport
      assert.equal(result.isDemo, true)
      assert.equal(result.target.type, 'community')
      assert.equal(result.totalPriceYuan, null)
      assert.equal(page.data.report.evaluation, result.effectiveUnitPrice)
      assert.equal(page.data.report.prices.find(item => item.key === 'evaluation').amount, result.effectiveUnitPrice)
      assert.equal(page.data.report.valuationId, result.valuationId)
      assert.equal(page.data.valuationExportable, true)
    }
  }
  assert.equal(cloudCalls, 0)
})

test('timeout and network retries reuse request ID; successful or business-error requests do not', async () => {
  for (const code of ['CLIENT_TIMEOUT', 'CLOUD_REQUEST_FAILED']) {
    const calls = []
    const ctx = setup({ createEvaluation: async request => {
      calls.push({ ...request })
      if (calls.length === 1) throw Object.assign(new Error('network pending'), { code })
      return report(request.communityId)
    } })
    ctx.facts('A')
    await ctx.page.runValuation()
    await ctx.page.runValuation()
    assert.equal(calls[0].requestId, calls[1].requestId)
    assert.equal(ctx.page._retryRequest, null)
    await ctx.page.runValuation()
    assert.notEqual(calls[1].requestId, calls[2].requestId)
  }
  const businessCalls = []
  const ctx = setup({ createEvaluation: async request => {
    businessCalls.push({ ...request })
    if (businessCalls.length === 1) throw Object.assign(new Error('bad config'), { code: 'CONFIG_INVALID' })
    return report(request.communityId)
  } })
  ctx.facts('A')
  await ctx.page.runValuation(); await ctx.page.runValuation()
  assert.notEqual(businessCalls[0].requestId, businessCalls[1].requestId)
})

test('switching target clears a timed-out request identity and creates a new one', async () => {
  const calls = []
  const ctx = setup({ createEvaluation: async request => {
    calls.push({ ...request })
    if (calls.length === 1) throw Object.assign(new Error('network pending'), { code: 'CLIENT_TIMEOUT' })
    return report(request.communityId)
  } })
  ctx.facts('A')
  await ctx.page.runValuation()
  assert.ok(ctx.page._retryRequest)
  ctx.page.clearSelection()
  assert.equal(ctx.page._retryRequest, null)
  ctx.facts('B')
  await ctx.page.runValuation()
  assert.notEqual(calls[0].requestId, calls[1].requestId)
  assert.equal(calls[1].communityId, 'B')
})

test('a poll timeout preserves the report ID for the next progress query', async () => {
  let creates = 0, polls = 0
  const ctx = setup({ createEvaluation: async () => { creates++; return { status: 'processing', valuationId: 'pending-id' } },
    getEvaluation: async id => {
      assert.equal(id, 'pending-id')
      polls++
      if (polls === 1) throw Object.assign(new Error('network pending'), { code: 'CLOUD_REQUEST_FAILED' })
      return report()
    } })
  ctx.facts()
  await ctx.page.runValuation(); await ctx.page.runValuation(); await ctx.page.runValuation()
  assert.equal(creates, 1)
  assert.equal(polls, 2)
  assert.equal(ctx.page.data.valuationReport.status, 'model_estimate')
})
