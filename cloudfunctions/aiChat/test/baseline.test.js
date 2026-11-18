const test = require('node:test')
const assert = require('node:assert/strict')
const { computeBaseline } = require('../lib/baseline')

function context(market = {}, target = {}) {
  return { target: { type: 'house', areaSqm: 90, propertyType: '住宅', ...target }, market }
}

test('prices a listing-only market at P25 × 95% and computes the total in yuan', () => {
  const result = computeBaseline(context({ communityAvg: 25000, listingAvg: 22000, listingP25: 18000 }))
  assert.equal(result.unitPrice, 17100)
  assert.equal(result.totalPriceYuan, 1539000)
  assert.equal(result.basis, 'listings')
  assert.equal(result.ruleVersion, 'baseline-v2')
})

test('weights one or two comparable sales at 50% and at least three at 80%', () => {
  const market = { listingP25: 20000, recentDealAvg: 15000, dealCount: 1 }
  for (const [dealCount, expected, weight] of [[1, 17000, 0.5], [2, 17000, 0.5], [3, 15800, 0.8]]) {
    const result = computeBaseline(context({ ...market, dealCount }))
    assert.equal(result.unitPrice, expected)
    assert.equal(result.basis, 'recent_sales_and_listings')
    assert.equal(result.components.find(row => row.kind === 'sale_deal').weight, weight)
  }
})

test('uses the transaction average when no listing sample can establish P25', () => {
  const result = computeBaseline(context({ recentDealAvg: 18000, dealCount: 1, listingAvg: 25000 }))
  assert.equal(result.unitPrice, 18000)
  assert.equal(result.basis, 'recent_sales')
})

test('falls back to 85% of the community reference without a sale or listing sample', () => {
  const result = computeBaseline(context({ communityAvg: 20000, listingAvg: 23000 }))
  assert.equal(result.unitPrice, 17000)
  assert.equal(result.basis, 'community')
})

test('filing price caps the market result and never raises it or participates in weighting', () => {
  const market = { listingP25: 20000, filingPrice: 18000 }
  const capped = computeBaseline(context(market))
  assert.equal(capped.unitPrice, 18000)
  assert.equal(capped.marketValue, 19000)
  assert.equal(capped.cappedByFiling, true)
  assert.equal(capped.components.some(row => row.kind === 'filing_reference'), false)
  const uncapped = computeBaseline(context({ ...market, filingPrice: 25000 }))
  assert.equal(uncapped.unitPrice, 19000)
  assert.equal(uncapped.cappedByFiling, false)
  assert.equal(computeBaseline(context({ ...market, filingPrice: 18999.8 })).unitPrice, 18999)
})

test('capitalized rent is displayed without influencing the unit price', () => {
  const market = { listingP25: 20000, rentPerSqm: 35 }
  const residential = computeBaseline(context(market))
  const commercial = computeBaseline(context(market, { propertyType: '商铺' }))
  assert.equal(residential.unitPrice, 19000)
  assert.equal(commercial.unitPrice, 19000)
  assert.equal(residential.incomeWeight, 0)
  assert.equal(residential.incomeValue, 19950)
  assert.equal(commercial.incomeValue, 8867)
})

test('filing, rent and auctions alone never create a market baseline', () => {
  const result = computeBaseline(context({ filingPrice: 23000, rentPerSqm: 35, auctionDealAvg: 14000 }))
  assert.equal(result.unitPrice, null)
  assert.equal(result.totalPriceYuan, null)
  assert.equal(result.method, 'insufficient_data')
})

test('community and missing-house-area estimates never fabricate a total', () => {
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { type: 'community' })).totalPriceYuan, null)
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { areaSqm: null })).totalPriceYuan, null)
})

test('invalid and overflowing inputs are not used in the baseline', () => {
  assert.equal(computeBaseline(context({ communityAvg: Infinity })).unitPrice, null)
  assert.equal(computeBaseline(context({ communityAvg: 1e308 })).unitPrice, null)
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { areaSqm: 1e308 })).totalPriceYuan, null)
  assert.equal(computeBaseline(context({ communityAvg: 20000, recentDealAvg: 22000, dealCount: 1.5 })).unitPrice, 17000)
})
