const test = require('node:test')
const assert = require('node:assert/strict')
const { buildMessages } = require('../lib/prompt')
const { generateEstimate } = require('../lib/providers')

test('prompt retains citable comparison facts and knowledge provenance without sending report metadata', () => {
  const kinds = ['sale_deal', 'auction_deal', 'listing', 'rent', 'community_reference', 'filing_reference']
  const facts = kinds.map((kind, index) => ({
    id: 'e' + index, kind, unitPrice: 19000 + index, areaSqm: 96, date: '2026-07-10', source: '示例源'
  }))
  const evidence = facts.map(item => ({
    ...item, url: 'https://example.org/source', sourceRecordId: 'raw-' + item.id
  }))
  const knowledge = [
    { id: 'k1', title: '示例条目', content: '核实实际交付条件', sourceUrl: 'https://example.org/policy', version: 'v1' },
    { id: 'k2', title: '待核实条目', content: '核实空置情况', version: 'v1' },
    { id: 'k3', title: '内部评估说明', content: '区分挂牌与成交价', source: '项目手册', version: 'v2' }
  ]
  const market = { recentDealAvg: 19000, listingP25: 21000 }
  const baseline = { unitPrice: 19200, filingPrice: 21500 }
  const payload = JSON.parse(buildMessages({ context: { evidence, market }, baseline, knowledge })[1].content)
  assert.deepEqual(payload.evidence, facts)
  assert.deepEqual(payload.market, market)
  assert.deepEqual(payload.baseline, baseline)
  assert.deepEqual(payload.knowledge, [
    { id: 'k1', title: '示例条目', content: '核实实际交付条件', hasSource: true },
    { id: 'k2', title: '待核实条目', content: '核实空置情况', hasSource: false },
    { id: 'k3', title: '内部评估说明', content: '区分挂牌与成交价', source: '项目手册', hasSource: true }
  ])
  assert.equal(evidence[0].sourceRecordId, 'raw-e0')
  assert.equal(knowledge[0].sourceUrl, 'https://example.org/policy')
})

test('actual model request includes the comparison guide and known residential sale facts', async () => {
  const comparisonAttributes = { propertyType: '住宅', floor: 5, totalFloors: 6, buildYear: 2012 }
  const context = {
    target: { type: 'house', propertyType: '普通住宅', areaSqm: 95, attributes: { floor: 3, totalFloors: 6, buildYear: 2015 } },
    evidence: [
      { id: 'sale', kind: 'sale_deal', unitPrice: 20000, areaSqm: 88, comparisonAttributes },
      { id: 'listing', kind: 'listing', unitPrice: 24000, comparisonAttributes },
      { id: 'missing', kind: 'sale_deal', unitPrice: 20100, areaSqm: 96 }
    ]
  }
  const baseline = { unitPrice: 20200 }
  const estimate = {
    unitPrice: 20400, priceRange: { low: 19800, high: 21000 },
    adjustments: [{ factor: '楼龄', description: '实例旧3年，按100/99向上修正。', evidenceIds: ['sale'] }],
    evidenceIds: ['sale'], buyerAdvice: '核实房况。', disposalAdvice: '核实交付条件。', missingFields: ['可比房朝向'], summary: '近期成交供参考。'
  }
  const result = await generateEstimate({ context, baseline, apiKey: 'mock-key' }, async request => {
    const [system, user] = request.body.messages
    assert.match(system.content, /住宅市场比较修正参数/)
    assert.match(system.content, /目标系数÷实例系数/)
    assert.match(system.content, /实例每旧3年减1分/)
    assert.match(system.content, /双方属性明确且在表内才修正/)
    assert.match(system.content, /仅对有 comparisonAttributes 的 sale_deal 计算系数/)
    const payload = JSON.parse(user.content)
    assert.deepEqual(payload.baseline, baseline)
    assert.deepEqual(payload.evidence[0].comparisonAttributes, comparisonAttributes)
    for (const item of payload.evidence.slice(1)) assert.equal('comparisonAttributes' in item, false)
    return { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(estimate) } }] } }
  })
  assert.deepEqual(result.estimate, estimate)
})

test('community, mixed, commercial, and unknown targets keep the general prompt', () => {
  const evidence = [{ id: 'sale', kind: 'sale_deal', unitPrice: 20000, comparisonAttributes: { propertyType: '住宅' } }]
  const targets = [
    { type: 'community', propertyType: '住宅' },
    ...['住宅/商业', '非住宅', '商铺', '', undefined].map(propertyType => ({ type: 'house', propertyType }))
  ]
  for (const target of targets) {
    const [system, user] = buildMessages({ context: { target, evidence }, baseline: {} })
    assert.doesNotMatch(system.content, /住宅市场比较修正参数/)
    assert.equal(JSON.parse(user.content).evidence[0].comparisonAttributes, undefined)
  }
})
