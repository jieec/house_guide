const test = require('node:test')
const assert = require('node:assert/strict')
const { validateEstimate } = require('../lib/validate')

function fixture() {
  return {
    estimate: {
      unitPrice: 10000,
      priceRange: { low: 9500, high: 10500 },
      adjustments: [{ factor: '成交比较', description: '同类房源成交参考', evidenceIds: ['deal-1'] }],
      evidenceIds: ['deal-1'], buyerAdvice: '核实房屋现状。', disposalAdvice: '先明确交付条件。',
      missingFields: [], summary: '参考有效成交样本。'
    },
    options: {
      context: { target: { type: 'house', areaSqm: 80 }, evidence: [{ id: 'deal-1', kind: 'sale_deal', unitPrice: 10000 }], missingFields: [] },
      baseline: { unitPrice: 10000 }, config: { maxDeviationRatio: 0.15 }
    }
  }
}

test('validates candidate and calculates house total in yuan on the server', () => {
  const { estimate, options } = fixture()
  const result = validateEstimate(estimate, options)
  assert.equal(result.valid, true)
  assert.equal(result.needsReview, false)
  assert.equal(result.value.totalPriceYuan, 800000)
  assert.notEqual(result.value, estimate)
})

test('community never uses average area to calculate a total', () => {
  const { estimate, options } = fixture()
  options.context.target.type = 'community'
  assert.equal(validateEstimate(estimate, options).value.totalPriceYuan, null)
})

test('strict structure rejects unknown fields, invalid types and non-finite numbers', () => {
  for (const mutate of [
    e => { e.totalPriceYuan = 1 }, e => { e.unitPrice = '10000' }, e => { e.unitPrice = NaN },
    e => { e.unitPrice = -1 }, e => { e.priceRange.low = 11000 },
    e => { e.priceRange.high = Infinity }, e => { e.priceRange.confidence = 0.9 },
    e => { e.adjustments[0].coefficient = 0.9 }, e => { e.missingFields = '楼层' },
    e => { e.summary = '' }, e => { e.buyerAdvice = 'a'.repeat(2001) },
    e => { delete e.disposalAdvice }
  ]) {
    const { estimate, options } = fixture()
    mutate(estimate)
    const result = validateEstimate(estimate, options)
    assert.equal(result.valid, false)
    assert.equal(result.value, null)
  }
})

test('requires known, non-empty evidence including a property price evidence', () => {
  for (const evidenceIds of [[], ['made-up'], ['deal-1', 'deal-1'], ['knowledge-1']]) {
    const { estimate, options } = fixture()
    options.knowledge = [{ id: 'knowledge-1', content: '地产知识' }]
    estimate.evidenceIds = evidenceIds
    assert.equal(validateEstimate(estimate, options).valid, false)
  }
  const { estimate, options } = fixture()
  estimate.adjustments[0].evidenceIds = ['unknown']
  assert.equal(validateEstimate(estimate, options).valid, false)
})

test('known knowledge can support an adjustment alongside price evidence', () => {
  const { estimate, options } = fixture()
  options.knowledge = [{ id: 'knowledge-1', content: '知识' }]
  estimate.adjustments[0].evidenceIds = ['deal-1', 'knowledge-1']
  assert.equal(validateEstimate(estimate, options).valid, true)
})

test('rent alone cannot be cited as property sale price evidence', () => {
  const { estimate, options } = fixture()
  options.context.evidence[0].kind = 'rent'
  options.context.evidence[0].unitPrice = 50
  const result = validateEstimate(estimate, options)
  assert.equal(result.valid, false)
  assert.match(result.errors.join(''), /房产价格证据/)
})

test('missing calibration and material baseline deviation require review', () => {
  const { estimate, options } = fixture()
  options.config = {}
  let result = validateEstimate(estimate, options)
  assert.equal(result.valid, true)
  assert.equal(result.needsReview, true)
  assert.match(result.reviewReasons.join(''), /未校准/)
  options.config = { maxDeviationRatio: 0.1 }
  options.baseline.unitPrice = 5000
  result = validateEstimate(estimate, options)
  assert.equal(result.needsReview, true)
  assert.match(result.reviewReasons.join(''), /偏离/)
})

test('critical missing property information is retained and requires review', () => {
  const { estimate, options } = fixture()
  options.context.target.areaSqm = null
  options.context.missingFields = ['面积']
  estimate.missingFields = ['占用情况']
  const result = validateEstimate(estimate, options)
  assert.equal(result.valid, true)
  assert.equal(result.needsReview, true)
  assert.equal(result.value.totalPriceYuan, null)
  assert.deepEqual(result.value.missingFields, ['面积', '占用情况'])
})

test('an exact deviation boundary is not rejected due to floating point rounding', () => {
  const { estimate, options } = fixture()
  options.config.maxDeviationRatio = 0.1
  estimate.unitPrice = 11000
  estimate.priceRange.high = 11500
  assert.equal(validateEstimate(estimate, options).needsReview, false)
  estimate.unitPrice = 11000.01
  assert.equal(validateEstimate(estimate, options).needsReview, true)
})
