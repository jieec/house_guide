const app = getApp()

function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function avg(arr) {
  const list = arr.filter(v => Number.isFinite(v) && v > 0)
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0
}
function first() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i]
  }
  return ''
}
function show(v, suffix) {
  return v === undefined || v === null || v === '' ? '暂无数据' : String(v) + (suffix || '')
}
function parseDist(d) {
  if (d === null || d === undefined || d === '') return ''
  const s = String(d).trim()
  const m = s.match(/[\d.]+/)
  if (!m) return ''
  let n = parseFloat(m[0])
  if (s.indexOf('公里') >= 0 || /km/i.test(s)) n *= 1000
  return String(Math.round(n))
}
function poiNames(items, limit) {
  return (items || []).slice(0, limit || 6).map(it => {
    const name = it.name || it.title || ''
    if (!name) return ''
    const d = parseDist(it.dist)
    return name + (d && d !== '0' ? ' · ' + d + '米' : '')
  }).filter(Boolean)
}

Page({
  data: {
    tabs: ['基本信息', '价格分析', '购置建议', '工具使用'],
    activeTab: 0,
    expandedTool: -1,
    expandedAdvice: -1,
    location: null,
    city: '',
    keyword: '',
    searching: false,
    loading: false,
    searchResults: [],
    selectedCommunity: null,
    report: { basic: [], prices: [], advice: [], tools: [], competitors: [], traffic: [], schools: [], missing: [] },
    dataStatus: '',
    updatedAt: ''
  },

  onShow() {
    const location = app.globalData.location || null
    const city = location && location.city ? String(location.city).replace(/市$/, '') : ''
    this.setData({ location, city })
  },
  switchTab(e) { this.setData({ activeTab: Number(e.currentTarget.dataset.index) }) },
  toggleTool(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ expandedTool: this.data.expandedTool === index ? -1 : index })
  },
  toggleAdvice(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ expandedAdvice: this.data.expandedAdvice === index ? -1 : index })
  },
  goLocation() { wx.navigateTo({ url: '/pages/location/location' }) },

  onKeyword(e) {
    const keyword = String(e.detail.value || '').trim()
    this.setData({ keyword })
    if (!keyword) return this.setData({ searchResults: [] })
    if (!this.data.city) return wx.showToast({ title: '请先选择位置', icon: 'none' })
    const db = wx.cloud.database()
    this.setData({ searching: true })
    db.collection('communities')
      .where({ city: this.data.city, community: db.RegExp({ regexp: keyword, options: 'i' }) })
      .limit(12).get()
      .then(res => this.setData({
        searchResults: (res.data || []).map(item => ({ ...item, displayAddress: [item.city, item.district, item.base && item.base.address].filter(Boolean).join(' ') })),
        searching: false
      }))
      .catch(() => {
        this.setData({ searchResults: [], searching: false })
        wx.showToast({ title: '小区查询失败', icon: 'none' })
      })
  },

  pickCommunity(e) {
    const selected = this.data.searchResults[Number(e.currentTarget.dataset.index)]
    if (!selected) return
    this.setData({ keyword: selected.community || '', searchResults: [], selectedCommunity: selected, activeTab: 0 })
    this.loadReport(selected)
  },
  reloadReport() { if (this.data.selectedCommunity) this.loadReport(this.data.selectedCommunity) },

  loadReport(doc) {
    const city = String(doc.city || this.data.city || '').replace(/市$/, '')
    const db = wx.cloud.database()
    this.setData({ loading: true, dataStatus: '正在读取后台数据…' })
    Promise.all([
      db.collection('houses').where({ city, community: doc.community }).limit(100).get().then(r => r.data || []).catch(() => []),
      this.queryCityAverage(db, city),
      db.collection('policies').where(db.command.or([{ city }, { city: '全国' }])).limit(5).get().then(r => r.data || []).catch(() => []),
      this.queryCompetitors(db, city, doc.district, doc.community)
    ]).then(([houses, cityAverage, policies, competitorStats]) => {
      const report = this.buildReport(doc, houses, cityAverage, policies, competitorStats)
      const updated = first(doc.updatedAt, doc.updated_at, doc.crawledAt, doc.crawled_at, doc.created_at)
      this.setData({
        report,
        loading: false,
        dataStatus: report.missing.length ? '已生成，后台有 ' + report.missing.length + ' 项数据缺失' : '后台数据完整',
        updatedAt: updated ? String(updated).slice(0, 10) : '未记录'
      })
    }).catch(err => {
      console.log('[guide.loadReport]', err)
      this.setData({ loading: false, dataStatus: '后台数据读取失败' })
    })
  },

  queryCityAverage(db, city) {
    const $ = db.command.aggregate
    return db.collection('houses').aggregate().match({ city, category: '二手房' })
      .group({ _id: null, average: $.avg('$unit_price'), count: $.sum(1) }).end()
      .then(res => {
        const row = res.list && res.list[0]
        return row ? { price: num(row.average), count: row.count || 0 } : { price: 0, count: 0 }
      }).catch(() => ({ price: 0, count: 0 }))
  },

  queryCompetitors(db, city, district, community) {
    if (!district) return Promise.resolve([])
    const $ = db.command.aggregate
    return db.collection('houses').aggregate()
      .match({ city, district, category: '二手房' })
      .group({ _id: '$community', average: $.avg('$unit_price'), count: $.sum(1) })
      .sort({ count: -1 }).limit(10).end()
      .then(res => (res.list || []).filter(row => row._id && row._id !== community).slice(0, 8).map(row => ({
        name: row._id,
        value: show(row.average ? Math.round(row.average) : '', '元/㎡'),
        meta: row.count + '套挂牌样本'
      }))).catch(() => [])
  },

  buildReport(doc, houses, cityResult, policies, competitorStats) {
    const base = doc.base || {}, price = doc.price || {}, props = doc.ajk_props || {}
    const pois = doc.pois || {}, cats = doc.categories || {}
    const sales = houses.filter(it => it.category === '二手房')
    const rents = houses.filter(it => it.category === '租房')
    const auctions = houses.filter(it => /法拍|拍卖|阿里|京东/.test([it.category, it.source, it.platform, it.title].join('')))
    const deals = houses.filter(it => /成交|已售/.test([it.status, it.trade_status, it.category].join('')))
    const salePrices = sales.map(it => num(it.unit_price)).filter(Boolean)
    const dealPrices = deals.map(it => num(first(it.deal_unit_price, it.unit_price))).filter(Boolean)
    const saleAreas = sales.map(it => num(it.area_sqm)).filter(Boolean)
    
    // 面积段分布
    const areaRanges = { '50㎡以下': 0, '50-70㎡': 0, '70-90㎡': 0, '90-120㎡': 0, '120-150㎡': 0, '150㎡以上': 0 }
    saleAreas.forEach(a => {
      if (a < 50) areaRanges['50㎡以下']++
      else if (a < 70) areaRanges['50-70㎡']++
      else if (a < 90) areaRanges['70-90㎡']++
      else if (a < 120) areaRanges['90-120㎡']++
      else if (a < 150) areaRanges['120-150㎡']++
      else areaRanges['150㎡以上']++
    })
    const areaRangeText = Object.entries(areaRanges).filter(([_, v]) => v > 0).map(([k, v]) => k + ' ' + v + '套').join('｜')
    
    // 户型分布
    const layoutCounts = {}
    sales.forEach(it => {
      const rooms = first(it.rooms, it.house_type, '')
      if (rooms) {
        const m = rooms.match(/(\d+室)/)
        const key = m ? m[1] : rooms.split(' ')[0]
        if (key) layoutCounts[key] = (layoutCounts[key] || 0) + 1
      }
    })
    const layoutText = Object.entries(layoutCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v + '套').join('｜')
    const saleTotals = sales.map(it => {
      const n = num(it.total_price)
      return String(it.total_price || '').includes('万') ? n : (n > 10000 ? n / 10000 : n)
    }).filter(Boolean)
    const rentsSqm = rents.map(it => {
      const rent = num(it.rent_month), area = num(it.area_sqm)
      return rent && area ? rent / area : 0
    }).filter(Boolean)
    const communityAvg = num(first(price.price, doc.ajk_avg_price, avg(salePrices)))
    const recentAvg = num(first(price.recentDealPrice, price.dealPrice, avg(dealPrices)))
    const listingAvg = num(first(price.listingPrice, avg(salePrices)))
    const rentAvg = num(first(price.rentPerSqm, price.rent, avg(rentsSqm)))
    const auctionAvg = num(first(price.auctionPrice, doc.auction_avg_price, avg(auctions.map(it => num(it.unit_price)))))
    const areaAvg = num(first(base.averageArea, doc.average_area, avg(saleAreas)))
    const totalAvg = num(first(price.averageTotalPrice, avg(saleTotals), communityAvg && areaAvg ? communityAvg * areaAvg / 10000 : 0))
    const cityAvg = num(first(doc.city_avg_price, cityResult.price))
    const propertyType = first(base.propertyType, props['物业类型'], props['房屋性质'], doc.propertyType)
    const propertyForRule = propertyType || '住宅'
    const completion = first(base.completionTime, props['竣工时间'], props['建筑年代'], props['建成年代'])
    const age = completion ? new Date().getFullYear() - num(completion) : 0
    const evaluation = num(first(price.evaluationPrice, doc.evaluation_price,
      dealPrices.length ? (Math.min.apply(null, dealPrices) * 1.1 + Math.max.apply(null, dealPrices) * 0.9) / 2 : 0))
    const history = first(price.history, doc.priceHistory, doc.history_prices, [])
    const traffic = poiNames([].concat(pois.subway || [], pois.bus || [], cats.station || []), 8)
    const schools = poiNames([].concat(pois.school || [], cats.school || []), 8)
    const hospitals = poiNames(pois.hospital || [], 5)
    const nearCompetitors = (doc.nearComms || []).slice(0, 8).map(it => ({
      name: it.name || it.community || '周边小区', value: show(first(it.price, it.avgPrice), '元/㎡'), meta: parseDist(it.dist) ? parseDist(it.dist) + '米' : ''
    }))
    const competitors = nearCompetitors.length ? nearCompetitors : (competitorStats || [])
    const rentRatio = communityAvg && rentAvg ? rentAvg * 12 / communityAvg * 100 : 0
    const investmentLine = /住宅/.test(propertyForRule) ? 2.6 : 4.5
    const priceDiff = cityAvg && communityAvg ? (communityAvg - cityAvg) / cityAvg * 100 : 0
    const location = [doc.province, doc.city, doc.district].filter(Boolean).join(' ')
    const areaRank = first(doc.areaRank, doc.rank, base.areaRank, doc.districtRank)
    const trendText = this.priceTrend(history, communityAvg, recentAvg)
    const houseTypeText = houses.map(it => first(it.house_types, it.house_type, it.title)).filter(Boolean).join(' ')
    const missing = []
    ;[['位置', location], ['面积', areaAvg], ['交通配套', traffic], ['教育配套', schools], ['竞品分析', competitors],
      ['房屋性质', propertyType], ['区域排名', areaRank], ['城市均价', cityAvg], ['小区均价', communityAvg],
      ['近期成交价', recentAvg], ['法拍成交价', auctionAvg], ['租金', rentAvg], ['历史价格趋势', history]]
      .forEach(row => { if (!row[1] || (Array.isArray(row[1]) && !row[1].length)) missing.push(row[0]) })
    const loan = totalAvg ? totalAvg * 10000 * 0.7 : 0
    const monthly = this.monthlyPayment(loan, 3.6, 30)
    const totalYuan = totalAvg ? totalAvg * 10000 : 0
    const deedRate = areaAvg && areaAvg <= 140 ? 0.01 : 0.015
    const deedTax = totalYuan ? totalYuan * deedRate : 0
    const totalRepay = monthly ? monthly * 30 * 12 : 0
    const interest = totalRepay ? totalRepay - loan : 0
    const policyText = policies.map(it => first(it.summary, it.purchase_limit, it.tax)).filter(Boolean).join('；')

    return {
      basic: [
        { label: '位置', value: show(location) }, { label: '小区名称', value: show(doc.community) },
        { label: '面积段分布', value: areaRangeText || '暂无数据' }, { label: '户型分布', value: layoutText || '暂无数据' },
        { label: '平均面积', value: show(areaAvg ? Math.round(areaAvg) : '', '㎡') }, { label: '房屋性质', value: show(propertyType) },
        { label: '建成年代', value: show(completion) }, { label: '区域排名', value: show(areaRank) },
        { label: '成交/在售样本', value: show(first(price.saleCount, sales.length), '套') },
        { label: '开发商', value: show(first(base.developer, props['开发商'])) },
        { label: '物业公司', value: show(first(base.propertyCompany, props['物业公司'])) },
        { label: '容积率 / 绿化率', value: [first(base.plotRatio, props['容积率']), first(base.greenRate, props['绿化率'])].filter(Boolean).join(' / ') || '暂无数据' }
      ],
      prices: [
        { label: '城市均价', value: show(cityAvg ? Math.round(cityAvg) : '', '元/㎡'), note: cityResult.count ? cityResult.count + '条城市样本' : '' },
        { label: '小区均价', value: show(communityAvg ? Math.round(communityAvg) : '', '元/㎡') },
        { label: '近期平均成交价', value: show(recentAvg ? Math.round(recentAvg) : '', '元/㎡') },
        { label: '法拍成交价', value: show(auctionAvg ? Math.round(auctionAvg) : '', '元/㎡') },
        { label: '平均挂牌价', value: show(listingAvg ? Math.round(listingAvg) : '', '元/㎡') },
        { label: '平均租金', value: show(rentAvg ? rentAvg.toFixed(1) : '', '元/㎡/月') },
        { label: '评估价格', value: show(evaluation ? Math.round(evaluation) : '', '元/㎡'), note: price.evaluationPrice || doc.evaluation_price ? '后台评估数据' : (evaluation ? '按Excel价格区间规则估算' : '') },
        { label: '历史走势', value: trendText }
      ],
      advice: this.buildAdvice({
        propertyType: propertyForRule, rentRatio, investmentLine, areaAvg, priceDiff,
        traffic, schools, hospitals, age, policyText, areaRank,
        volume: sales.length, trendText, auctionAvg, recentAvg, communityAvg, cityAvg,
        evaluation, houseTypeText
      }),
      tools: [
        {
          label: '估算总价', value: show(totalAvg ? totalAvg.toFixed(0) : '', '万元'), note: '后台均价 × 后台平均面积',
          formula: '估算总价 = 小区均价 × 平均面积',
          parts: [
            { name: '小区均价', value: show(communityAvg ? Math.round(communityAvg) : '', '元/㎡') },
            { name: '平均面积', value: show(areaAvg ? Math.round(areaAvg) : '', '㎡') },
            { name: '计算', value: communityAvg && areaAvg ? Math.round(communityAvg) + ' × ' + Math.round(areaAvg) + ' ÷ 10000' : '数据不足' }
          ], warning: '这是小区平均口径，不代表某一套房屋的实际成交总价。'
        },
        {
          label: '交易税费参考', value: show(deedTax ? Math.round(deedTax) : '', '元起'), note: '点击查看契税、增值税、个人所得税',
          formula: '交易税费 = 契税 + 增值税及附加 + 个人所得税 + 其他费用',
          parts: [
            { name: '计税总价', value: show(totalYuan ? Math.round(totalYuan) : '', '元') },
            { name: '契税', value: deedTax ? Math.round(totalYuan) + ' × ' + (deedRate * 100) + '% = ' + Math.round(deedTax) + '元' : '数据不足' },
            { name: '增值税及附加', value: '需知道是否满2年；符合免征条件时可为0' },
            { name: '个人所得税', value: '需知道是否满五唯一及原值；符合免征条件时可为0' },
            { name: '登记/服务等费用', value: '以当地不动产登记及实际服务收费为准' }
          ], warning: '当前按家庭唯一住房示例估算：面积≤140㎡按1%，面积＞140㎡按1.5%。实际税率还取决于家庭住房套数、房屋性质及交易时政策。'
        },
        {
          label: '贷款金额示例', value: show(loan ? Math.round(loan) : '', '元'), note: '按估算总价的70%测算',
          formula: '贷款金额 = 估算总价 × 70%',
          parts: [
            { name: '估算总价', value: show(totalYuan ? Math.round(totalYuan) : '', '元') },
            { name: '示例贷款比例', value: '70%' },
            { name: '计算', value: totalYuan ? Math.round(totalYuan) + ' × 70% = ' + Math.round(loan) + '元' : '数据不足' }
          ], warning: '实际可贷比例取决于首套/二套、评估价、征信、收入及银行政策。'
        },
        {
          label: '30年月供示例', value: show(monthly ? monthly.toFixed(0) : '', '元/月'), note: '等额本息，年利率3.6%',
          formula: '月供 = 本金 × 月利率 × (1+月利率)^期数 ÷ [(1+月利率)^期数-1]',
          parts: [
            { name: '贷款本金', value: show(loan ? Math.round(loan) : '', '元') },
            { name: '贷款期限', value: '30年，共360期' },
            { name: '示例年利率', value: '3.6%，月利率0.3%' },
            { name: '累计还款', value: show(totalRepay ? Math.round(totalRepay) : '', '元') },
            { name: '其中利息', value: show(interest ? Math.round(interest) : '', '元') }
          ], warning: '利率为演示值，实际月供应以银行审批利率和放款日为准。'
        },
        {
          label: '租售比', value: show(rentRatio ? rentRatio.toFixed(2) : '', '%'), note: '年租金收入 ÷ 购房价格',
          formula: '年租售比 = 月租金单价 × 12 ÷ 小区均价 × 100%',
          parts: [
            { name: '月租金单价', value: show(rentAvg ? rentAvg.toFixed(1) : '', '元/㎡/月') },
            { name: '年租金单价', value: show(rentAvg ? (rentAvg * 12).toFixed(1) : '', '元/㎡/年') },
            { name: '小区均价', value: show(communityAvg ? Math.round(communityAvg) : '', '元/㎡') },
            { name: '参考线', value: propertyForRule + '约' + investmentLine + '%' }
          ], warning: '未扣除空置期、物业费、维修、税费和资金成本，因此不等同于净收益率。'
        },
        {
          label: '法拍交易成本', value: '需具体拍卖标的', note: '点击查看成本组成',
          formula: '总成本 = 成交价 + 税费 + 欠费 + 腾退/交付成本 + 融资成本',
          parts: [
            { name: '拍卖成交价', value: show(auctionAvg ? Math.round(auctionAvg) : '', '元/㎡') },
            { name: '过户税费', value: '按买卖双方税费承担约定核算' },
            { name: '历史欠费', value: '物业、水电、土地出让金等需尽调' },
            { name: '腾退交付', value: '根据占用、租赁和执行情况核算' },
            { name: '融资成本', value: '保证金、尾款期限及贷款利息' }
          ], warning: '小区均值无法替代具体拍卖公告、执行裁定和现场尽调。'
        },
        {
          label: '楼龄风险', value: age >= 30 ? '需重点关注' : (age ? '暂未触发' : '暂无数据'), note: age ? '估算楼龄约' + age + '年' : '后台缺少建成年代',
          formula: '估算楼龄 = 当前年份 - 建成年份',
          parts: [
            { name: '建成年份', value: show(completion) },
            { name: '估算楼龄', value: show(age || '', '年') },
            { name: '风险参考', value: '楼龄达到30年重点关注；楼龄与贷款年限还需满足银行要求' }
          ], warning: '建成年代不等同于产权起算时间，贷款要求也会因银行和房屋性质不同而变化。'
        }
      ],
      competitors, traffic, schools, missing,
      areaRangeText, layoutText
    }
  },

  priceTrend(history, communityAvg, recentAvg) {
    if (Array.isArray(history) && history.length >= 2) {
      const a = num(first(history[0].price, history[0].value, history[0]))
      const last = history[history.length - 1]
      const b = num(first(last.price, last.value, last))
      if (a && b) return (b >= a ? '上涨 ' : '下跌 ') + Math.abs((b - a) / a * 100).toFixed(1) + '%'
    }
    if (communityAvg && recentAvg) return (recentAvg >= communityAvg ? '近期高于均价 ' : '近期低于均价 ') + Math.abs((recentAvg - communityAvg) / communityAvg * 100).toFixed(1) + '%'
    return '暂无数据'
  },

  buildAdvice(d) {
    const pct = value => Math.max(0, Math.min(100, Math.round(value)))
    const level = score => score >= 75 ? '高度适配' : (score >= 55 ? '较为适配' : (score >= 35 ? '谨慎考虑' : '适配度较低'))
    const rankNumber = num(d.areaRank)
    const rankTopHalf = /前\s*50%|前半|优秀|较高/.test(String(d.areaRank || '')) || (rankNumber > 0 && rankNumber <= 50)
    const hasPriceBenchmark = d.communityAvg && d.cityAvg
    const priceWithin10 = hasPriceBenchmark && Math.abs(d.priceDiff) <= 10
    const propertyIsImprovement = /复式|别墅|大平层|叠墅|联排/.test(d.houseTypeText || '')

    let finance = 0
    const financeMetrics = []
    if (d.rentRatio) {
      const points = d.rentRatio >= d.investmentLine ? 35 : (d.rentRatio >= d.investmentLine * 0.75 ? 22 : 8)
      finance += points
      financeMetrics.push({ name: '租售比（35分）', value: d.rentRatio.toFixed(2) + '% / 参考线' + d.investmentLine + '%', result: '+' + points + '分', good: points >= 22 })
    } else financeMetrics.push({ name: '租售比（35分）', value: '缺少租金或房价', result: '+0分', good: false })
    if (hasPriceBenchmark) {
      const points = d.priceDiff <= -5 ? 20 : (d.priceDiff <= 5 ? 14 : (d.priceDiff <= 10 ? 8 : 2))
      finance += points
      financeMetrics.push({ name: '价格安全垫（20分）', value: '较城市均价' + (d.priceDiff >= 0 ? '高' : '低') + Math.abs(d.priceDiff).toFixed(1) + '%', result: '+' + points + '分', good: points >= 14 })
    } else financeMetrics.push({ name: '价格安全垫（20分）', value: '缺少城市或小区均价', result: '+0分', good: false })
    const liquidityPoints = d.volume >= 20 ? 15 : (d.volume >= 8 ? 10 : (d.volume > 0 ? 5 : 0))
    finance += liquidityPoints
    financeMetrics.push({ name: '挂牌流动性（15分）', value: d.volume ? d.volume + '套样本' : '暂无样本', result: '+' + liquidityPoints + '分', good: liquidityPoints >= 10 })
    const auctionDiscount = d.auctionAvg && d.evaluation ? (d.evaluation - d.auctionAvg) / d.evaluation * 100 : 0
    const auctionPoints = auctionDiscount >= 15 ? 15 : (auctionDiscount >= 5 ? 10 : (d.auctionAvg ? 4 : 0))
    finance += auctionPoints
    financeMetrics.push({ name: '法拍折价空间（15分）', value: d.auctionAvg ? (auctionDiscount ? '较评估价低' + auctionDiscount.toFixed(1) + '%' : '已有法拍价格') : '缺少法拍成交价', result: '+' + auctionPoints + '分', good: auctionPoints >= 10 })
    const trendPoints = /上涨/.test(d.trendText) ? 10 : (/低于|下跌/.test(d.trendText) ? 4 : (d.trendText !== '暂无数据' ? 7 : 0))
    finance += trendPoints
    financeMetrics.push({ name: '价格趋势（10分）', value: d.trendText, result: '+' + trendPoints + '分', good: trendPoints >= 7 })
    const agePoints = d.age ? (d.age < 20 ? 5 : (d.age < 30 ? 3 : 0)) : 0
    finance += agePoints
    financeMetrics.push({ name: '楼龄融资性（5分）', value: d.age ? d.age + '年' : '缺少建成年代', result: '+' + agePoints + '分', good: agePoints >= 3 })

    let rigid = 0
    const rigidMetrics = []
    const areaPoints = d.areaAvg >= 85 && d.areaAvg <= 144 ? 25 : (d.areaAvg >= 70 && d.areaAvg < 160 ? 12 : 3)
    rigid += d.areaAvg ? areaPoints : 0
    rigidMetrics.push({ name: '面积适配（25分）', value: d.areaAvg ? Math.round(d.areaAvg) + '㎡，Excel刚需区间85–144㎡' : '缺少面积', result: '+' + (d.areaAvg ? areaPoints : 0) + '分', good: areaPoints === 25 })
    const rigidPricePoints = priceWithin10 ? 25 : (hasPriceBenchmark && Math.abs(d.priceDiff) <= 20 ? 12 : 2)
    rigid += hasPriceBenchmark ? rigidPricePoints : 0
    rigidMetrics.push({ name: '价格合理性（25分）', value: hasPriceBenchmark ? '较城市均价偏差' + (d.priceDiff >= 0 ? '+' : '') + d.priceDiff.toFixed(1) + '%' : '缺少城市或小区均价', result: '+' + (hasPriceBenchmark ? rigidPricePoints : 0) + '分', good: rigidPricePoints === 25 && hasPriceBenchmark })
    const schoolPoints = d.schools.length >= 3 ? 20 : (d.schools.length ? 12 : 0)
    rigid += schoolPoints
    rigidMetrics.push({ name: '教育配套（20分）', value: d.schools.length ? d.schools.length + '个学校样本' : '暂无学校数据', result: '+' + schoolPoints + '分', good: schoolPoints >= 12 })
    const trafficPoints = d.traffic.length >= 3 ? 15 : (d.traffic.length ? 9 : 0)
    rigid += trafficPoints
    rigidMetrics.push({ name: '交通配套（15分）', value: d.traffic.length ? d.traffic.length + '个交通样本' : '暂无交通数据', result: '+' + trafficPoints + '分', good: trafficPoints >= 9 })
    const medicalPoints = d.hospitals.length ? 10 : 0
    rigid += medicalPoints
    rigidMetrics.push({ name: '医疗配套（10分）', value: d.hospitals.length ? d.hospitals.length + '个医院样本' : '暂无医院数据', result: '+' + medicalPoints + '分', good: medicalPoints > 0 })
    const rankPoints = rankTopHalf ? 5 : 0
    rigid += rankPoints
    rigidMetrics.push({ name: '区域/学校排名（5分）', value: d.areaRank || '缺少公开排名', result: '+' + rankPoints + '分', good: rankPoints > 0 })

    let improve = 0
    const improveMetrics = []
    const improveAreaPoints = d.areaAvg > 144 ? 35 : (d.areaAvg >= 120 ? 20 : (d.areaAvg ? 5 : 0))
    improve += improveAreaPoints
    improveMetrics.push({ name: '改善面积（35分）', value: d.areaAvg ? Math.round(d.areaAvg) + '㎡，Excel改善标准＞144㎡' : '缺少面积', result: '+' + improveAreaPoints + '分', good: improveAreaPoints >= 20 })
    const improvePricePoints = hasPriceBenchmark && d.priceDiff >= 5 && d.priceDiff <= 15 ? 20 : (hasPriceBenchmark && Math.abs(d.priceDiff) <= 20 ? 10 : 0)
    improve += improvePricePoints
    improveMetrics.push({ name: '改善价格带（20分）', value: hasPriceBenchmark ? '较城市均价' + (d.priceDiff >= 0 ? '高' : '低') + Math.abs(d.priceDiff).toFixed(1) + '%，目标约高10%' : '缺少城市或小区均价', result: '+' + improvePricePoints + '分', good: improvePricePoints === 20 })
    const typePoints = propertyIsImprovement ? 20 : (/住宅/.test(d.propertyType) ? 8 : 0)
    improve += typePoints
    improveMetrics.push({ name: '产品类型（20分）', value: propertyIsImprovement ? '发现复式/别墅/大平层等改善产品' : d.propertyType + '，未发现明确改善户型', result: '+' + typePoints + '分', good: typePoints === 20 })
    const improveTraffic = d.traffic.length ? 10 : 0
    const improveSchool = d.schools.length ? 5 : 0
    const improveMedical = d.hospitals.length ? 10 : 0
    improve += improveTraffic + improveSchool + improveMedical
    improveMetrics.push({ name: '综合配套（25分）', value: '交通' + d.traffic.length + '项、教育' + d.schools.length + '项、医疗' + d.hospitals.length + '项', result: '+' + (improveTraffic + improveSchool + improveMedical) + '分', good: improveTraffic + improveSchool + improveMedical >= 15 })

    finance = pct(finance); rigid = pct(rigid); improve = pct(improve)
    return [
      {
        title: '金融投资', score: finance, level: level(finance), metrics: financeMetrics,
        summary: '金融投资适配度' + finance + '%。判断重点是租售比是否超过' + d.investmentLine + '%、相对城市均价是否有安全垫、市场流动性、法拍折价、价格趋势和楼龄融资性。' + (finance >= 55 ? '当前回报与退出指标具备一定支撑，可继续核验真实成交和法拍尽调。' : '当前收益或数据支撑不足，不建议仅凭价格表象作投资决策。')
      },
      {
        title: '刚需自住', score: rigid, level: level(rigid), metrics: rigidMetrics,
        summary: '刚需自住适配度' + rigid + '%。依据Excel规则，重点检查85–144㎡面积区间、价格与城市均价偏差是否在±10%、学校与交通是否齐全、是否有医院，以及区域或学校排名是否进入前50%。' + (rigid >= 55 ? '目前面积、价格或生活配套对日常自住形成支撑。' : '目前面积、价格或配套至少有一项明显不足，需要结合通勤和学位资格进一步核验。')
      },
      {
        title: '改善居住', score: improve, level: level(improve), metrics: improveMetrics,
        summary: '改善居住适配度' + improve + '%。依据Excel规则，核心是面积是否超过144㎡、价格是否处于区域均价上方约10%的改善带、是否存在复式/别墅/大平层等产品，以及交通、教育、医疗配套是否能够提升居住品质。' + (improve >= 55 ? '当前产品尺度与配套较符合改善需求。' : '当前小区平均面积或产品类型不足以证明其属于典型改善选择。')
      }
    ]
  },
  monthlyPayment(principal, annualRate, years) {
    if (!principal) return 0
    const r = annualRate / 12 / 100, n = years * 12
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  }
})
