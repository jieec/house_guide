const test = require('node:test')
const assert = require('node:assert/strict')
const exporter = require('../utils/report-export')
const layout = require('../utils/report-layout')

function fixture(extra = {}) {
  return {
    valuationId: 'demo-report-normal-001', status: 'model_estimate', isDemo: true,
    target: { type: 'house', id: 'demo-house-001', name: '演示云栖花园', city: '示例城市', district: '示例区域', propertyType: '住宅', areaSqm: 90, listingUnitPrice: 27800, attributes: { floor: 12, totalFloors: 26, rooms: 3, orientation: '南', decoration: '精装' }, overrides: {} },
    baselineUnitPrice: 25000, modelUnitPrice: 26000, effectiveUnitPrice: 26000, effectiveSource: 'model', totalPriceYuan: 2340000,
    priceRange: { low: 25000, high: 27000 },
    modelEstimate: { unitPrice: 26000, totalPriceYuan: 2340000, priceRange: { low: 25000, high: 27000 }, adjustments: [{ factor: '可比成交', description: '结合所给成交案例形成参考价格。', evidenceIds: ['ev_demo_1'] }], evidenceIds: ['ev_demo_1'], buyerAdvice: '核实房屋现状后结合报价商议。', disposalAdvice: '核实交付条件，按市场参考定位处置。', summary: '演示房源的结构化估价结果。', missingFields: [] },
    buyerAdvice: '核实房屋现状后结合报价商议。', disposalAdvice: '核实交付条件，按市场参考定位处置。', summary: '演示房源的结构化估价结果。',
    evidence: [{ id: 'ev_demo_1', kind: 'sale_deal', unitPrice: 25800, areaSqm: 89, date: '2026-11-10', source: '本地演示成交样本', url: '' }],
    missingFields: [], warnings: [], reviewReasons: [], fallbackReason: null,
    versions: { provider: 'local-demo', model: 'fixture-v1', prompt: 'valuation-json-v1', rule: 'baseline-v1', config: 'demo-config-v1', knowledge: 'demo-knowledge-v1' },
    generatedAt: '2026-11-17T08:00:00.000Z', dataQuality: { asOfDate: '2026-11-17' },
    ...extra
  }
}
function measureContext() {
  return { font: '', measureText(text) { const size = Number((this.font.match(/(\d+)px/) || [0, 18])[1]); return { width: Array.from(String(text)).reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? size : size * .56), 0) } } }
}
function allText(data) { return data.sections.flatMap(section => section.items.map(item => [item.label, item.value, item.note].join(' '))).join('\n') }

test('structured collector uses one valuation snapshot and never reads legacy local forms', () => {
  global.wx = { getStorageSync() { throw new Error('legacy storage must not be read') } }
  const original = fixture()
  const data = exporter.collect({ data: { valuationReport: original, evalPer: 999999, item: { title: 'STALE_PRIVATE_STATE' }, report: { prices: [{ value: '999999' }] } } })
  assert.equal(data.valuationSnapshot.totalPriceYuan, 2340000)
  assert.equal(data.valuationSummary.unitPrice, '26000')
  assert.equal(data.valuationSummary.totalPrice, '2340000 元')
  assert.equal(allText(data).includes('999999'), false)
  assert.equal(allText(data).includes('STALE_PRIVATE_STATE'), false)
  assert.equal(allText(data).includes('[object Object]'), false)
  original.effectiveUnitPrice = 1
  original.target.areaSqm = 1
  assert.equal(data.valuationSnapshot.effectiveUnitPrice, 26000)
  assert.equal(data.valuationSnapshot.target.areaSqm, 90)
})

test('review candidate is clearly separated from the rule price used by the report', () => {
  const data = exporter.collect({ data: { valuationReport: fixture({ status: 'needs_review', effectiveUnitPrice: 25000, effectiveSource: 'rule', totalPriceYuan: 2250000, priceRange: null, buyerAdvice: null, disposalAdvice: null, summary: null, reviewReasons: ['偏离阈值待校准'] }) } })
  assert.equal(data.valuationSummary.unitPrice, '25000')
  assert.equal(data.valuationSummary.totalPrice, '2250000 元')
  assert.equal(data.valuationSummary.source, '公式基准参考')
  assert.match(allText(data), /模型候选价（待复核）/)
  assert.match(allText(data), /候选参考区间（待复核）/)
  assert.match(allText(data), /未作为已采用结论/)
})

test('review PDF preserves exact server candidate total and keeps price details together', () => {
  const r = fixture({ status: 'needs_review', isDemo: false, baselineUnitPrice: 18951,
    modelUnitPrice: 15900, effectiveUnitPrice: 18951, effectiveSource: 'rule', totalPriceYuan: 1819296,
    priceRange: null, buyerAdvice: null, disposalAdvice: null, summary: null,
    reviewReasons: ['价格偏离复核阈值尚未校准，模型候选价需人工复核', '关键房源信息待核实：总楼层、是否有人占用或出租'] })
  r.target.areaSqm = 96
  r.modelEstimate = { ...r.modelEstimate, unitPrice: 15900, totalPriceYuan: 1526400, priceRange: { low: 14800, high: 17200 } }
  const data = exporter.collect({ data: { valuationReport: r, area: 999, evalPer: 999999 } })
  const prices = data.sections.find(section => section.number === '02').items
  const candidate = prices.find(item => item.label === '候选总价（待复核）')
  assert.equal(candidate.value, '1526400 元')
  assert.equal(candidate.warning, true)
  assert.match(candidate.note, /尚未采纳/)
  assert.equal(prices.find(item => item.label === '采用总价').value, '1819296 元')
  const pages = layout.buildPages(measureContext(), data)
  const detailPages = pages.filter(page => page.section === '估价结果' && page.commands.some(c => c.text === '价格明细'))
  assert.equal(detailPages.length, 1)
  const detailText = detailPages[0].commands.filter(c => c.type === 'text').map(c => c.text).join('')
  assert.match(detailText, /1526400 元/)
  assert.match(detailText, /1819296 元/)
  r.reviewReasons.forEach(reason => assert.ok(detailText.includes(reason)))
  assert.equal(pages.some(page => page.commands.some(c => c.text === '演示数据 · 仅用于功能验证')), false)
})

test('timeout fallback and insufficient evidence do not fabricate model advice or zero price', () => {
  const fallback = exporter.collect({ data: { valuationReport: fixture({ status: 'rule_only', effectiveUnitPrice: 25000, effectiveSource: 'rule', totalPriceYuan: 2250000, modelUnitPrice: null, modelEstimate: null, priceRange: null, buyerAdvice: null, disposalAdvice: null, summary: null, fallbackReason: 'MODEL_TIMEOUT' }) } })
  assert.match(allText(fallback), /MODEL_TIMEOUT/)
  assert.match(allText(fallback), /模型意见未采用/)
  const empty = exporter.collect({ data: { valuationReport: fixture({ status: 'insufficient_data', baselineUnitPrice: null, effectiveUnitPrice: null, effectiveSource: null, totalPriceYuan: null, modelUnitPrice: null, modelEstimate: null, priceRange: null, evidence: [] }) } })
  assert.equal(empty.valuationSummary.unitPrice, '暂无数据')
  assert.equal(empty.valuationSummary.totalPrice, '暂无数据')
  assert.equal(empty.chart.some(row => row.value === '0'), false)
})

test('missing house area and community reports never borrow a mean area to calculate total', () => {
  const missing = fixture()
  missing.target.areaSqm = null
  missing.totalPriceYuan = null
  missing.missingFields = ['areaSqm']
  const data = exporter.collect({ data: { valuationReport: missing, area: 120, report: { averageArea: 120 } } })
  assert.equal(data.valuationSummary.totalPrice, '暂无数据')
  assert.match(allText(data), /单套面积/)
  const community = fixture()
  community.target.type = 'community'
  community.target.areaSqm = null
  community.totalPriceYuan = null
  const communityData = exporter.collect({ data: { valuationReport: community } })
  assert.equal(communityData.reportKind, '小区参考估价报告')
  assert.equal(communityData.valuationSummary.totalPrice, '小区参考，不计算总价')
})

test('every dynamically paginated page retains the demo label and long text remains intact', () => {
  const r = fixture()
  r.disposalAdvice = '长处置意见需要完整保留。'.repeat(600) + 'END_OF_DISPOSAL'
  const data = exporter.collect({ data: { valuationReport: r } })
  const pages = layout.buildPages(measureContext(), data)
  assert.ok(pages.length > 6)
  assert.ok(pages.every(page => page.commands.some(command => command.type === 'text' && command.text === '演示数据 · 仅用于功能验证')))
  assert.ok(pages.flatMap(page => page.commands).filter(command => command.type === 'text').map(command => command.text).join('').includes('END_OF_DISPOSAL'))
  for (const page of pages) for (const command of page.commands) {
    if (command.type === 'rect') assert.ok(command.y >= 0 && command.y + command.h <= layout.height)
    else assert.ok(command.y >= 0 && command.y + command.size <= layout.height)
  }
})

test('legacy form exports remain compatible when there is no structured report', () => {
  global.wx = { getStorageSync: key => key === 'basic' ? { communityName: '旧表单小区', avgPrice: 12345 } : {} }
  const data = exporter.collect({ data: { form: { communityName: '旧表单小区' } } })
  assert.equal(data.title, '旧表单小区')
  assert.equal(data.sections.length, 4)
  assert.equal(data.valuationSnapshot, undefined)
})

function platform({ mutate, failCapture = false } = {}) {
  const files = new Map(), opened = [], deleted = [], errors = [], painted = []
  let sequence = 0
  const ctx = { ...measureContext(), scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, fillText(text) { painted.push(String(text)) } }
  const canvas = { width: 1, height: 1, getContext: () => ctx, requestAnimationFrame: callback => setTimeout(callback, 0) }
  const fs = {
    readFile: args => { const bytes = files.get(args.filePath); args.success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) },
    writeFile: args => { files.set(args.filePath, Buffer.from(args.data)); args.success({}) },
    unlink: args => { deleted.push(args.filePath); files.delete(args.filePath) }
  }
  global.wx = {
    env: { USER_DATA_PATH: '/mock' }, getStorageSync() { throw new Error('unexpected legacy storage access') }, getFileSystemManager: () => fs,
    showLoading() {}, hideLoading() {}, showToast: args => errors.push(args.title),
    createSelectorQuery: () => ({ in() { return this }, select(selector) { assert.equal(selector, '#pdfCanvas'); return this }, fields() { return this }, exec(callback) { callback([{ node: canvas }]) } }),
    canvasToTempFilePath: args => {
      if (mutate && sequence === 0) mutate()
      if (failCapture && sequence === 1) { args.fail({ errMsg: '模拟截图失败' }); return }
      const name = '/page-' + sequence++ + '.jpg'; files.set(name, Buffer.from([255, 216, 255, 217])); args.success({ tempFilePath: name })
    },
    getImageInfo: args => args.success({ width: layout.width * 2, height: layout.height * 2 }),
    openDocument: args => { opened.push(args.filePath); args.success({}) }
  }
  return { files, opened, deleted, errors, painted, canvas }
}

test('actual export path freezes the visible report, creates A4 PDF, and ignores duplicate taps', async () => {
  const page = { data: { valuationReport: fixture(), valuationLoading: false, valuationDirty: false, valuationError: '' } }
  const env = platform({ mutate: () => { page.data.valuationReport.target.name = 'LATE_REPLACEMENT'; page.data.valuationReport.effectiveUnitPrice = 1 } })
  const [result] = await Promise.all([exporter.exportReport(page), exporter.exportReport(page)])
  assert.equal(result.ok, true)
  assert.equal(result.valuationId, 'demo-report-normal-001')
  assert.equal(env.opened.length, 1)
  const body = env.files.get(env.opened[0]).toString('latin1')
  assert.match(body, /^%PDF-1\.4/)
  assert.match(body, /MediaBox \[0 0 595\.28 841\.89\]/)
  assert.equal(env.painted.includes('LATE_REPLACEMENT'), false)
  assert.ok(env.painted.includes('26000'))
  assert.equal(env.canvas.width, 1)
  assert.equal(env.deleted.length, (body.match(/\/Type \/Page \/Parent/g) || []).length)
  assert.equal(env.errors.length, 0)
  assert.equal(page._exportingReport, false)
})

test('export refuses stale, pending or failed data before drawing any document', async () => {
  const env = platform()
  for (const change of [{ valuationLoading: true }, { valuationDirty: true }, { valuationError: '请求失败' }, { valuationReport: null }, { valuationReport: fixture({ status: 'processing' }) }, { valuationReport: fixture({ status: 'failed' }) }]) {
    const result = await exporter.exportReport({ data: { valuationReport: fixture(), ...change } })
    assert.equal(result.ok, false)
  }
  assert.equal(env.opened.length, 0)
  assert.equal(env.painted.length, 0)
  assert.equal(env.errors.length, 6)
})

test('a capture failure cleans up generated images and restores canvas for the next export', async () => {
  const env = platform({ failCapture: true })
  const page = { data: { valuationReport: fixture() } }
  const result = await exporter.exportReport(page)
  assert.equal(result.ok, false)
  assert.equal(env.opened.length, 0)
  assert.equal(env.files.has('/page-0.jpg'), false)
  assert.equal(env.canvas.width, 1)
  assert.equal(page._exportingReport, false)
})
