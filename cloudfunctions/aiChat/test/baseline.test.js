const test = require('node:test')
const assert = require('node:assert/strict')
const { computeBaseline } = require('../lib/baseline')

function context(market = {}, target = {}) {
  return { target: { type: 'house', areaSqm: 90, propertyType: '住宅', ...target }, market }
}

test('matches legacy market weights and computes total price in yuan', () => {
  const result = computeBaseline(context({ communityAvg: 20000, listingAvg: 18000 }))
  assert.equal(result.unitPrice, 19400)
  assert.equal(result.totalPriceYuan, 1746000)
  assert.equal(result.method, 'market_comparison')
})

test('filing weights disable rental income contribution', () => {
  const result = computeBaseline(context({ communityAvg: 20000, listingAvg: 18000, filingPrice: 16000, rentPerSqm: 30 }))
  assert.equal(result.unitPrice, 17700)
  assert.equal(result.incomeWeight, 0)
  assert.equal(result.components.find(row => row.kind === 'filing_reference').weight, 0.5)
})

test('only at least three actual sale comparables enable transaction weight', () => {
  const market = { communityAvg: 20000, listingAvg: 18000, recentDealAvg: 16000, dealCount: 2 }
  assert.equal(computeBaseline(context(market)).unitPrice, 19400)
  assert.equal(computeBaseline(context({ ...market, dealCount: 3 })).unitPrice, 17700)
})

test('applies reliable income weight, preserving exact reference formula', () => {
  const result = computeBaseline(context({ communityAvg: 20000, listingAvg: 18000, rentPerSqm: 35 }))
  const incomeValue = 35 * 12 * 0.95 / 0.02
  assert.equal(result.unitPrice, Math.round(19400 * 0.8 + incomeValue * 0.2))
  assert.equal(result.method, 'market_and_income')
  assert.equal(result.incomeWeight, 0.2)
})

test('rental outlier does not overwrite market baseline', () => {
  assert.equal(computeBaseline(context({ communityAvg: 20000, listingAvg: 18000, rentPerSqm: 500 })).unitPrice, 19400)
})

test('no market evidence means null, even when rent or auction prices exist', () => {
  const result = computeBaseline(context({ rentPerSqm: 35, auctionDealAvg: 14000 }))
  assert.equal(result.unitPrice, null)
  assert.equal(result.totalPriceYuan, null)
  assert.equal(result.method, 'insufficient_data')
})

test('community and missing-house-area estimates never fabricate a total', () => {
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { type: 'community' })).totalPriceYuan, null)
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { areaSqm: null })).totalPriceYuan, null)
})

test('supports bounded rule parameters and ignores invalid/nonfinite inputs', () => {
  const result = computeBaseline(context({ communityAvg: 20000, listingAvg: 18000 }), { communityWeight: 0.5, listingWeight: 0.5, version: 'test-v2' })
  assert.equal(result.unitPrice, 19000)
  assert.equal(result.ruleVersion, 'test-v2')
  assert.equal(computeBaseline(context({ communityAvg: 20000, listingAvg: 18000 }), { communityWeight: NaN, listingWeight: -1 }).unitPrice, 19400)
  assert.equal(computeBaseline(context({ communityAvg: Infinity })).unitPrice, null)
  assert.equal(computeBaseline(context({ communityAvg: 1e308 })).unitPrice, null)
  assert.equal(computeBaseline(context({ communityAvg: 20000 }, { areaSqm: 1e308 })).totalPriceYuan, null)
})
