const RULE_VERSION = 'baseline-v1'

function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null }
function setting(config, name, fallback, min, max) {
  const value = config[name]
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function computeBaseline(context, ruleConfig = {}) {
  const market = context.market || {}, target = context.target || {}
  const components = [], warnings = []
  const filing = positive(market.filingPrice)
  const community = positive(market.communityAvg)
  const listing = positive(market.listingAvg)
  const deal = positive(market.recentDealAvg)
  const rent = positive(market.rentPerSqm)
  const add = (kind, unitPrice, weight) => { if (unitPrice && weight > 0) components.push({ kind, unitPrice, weight }) }
  if (market.dealCount >= 3 && deal) add('sale_deal', deal, setting(ruleConfig, 'dealWeight', 1, 0, 10))
  if (filing) {
    add('community_reference', community, setting(ruleConfig, 'filingCommunityWeight', 0.35, 0, 10))
    add('listing', listing, setting(ruleConfig, 'filingListingWeight', 0.15, 0, 10))
    add('filing_reference', filing, setting(ruleConfig, 'filingWeight', 0.5, 0, 10))
  } else {
    add('community_reference', community, setting(ruleConfig, 'communityWeight', 0.7, 0, 10))
    add('listing', listing, setting(ruleConfig, 'listingWeight', 0.3, 0, 10))
  }
  const weight = components.reduce((sum, item) => sum + item.weight, 0)
  const marketValue = weight ? components.reduce((sum, item) => sum + item.unitPrice * item.weight, 0) / weight : null
  const commercial = /商业|商铺|办公/.test(target.propertyType || '')
  const capRate = commercial
    ? setting(ruleConfig, 'commercialCapRate', 0.045, 0.001, 1)
    : setting(ruleConfig, 'residentialCapRate', 0.02, 0.001, 1)
  const netRentFactor = setting(ruleConfig, 'netRentFactor', 0.95, 0, 1)
  const incomeValue = rent ? rent * 12 * netRentFactor / capRate : null
  const reliable = !filing && marketValue && incomeValue && incomeValue >= marketValue * 0.7 && incomeValue <= marketValue * 1.5
  const incomeWeight = reliable ? setting(ruleConfig, 'incomeWeight', 0.2, 0, 1) : 0
  const value = marketValue ? marketValue * (1 - incomeWeight) + (incomeValue || 0) * incomeWeight : null
  if (!marketValue) warnings.push('缺少可用市场价格证据，未生成基准价')
  if (rent && !reliable) warnings.push('收益法未参与基准价：存在备案价、缺少市场基准或租金估值偏离过大')
  if (!target.propertyType) warnings.push('物业类型未知，收益法资本化率暂按住宅参考参数计算')
  const roundedUnit = positive(value) ? Math.round(value) : null
  const unitPrice = roundedUnit && Number.isSafeInteger(roundedUnit) ? roundedUnit : null
  const area = target.type === 'house' ? positive(target.areaSqm) : null
  const roundedTotal = unitPrice && area ? Math.round(unitPrice * area) : null
  const totalPriceYuan = roundedTotal && Number.isSafeInteger(roundedTotal) ? roundedTotal : null
  if (value && !unitPrice) warnings.push('基准价格超出有效数值范围，未生成价格')
  if (unitPrice && area && !totalPriceYuan) warnings.push('评估总价超出有效数值范围，未生成总价')
  return {
    unitPrice, totalPriceYuan,
    method: !unitPrice ? 'insufficient_data' : incomeWeight > 0 ? 'market_and_income' : 'market_comparison',
    components, marketValue: positive(marketValue) && Number.isSafeInteger(Math.round(marketValue)) ? Math.round(marketValue) : null, incomeValue: positive(incomeValue) && Number.isSafeInteger(Math.round(incomeValue)) ? Math.round(incomeValue) : null,
    capRate, incomeWeight, ruleVersion: typeof ruleConfig.version === 'string' ? ruleConfig.version : RULE_VERSION, warnings
  }
}

module.exports = { computeBaseline, RULE_VERSION }
