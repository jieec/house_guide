const app = getApp()
const reportExport = require('../../utils/report-export.js')
const valuationClient = require('../../utils/valuation-client.js')
const valuationResult = require('../../utils/valuation-result.js')

function emptyReport() {
  return { basic: [], basicGroups: [], prices: [], advice: [], tools: [], competitors: [], traffic: [], schools: [], missing: [], deals: [], dealSummary: '' }
}
function readyValuation(report) {
  return valuationResult.canExportValuation ? valuationResult.canExportValuation(report) : !!(report && ['model_estimate', 'needs_review', 'rule_only', 'insufficient_data'].includes(report.status))
}

function num(v) {
  if (v && typeof v === 'object') {
    const numericKey = ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal'].find(key => Object.prototype.hasOwnProperty.call(v, key))
    if (numericKey) v = v[numericKey]
  }
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function avg(arr) {
  const list = arr.filter(v => Number.isFinite(v) && v > 0)
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0
}
function percentile(arr, q) {
  if (!arr.length) return 0
  const pos = (arr.length - 1) * q
  const lo = Math.floor(pos), hi = Math.min(lo + 1, arr.length - 1)
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo)
}
function methodNote(basis, saleWeight) {
  switch (basis) {
    case 'recent_sales_and_listings':
      return Number.isFinite(saleWeight)
        ? '近期成交' + Math.round(saleWeight * 100) + '%＋挂牌P25×95% ' + Math.round((1 - saleWeight) * 100) + '%'
        : '近期成交与挂牌P25×95%加权'
    case 'recent_sales': return '仅采用近期成交（缺少挂牌样本）'
    case 'listings': return '挂牌P25×95%（无可用近期成交）'
    case 'community': return '小区参考均价×85%（样本不足）'
    default: return '缺少估价样本'
  }
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
const LOCAL_POI = /珠海|橫琴|横琴|香洲|斗門|斗门|金灣|金湾|拱北|湾仔|南屏|前山|吉大|翠微|新香洲|唐家|白蕉|平沙|三灶|紅旗|红旗|乾務|乾务|梅华|梅華|獅山|狮山|吉蓮|吉莲|九洲|九州|海濱|海滨|情侶|情侣|港珠澳大橋|港珠澳大桥|十字門|十字门|湾仔北|粵澳深度合作區|粤澳深度合作区|橫琴粵澳|横琴粤澳/
const LOCAL_POI_WHITELIST = /澳门回归纪念公园|澳門回歸紀念公園|旺角百货|旺角百貨/
const FOREIGN_POI = /澳门|澳門|香港|氹仔|路环|路環|妈阁|媽閣|葡京|黑沙|新界|九龙|港岛|离岛|氹仔线|新马路|大三巴|新八佰伴|八佰伴|信德堡|Circle\s*Square|威尼斯人|巴黎人|官也街|塔石|望厦|筷子基|高士德|水坑尾|贾伯乐|沙梨头|河边新街|下环|风顺堂|花王堂|大堂区|望德堂|圣安多尼堂|路氹|金鐘|金钟|中環|中环|銅鑼灣|铜锣湾|尖沙咀|旺角|深水埗|將軍澳|将军澳|太古廣場|太古广场|鰂魚涌|鲗鱼涌|九龍塘|九龙塘|紅磡|红磡|土瓜灣|土瓜湾|觀塘|观塘|黃大仙|黄大仙|鑽石山|钻石山|荔枝角|長沙灣|长沙湾|東涌|东涌|迪士尼|灣仔|萬茂臺|万茂台/i
const TRAD_POI = /[學聖諾廣碼馬區園場圖醫銀東陽記紀會車產業務財觀覽購買賣點頭發結維綜絡統網經線級紙紅細組織讓與門間開關長們應際條華約龍羅理鐘臺萬灣]/
function isLocalPoi(it) {
  if (!it) return false
  const text = [it.name, it.title, it.info, it.address, it.city, it.district, it.province].filter(Boolean).join(' ')
  if (!text) return false
  if (LOCAL_POI_WHITELIST.test(text) || LOCAL_POI.test(text)) return true
  if (FOREIGN_POI.test(text)) return false
  if (TRAD_POI.test(text)) return false
  if (it.city && String(it.city).indexOf('珠海') < 0) return false
  if (it.province && String(it.province).indexOf('广东') < 0) return false
  return true
}
function poiNames(items, limit, city) {
  const zhuhai = String(city || '').trim().replace(/市$/, '') === '珠海'
  const out = [], seen = new Set()
  ;(items || []).forEach(it => {
    if (!it || (zhuhai && !isLocalPoi(it))) return
    const name = it.name || it.title || ''
    if (!name || seen.has(name)) return
    seen.add(name)
    const d = parseDist(it.dist)
    out.push(name + (d && d !== '0' ? ' · ' + d + '米' : ''))
  })
  return out.slice(0, limit || 6)
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
    report: emptyReport(),
    dataStatus: '',
    updatedAt: '',
    valuationReport: null,
    valuationLoading: false,
    valuationError: '',
    valuationDirty: false,
    valuationExportable: false,
    demoMode: false,
    demoScenario: 'normal',
    demoScenarioIndex: 0,
    demoScenarios: valuationClient.SCENARIOS || []
  },

  onShow() {
    this._disposed = false
    if (app.globalData.valuationDemo) {
      const entry = app.globalData.valuationDemo
      delete app.globalData.valuationDemo
      return this.enterDemo(entry && entry.scenario ? entry.scenario : 'normal')
    }
    if (this.data.demoMode) return
    const location = app.globalData.location || null
    const city = location && location.city ? String(location.city).replace(/市$/, '') : ''
    if (this.data.city && city !== this.data.city) this.clearSelection()
    this.setData({ location, city })
  },
  onUnload() {
    this._disposed = true
    this._loadSeq = (this._loadSeq || 0) + 1
    this._valuationSeq = (this._valuationSeq || 0) + 1
    this._searchSeq = (this._searchSeq || 0) + 1
    this._retryRequest = null
    this._pendingValuationId = null
  },
  invalidateValuation() {
    this._valuationSeq = (this._valuationSeq || 0) + 1
    this._pendingValuationId = null
    this._retryRequest = null
    this.setData({ valuationReport: null, valuationLoading: false, valuationError: '', valuationDirty: true, valuationExportable: false })
  },
  clearSelection() {
    this._loadSeq = (this._loadSeq || 0) + 1
    this._searchSeq = (this._searchSeq || 0) + 1
    this._reportFacts = null
    this.invalidateValuation()
    this.setData({ selectedCommunity: null, report: emptyReport(), searchResults: [], searching: false, loading: false, dataStatus: '', updatedAt: '' })
  },
  enterDemo(eventOrScenario) {
    const requested = typeof eventOrScenario === 'string' ? eventOrScenario : 'normal'
    const options = valuationClient.SCENARIOS || []
    const index = options.findIndex(item => item.key === requested)
    const scenario = index >= 0 ? requested : 'normal'
    this.clearSelection()
    const doc = valuationClient.getDemoCommunity(scenario)
    this.setData({ demoMode: true, demoScenario: scenario, demoScenarioIndex: Math.max(0, index), location: doc, city: doc.city || '演示城市', keyword: doc.community, selectedCommunity: doc, activeTab: 0 })
    return this.loadReport(doc)
  },
  exitDemo() {
    this.clearSelection()
    const location = app.globalData.location || null
    this.setData({ demoMode: false, demoScenario: 'normal', demoScenarioIndex: 0, keyword: '', location, city: location && location.city ? String(location.city).replace(/市$/, '') : '' })
  },
  onDemoScenarioChange(e) {
    const option = (valuationClient.SCENARIOS || [])[Number(e.detail.value)]
    if (this.data.demoMode && option) return this.enterDemo(option.key)
  },
  goSingleDemo() {
    wx.navigateTo({ url: '/pages/houses/analyze/analyze?demo=1&scenario=' + encodeURIComponent(this.data.demoScenario) })
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
  goLocation() {
    if (this.data.demoMode) return wx.showToast({ title: '请先退出本地演示再修改位置', icon: 'none' })
    wx.navigateTo({ url: '/pages/location/location' })
  },

  onKeyword(e) {
    const keyword = String(e.detail.value || '').trim()
    this.clearSelection()
    this.setData({ keyword })
    const seq = this._searchSeq
    if (!keyword) return
    if (this.data.demoMode) {
      const doc = valuationClient.getDemoCommunity(this.data.demoScenario)
      const matches = doc.community.indexOf(keyword) >= 0 ? [{ ...doc, displayAddress: '本地演示数据，不代表真实房产' }] : []
      return this.setData({ searchResults: matches })
    }
    if (!this.data.city) return wx.showToast({ title: '请先选择位置', icon: 'none' })
    if (!wx.cloud) return wx.showToast({ title: '云服务不可用', icon: 'none' })
    const db = wx.cloud.database()
    this.setData({ searching: true })
    return db.collection('communities')
      .where({ city: this.data.city, community: db.RegExp({ regexp: keyword, options: 'i' }) })
      .limit(12).get()
      .then(res => {
        if (this._disposed || seq !== this._searchSeq) return
        this.setData({
          searchResults: (res.data || []).map(item => ({ ...item, displayAddress: [item.city, item.district, item.base && item.base.address].filter(Boolean).join(' ') })),
          searching: false
        })
      })
      .catch(() => {
        if (this._disposed || seq !== this._searchSeq) return
        this.setData({ searchResults: [], searching: false })
        wx.showToast({ title: '小区查询失败', icon: 'none' })
      })
  },

  pickCommunity(e) {
    const selected = this.data.searchResults[Number(e.currentTarget.dataset.index)]
    if (!selected) return
    this.setData({ keyword: selected.community || '', searchResults: [], selectedCommunity: selected, activeTab: 0 })
    return this.loadReport(selected)
  },
  reloadReport() { if (this.data.selectedCommunity) return this.loadReport(this.data.selectedCommunity) },

  askAI() { return this.runValuation() },
  async runValuation() {
    const doc = this.data.selectedCommunity
    if (!doc || !this._reportFacts || this.data.loading) return
    if (this.data.valuationLoading) return
    const seq = this._valuationSeq = (this._valuationSeq || 0) + 1
    const targetId = doc._id
    const demo = this.data.demoMode
    const scenario = this.data.demoScenario
    const pendingId = this._pendingValuationId
    const request = this._retryRequest || (!pendingId ? { targetType: 'community', communityId: targetId, requestId: valuationClient.newRequestId() } : null)
    if (request) this._retryRequest = request
    this.setData({ valuationLoading: true, valuationReport: null, valuationError: '', valuationDirty: true, valuationExportable: false })
    this.rebuildReport()
    try {
      const options = { demo, scenario }
      const result = pendingId
        ? await valuationClient.getEvaluation(pendingId, options)
        : await valuationClient.createEvaluation(request, options)
      if (!this.isCurrentValuation(seq, targetId, demo, scenario)) return
      if (!result || (!['processing', 'failed'].includes(result.status) && (!result.target || result.target.type !== 'community' || result.target.id !== targetId))) throw new Error('估价结果与当前小区不匹配')
      const snapshot = JSON.parse(JSON.stringify(result))
      const ready = readyValuation(snapshot)
      this._retryRequest = null
      this._pendingValuationId = snapshot.status === 'processing' ? snapshot.valuationId : null
      this.rebuildReport(snapshot)
      this.setData({ valuationReport: snapshot, valuationLoading: false, valuationDirty: !ready, valuationExportable: ready,
        valuationError: snapshot.status === 'failed' ? '评估未完成，请重新生成。' : '' })
    } catch (error) {
      if (!this.isCurrentValuation(seq, targetId, demo, scenario)) return
      // A timed-out request can still be running in the cloud. Reuse its request
      // identity (or existing report ID) rather than create another model call.
      if (!error || !['CLIENT_TIMEOUT', 'CLOUD_REQUEST_FAILED'].includes(error.code)) {
        this._retryRequest = null
        this._pendingValuationId = null
      }
      this.rebuildReport()
      this.setData({ valuationReport: null, valuationLoading: false, valuationDirty: true, valuationExportable: false,
        valuationError: error.message || error.errMsg || '评估请求失败，请检查云环境后重试。' })
    }
  },
  isCurrentValuation(seq, targetId, demo, scenario) {
    return !this._disposed && seq === this._valuationSeq && this.data.selectedCommunity && this.data.selectedCommunity._id === targetId && this.data.demoMode === demo && this.data.demoScenario === scenario
  },
  rebuildReport(valuation) {
    const facts = this._reportFacts
    if (!facts) return
    const market = facts.market
    const report = this.buildReport(facts.doc, market, market.cityResult || {}, market.policies || [], market.competitorStats || [], valuation)
    this.setData({ report })
    return report
  },

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

  async loadReport(doc) {
    this.invalidateValuation()
    this._reportFacts = null
    const seq = this._loadSeq = (this._loadSeq || 0) + 1
    const demo = this.data.demoMode
    const scenario = this.data.demoScenario
    const city = String(doc.city || this.data.city || '').replace(/市$/, '')
    this.setData({ loading: true, report: emptyReport(), dataStatus: demo ? '正在读取本地演示数据…' : '正在读取后台数据…' })
    try {
      let market
      if (demo) market = valuationClient.getDemoMarket(scenario)
      else {
        if (!wx.cloud) throw new Error('云服务不可用')
        const db = wx.cloud.database()
        const [sales, rents, cityResult, policies, competitorStats, auctionDeals] = await Promise.all([
          db.collection('houses').where({ city, community: doc.community, category: '二手房' }).limit(200).get().then(r => r.data || []),
          db.collection('houses').where({ city, community: doc.community, category: '租房' }).limit(100).get().then(r => r.data || []),
          this.queryCityAverage(db, city),
          db.collection('policies').where(db.command.or([{ city }, { city: '全国' }])).limit(5).get().then(r => r.data || []),
          this.queryCompetitors(db, city, doc.district, doc.community),
          this.queryAuctionDeals(db, city, doc.community)
        ])
        market = { sales, rents, cityResult, policies, competitorStats, auctionDeals }
      }
      if (this._disposed || seq !== this._loadSeq || demo !== this.data.demoMode || !this.data.selectedCommunity || this.data.selectedCommunity._id !== doc._id) return
      this._reportFacts = { doc: JSON.parse(JSON.stringify(doc)), market }
      const report = this.rebuildReport()
      const updated = first(doc.updatedAt, doc.updated_at, doc.crawledAt, doc.crawled_at, doc.created_at)
      const taxTool = report.tools.find(tool => tool.label === '交易税费参考')
      const taxTotal = (taxTool && taxTool.parts || []).find(part => part.name === '计税总价')
      const loanTotalPrice = taxTotal ? num(taxTotal.value) / 10000 : 0
      const loanForm = loanTotalPrice && !this.data.loanForm.totalPrice ? { ...this.data.loanForm, totalPrice: String(loanTotalPrice) } : this.data.loanForm
      this.setData({ loanForm, loanResult: this.calculateLoanResult(loanForm), loading: false,
        dataStatus: demo ? '本地演示数据 · 不代表真实房产' : (report.missing.length ? '已生成，后台有 ' + report.missing.length + ' 项数据缺失' : '后台数据完整'),
        updatedAt: updated ? String(updated).slice(0, 10) : '未记录' })
      if (demo) return this.runValuation()
    } catch (error) {
      if (this._disposed || seq !== this._loadSeq || demo !== this.data.demoMode) return
      this._reportFacts = null
      this.setData({ loading: false, report: emptyReport(), dataStatus: demo ? '本地演示数据读取失败' : '后台数据读取失败', valuationError: error.message || '数据读取失败', valuationExportable: false })
    }
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
    if (this.data.loading || this.data.valuationLoading || this.data.valuationDirty || this.data.valuationError || !readyValuation(this.data.valuationReport)) {
      return wx.showToast({ title: '请先完成当前小区评估', icon: 'none' })
    }
    return reportExport.exportReport(this)
  },

  buildReport(doc, { sales = [], rents = [], auctionDeals = [] }, cityResult = {}, policies = [], competitorStats = [], valuation) {
    const houses = [...sales, ...rents]
    const dbQuery = null
    const base = doc.base || {}, price = doc.price || {}, props = doc.ajk_props || {}
    const bk = doc.beike || {}, dealHistory = doc.deals || {}
    const pois = doc.pois || {}, cats = doc.categories || {}
    const salePrices = sales.filter(it => {
      const statuses = [it.transactionStatus, it.transaction_status, it.status, it.trade_status, it.auction_status]
      return !statuses.some(status => /^(成交|已成交|已售|已售出|拍卖成交|交易成功|sold|completed|auction_sold|未成交|流拍|已流拍|撤拍|已撤拍|中止|终止|cancelled|unsold|failed)$/i.test(String(status || '').trim()))
        && !/法拍|拍卖|auction/i.test([it.category, it.transactionType, it.transaction_type].join(' '))
    }).map(it => num(first(it.listing_unit_price, it.unit_price))).filter(value => value > 0)
    const saleAreas = sales.map(it => num(it.area_sqm)).filter(Boolean)
    
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
    const communityAvg = num(first(price.price, doc.ajk_avg_price, bk.avg_price, avg(salePrices)))
    const dealAvg = num(dealHistory.avg_unit_price)
    const dealCount = num(dealHistory.count)
    const hasRecentDeals = Number.isSafeInteger(dealCount) && dealCount >= 1 && dealAvg > 0
    const recentAvg = hasRecentDeals ? dealAvg : num(first(price.recentDealPrice, price.dealPrice))
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
    // ===== 评估价：近期成交优先 + 挂牌低价辅助（2026-11 校准 v4）=====
    // 成交≥3笔：成交80% + 挂牌P25×95% 20%
    // 成交1-2笔：成交50% + 挂牌P25×95% 50%
    // 仅有一种样本时，使用近期成交均价或挂牌P25×95%；均缺失时使用小区参考均价×85%
    // 备案价只做上限，不参与加权；收益法仅展示，不参与评估
    const reference = doc.reference || {}
    const beianRef = num(reference.beian_price)
    const gongdiRef = num(reference.gongdi_price)
    const discountRef = num(reference.discount) || (beianRef > 0 && gongdiRef > 0 ? gongdiRef / beianRef : 0)
    const gongdiRate = discountRef > 0 ? discountRef : 0.902
    const gongdiValue = beianRef > 0 ? Math.round(beianRef * gongdiRate) : 0
    const gongdiRatePct = Math.round(gongdiRate * 1000) / 10
    const sortedSalePrices = salePrices.slice().sort((a, b) => a - b)
    const listingLow = percentile(sortedSalePrices, 0.25)
    const saleWeight = dealCount >= 3 ? 0.8 : 0.5
    let marketValue = 0
    let localBasis = null
    if (hasRecentDeals && listingLow > 0) {
      marketValue = dealAvg * saleWeight + listingLow * 0.95 * (1 - saleWeight)
      localBasis = 'recent_sales_and_listings'
    } else if (hasRecentDeals) {
      marketValue = dealAvg
      localBasis = 'recent_sales'
    } else if (listingLow > 0) {
      marketValue = listingLow * 0.95
      localBasis = 'listings'
    } else if (communityAvg > 0) {
      marketValue = communityAvg * 0.85
      localBasis = 'community'
    }
    // 备案价只做上限，不参与加权
    const roundedMarketValue = Math.round(marketValue)
    const cappedByBeian = beianRef > 0 && (marketValue > beianRef || roundedMarketValue > beianRef)
    const localBaseline = cappedByBeian ? Math.floor(beianRef) : roundedMarketValue
    // 收益还原法：年有效租金 ÷ 资本化率（住宅 2.0%，商业 4.5%；空置及费用率 5%）
    const isCommercial = /商业|商铺|办公/.test(propertyForRule)
    const capRate = isCommercial ? 0.045 : 0.02
    const incomeValue = rentAvg > 0 ? rentAvg * 12 * 0.95 / capRate : 0
    const hasValuation = valuation !== undefined && valuation !== null
    const evaluation = hasValuation
      ? (typeof valuation.effectiveUnitPrice === 'number' && Number.isFinite(valuation.effectiveUnitPrice) && valuation.effectiveUnitPrice > 0 ? valuation.effectiveUnitPrice : null)
      : (Number.isSafeInteger(localBaseline) && localBaseline > 0 ? localBaseline : null)
    const serverBaseline = hasValuation && valuation.baseline || {}
    const baselineBasis = hasValuation ? serverBaseline.basis || null : localBasis
    const baselineCappedByFiling = hasValuation ? serverBaseline.cappedByFiling === true : cappedByBeian
    const serverSale = (serverBaseline.components || []).find(component => component.kind === 'sale_deal')
    const marketMethod = hasValuation && !serverBaseline.basis
      ? (serverBaseline.marketValue > 0 ? '后端报告的市场比较法明细' : '当前报告暂无方法明细')
      : methodNote(baselineBasis, hasValuation ? serverSale && serverSale.weight : saleWeight)
    const evaluationNote = hasValuation
      ? (evaluation === null ? '数据不足，暂无采用价' : valuation.effectiveSource === 'model' ? '已采用结构化模型评估' : '公式参考价 · 模型未采用或待复核')
      : '本地公式参考 · ' + (baselineCappedByFiling ? '备案价上限校准' : marketMethod)
    const evaluationDisplay = evaluation === null ? '—' : String(Math.round(evaluation))
    const reportedMarketValue = hasValuation ? (typeof serverBaseline.marketValue === 'number' && serverBaseline.marketValue > 0 ? serverBaseline.marketValue : null) : marketValue
    const reportedIncomeValue = hasValuation ? (typeof serverBaseline.incomeValue === 'number' && serverBaseline.incomeValue > 0 ? serverBaseline.incomeValue : null) : incomeValue
    // 市场评估价与工抵参考价的偏离：正数=评估高于工抵（即工抵折扣空间）
    const evalVsGongdi = gongdiValue > 0 && evaluation > 0 ? (evaluation / gongdiValue - 1) * 100 : 0
    const evalVsGongdiText = gongdiValue > 0 && evaluation > 0
      ? (evalVsGongdi >= 0 ? '+' : '') + evalVsGongdi.toFixed(1) + '%'
      : ''
    const gongdiVsEval = gongdiValue > 0 && evaluation > 0 ? (gongdiValue / evaluation - 1) * 100 : 0
    const gongdiVsEvalText = gongdiValue > 0 && evaluation > 0
      ? (gongdiVsEval >= 0 ? '+' : '') + gongdiVsEval.toFixed(1) + '%'
      : ''
    const history = first(price.history, doc.priceHistory, doc.history_prices, [])
    const traffic = poiNames([].concat(pois.subway || [], pois.bus || [], cats.station || []), 8, doc.city)
    const schools = poiNames([].concat(pois.school || [], cats.school || []), 8, doc.city)
    const hospitals = poiNames([].concat(pois.hospital || [], cats.hospital || []), 5, doc.city)
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
      { key: 'city_average', label: '城市均价', amount: cityAvg, color: '#5B6E9E', note: cityResult.count ? cityResult.count + '条城市样本' : '' },
      { key: 'community_average', label: '小区均价', amount: communityAvg, color: '#4A7889' },
      { key: 'recent_deal', label: '楼盘近期平均成交价', labelLines: ['楼盘近期', '平均成交价'], amount: recentAvg, color: '#5B7F63' },
      { key: 'auction_deal', label: '楼盘近期法拍成交价', labelLines: ['楼盘近期', '法拍成交价'], amount: auctionAvg, color: '#9C6055' },
      { key: 'listing_average', label: '楼盘平均挂牌价', labelLines: ['楼盘平均', '挂牌价'], amount: listingAvg, color: '#8A6A38' },
      { key: 'evaluation', label: '评估价格', amount: evaluation, color: '#7A5C93', note: evaluationNote },
      ...(gongdiValue > 0 ? [{ key: 'gongdi_reference', label: '工抵参考价', labelLines: ['工抵参考价'], amount: gongdiValue, color: '#A06A4A', note: '备案价×' + gongdiRatePct + '%（华发工抵实测折扣）' }] : [])
    ]
    const priceChartMax = Math.ceil(Math.max(...priceItems.map(item => item.amount || 0), 0))
    const chartItems = priceItems.map(item => ({
      ...item,
      labelLines: item.labelLines || [item.label],
      hasData: item.amount > 0,
      value: item.amount > 0 ? String(Math.round(item.amount)) : '—',
      barWidth: item.amount > 0 && priceChartMax > 0 ? item.amount / priceChartMax * 100 : 0
    }))

    // 价格区间与评估价偏离度：都由上面的取样值直接推导，不引入新数据源
    const priceNums = priceItems.map(item => item.amount).filter(v => v > 0)
    const priceRangeText = priceNums.length
      ? Math.round(Math.min(...priceNums)) + ' – ' + Math.round(Math.max(...priceNums)) + ' 元/㎡'
      : '暂无数据'
    const evalDeviation = evaluation > 0 && listingAvg > 0
      ? ((evaluation / listingAvg - 1) * 100).toFixed(1) + '%'
      : '暂无数据'

    // 按「概况 / 规模 / 市场」三簇排序，前端据此切成带小标题的分组
    const basicRows = [
      { label: '位置', value: show(location) }, { label: '小区名称', value: show(doc.community) },
      { label: '房屋性质', value: show(first(bk.ownership, base.shipType, propertyType)) },
      { label: '建成年代', value: show(first(bk.build_year, completion)) },
      { label: '建筑类型', value: show(first(bk.build_type, base.buildType, props['建筑类型'])) },
      { label: '开发商', value: show(first(bk.developer, base.developer, props['开发商'])) },
      { label: '物业公司', value: show(first(bk.property_company, base.propertyCompany, props['物业公司'])) },
      { label: '物业费', value: show(first(bk.property_fee, base.propertyMoney, props['物业费'])) },
      { label: '户型分布', value: layoutText || '暂无数据' },
      { label: '总户数 / 楼栋数', value: [bk.household_count, bk.building_count].filter(Boolean).join(' / ') || '暂无数据' },
      { label: '容积率 / 绿化率', value: [first(bk.plot_ratio, base.plotRatio, props['容积率']), first(bk.greening_rate, base.greeningRatio, base.greenRate, props['绿化率'])].filter(Boolean).join(' / ') || '暂无数据' },
      { label: '车位配比', value: show(base.parking) },
      { label: '区域排名', value: show(areaRank) },
      { label: '成交套数', value: show(sales.length, '套') },
      { label: '贝壳参考均价', value: bk.avg_price ? bk.avg_price + ' 元/㎡' : '暂无数据' },
      { label: '挂牌率', value: bk.listing_rate ? (bk.listing_rate * 100).toFixed(1) + '%（在售 ' + (bk.listing_count || 0) + ' 套）' : '暂无数据' }
    ]
    // 分组切片：8 / 4 / 4，与上面的书写顺序对应
    const basicGroups = [
      { title: '小区概况', rows: basicRows.slice(0, 8) },
      { title: '规模指标', rows: basicRows.slice(8, 12) },
      { title: '市场表现', rows: basicRows.slice(12) }
    ]

    return {
      basic: basicRows,
      basicGroups,
      evaluation,
      evaluationDisplay,
      evaluationNote,
      evaluationSource: hasValuation ? valuation.effectiveSource : 'local_rule',
      valuationId: hasValuation ? valuation.valuationId : '',
      baselineBasis,
      baselineCappedByFiling,
      communityAverageDisplay: communityAvg > 0 ? String(Math.round(communityAvg)) : '—',
      cityAverageDisplay: cityAvg > 0 ? String(Math.round(cityAvg)) : '—',
      listingAverageDisplay: listingAvg > 0 ? String(Math.round(listingAvg)) : '—',
      rentAverageDisplay: rentAvg > 0 ? rentAvg.toFixed(1) + ' 元/㎡/月' : '暂无数据',
      marketValue: reportedMarketValue,
      incomeValue: reportedIncomeValue,
      capRate: hasValuation ? serverBaseline.capRate || null : capRate,
      listingAvg,
      rentAvg,
      evalDeviation,
      gongdiValue,
      gongdiRate,
      gongdiRatePct,
      evalVsGongdi,
      evalVsGongdiText,
      gongdiVsEval,
      gongdiVsEvalText,
      priceChartMax,
      prices: chartItems,
      priceDetails: [
        { label: '楼盘平均租金', value: show(rentAvg ? rentAvg.toFixed(1) : '', '元/㎡/月') },
        ...(hasValuation ? [{
          label: '后端公式基准价',
          value: show(valuation.baselineUnitPrice > 0 ? Math.round(valuation.baselineUnitPrice) : '', '元/㎡'),
          note: baselineCappedByFiling ? '以备案价为上限' : '当前报告的公式基准'
        }] : []),
        { label: '市场比较法估值', value: show(reportedMarketValue ? Math.round(reportedMarketValue) : '', '元/㎡'), note: marketMethod },
        {
          label: '收益还原法估值',
          value: reportedIncomeValue ? Math.round(reportedIncomeValue) + ' 元/㎡' : '暂无方法明细',
          note: hasValuation
            ? (serverBaseline.incomeWeight === 0 ? '仅供参考，未计入基准价' : '后端报告的收益法明细')
            : (isCommercial ? '年租金×95% ÷ 4.5%' : '年租金×95% ÷ 2.0%') + '，仅供参考'
        },
        ...(beianRef > 0 ? [{
          label: '备案价参考（工抵房源）',
          value: Math.round(beianRef) + ' 元/㎡',
          note: '华发工抵房源备案价'
        }] : []),
        { label: '历史走势', value: trendText },
        { label: '评估价折价率', value: evalDeviation, note: '评估价相对平均挂牌价的偏离幅度' },
        { label: '取样价格跨度', value: priceRangeText, note: '各项参考价格的最低值到最高值，不是模型估价区间' },
        ...(gongdiValue > 0 ? [{
          label: '工抵参考价（备案价×折扣）',
          value: gongdiValue + ' 元/㎡',
          note: '备案价 ' + Math.round(beianRef) + ' × ' + gongdiRatePct + '%（华发工抵实测折扣）'
        }] : []),
        ...(gongdiValue > 0 && evaluation > 0 ? [{
          label: '评估价较工抵参考价',
          value: evalVsGongdiText,
          note: '以工抵参考价为基准'
        }, {
          label: '工抵参考价较评估价',
          value: gongdiVsEvalText,
          note: '以当前评估价为基准'
        }] : [])
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
      deals: (dealHistory.recent || []).map(it => ({
        title: it.title || '',
        date: it.date || '',
        total: it.total_wan ? it.total_wan + ' 万' : '',
        unit: it.unit_price ? it.unit_price + ' 元/㎡' : ''
      })),
      dealSummary: dealHistory.count ? ('贝壳累计 ' + dealHistory.count + ' 笔成交 · 成交均价 ' + (dealHistory.avg_unit_price || '—') + ' 元/㎡ · 最近成交 ' + (dealHistory.latest_date || '—')) : '',
      policies,
      layoutText
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
        color: '#4A7889',
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
        color: '#5B7F63',
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
        color: '#9C6055',
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
        color: '#7A5C93',
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
        color: '#8A6A38',
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
        color: '#4A7889',
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
