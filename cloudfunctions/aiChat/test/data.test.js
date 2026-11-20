const test = require('node:test')
const assert = require('node:assert/strict')
const { loadValuationData, number, isSold } = require('../lib/data')

const NOW = new Date('2026-11-17T00:00:00Z')
function database(records, failCollection) {
  return {
    collection(name) {
      return {
        doc(id) { return { async get() { const data = (records[name] || []).find(row => row._id === id); if (!data) throw new Error('document not found'); return { data } } } },
        where(query) {
          let skip = 0, limit = 100, sorted = false
          const chain = {
            skip(n) { skip = n; return chain }, limit(n) { limit = n; return chain },
            orderBy() { sorted = true; return chain },
            async get() {
              if (name === failCollection) throw new Error('permission denied')
              const rows = (records[name] || []).filter(row => Object.keys(query).every(key => query[key] && query[key].__in ? query[key].__in.includes(row[key]) : row[key] === query[key]))
              if (sorted) rows.sort((a, b) => a._id.localeCompare(b._id))
              return { data: rows.slice(skip, skip + limit) }
            }
          }
          return chain
        }
      }
    }
  }
}
function community(extra = {}) { return { _id: 'c1', city: '珠海', community: '测试花园', propertyType: '住宅', ...extra } }
function house(extra = {}) { return { _id: 'h1', city: '珠海', community: '测试花园', category: '二手房', ...extra } }
async function load(records, request = { targetType: 'community', communityId: 'c1' }, failCollection) {
  return loadValuationData(database({ communities: [community()], houses: [], ...records }, failCollection), request, NOW)
}

test('normalizes scalar / legacy totals / unit prices without dropping magnitude', () => {
  assert.equal(number({ $numberInt: '23000' }), 23000)
  assert.equal(number({ $numberDouble: '90.5' }), 90.5)
  assert.equal(number('2.3万元/㎡'), 23000)
  assert.equal(number('230万元', 'wan'), 2300000)
  assert.equal(number('230', 'wan'), 2300000)
  assert.equal(number('2,300,000元', 'wan'), 2300000)
  assert.equal(number('90平方米'), 90)
  assert.equal(number('58.3元/㎡/月'), 58.3)
  assert.equal(number('80~100平米'), null)
  assert.equal(number('-1'), null)
  assert.equal(number('NaN'), null)
})

test('only explicit completed transactions with actual transaction price become deals', async () => {
  const result = await load({ houses: [
    house({ _id: 'listing', unit_price: '28000', total_price: '280', area_sqm: 100 }),
    house({ _id: 'sold-listing-only', status: '成交', unit_price: 99999 }),
    house({ _id: 'sold', status: '成交', deal_unit_price: '2万元/㎡', unit_price: 99999, deal_date: '2026-10-10' }),
    house({ _id: 'auction-open', category: '法拍房', status: '即将开始', unit_price: 10000, start_price: 1000000 }),
    house({ _id: 'auction-failed', category: '法拍', status: '流拍', deal_unit_price: 15000 }),
    house({ _id: 'auction-sold', category: '拍卖', status: '已成交', deal_price: '180万元', area_sqm: 90, deal_date: '2026-10-11' }),
    house({ _id: 'not-sold', status: '未成交', deal_unit_price: 100 }),
    house({ _id: 'conflict', status: '成交', trade_status: '流拍', deal_unit_price: 100 })
  ] })
  assert.equal(result.market.recentDealAvg, 20000)
  assert.equal(result.market.auctionDealAvg, 20000)
  assert.equal(result.market.listingAvg, 28000)
  assert.equal(result.market.dealCount, 1)
  assert.equal(result.evidence.filter(row => row.kind === 'sale_deal').length, 1)
  assert.equal(result.evidence.filter(row => row.kind === 'auction_deal').length, 1)
  assert.equal(isSold({ status: '未成交' }), false)
})

test('derives listing unit price with legacy total_price in ten-thousand yuan', async () => {
  const result = await load({ houses: [house({ total_price: '230', area_sqm: '100㎡' })] })
  assert.equal(result.market.listingAvg, 23000)
})

test('community report never uses average area as the area of a single house', async () => {
  const result = await load({ communities: [community({ base: { averageArea: 120 }, price: { price: 20000 } })] })
  assert.equal(result.target.areaSqm, null)
  assert.equal(result.target.type, 'community')
})

test('loads house attributes, marks overrides, excludes own price, and omits contact data', async () => {
  const result = await load({ houses: [
    house({ communityId: 'c1', area_sqm: 89, floor: '12', total_floors: 26, unit_price: 90000, tel: 'secret-contact', title: 'private free text' }),
    house({ _id: 'comparable', unit_price: 20000 })
  ] }, { targetType: 'house', houseId: 'h1', purpose: 'investment', overrides: { areaSqm: '90㎡', decoration: '精装' } })
  assert.equal(result.target.areaSqm, 90)
  assert.equal(result.target.overrides.areaSqm.source, 'user_override')
  assert.equal(result.target.attributes.decoration, '精装')
  assert.equal(result.target.attributes.totalFloors, 26)
  assert.equal(result.market.listingAvg, 20000)
  assert.equal(JSON.stringify(result).includes('secret-contact'), false)
  assert.equal(JSON.stringify(result).includes('private free text'), false)
})

test('passes only the recorded comparison facts of explicitly residential normal sales', async () => {
  const result = await load({ houses: [
    house({ communityId: 'c1', propertyType: '住宅', floor: 5, totalFloors: 6, structure: '砖混结构', managementGrade: '一般', has_basement: true }),
    house({
      _id: 'actual-sale', property_type: '住宅', status: '已成交', deal_unit_price: 21000, area_sqm: 86,
      floor: '第2层', total_floors: '共7层', direction: '东', decoration_type: '精装', build_year: '2002年', elevator: false,
      structure: '砖木结构', management_grade: '较完善', street_noise: '不临街，安静',
      layout_quality: '合理', roof_type: '平屋面', has_basement: false, private_yard: true,
      phone: 'PRIVATE_PHONE', address: 'PRIVATE_ADDRESS', occupancy: 'PRIVATE_OCCUPANCY', title: 'PRIVATE_TEXT'
    }),
    house({ _id: 'partial-sale', propertyType: '住宅', status: '已成交', deal_unit_price: 20000, area: 95,
      floor: '高楼层', orientation: '南北向', managementGrade: 'PRIVATE_TEXT', privateYard: '未知' }),
    house({ _id: 'unknown-type', status: '已成交', deal_unit_price: 22000, floor: 2 }),
    house({ _id: 'other-use', propertyType: '商铺', status: '已成交', deal_unit_price: 15000, floor: 2 }),
    house({ _id: 'listing-ref', propertyType: '住宅', unit_price: 20000, floor: 4 }),
    house({ _id: 'auction-ref', propertyType: '住宅', category: '法拍', status: '已成交', deal_unit_price: 19000, floor: 4 })
  ] }, { targetType: 'house', houseId: 'h1' })
  assert.equal(result.target.attributes.structure, '砖混结构')
  assert.equal(result.target.attributes.managementGrade, '一般')
  assert.equal(result.target.attributes.hasBasement, true)
  const sale = result.evidence.find(item => item.sourceRecordId === 'actual-sale')
  assert.equal(sale.areaSqm, 86)
  assert.deepEqual(sale.comparisonAttributes, {
    propertyType: '住宅', floor: 2, totalFloors: 7, orientation: '东向', decoration: '精装', buildYear: 2002,
    elevator: false, structure: '砖木结构', managementGrade: '较完善', streetNoise: '不临街安静',
    layoutQuality: '合理', roofType: '平屋面', hasBasement: false, privateYard: true
  })
  assert.deepEqual(result.evidence.find(item => item.sourceRecordId === 'partial-sale').comparisonAttributes, { propertyType: '住宅' })
  assert.equal(result.evidence.some(item => item.sourceRecordId === 'other-use'), false)
  for (const id of ['unknown-type', 'listing-ref', 'auction-ref']) {
    assert.equal(Object.hasOwn(result.evidence.find(item => item.sourceRecordId === id), 'comparisonAttributes'), false)
  }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/)
})

test('does not guess missing single-house area, and rejects arbitrary/invalid overrides', async () => {
  const records = { houses: [house({ communityId: 'c1' })] }
  const result = await load(records, { targetType: 'house', houseId: 'h1' })
  assert.equal(result.target.areaSqm, null)
  assert.ok(result.missingFields.includes('areaSqm'))
  await assert.rejects(load(records, { targetType: 'house', houseId: 'h1', overrides: { evaluation: 99999 } }), { code: 'INVALID_INPUT' })
  await assert.rejects(load(records, { targetType: 'house', houseId: 'h1', overrides: { areaSqm: 0 } }), { code: 'INVALID_INPUT' })
  await assert.rejects(load({}, { targetType: 'community', communityId: 'c1', overrides: { areaSqm: 80 } }), { code: 'INVALID_INPUT' })
})

test('delivery override length matches API contract, and floor checks combine source with overrides', async () => {
  const records = { houses: [house({ communityId: 'c1', floor: 12, total_floors: 26 })] }
  const result = await load(records, { targetType: 'house', houseId: 'h1', overrides: { deliveryStatus: '交'.repeat(200) } })
  assert.equal(result.target.attributes.deliveryStatus.length, 200)
  await assert.rejects(load(records, { targetType: 'house', houseId: 'h1', overrides: { floor: 27 } }), { code: 'INVALID_INPUT' })
  await assert.rejects(load(records, { targetType: 'house', houseId: 'h1', overrides: { totalFloors: 10 } }), { code: 'INVALID_INPUT' })
  await assert.rejects(load({ houses: [house({ communityId: 'c1', floor: '30层', total_floors: 26 })] }, { targetType: 'house', houseId: 'h1' }), { code: 'INSUFFICIENT_DATA' })
})

test('combines market samples stored with and without the city suffix', async () => {
  const result = await load({ houses: [house({ _id: 'a', city: '珠海', unit_price: 20000 }), house({ _id: 'b', city: '珠海市', unit_price: 22000 })] })
  assert.equal(result.market.listingAvg, 21000)
  assert.equal(result.dataQuality.scannedHouseCount, 2)
})

test('uses the CloudBase command.in query for normalized city variants when available', async () => {
  const db = database({ communities: [community()], houses: [house({ _id: 'a', unit_price: 20000 }), house({ _id: 'b', city: '珠海市', unit_price: 22000 })] })
  let commandCalls = 0
  db.command = { in(values) { commandCalls++; return { __in: values } } }
  const result = await loadValuationData(db, { targetType: 'community', communityId: 'c1' }, NOW)
  assert.equal(commandCalls, 1)
  assert.equal(result.market.listingAvg, 21000)
})

test('excludes explicitly incompatible property samples and community reference prices', async () => {
  const result = await load({
    communities: [community({ price: { price: 30000, listingPrice: 31000, rentPerSqm: 50 } })],
    houses: [
      house({ communityId: 'c1', propertyType: '商铺', area_sqm: 100 }),
      house({ _id: 'residential', propertyType: '住宅', unit_price: 35000 }),
      house({ _id: 'commercial', propertyType: '商铺', unit_price: 18000 })
    ]
  }, { targetType: 'house', houseId: 'h1' })
  assert.equal(result.market.listingAvg, 18000)
  assert.equal(result.market.communityAvg, 18000)
  assert.equal(result.market.rentPerSqm, null)
  assert.equal(result.evidence.some(item => item.unitPrice === 30000 || item.unitPrice === 35000), false)
})

test('rejects cross-community targets and ambiguous name linkage', async () => {
  await assert.rejects(load({
    communities: [community(), community({ _id: 'c2', community: '另一小区' })],
    houses: [house({ communityId: 'c1' })]
  }, { targetType: 'house', houseId: 'h1', communityId: 'c2' }), { code: 'TARGET_MISMATCH' })
  await assert.rejects(load({
    communities: [community(), community({ _id: 'c2' })], houses: [house()]
  }, { targetType: 'house', houseId: 'h1' }), { code: 'AMBIGUOUS_COMMUNITY' })
})

test('supports explicit embedded transaction arrays and Extended JSON values', async () => {
  const result = await load({ communities: [community({ deals: { count: 1000, recent: [
    { _id: 'd1', unit_price: { $numberInt: '20000' }, date: '2026-10-10', area: '80' },
    { _id: 'd2', unit_price: 21000, date: '2026-10-11' },
    { _id: 'd3', unit_price: 22000, date: '2026-10-12' },
    { _id: 'future', unit_price: 1000000, date: '2027-10-12' }
  ] } })] })
  assert.equal(result.market.dealCount, 3)
  assert.equal(result.market.recentDealAvg, 21000)
  assert.equal(result.evidence.find(row => row.sourceRecordId === 'd1').areaSqm, 80)
  assert.ok(result.warnings.some(warning => warning.includes('晚于评估日')))
})

test('a normal transaction summary anchors the baseline without creating individual evidence', async () => {
  const result = await load({ communities: [community({
    price: { recentDealPrice: 18862, auctionPrice: 10000 },
    deals: { source: 'beike', count: { $numberInt: '2' }, avg_unit_price: { $numberInt: '16821' }, latest_date: '2026-08-01' }
  })] })
  assert.equal(result.market.recentDealAvg, 16821)
  assert.equal(result.market.dealCount, 2)
  assert.equal(result.market.recentDealSource, 'community_deal_summary')
  assert.equal(result.dataQuality.saleDealCount, 0)
  assert.equal(result.evidence.some(item => item.kind === 'sale_deal'), false)
})

test('uncounted price fields, auctions and future-dated summaries do not feed the normal sale baseline', async () => {
  for (const deals of [{ count: 2 }, { count: 2, avg_unit_price: 16000, source: '法拍' }, { count: 2, avg_unit_price: 16000, latest_date: '2027-01-01' }]) {
    const result = await load({ communities: [community({ price: { recentDealPrice: 20000, auctionPrice: 10000 }, deals })] })
    assert.equal(result.market.recentDealAvg, null)
    assert.equal(result.market.auctionDealAvg, null)
    assert.equal(result.market.dealCount, 0)
  }
})

test('derives interpolated P25 from eligible listings, excluding sold and auction records', async () => {
  const prices = [20000, 24000, 28000, 32000]
  const result = await load({ houses: [
    ...prices.map((unit_price, i) => house({ _id: 'listing-' + i, unit_price })),
    house({ _id: 'sold', status: '已成交', unit_price: 10000, deal_unit_price: 14000 }),
    house({ _id: 'auction', category: '法拍', unit_price: 10000 })
  ] })
  assert.equal(result.market.listingP25, 23000)
  assert.equal(result.market.listingSampleCount, 4)
  assert.equal(result.market.listingAvg, 26000)
  assert.equal(result.market.recentDealAvg, 14000)
})

test('an uncounted price field alone does not fabricate sale evidence', async () => {
  const result = await load({ communities: [community({ price: { recentDealPrice: 20000, auctionPrice: 10000 } })] })
  assert.equal(result.market.recentDealAvg, null)
  assert.equal(result.market.auctionDealAvg, null)
  assert.equal(result.market.dealCount, 0)
})

test('deduplicates the same transaction copied into two legacy arrays', async () => {
  const transaction = { date: '2026-10-10', area: 90, unit_price: 20000 }
  const result = await load({ communities: [community({ deals: { recent: [transaction] }, price: { dealRecords: [transaction] } })] })
  assert.equal(result.market.dealCount, 1)
})

test('future-dated community references do not enter the baseline market fields', async () => {
  const result = await load({ communities: [community({ price: { price: 30000 }, updated_at: '2027-01-01', reference: { beian_price: 28000, updated_at: '2027-01-01' } })] })
  assert.equal(result.market.communityAvg, null)
  assert.equal(result.market.filingPrice, null)
})

test('pages with finite cap and reports truncation explicitly', async () => {
  const result = await load({ houses: Array.from({ length: 501 }, (_, index) => house({ _id: 'h' + index, unit_price: 20000 })) })
  assert.equal(result.dataQuality.scannedHouseCount, 500)
  assert.ok(result.evidence.length <= 100)
  assert.ok(result.warnings.some(warning => warning.includes('500')))
})

test('query errors are not treated as empty datasets', async () => {
  await assert.rejects(load({}, undefined, 'houses'), { code: 'DATA_QUERY_FAILED' })
})
