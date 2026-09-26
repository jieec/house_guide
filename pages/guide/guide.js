const app = getApp()
const reportExport = require('../../utils/report-export.js')

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
    tabs: ['基本信息', '价值分析', '购置建议', '工具使用'],
    activeTab: 0,
    loanTypeOptions: ['商业贷款', '公积金贷款', '组合贷款'],
    loanTermOptions: ['5年', '10年', '15年', '20年', '25年', '30年'],
    repaymentOptions: ['等额本息', '等额本金'],
    loanForm: {
      loanType: '商业贷款', typeIndex: 0, totalPrice: '', downPayment: '30',
      termYears: '30', termIndex: 5, repayment: '等额本息', repaymentIndex: 0,
      commercialRate: '3.6', providentRate: '2.85', commercialShare: '50'
    },
    loanResult: { valid: false, summary: '待输入', message: '请输入房屋总价后测算', parts: [] },
    expandedAdvice: '',
    location: null,
    city: '',
    keyword: '',
    searching: false,
    loading: false,
    searchResults: [],
    selectedCommunity: null,
    report: { basic: [], prices: [], advice: [], tools: [], competitors: [], traffic: [], schools: [], missing: [] },
    dataStatus: '',
    updatedAt: '',
    showContent: false
  },

  onShow() {
    const location = app.globalData.location || null
    const city = location && location.city ? String(location.city).replace(/市$/, '') : ''
    
    // 触发入场动画
    this.setData({ 
      showContent: false,
      location,
      city
    })
    setTimeout(() => {
      this.setData({ showContent: true })
    }, 100)
  },
  switchTab(e) { this.setData({ activeTab: Number(e.currentTarget.dataset.index) }) },
  toggleTool(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ expandedTool: this.data.expandedTool === index ? -1 : index })
  },
  onLoanInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['loanForm.' + field]: e.detail.value })
  },
  onLoanTypeTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ 'loanForm.typeIndex': index, 'loanForm.loanType': this.data.loanTypeOptions[index] })
  },
  onLoanTypeChange(e) {
    const index = Number(e.detail.value)
    this.setData({ 'loanForm.typeIndex': index, 'loanForm.loanType': this.data.loanTypeOptions[index] })
  },
  onLoanTermChange(e) {
    const index = Number(e.detail.value)
    const termYears = this.data.loanTermOptions[index].replace('年', '')
    this.setData({ 'loanForm.termIndex': index, 'loanForm.termYears': termYears })
  },
  onRepaymentChange(e) {
    const index = Number(e.detail.value)
    this.setData({ 'loanForm.repaymentIndex': index, 'loanForm.repayment': this.data.repaymentOptions[index] })
  },
  calculateLoan() {
    const result = this.calculateLoanResult(this.data.loanForm)
    // 更新 tools 中贷款测算的显示值
    const tools = this.data.report.tools || []
    const loanToolIndex = tools.findIndex(t => t.loanCalculator)
    if (loanToolIndex >= 0 && result.valid) {
      tools[loanToolIndex].value = result.summary
      tools[loanToolIndex].note = `${this.data.loanForm.totalPrice}万 · ${this.data.loanForm.loanType} · ${this.data.loanForm.termYears}年`
    }
    this.setData({ 
      loanResult: result,
      'report.tools': tools
    })
  },
  calculateLoanResult(form) {
    const totalPrice = num(form.totalPrice)
    const downRate = Math.max(0, Math.min(100, num(form.downPayment)))
    const years = Math.max(1, num(form.termYears))
    const commercialRate = num(form.commercialRate)
    const providentRate = num(form.providentRate)
    if (!totalPrice) return { valid: false, summary: '待输入', message: '请输入房屋总价后测算', parts: [] }
    const totalLoan = totalPrice * 10000 * (1 - downRate / 100)
    let commercialLoan = totalLoan
    let providentLoan = 0
    if (form.loanType === '公积金贷款') {
      commercialLoan = 0
      providentLoan = totalLoan
    } else if (form.loanType === '组合贷款') {
      const share = Math.max(0, Math.min(100, num(form.commercialShare)))
      commercialLoan = totalLoan * share / 100
      providentLoan = totalLoan - commercialLoan
    }
    const calc = (principal, rate) => {
      if (!principal) return { first: 0, last: 0, total: 0, interest: 0 }
      const n = years * 12
      const r = rate / 12 / 100
      if (form.repayment === '等额本金') {
        const first = principal / n + principal * r
        const last = principal / n + principal / n * r
        const total = principal + principal * r * (n + 1) / 2
        return { first, last, total, interest: total - principal }
      }
      const monthly = r ? principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : principal / n
      const total = monthly * n
      return { first: monthly, last: monthly, total, interest: total - principal }
    }
    const commercial = calc(commercialLoan, commercialRate)
    const provident = calc(providentLoan, providentRate)
    const monthly = commercial.first + provident.first
    const last = commercial.last + provident.last
    const total = commercial.total + provident.total
    return {
      valid: true, summary: Math.round(monthly) + '元/月', message: '',
      parts: [
        { name: '贷款总额', value: Math.round(totalLoan / 10000) + '万元' },
        { name: '首月月供', value: Math.round(monthly) + '元' },
        { name: '末月月供', value: Math.round(last) + '元' },
        { name: '累计还款', value: Math.round(total) + '元' },
        { name: '支付利息', value: Math.round(total - totalLoan) + '元' }
      ]
    }
  },
  toggleAdvice(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ expandedAdvice: this.data.expandedAdvice === index ? -1 : index })
  },
  toggleAdviceKey(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ expandedAdvice: this.data.expandedAdvice === key ? '' : key })
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

  queryRentCount(db, city, community) {
    return db.collection('houses')
      .where({ city, community, category: '租房' })
      .count().then(r => r.total).catch(() => 0)
  },

  queryListingCount(db, city, community) {
    return db.collection('houses')
      .where({ city, community, category: '二手房' })
      .count().then(r => r.total).catch(() => 0)
  },

  queryAuctionDeals(db, city, community) {
    return db.collection('houses')
      .where({ city, community, category: db.command.or([db.command.or([{ category: '法拍' }, { category: '拍卖' }]), db.command.and([{ category: '二手房' }, { status: '成交' }])]) })
      .limit(10).get().then(r => r.data || []).catch(() => [])
  },

  loadReport(doc) {
    const city = String(doc.city || this.data.city || '').replace(/市$/, '')
    const db = wx.cloud.database()
    this.setData({ loading: true, dataStatus: '正在读取后台数据…' })
    Promise.all([
      db.collection('houses').where({ city, community: doc.community, category: '二手房' }).limit(200).get().then(r => r.data || []).catch(() => []),
      db.collection('houses').where({ city, community: doc.community, category: '租房' }).limit(100).get().then(r => r.data || []).catch(() => []),
      this.queryCityAverage(db, city),
      db.collection('policies').where(db.command.or([{ city }, { city: '全国' }])).limit(5).get().then(r => r.data || []).catch(() => []),
      this.queryCompetitors(db, city, doc.district, doc.community),
      this.queryAuctionDeals(db, city, doc.community)
    ]).then(([sales, rents, cityResult, policies, competitorStats, auctionDeals]) => {
      const report = this.buildReport(doc, { sales, rents, auctionDeals }, cityResult, policies, competitorStats)
      const updated = first(doc.updatedAt, doc.updated_at, doc.crawledAt, doc.crawled_at, doc.created_at)
      const taxTool = report.tools.find(tool => tool.label === '交易税费参考')
      const taxTotal = (taxTool && taxTool.parts || []).find(part => part.name === '计税总价')
      const loanTotalPrice = taxTotal ? num(taxTotal.value) / 10000 : 0
      const loanForm = loanTotalPrice && !this.data.loanForm.totalPrice ? { ...this.data.loanForm, totalPrice: String(loanTotalPrice) } : this.data.loanForm
      this.setData({
        report,
        loanForm,
        loanResult: loanTotalPrice ? this.calculateLoanResult(loanForm) : this.data.loanResult,
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

  exportPdf() {
    reportExport.exportReport(this)
  },

  buildReport(doc, { sales, rents, auctionDeals }, cityResult, policies, competitorStats) {
    const houses = [...sales, ...rents]
    const dbQuery = null
    const base = doc.base || {}, price = doc.price || {}, props = doc.ajk_props || {}
    const pois = doc.pois || {}, cats = doc.categories || {}
    const deals = auctionDeals.filter(it => /成交|已售|法拍|拍卖/.test([it.category, it.status, it.trade_status].join('')))
    const salePrices = sales.map(it => num(it.unit_price)).filter(Boolean)
    const dealPrices = deals.map(it => num(first(it.deal_unit_price, it.unit_price))).filter(Boolean)
    const listingPrices = sales.map(it => num(it.unit_price)).filter(Boolean)
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
    const auctionAvg = num(first(price.auctionPrice, doc.auction_avg_price, avg(auctionDeals.map(it => num(it.unit_price)))))
    const areaAvg = num(first(base.averageArea, doc.average_area, avg(saleAreas)))
    const totalAvg = num(first(price.averageTotalPrice, avg(saleTotals), communityAvg && areaAvg ? communityAvg * areaAvg / 10000 : 0))
    const cityAvg = num(first(doc.city_avg_price, cityResult.price))
    const propertyType = first(base.propertyType, props['物业类型'], props['房屋性质'], doc.propertyType)
    const propertyForRule = propertyType || '住宅'
    const completion = first(base.completionTime, props['竣工时间'], props['建筑年代'], props['建成年代'])
    const age = completion ? new Date().getFullYear() - num(completion) : 0
    const evaluation = communityAvg && auctionAvg ? communityAvg * 0.4 + auctionAvg * 0.6 : 0
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
    const totalYuan = totalAvg ? totalAvg * 10000 : 0
    const deedRate = areaAvg && areaAvg <= 140 ? 0.01 : 0.015
    const deedTax = totalYuan ? totalYuan * deedRate : 0
    const policyText = policies.map(it => first(it.summary, it.purchase_limit, it.tax)).filter(Boolean).join('；')
    const priceItems = [
      { label: '城市均价', amount: cityAvg, color: '#4d96ff', note: cityResult.count ? cityResult.count + '条城市样本' : '' },
      { label: '小区均价', amount: communityAvg, color: '#00d4ff' },
      { label: '楼盘近期平均成交价', labelLines: ['楼盘近期', '平均成交价'], amount: recentAvg, color: '#5ddb7a' },
      { label: '楼盘近期法拍成交价', labelLines: ['楼盘近期', '法拍成交价'], amount: auctionAvg, color: '#ff9a6c' },
      { label: '楼盘平均挂牌价', labelLines: ['楼盘平均', '挂牌价'], amount: listingAvg, color: '#f5c451' },
      { label: '评估价格', amount: evaluation, color: '#b394ff', note: '小区均价×40%＋法拍成交价×60%' }
    ]
    const priceChartMax = Math.ceil(Math.max(...priceItems.map(item => item.amount || 0), 0))
    const chartItems = priceItems.map(item => ({
      ...item,
      labelLines: item.labelLines || [item.label],
      hasData: item.amount > 0,
      value: item.amount > 0 ? String(Math.round(item.amount)) : '—',
      barWidth: item.amount > 0 && priceChartMax > 0 ? item.amount / priceChartMax * 100 : 0
    }))

    return {
      basic: [
        { label: '位置', value: show(location) }, { label: '小区名称', value: show(doc.community) },
        { label: '面积段分布', value: areaRangeText || '暂无数据' }, { label: '户型分布', value: layoutText || '暂无数据' },
        { label: '房屋性质', value: show(propertyType) },
        { label: '建成年代', value: show(completion) }, { label: '区域排名', value: show(areaRank) },
        { label: '成交套数', value: show(sales.length, '套') },
        { label: '开发商', value: show(first(base.developer, props['开发商'])) },
        { label: '物业公司', value: show(first(base.propertyCompany, props['物业公司'])) },
        { label: '容积率 / 绿化率', value: [first(base.plotRatio, props['容积率']), first(base.greenRate, props['绿化率'])].filter(Boolean).join(' / ') || '暂无数据' }
      ],
      priceChartMax,
      prices: chartItems,
      priceDetails: [
        { label: '楼盘平均租金', value: show(rentAvg ? rentAvg.toFixed(1) : '', '元/㎡/月') },
        { label: '历史走势', value: trendText }
      ],
      advice: this.buildAdvice({
        propertyType: propertyForRule, rentRatio, investmentLine, areaAvg, priceDiff,
        traffic, schools, hospitals, age, policyText, areaRank,
        volume: sales.length, trendText, auctionAvg, recentAvg, communityAvg, cityAvg,
        evaluation, houseTypeText, listingAvg, rentCount: rents.length,
        rentAvg, remainingYears: num(first(price.remainingYears, base.remainingYears, doc.remainingYears, doc.landRemainingYears))
      }),
      tools: [
        (() => {
          // 自动计算贷款测算结果
          const loanResult = this.calculateLoanResult(this.data.loanForm)
          return {
            label: '贷款测算', 
            value: loanResult.valid ? loanResult.summary : '待输入', 
            note: loanResult.valid ? `${this.data.loanForm.totalPrice}万 · ${this.data.loanForm.loanType} · ${this.data.loanForm.termYears}年` : '商业 / 公积金 / 组合贷款，支持两种还款方式',
            loanCalculator: true, formula: '', parts: [], warning: '结果仅作预算参考，实际额度、利率和贷款年限以银行审批为准。'
          }
        })(),
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
          label: '风险提示', value: age >= 30 ? '需重点关注' : '请核实', note: '楼龄、清楼/腾退、唯一住房收楼风险',
          formula: '法拍房成交前应核实房屋现状、占用和交付条件',
          parts: [
            { name: '楼龄风险', value: age ? '约' + age + '年' + (age >= 30 ? '，需重点关注贷款年限' : '') : '建成年代缺失，需核实' },
            { name: '是否清楼', value: first(doc.vacateStatus, doc.clearHouse, doc.clearance, doc.auction_clearance) || '拍卖公告未明确，需现场核实' },
            { name: '占用/腾退', value: first(doc.occupancy, doc.occupancyStatus, doc.deliveryStatus) || '需核实是否有人居住、出租或存在腾退障碍' },
            { name: '唯一住房收楼', value: first(doc.onlyHomeRisk, doc.uniqueHome, doc.only_house_risk) || '需核实是否为被执行人唯一住房，收楼可能受阻' },
            { name: '来源提示', value: first(doc.auctionSource, doc.source) || '法拍信息以阿里拍卖及法院公告为准' }
          ], warning: '阿里拍卖页面中的清场、占用、租赁、唯一住房等提示，应与拍卖公告、执行裁定和现场尽调交叉核实。'
        }
      ],
      competitors, traffic, schools, missing,
      policies,
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
    // ─── 工具函数 ───────────────────────────────────────────────
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    const pct = v => Math.round(clamp(v, 0, 100))

    // ─── 辅助数据提取 ───────────────────────────────────────────
    const rentRatio = d.rentRatio || 0                       // 年租售比 %
    const areaAvg = d.areaAvg || 0                           // 平均面积 ㎡
    const communityAvg = d.communityAvg || 0
    const evaluation = d.evaluation || 0                     // 评估价
    const auctionAvg = d.auctionAvg || 0                    // 法拍成交价
    const recentAvg = d.recentAvg || 0                      // 近期成交均价
    const listingAvg = d.listingAvg || communityAvg
    const saleCount = d.volume || 0                          // 在售套数
    const rentCount = d.rentCount || 0                       // 在租套数
    const trendUp = /上涨/.test(d.trendText || '')
    const trendDown = /下跌/.test(d.trendText || '')

    // 购置判断采用“收益法 + 市场比较法”，并把空置、运营和年限风险单独列出
    const rentAvg = d.rentAvg || 0
    const targetNetYield = /住宅/.test(d.propertyType || '') ? 3 : 4.5
    const netRentRatio = rentRatio > 0 ? rentRatio * 0.75 : 0 // 预留约25%空置、税费、维修及管理损耗
    const safePrice = rentAvg > 0 ? rentAvg * 12 * 0.75 / (targetNetYield / 100) : 0
    const marketValues = [communityAvg, recentAvg, auctionAvg, evaluation].filter(v => v > 0)
    const marketReference = marketValues.length ? marketValues.reduce((s, v) => s + v, 0) / marketValues.length : 0
    const valuationSpread = marketReference && safePrice ? (safePrice - marketReference) / marketReference * 100 : 0
    const remainingYears = d.remainingYears || 0
    const termRisk = remainingYears > 0 && remainingYears < 25
    const valueConclusion = !safePrice ? '租金或价格数据不足，暂不能给出安全入手价' :
      safePrice >= marketReference * 1.05 ? '按净回报率测算，价格仍有安全垫' :
      safePrice >= marketReference * 0.95 ? '收益法与市场比较法基本接近，建议按成交条件议价' :
      '按净回报率测算，当前价格偏高，建议压价或放弃'

    // 可选字段，缺数据时为 0
    const hasSchool = (d.schools || []).length > 0
    const hasTraffic = (d.traffic || []).length > 0
    const hasHospital = (d.hospitals || []).length > 0
    const poiScore = ((d.schools || []).length > 0 ? 1 : 0) +
      ((d.traffic || []).length > 0 ? 1 : 0) +
      ((d.hospitals || []).length > 0 ? 1 : 0)

    // ─── 投资维度 ───────────────────────────────────────────────

    // ① 租赁指数：租售比 + 租赁活跃度
    // 租售比基准 3%（用户要求），满分 35 分；活跃度满分 15 分
    const rentalRatioScore = rentRatio >= 3 ? 35
      : rentRatio >= 2.5 ? 30
      : rentRatio >= 2.0 ? 24
      : rentRatio >= 1.5 ? 17
      : rentRatio >= 1.0 ? 10
      : rentRatio > 0 ? 5 : 0
    const activeRent = rentCount >= 10 ? 15
      : rentCount >= 5 ? 11
      : rentCount >= 2 ? 7
      : rentCount >= 1 ? 4 : 0
    const rentalScore = pct(rentalRatioScore + activeRent)

    // ② 销售指数：差价率 = (评估价 - 最低成交价) / 评估价
    // 差价 > 15% 为目标；满分 50 分
    const lowestDeal = auctionAvg > 0 ? auctionAvg : (recentAvg > 0 ? recentAvg * 0.85 : 0)
    const discountRate = (evaluation > 0 && lowestDeal > 0)
      ? (evaluation - lowestDeal) / evaluation * 100 : 0
    const discountScore = discountRate >= 20 ? 35
      : discountRate >= 18 ? 30
      : discountRate >= 15 ? 26
      : discountRate >= 12 ? 20
      : discountRate >= 8 ? 14
      : discountRate >= 5 ? 8
      : discountRate > 0 ? 4 : 0
    // 流动性：成交活跃，满分 15 分
    const activeSale = saleCount >= 20 ? 15
      : saleCount >= 10 ? 12
      : saleCount >= 5 ? 8
      : saleCount >= 2 ? 5 : 2
    const salesScore = pct(discountScore + activeSale)

    // ③ 融资指数：差价 > 20% 且挂牌 < 5 套
    const financeDiscount = discountRate >= 25 ? 40
      : discountRate >= 20 ? 35
      : discountRate >= 15 ? 24
      : discountRate >= 10 ? 14
      : discountRate > 0 ? 6 : 0
    const scarceListing = saleCount < 5 ? 20
      : saleCount < 10 ? 14
      : saleCount < 20 ? 8 : 0
    const financeScore = pct(financeDiscount + scarceListing)

    // 投资维度综合分（三个子项各占权重）
    const investTotal = pct(rentalScore * 0.45 + salesScore * 0.30 + financeScore * 0.25)

    // ─── 自住维度 ───────────────────────────────────────────────

    // ① 刚需型：地段配套 + 户型不大 + 学区
    // 学区：3 分制
    const schoolScore = hasSchool ? 30 : 0
    // 户型：面积 50-90㎡ 最佳，90-110㎡ 次之
    const areaRigidScore = areaAvg >= 50 && areaAvg <= 90 ? 28
      : areaAvg >= 90 && areaAvg <= 110 ? 22
      : areaAvg > 110 && areaAvg <= 144 ? 14
      : areaAvg > 0 ? 8 : 0
    // 地段配套（交通+医疗）
    const areaInfraScore = poiScore >= 2 ? 22 : (poiScore === 1 ? 14 : 6)
    const rigidScore = pct(schoolScore + areaRigidScore + areaInfraScore)

    // ② 改善型：平均面积大（>125㎡）+ 四房及以上 + 景观资源
    // 面积：125㎡+ 满分
    const areaImproveScore = areaAvg >= 160 ? 32
      : areaAvg >= 140 ? 28
      : areaAvg >= 125 ? 24
      : areaAvg >= 110 ? 16
      : areaAvg >= 100 ? 10 : 0
    // 景观资源：公园/海边（数据来自 POI 或 keywords）
    const landscapeKeywords = ['公园', '海', '景区', '高尔夫', '温泉', '游乐场', '景观', '江景', '湖景']
    const houseTypeText = d.houseTypeText || ''
    const hasLandscape = landscapeKeywords.some(k => houseTypeText.includes(k)) ? 20
      : ((d.traffic || []).length > 0 ? 10 : 0)
    // 户型：四房及以上
    const roomsImprove = /4室|5室|6室|复式|别墅/.test(houseTypeText) ? 18 : 8
    const improveScore = pct(areaImproveScore + hasLandscape + roomsImprove)

    // ③ 度假型：景观资源 + 景区/海边/公园附近
    // 靠海边/公园/景区/高尔夫/温泉/综合游乐场
    const vacationKeywords = ['海', '公园', '景区', '高尔夫', '温泉', '游乐场', '江景', '湖景', '度假']
    const vacationCount = vacationKeywords.filter(k => houseTypeText.includes(k)).length
    const vacationScenic = vacationCount >= 3 ? 45
      : vacationCount === 2 ? 36
      : vacationCount === 1 ? 28
      : 12  // 无明确关键词但有配套基础分
    // 地段配套支撑
    const vacationInfra = poiScore >= 1 ? 15 : 5
    const vacationScore = pct(vacationScenic + vacationInfra)

    // 自住维度综合分（刚需 + 改善 + 度假）
    const liveTotal = pct(rigidScore * 0.40 + improveScore * 0.35 + vacationScore * 0.25)

    // ─── 组装返回 ───────────────────────────────────────────────

    const levelText = score => score >= 75 ? '高度推荐'
      : score >= 55 ? '较为推荐'
      : score >= 35 ? '谨慎考虑'
      : '适配度较低'

    // 按分数占比画饼图，确保饼图角度总和恒为 360°，与图例百分比一致
    const buildPie = (cats) => {
      const total = cats.reduce((s, c) => s + (c.score || 0), 0)
      let pos = 0
      let stops = []
      cats.forEach((c) => {
        const deg = total > 0 ? ((c.score || 0) / total) * 360 : 0
        const next = pos + deg
        stops.push(c.color + ' ' + pos + 'deg ' + next + 'deg')
        pos = next
      })
      return 'conic-gradient(' + stops.join(', ') + ')'
    }

    // 计算百分比：在该维度总分中占比
    const ratio = (cats, score) => {
      const total = cats.reduce((s, c) => s + (c.score || 0), 0)
      return total > 0 ? Math.round((score || 0) / total * 1000) / 10 : 0
    }

    const investmentCats = [
      {
        name: '租赁指数',
        desc: '长期持有 · 租售比',
        score: rentalScore,
        pct: 0,
        threshold: '租售比 ≥ 3% 为优质',
        color: '#00d4ff',
        details: [
          { label: '年租售比', value: rentRatio > 0 ? rentRatio.toFixed(2) + '%' : '暂无数据' },
          { label: '在租套数', value: rentCount > 0 ? rentCount + ' 套' : '暂无数据' },
          { label: '判断标准', value: rentRatio >= 3 ? '✓ 达到优质门槛' : rentRatio >= 2 ? '△ 接近门槛' : '✗ 低于门槛' }
        ]
      },
      {
        name: '销售指数',
        desc: '成交活跃 · 差价大',
        score: salesScore,
        pct: 0,
        threshold: '差价率 > 15%',
        color: '#23c343',
        details: [
          { label: '评估价', value: evaluation > 0 ? Math.round(evaluation) + ' 元/㎡' : '暂无数据' },
          { label: '最低成交/法拍', value: lowestDeal > 0 ? Math.round(lowestDeal) + ' 元/㎡' : '暂无数据' },
          { label: '差价率', value: discountRate > 0 ? discountRate.toFixed(1) + '%' : '暂无数据', highlight: discountRate >= 15 },
          { label: '在售套数', value: saleCount > 0 ? saleCount + ' 套' : '暂无数据' }
        ]
      },
      {
        name: '融资指数',
        desc: '评估价高 · 流通性低',
        score: financeScore,
        pct: 0,
        threshold: '差价率 > 20% 且挂牌 < 5 套',
        color: '#ff9a6c',
        details: [
          { label: '评估价', value: evaluation > 0 ? Math.round(evaluation) + ' 元/㎡' : '暂无数据' },
          { label: '差价率', value: discountRate > 0 ? discountRate.toFixed(1) + '%' : '暂无数据', highlight: discountRate >= 20 },
          { label: '挂牌套数', value: saleCount > 0 ? saleCount + ' 套' : '暂无数据', highlight: saleCount < 5 },
          { label: '融资判断', value: discountRate >= 20 && saleCount < 5 ? '✓ 符合融资标准' : '✗ 不符合融资标准' }
        ]
      }
    ]

    const selfuseCats = [
      {
        name: '刚需型',
        desc: '地段配套 · 户型不大 · 学区',
        score: rigidScore,
        pct: 0,
        threshold: '50-110㎡ + 学区 + 交通',
        color: '#a78bfa',
        details: [
          { label: '平均面积', value: areaAvg > 0 ? Math.round(areaAvg) + ' ㎡' : '暂无数据', highlight: areaAvg >= 50 && areaAvg <= 110 },
          { label: '学区配套', value: hasSchool ? '✓ 有学校' : '✗ 未找到学校' },
          { label: '交通配套', value: hasTraffic ? '✓ 有交通' : '△ 无交通数据' },
          { label: '医疗配套', value: hasHospital ? '✓ 有医院' : '△ 无医院数据' }
        ]
      },
      {
        name: '改善型',
        desc: '大面积 · 景观资源 · 四房+',
        score: improveScore,
        pct: 0,
        threshold: '≥ 125㎡ + 四房 + 景观',
        color: '#fb923c',
        details: [
          { label: '平均面积', value: areaAvg > 0 ? Math.round(areaAvg) + ' ㎡' : '暂无数据', highlight: areaAvg >= 125 },
          { label: '户型文本', value: houseTypeText || '暂无数据' },
          { label: '景观资源', value: /公园|海|景区|高尔夫|温泉|江景|湖景/.test(houseTypeText) ? '✓ 有景观标签' : '△ 无明确景观' },
          { label: '判断标准', value: areaAvg >= 125 && /4室|5室/.test(houseTypeText) ? '✓ 符合改善型' : '△ 需进一步核实' }
        ]
      },
      {
        name: '度假型',
        desc: '景观资源 · 靠海/公园/景区',
        score: vacationScore,
        pct: 0,
        threshold: '海边/公园/景区/温泉等',
        color: '#38bdf8',
        details: [
          { label: '景观关键词命中', value: vacationCount > 0 ? vacationCount + ' 个匹配' : '暂无匹配' },
          { label: '附近配套', value: poiScore > 0 ? poiScore + ' 项' : '暂无数据' },
          { label: '度假潜力', value: vacationCount >= 2 ? '✓ 具备度假条件' : vacationCount === 1 ? '△ 有单一度假元素' : '✗ 缺乏度假元素' }
        ]
      }
    ]

    // 回填百分比
    investmentCats.forEach(c => c.pct = ratio(investmentCats, c.score))
    selfuseCats.forEach(c => c.pct = ratio(selfuseCats, c.score))

    return {
      investment: {
        totalScore: investTotal,
        level: levelText(investTotal),
        pieBg: buildPie(investmentCats),
        categories: investmentCats
      },
      selfuse: {
        totalScore: liveTotal,
        level: levelText(liveTotal),
        pieBg: buildPie(selfuseCats),
        categories: selfuseCats
      }
    }
  },
})
