const crypto = require('crypto')

const PAGE_SIZE = 100
const MAX_HOUSES = 500
const MAX_EVIDENCE = 100
const ATTRIBUTES = ['floor', 'totalFloors', 'rooms', 'orientation', 'decoration', 'elevator', 'buildYear', 'occupancy', 'deliveryStatus']
const SOLD = new Set(['成交', '已成交', '已售', '已售出', '拍卖成交', '交易成功', 'sold', 'completed', 'auction_sold'])
const UNSOLD = new Set(['未成交', '流拍', '已流拍', '撤拍', '已撤拍', '中止', '终止', 'cancelled', 'unsold', 'failed'])

function error(code, message) {
  return Object.assign(new Error(message), { code })
}

function scalar(value) {
  if (value && typeof value === 'object') {
    for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$date']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) return scalar(value[key])
    }
  }
  return value
}

function text(value, max = 120) {
  const result = scalar(value)
  return typeof result === 'string' || typeof result === 'number' ? String(result).trim().slice(0, max) : ''
}

// Monetary output is always yuan; only the legacy total_price/total_wan fields
// default to ten-thousand yuan. A unit-price field never uses that default.
function number(value, defaultUnit = 'yuan') {
  const raw = scalar(value)
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw * (defaultUnit === 'wan' ? 10000 : 1) : null
  if (typeof raw !== 'string') return null
  const match = raw.trim().replace(/[,，\s]/g, '').match(/^(\d+(?:\.\d+)?)\s*(万|亿)?(?:元|圆)?(?:(?:\/(?:㎡|m²|平米|平方米|平))(?:\/月)?|(?:㎡|m²|平米|平方米)|\/月)?$/i)
  if (!match) return null
  const multiplier = match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : (/元|圆/.test(raw) ? 1 : defaultUnit === 'wan' ? 1e4 : 1)
  const result = Number(match[1]) * multiplier
  return Number.isFinite(result) && result > 0 ? result : null
}

function firstNumber(values, defaultUnit = 'yuan') {
  for (const value of values) {
    const result = number(value, defaultUnit)
    if (result !== null) return result
  }
  return null
}

function firstText(values) {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return ''
}

function cityName(value) { return text(value).replace(/市$/, '') }
function propertyClass(value) {
  const property = text(value)
  if (/商业|商铺|办公|写字楼|厂房|工业/.test(property)) return 'commercial'
  if (/住宅|别墅/.test(property)) return 'residential'
  if (/公寓/.test(property)) return 'apartment'
  return null
}
function average(values) { return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null }
function safeUrl(value) {
  try {
    const url = new URL(text(value, 2048))
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : ''
  } catch (_) { return '' }
}
function isoDate(value) {
  const raw = scalar(value)
  if (raw === undefined || raw === null || raw === '') return null
  const parsed = typeof raw === 'number' || /^\d{10,13}$/.test(String(raw)) ? new Date(Number(raw) * (Number(raw) < 1e12 ? 1000 : 1)) : new Date(raw)
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10)
}

async function getDocument(db, collection, id) {
  let result
  try { result = await db.collection(collection).doc(id).get() } catch (cause) {
    if (/not.?exist|not.?found|不存在/i.test(String(cause && (cause.errMsg || cause.message)))) throw error('TARGET_NOT_FOUND', '未找到评估目标或关联小区')
    throw error('DATA_QUERY_FAILED', '读取评估目标失败')
  }
  if (!result || !result.data || Array.isArray(result.data)) throw error('TARGET_NOT_FOUND', '未找到评估目标或关联小区')
  return result.data
}

async function readHouses(db, community, warnings) {
  const result = []
  const normalized = cityName(community.city)
  const cities = [...new Set([community.city, normalized, normalized + '市'])]
  const queries = db.command && typeof db.command.in === 'function'
    ? [{ city: db.command.in(cities), community: community.community }]
    : cities.map(city => ({ city, community: community.community }))
  for (const query of queries) {
    for (let offset = 0; offset <= MAX_HOUSES; offset += PAGE_SIZE) {
      const remaining = MAX_HOUSES - result.length
      const limit = Math.min(PAGE_SIZE, remaining + 1)
      let page
      try {
        let collection = db.collection('houses').where(query)
        // Stable pagination avoids repeated/omitted records while samples are
        // ordered for the prompt by their actual evidence dates afterwards.
        if (typeof collection.orderBy === 'function') collection = collection.orderBy('_id', 'asc')
        page = await collection.skip(offset).limit(limit).get()
      } catch (_) { throw error('DATA_QUERY_FAILED', '读取市场样本失败') }
      const rows = page && Array.isArray(page.data) ? page.data : []
      result.push(...rows.slice(0, remaining))
      if (rows.length > remaining) {
        warnings.push('市场房源样本超过500条，本次只使用前500条，不能视作完整市场统计')
        return result
      }
      if (rows.length < limit) break
    }
  }
  return result
}

function isSold(row) {
  const statuses = [row.transactionStatus, row.transaction_status, row.status, row.trade_status, row.auction_status].map(value => text(value).toLowerCase()).filter(Boolean)
  return !statuses.some(status => UNSOLD.has(status)) && statuses.some(status => SOLD.has(status))
}
function isAuction(row) {
  return /法拍|拍卖|auction/i.test([row.category, row.transactionType, row.transaction_type].map(value => text(value)).join(' '))
}
function area(row) { return firstNumber([row.areaSqm, row.area_sqm, row.area]) }
function dealUnitPrice(row, embedded) {
  const direct = firstNumber([row.deal_unit_price, row.dealUnitPrice, row.sold_unit_price, ...(embedded ? [row.unit_price, row.unit] : [])])
  if (direct) return direct
  const total = firstNumber([row.deal_price_yuan, row.deal_total_price_yuan, row.deal_price, row.sold_price_yuan]) || firstNumber([row.deal_total_wan, row.total_wan, row.deal_total_price], 'wan')
  const size = area(row)
  return total && size ? total / size : null
}
function listingUnitPrice(row) {
  const direct = firstNumber([row.listing_unit_price, row.unit_price])
  if (direct) return direct
  const total = firstNumber([row.listing_price_yuan, row.total_price_yuan]) || firstNumber([row.total_price, row.total_wan], 'wan')
  const size = area(row)
  return total && size ? total / size : null
}

function attributes(row) {
  const aliases = {
    floor: ['floor'], totalFloors: ['totalFloors', 'total_floors'], rooms: ['rooms', 'house_type', 'house_types'],
    orientation: ['orientation', 'direction'], decoration: ['decoration', 'decoration_type'],
    elevator: ['elevator'], buildYear: ['buildYear', 'build_year'], occupancy: ['occupancy', 'occupancyStatus'],
    deliveryStatus: ['deliveryStatus', 'vacateStatus', 'auction_clearance']
  }
  const result = {}
  for (const key of ATTRIBUTES) {
    const value = aliases[key].map(alias => scalar(row[alias])).find(v => v !== undefined && v !== null && v !== '')
    if (typeof value === 'boolean' || typeof value === 'number') result[key] = value
    else if (typeof value === 'string') result[key] = value.slice(0, key === 'deliveryStatus' ? 200 : key === 'orientation' ? 60 : 120)
  }
  return result
}

function applyOverrides(target, overrides) {
  if (!overrides) return
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw error('INVALID_INPUT', '补录属性格式错误')
  for (const key of Object.keys(overrides)) {
    if (!['areaSqm', ...ATTRIBUTES].includes(key)) throw error('INVALID_INPUT', '不支持的补录属性：' + key)
    const value = scalar(overrides[key])
    if (key === 'areaSqm') {
      if (target.type !== 'house') throw error('INVALID_INPUT', '小区参考估值不能补录单套面积')
      const size = number(value)
      if (!size || size > 1000000) throw error('INVALID_INPUT', '补录面积必须为有效正数')
      target.areaSqm = size
      target.overrides.areaSqm = { value: size, source: 'user_override' }
    } else {
      const maxLength = key === 'deliveryStatus' ? 200 : key === 'orientation' ? 60 : 120
      if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && (!value.trim() || value.length > maxLength))) throw error('INVALID_INPUT', '补录属性值无效：' + key)
      target.attributes[key] = value
      target.overrides[key] = { value, source: 'user_override' }
    }
  }
}

function validateFloors(target) {
  const asNumber = value => typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:层)?$/.test(value.trim()) ? Number(value.replace(/层$/, '')) : null
  const floor = asNumber(target.attributes.floor)
  const totalFloors = asNumber(target.attributes.totalFloors)
  if (floor !== null && totalFloors !== null && (totalFloors < 1 || floor > totalFloors)) {
    const overridden = target.overrides.floor || target.overrides.totalFloors
    throw error(overridden ? 'INVALID_INPUT' : 'INSUFFICIENT_DATA', '房源楼层不能超过总楼层，请核对原始记录或补录属性')
  }
}

async function loadValuationData(db, request, now = new Date()) {
  if (!request || !['house', 'community'].includes(request.targetType)) throw error('INVALID_INPUT', 'targetType必须为house或community')
  const targetId = request.targetType === 'house' ? request.houseId : request.communityId
  if (typeof targetId !== 'string' || !targetId.trim() || targetId.length > 128) throw error('INVALID_INPUT', '缺少有效目标ID')
  let house = null
  let community
  if (request.targetType === 'house') {
    house = await getDocument(db, 'houses', targetId)
    const linkedId = firstText([house.communityId, house.community_id])
    if (request.communityId && linkedId && request.communityId !== linkedId) throw error('TARGET_MISMATCH', '房源与小区不匹配')
    if (request.communityId || linkedId) community = await getDocument(db, 'communities', request.communityId || linkedId)
    else {
      if (!text(house.city) || !text(house.community)) throw error('COMMUNITY_REQUIRED', '房源缺少关联小区信息')
      let match
      try { match = await db.collection('communities').where({ community: house.community }).limit(100).get() } catch (_) { throw error('DATA_QUERY_FAILED', '查找关联小区失败') }
      const matches = (match.data || []).filter(item => cityName(item.city) === cityName(house.city))
      if (matches.length !== 1 || (match.data || []).length >= 100) throw error(matches.length ? 'AMBIGUOUS_COMMUNITY' : 'COMMUNITY_REQUIRED', '无法唯一确定房源关联小区')
      community = matches[0]
    }
    if ((house.city && cityName(house.city) !== cityName(community.city)) || (house.community && text(house.community) !== text(community.community))) throw error('TARGET_MISMATCH', '房源与小区不匹配')
  } else community = await getDocument(db, 'communities', targetId)
  const communityId = text(community._id) || request.communityId || firstText([house && house.communityId, house && house.community_id])
  if (!text(community.city) || !text(community.community)) throw error('INSUFFICIENT_DATA', '小区缺少城市或名称')
  const base = community.base || {}, price = community.price || {}, beike = community.beike || {}, reference = community.reference || {}
  const target = {
    type: request.targetType, id: targetId, communityId, name: text(community.community), city: cityName(community.city), district: text(community.district),
    propertyType: firstText([house && house.propertyType, house && house.property_type, base.propertyType, community.propertyType]),
    areaSqm: house ? area(house) : null, attributes: attributes(house || {}), overrides: {},
    listingUnitPrice: house && !isAuction(house) && !isSold(house) ? listingUnitPrice(house) : null
  }
  applyOverrides(target, request.overrides)
  validateFloors(target)
  const warnings = []
  const targetClass = propertyClass(target.propertyType)
  const communityClass = propertyClass(firstText([base.propertyType, community.propertyType]))
  const useCommunitySummary = !targetClass || !communityClass || targetClass === communityClass
  if (!useCommunitySummary) warnings.push('目标物业类型与小区汇总口径不同，未采用小区汇总参考价和租金')
  const rows = await readHouses(db, community, warnings)
  const evidence = []
  const seen = new Set()
  const transactionFingerprints = new Set()
  const today = now.toISOString().slice(0, 10)
  function add(kind, unitPrice, row, origin, dateValue, index) {
    if (!unitPrice) return
    const date = isoDate(dateValue)
    if (date && date > today) { warnings.push('已排除日期晚于评估日的证据'); return }
    const identity = text(row._id) || text(row.id) || origin + ':' + index
    if (house && identity === targetId) return
    const key = kind + ':' + identity
    if (seen.has(key)) return
    if (kind === 'sale_deal' || kind === 'auction_deal') {
      const size = area(row)
      // The same transaction can be present in both legacy embedded arrays.
      // Deduplication requires date, area and price; an unknown date alone is
      // never treated as proof that two records describe the same transaction.
      if (date && size) {
        const fingerprint = [kind, date, size, unitPrice].join(':')
        if (transactionFingerprints.has(fingerprint)) return
        transactionFingerprints.add(fingerprint)
      }
    }
    seen.add(key)
    evidence.push({
      id: 'ev_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 20), kind, unitPrice,
      areaSqm: area(row), date, source: firstText([row.source, origin]), url: safeUrl(row.source_url || row.sourceUrl || row.url),
      sourceRecordId: identity
    })
  }
  rows.forEach((row, index) => {
    if (text(row._id) === targetId && house) return
    const rowClass = propertyClass(row.propertyType || row.property_type)
    if (targetClass && rowClass && targetClass !== rowClass) { warnings.push('已排除物业类型与目标不一致的市场样本'); return }
    if (!rowClass) warnings.push('部分房源缺少物业类型，需核实可比性')
    const auction = isAuction(row)
    if (isSold(row)) {
      add(auction ? 'auction_deal' : 'sale_deal', dealUnitPrice(row, false), row, 'houses', row.deal_date || row.dealDate || row.sold_at, index)
    } else if (!auction && /租房|rental|rent/i.test(text(row.category))) {
      const rent = firstNumber([row.rent_per_sqm, row.rentPerSqm]) || (area(row) && firstNumber([row.rent_month]) ? firstNumber([row.rent_month]) / area(row) : null)
      add('rent', rent, row, 'houses', row.updated_at || row.created_at, index)
    } else if (!auction && /二手房|listing|resale/i.test(text(row.category)) && ![row.status, row.trade_status].some(status => UNSOLD.has(text(status).toLowerCase()))) {
      add('listing', listingUnitPrice(row), row, 'houses', row.updated_at || row.created_at, index)
    }
  })
  // These arrays explicitly represent closed transactions, unlike generic house
  // listings. Generic unit_price is valid only inside these transaction arrays.
  const embedded = [
    { rows: community.deals && community.deals.recent, origin: 'communities.deals.recent' },
    { rows: price.dealRecords, origin: 'communities.price.dealRecords' }
  ]
  embedded.forEach(group => (Array.isArray(group.rows) ? group.rows : []).slice(0, 100).forEach((row, index) => {
    const rowClass = propertyClass(row.propertyType || row.property_type)
    if (targetClass && rowClass && targetClass !== rowClass) return
    if (!useCommunitySummary && !rowClass) return
    if ([row.status, row.trade_status].some(status => UNSOLD.has(text(status).toLowerCase()))) return
    add(isAuction(row) ? 'auction_deal' : 'sale_deal', dealUnitPrice(row, true), row, group.origin, row.date || row.deal_date, index)
  }))
  const communityAvg = useCommunitySummary ? firstNumber([price.price, community.ajk_avg_price, beike.avg_price]) : null
  const filingPrice = useCommunitySummary ? firstNumber([reference.beian_price, reference.filingPrice]) : null
  add('community_reference', communityAvg, { _id: communityId, source: 'community_reference', url: beike.url }, 'communities', community.beike_updated_at || community.updatedAt || community.updated_at, 0)
  add('filing_reference', filingPrice, { _id: communityId, source: 'filing_reference', url: reference.source_url }, 'communities.reference', reference.updatedAt || reference.updated_at, 0)
  evidence.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id))
  const perKind = new Map()
  for (const item of evidence) {
    if (!perKind.has(item.kind)) perKind.set(item.kind, [])
    perKind.get(item.kind).push(item)
  }
  // Keep each evidence class represented, instead of filling the prompt entirely
  // with listings and accidentally dropping transaction/reference evidence.
  const selected = []
  for (const kind of ['sale_deal', 'auction_deal', 'listing', 'rent', 'community_reference', 'filing_reference']) selected.push(...(perKind.get(kind) || []).slice(0, kind.includes('reference') ? 1 : 24))
  if (selected.length > MAX_EVIDENCE || selected.length < evidence.length) warnings.push('模型证据已按类别和日期截取，不代表全部市场记录')
  const finalEvidence = selected.slice(0, MAX_EVIDENCE)
  const byKind = kind => finalEvidence.filter(item => item.kind === kind).map(item => item.unitPrice)
  const sales = byKind('sale_deal'), auctionDeals = byKind('auction_deal'), listings = byKind('listing'), rents = byKind('rent')
  const acceptedCommunityAvg = finalEvidence.find(item => item.kind === 'community_reference')
  const acceptedFiling = finalEvidence.find(item => item.kind === 'filing_reference')
  const market = {
    listingAvg: average(listings) || (useCommunitySummary ? firstNumber([price.listingPrice]) : null),
    recentDealAvg: average(sales), rentPerSqm: average(rents) || (useCommunitySummary ? firstNumber([price.rentPerSqm, community.rentals && community.rentals.avg_unit_rent]) : null),
    auctionDealAvg: average(auctionDeals), communityAvg: acceptedCommunityAvg ? acceptedCommunityAvg.unitPrice : average(listings),
    filingPrice: acceptedFiling ? acceptedFiling.unitPrice : null, gongdiPrice: useCommunitySummary ? firstNumber([reference.gongdi_price]) : null, dealCount: sales.length
  }
  const missingFields = []
  if (target.type === 'house') {
    if (!target.areaSqm) missingFields.push('areaSqm')
    for (const key of ['floor', 'totalFloors', 'rooms', 'orientation', 'decoration']) if (target.attributes[key] === undefined) missingFields.push(key)
    if (isAuction(house)) {
      for (const key of ['occupancy', 'deliveryStatus']) if (target.attributes[key] === undefined) missingFields.push(key)
    }
  }
  if (!target.propertyType) missingFields.push('propertyType')
  if (!sales.length) missingFields.push('saleDeals')
  if (!market.listingAvg && !market.communityAvg && !market.filingPrice) missingFields.push('marketPriceReference')
  if (finalEvidence.some(item => !item.date)) warnings.push('部分证据没有可验证日期，需核实数据时效')
  if (market.listingAvg && !listings.length) warnings.push('挂牌均价来自小区汇总，缺少逐条挂牌证据')
  if (market.rentPerSqm && !rents.length) warnings.push('租金来自小区汇总，缺少逐条租赁证据')
  return {
    target, market, evidence: finalEvidence, missingFields, warnings: [...new Set(warnings)],
    dataQuality: { level: sales.length >= 3 && !missingFields.length && !warnings.length ? 'sufficient' : 'limited', saleDealCount: sales.length, auctionDealCount: auctionDeals.length, listingCount: listings.length, rentCount: rents.length, scannedHouseCount: rows.length, evidenceCount: finalEvidence.length, asOfDate: today, missingFieldCount: missingFields.length }
  }
}

module.exports = { loadValuationData, number, scalar, isSold, dealUnitPrice }
