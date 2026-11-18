const RULE_VERSION = 'baseline-v2'

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : null
}

function roundedPrice(value) {
  const rounded = Math.round(value)
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null
}

function computeBaseline(context) {
  const { market = {}, target = {} } = context
  const warnings = []
  const filingPrice = positive(market.filingPrice)
  const communityAvg = positive(market.communityAvg)
  const listingP25 = positive(market.listingP25)
  const listingValue = listingP25 ? listingP25 * 0.95 : null
  const dealCount = Number.isSafeInteger(market.dealCount) && market.dealCount > 0 ? market.dealCount : 0
  const deal = dealCount ? positive(market.recentDealAvg) : null

  let basis = null
  let components = []
  if (deal && listingValue) {
    const dealWeight = dealCount >= 3 ? 0.8 : 0.5
    basis = 'recent_sales_and_listings'
    components = [
      { kind: 'sale_deal', unitPrice: deal, weight: dealWeight },
      { kind: 'listing', unitPrice: listingValue, weight: dealCount >= 3 ? 0.2 : 0.5 }
    ]
  } else if (deal) {
    basis = 'recent_sales'
    components = [{ kind: 'sale_deal', unitPrice: deal, weight: 1 }]
  } else if (listingValue) {
    basis = 'listings'
    components = [{ kind: 'listing', unitPrice: listingValue, weight: 1 }]
  } else if (communityAvg) {
    basis = 'community'
    components = [{ kind: 'community_reference', unitPrice: communityAvg * 0.85, weight: 1 }]
  }

  const marketValue = components.reduce((sum, { unitPrice, weight }) => sum + unitPrice * weight, 0)
  // Results use integer yuan. Flooring a fractional ceiling keeps the result
  // below the filing price even when the market value rounds up.
  const roundedMarketValue = roundedPrice(marketValue)
  const cappedByFiling = filingPrice !== null && (marketValue > filingPrice || roundedMarketValue > filingPrice)
  const unitPrice = cappedByFiling ? roundedPrice(Math.floor(filingPrice)) : roundedMarketValue
  const area = target.type === 'house' ? positive(target.areaSqm) : null
  const totalPriceYuan = unitPrice && area ? roundedPrice(unitPrice * area) : null
  if (!basis) warnings.push('缺少可用市场价格证据，未生成基准价')
  if (basis && !unitPrice) warnings.push('基准价格超出有效数值范围，未生成价格')
  if (unitPrice && area && !totalPriceYuan) warnings.push('评估总价超出有效数值范围，未生成总价')

  const rent = positive(market.rentPerSqm)
  const capRate = /商业|商铺|办公/.test(target.propertyType || '') ? 0.045 : 0.02
  const incomeValue = rent ? roundedPrice(rent * 12 * 0.95 / capRate) : null
  if (rent && !target.propertyType) warnings.push('物业类型未知，收益法资本化率暂按住宅参考参数计算')

  return {
    unitPrice,
    totalPriceYuan,
    method: unitPrice ? 'market_comparison' : 'insufficient_data',
    basis,
    components,
    marketValue: roundedMarketValue,
    listingP25,
    recentDealAvg: deal,
    recentDealCount: deal ? dealCount : 0,
    recentDealSource: deal ? market.recentDealSource || null : null,
    filingPrice,
    cappedByFiling,
    incomeValue,
    capRate,
    incomeWeight: 0,
    ruleVersion: RULE_VERSION,
    warnings
  }
}

module.exports = { computeBaseline, RULE_VERSION }
