// Synthetic fixtures only. Nothing in this module queries cloud services or a model.
const SCENARIOS = [
  { key: 'normal', label: '正常估价' }, { key: 'review', label: '候选价待复核' },
  { key: 'timeout', label: '模型超时回退' }, { key: 'missing_area', label: '缺少房源面积' },
  { key: 'insufficient', label: '市场数据不足' }, { key: 'error', label: '接口调用失败' }
]
const clone = value => JSON.parse(JSON.stringify(value))
const DEMO_LABEL = '演示数据 · 本地模拟响应，非真实模型估价'
function scenarioKey(value) { return SCENARIOS.some(item => item.key === value) ? value : 'normal' }
function getDemoHouse(scenario = 'normal') {
  const item = {
    _id: 'demo-house-001', communityId: 'demo-community-001', city: '示例城市', district: '示例区域', community: '云栖花园',
    title: '云栖花园 · 三室朝南住宅（演示房源）', category: '二手房', propertyType: '住宅',
    area_sqm: 90, rooms: '3室2厅', floor: 12, total_floors: 26, orientation: '南', decoration: '普通装修',
    unit_price: 27000, total_price: 243, build_year: 2018, elevator: true, occupancy: '演示：空置', deliveryStatus: '演示：可交付'
  }
  if (scenario === 'missing_area') { delete item.area_sqm; delete item.total_price }
  return clone(item)
}
function getDemoCommunity(scenario = 'normal') {
  const doc = {
    _id: 'demo-community-001', city: '示例城市', province: '示例省份', district: '示例区域', community: '云栖花园', propertyType: '住宅',
    updatedAt: '2026-11-17', base: { propertyType: '住宅', averageArea: 90, completionTime: '2018', developer: '演示开发商', propertyCompany: '演示物业', areaRank: '演示排名', plotRatio: 2.3, greenRate: '35%' },
    price: { price: 25700, listingPrice: 27000, recentDealPrice: 25400, auctionPrice: 24000, rentPerSqm: 55, averageTotalPrice: 243, history: [{ month: '2026-09', price: 26000 }, { month: '2026-10', price: 25700 }] },
    beike: { avg_price: 25700, household_count: 800, building_count: 10, listing_count: 24, listing_rate: 0.03 },
    deals: { count: 3, avg_unit_price: 25400, latest_date: '2026-11-10', recent: [
      { title: '演示成交 A · 88㎡', date: '2026-11-10', unit_price: 25000, total_wan: 220 },
      { title: '演示成交 B · 92㎡', date: '2026-11-08', unit_price: 26000, total_wan: 239.2 },
      { title: '演示成交 C · 89㎡', date: '2026-11-05', unit_price: 25200, total_wan: 224.28 }
    ] },
    pois: { subway: [{ name: '演示地铁站', dist: '650米' }], school: [{ name: '演示学校', dist: '900米' }], hospital: [{ name: '演示医院', dist: '1200米' }] },
    nearComms: [{ name: '演示 · 湖畔小区', price: 26000, dist: '800米' }]
  }
  if (scenario === 'insufficient') { doc.price = {}; doc.beike = {}; doc.deals = {} }
  return clone(doc)
}
function getDemoMarket(scenario = 'normal') {
  if (scenario === 'insufficient') return { sales: [], rents: [], auctionDeals: [], cityResult: {}, policies: [], competitorStats: [] }
  return clone({
    sales: [{ _id: 'demo-listing-001', unit_price: 27000, area_sqm: 90, total_price: 243, rooms: '3室2厅' }],
    rents: [{ _id: 'demo-rent-001', rent_month: 4950, area_sqm: 90 }], auctionDeals: [],
    cityResult: { price: 24000, count: 100 }, policies: [], competitorStats: []
  })
}
function demoReport(request, scenario = 'normal') {
  scenario = scenarioKey(scenario)
  if (scenario === 'error') throw Object.assign(new Error('演示：模拟接口连接失败，请重试或切换场景'), { code: 'DEMO_REQUEST_FAILED' })
  const house = request.targetType === 'house'
  const sourceHouse = getDemoHouse(scenario)
  const overrides = request.overrides || {}
  let area = house ? (overrides.areaSqm !== undefined ? Number(overrides.areaSqm) : sourceHouse.area_sqm || null) : null
  if (!(Number.isFinite(area) && area > 0)) area = null
  const target = {
    type: house ? 'house' : 'community', id: house ? sourceHouse._id : 'demo-community-001', communityId: 'demo-community-001',
    name: '云栖花园', city: '示例城市', district: '示例区域', propertyType: '住宅', areaSqm: area,
    listingUnitPrice: house ? 27000 : null,
    attributes: house ? { floor: 12, totalFloors: 26, rooms: '3室2厅', orientation: '南', decoration: '普通装修', buildYear: 2018, elevator: true, occupancy: '演示：空置', deliveryStatus: '演示：可交付' } : {},
    overrides: {}
  }
  Object.keys(overrides).forEach(key => {
    target.overrides[key] = { value: overrides[key], source: 'user_override' }
    if (key !== 'areaSqm') target.attributes[key] = overrides[key]
  })
  const evidence = scenario === 'insufficient' ? [] : [
    { id: 'demo-ev-1', kind: 'sale_deal', unitPrice: 25000, areaSqm: 88, date: '2026-11-10', source: '本地虚构成交 A', url: '' },
    { id: 'demo-ev-2', kind: 'sale_deal', unitPrice: 26000, areaSqm: 92, date: '2026-11-08', source: '本地虚构成交 B', url: '' },
    { id: 'demo-ev-3', kind: 'sale_deal', unitPrice: 25200, areaSqm: 89, date: '2026-11-05', source: '本地虚构成交 C', url: '' }
  ]
  const hasMissingArea = house && !area
  const status = scenario === 'insufficient' ? 'insufficient_data' : scenario === 'timeout' ? 'rule_only' : scenario === 'review' || hasMissingArea ? 'needs_review' : 'model_estimate'
  const baseline = status === 'insufficient_data' ? null : 25000
  const candidate = status === 'rule_only' || status === 'insufficient_data' ? null : scenario === 'review' ? 28000 : 26000
  const effective = status === 'model_estimate' ? candidate : baseline
  const total = effective && area ? Math.round(effective * area) : null
  const missingFields = status === 'insufficient_data' ? ['saleDeals', 'marketPriceReference'] : hasMissingArea ? ['areaSqm'] : []
  const modelEstimate = candidate ? {
    unitPrice: candidate, totalPriceYuan: area ? Math.round(candidate * area) : null,
    priceRange: { low: candidate - 1000, high: candidate + 1000 },
    adjustments: [{ factor: '可比成交与目标属性', description: '演示：对照三条虚构成交及房源属性形成候选价格，仅用于验证页面和报告流程。', evidenceIds: ['demo-ev-1', 'demo-ev-2', 'demo-ev-3'] }],
    evidenceIds: ['demo-ev-1', 'demo-ev-2', 'demo-ev-3'],
    buyerAdvice: '演示：比较挂牌价与采用估价，并在实际交易前核实房屋现状、产权和交付条件。',
    disposalAdvice: '演示：以市场定位作为处置参考；法拍或限期处置需要另行核实占用、交付和资金期限，不能直接套统一折扣。',
    missingFields, summary: '本地固定模拟结果。所有房源、成交和价格均为演示数据，不代表真实市场或模型能力。'
  } : null
  const reviewReasons = status === 'needs_review' ? [hasMissingArea ? '缺少真实面积，不能计算单套总价；候选结果待复核。' : '演示：候选价偏离基准，需人工复核，当前仍采用公式参考价。'] : []
  return clone({
    schemaVersion: '1.0', valuationId: 'demo-' + (request.requestId || scenario + '-' + Date.now()), status,
    target, purpose: request.purpose || 'investment', isDemo: true, demoLabel: DEMO_LABEL, demoScenario: scenario,
    baselineUnitPrice: baseline, modelUnitPrice: candidate, effectiveUnitPrice: effective,
    effectiveSource: effective === null ? null : status === 'model_estimate' ? 'model' : 'rule', totalPriceYuan: total,
    priceRange: status === 'model_estimate' ? modelEstimate.priceRange : null, modelEstimate,
    buyerAdvice: status === 'model_estimate' ? modelEstimate.buyerAdvice : null,
    disposalAdvice: status === 'model_estimate' ? modelEstimate.disposalAdvice : null,
    summary: status === 'model_estimate' ? modelEstimate.summary : null,
    evidence, missingFields, warnings: [DEMO_LABEL], reviewReasons,
    fallbackReason: status === 'rule_only' ? 'MODEL_TIMEOUT' : status === 'insufficient_data' ? 'NO_PRICE_EVIDENCE' : null,
    dataQuality: { level: status === 'insufficient_data' || hasMissingArea ? 'limited' : 'sufficient', saleDealCount: evidence.length, asOfDate: '2026-11-17' },
    baseline: { unitPrice: baseline, totalPriceYuan: baseline && area ? Math.round(baseline * area) : null, method: 'demo_fixture', components: [], ruleVersion: 'demo-baseline-v1', warnings: [DEMO_LABEL] },
    versions: { prompt: 'demo-prompt-v1', rule: 'demo-baseline-v1', config: 'demo-config-v1', knowledge: 'demo-knowledge-v1', provider: 'local_mock', model: '固定模拟响应' },
    knowledgeUsed: [{ id: 'demo-knowledge-1', title: '本地虚构示例知识', version: 'demo-v1', sourceUrl: '' }], generatedAt: new Date().toISOString()
  })
}
module.exports = { SCENARIOS, DEMO_LABEL, getDemoHouse, getDemoCommunity, getDemoMarket, demoReport, scenarioKey }
