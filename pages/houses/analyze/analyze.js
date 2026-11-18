const banks = require('../../../utils/banks.js')
const valuationClient = require('../../../utils/valuation-client.js')
const reportExport = require('../../../utils/report-export.js')

const READY_STATUSES = ['model_estimate', 'needs_review', 'rule_only', 'insufficient_data']
const PURPOSE_KEYS = ['rigid', 'investment', 'improvement']
const FINANCIAL_FIELDS = {
  gap: '', grade: '', gradeDesc: '', loanAmount: '', maxYears: 30,
  monthly: '', totalInterest: '', totalRepay: '', deedTax: '', vatTax: '',
  incomeTax: '', totalTax: '', banks: [], risks: []
}

function parseNum(value) {
  if (value && typeof value === 'object') {
    for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) return parseNum(value[key])
    }
    return NaN
  }
  if (value === null || value === undefined || value === '') return NaN
  const match = String(value).trim().replace(/[,，]/g, '').match(/^-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : NaN
}
function parseArea(value) {
  if (value && typeof value === 'object') {
    for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) return parseArea(value[key])
    }
    return NaN
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : NaN
  if (typeof value !== 'string') return NaN
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:㎡|m²|m2|平米|平方米|平)?$/i)
  const result = match ? Number(match[1]) : NaN
  return Number.isFinite(result) && result > 0 ? result : NaN
}
function positive(value) { return Number.isFinite(value) && value > 0 }
function errorMessage(error) { return error && (error.message || error.errMsg) || '估价请求失败，请重试' }

Page({
  data: {
    item: null, houseId: '', loading: true, loadError: '', isRent: false,
    rentPerSqm: '', pricePerSqm: '', rentRatioResult: '', annualReturn: '',
    area: '', salePer: '', saleTotal: '', missingTip: '',
    purposes: ['自住（首次刚需）', '投资', '改善居住'], purposeIndex: 1,
    suiteType: ['首套', '二套及以上'], suiteIndex: 0,
    fullTwo: ['满2年', '不满2年'], fullTwoIndex: 0,
    fullFive: ['否', '满五唯一'], fullFiveIndex: 0,
    evalPer: '', age: '35', rate: '3.6',
    ...FINANCIAL_FIELDS,
    valuationReport: null, valuationLoading: false, valuationError: '', valuationDirty: false,
    canExport: false, exportingReport: false,
    demoMode: false, demoScenario: 'normal', demoScenarioIndex: 0,
    demoScenarios: valuationClient.SCENARIOS
  },

  async onLoad(options = {}) {
    this._alive = true
    this._loadSeq = 0
    this._valuationSeq = 0
    this._areaEdited = false
    const demoMode = options.demo === '1'
    const scenarioIndex = valuationClient.SCENARIOS.findIndex(item => item.key === options.scenario)
    const demoScenarioIndex = scenarioIndex >= 0 ? scenarioIndex : 0
    this.setData({
      demoMode, demoScenarioIndex,
      demoScenario: valuationClient.SCENARIOS[demoScenarioIndex].key,
      houseId: demoMode ? 'demo-house-001' : options.id || ''
    })
    await this.loadCurrentHouse()
  },

  onUnload() {
    this._alive = false
    this._loadSeq++
    this._valuationSeq++
  },

  invalidateValuation(message = '') {
    this._valuationSeq = (this._valuationSeq || 0) + 1
    this._pendingValuationId = null
    this._retryRequest = null
    this.setData({
      valuationReport: null, valuationLoading: false, valuationError: '',
      valuationDirty: !!message, canExport: false, evalPer: '', missingTip: message,
      ...FINANCIAL_FIELDS
    })
  },

  async loadCurrentHouse() {
    const seq = ++this._loadSeq
    this.invalidateValuation()
    this._areaEdited = false
    this.setData({ loading: true, loadError: '', item: null, area: '', salePer: '', saleTotal: '' })
    if (!this.data.houseId) {
      this.setData({ loading: false, loadError: '缺少房源编号，请从房源详情页进入。' })
      return
    }
    try {
      const item = await valuationClient.loadHouse(this.data.houseId, { demo: this.data.demoMode, scenario: this.data.demoScenario })
      if (!this._alive || seq !== this._loadSeq) return
      if (!item || !item._id) throw new Error('房源不存在或无权访问')
      this.setData({ item, ...this.parseListing(item), loading: false })
      if (this.data.demoMode && !this.data.isRent) await this.runValuation()
    } catch (error) {
      if (!this._alive || seq !== this._loadSeq) return
      this.setData({ loading: false, item: null, loadError: errorMessage(error) })
    }
  },

  parseListing(item) {
    // A range or type description is not the measured area of a single property.
    const size = parseArea(item.area_sqm === undefined ? item.areaSqm : item.area_sqm)
    if (item.category === '租房') {
      const rent = parseNum(item.rent_month)
      return { isRent: true, area: positive(size) ? String(size) : '', evalPer: '',
        rentPerSqm: positive(size) && positive(rent) ? (rent / size).toFixed(1) : '' }
    }
    const unitRaw = item.listing_unit_price === undefined ? item.unit_price : item.listing_unit_price
    let unit = parseNum(unitRaw)
    if (positive(unit) && /万/.test(String(unitRaw))) unit *= 10000
    const totalRaw = item.total_price_yuan === undefined ? item.total_price : item.total_price_yuan
    let totalWan = parseNum(totalRaw)
    if (positive(totalWan) && (item.total_price_yuan !== undefined || (/元/.test(String(totalRaw)) && !/万/.test(String(totalRaw))))) totalWan /= 10000
    if (!positive(unit) && positive(totalWan) && positive(size)) unit = Math.round(totalWan * 10000 / size)
    if (!positive(totalWan) && positive(unit) && positive(size)) totalWan = unit * size / 10000
    return {
      isRent: false, salePer: positive(unit) ? String(Math.round(unit)) : '',
      saleTotal: positive(totalWan) ? String(Number(totalWan.toFixed(2))) : '',
      area: positive(size) ? String(size) : '', evalPer: ''
    }
  },

  async onDemoScenario(e) {
    if (!this.data.demoMode || this.data.exportingReport) return
    const index = Number(e.detail.value)
    const scenario = valuationClient.SCENARIOS[index]
    if (!scenario) return
    this.setData({ demoScenarioIndex: index, demoScenario: scenario.key })
    await this.loadCurrentHouse()
  },

  async runValuation() {
    if (!this.data.item || this.data.isRent || this.data.exportingReport || this.data.valuationLoading) return
    const editedArea = parseArea(this.data.area)
    if (this._areaEdited && !positive(editedArea)) {
      this.invalidateValuation('请补录有效面积后重新生成估价。')
      return
    }
    const seq = ++this._valuationSeq
    const pendingId = this._pendingValuationId
    const scenario = this.data.demoScenario
    const houseId = this.data.houseId
    const request = this._retryRequest || { targetType: 'house', houseId, purpose: PURPOSE_KEYS[this.data.purposeIndex], requestId: valuationClient.newRequestId() }
    if (this._areaEdited) request.overrides = { areaSqm: editedArea }
    this._retryRequest = request
    this.setData({ valuationLoading: true, valuationError: '', valuationReport: null, canExport: false, evalPer: '', ...FINANCIAL_FIELDS })
    try {
      const options = { demo: this.data.demoMode, scenario }
      const report = pendingId ? await valuationClient.getEvaluation(pendingId, options) : await valuationClient.createEvaluation(request, options)
      if (!this._alive || seq !== this._valuationSeq || houseId !== this.data.houseId || scenario !== this.data.demoScenario) return
      if (!report) throw new Error('估价服务没有返回有效报告。')
      this._retryRequest = null
      if (report.status === 'processing') {
        this._pendingValuationId = report.valuationId
        this.setData({ valuationReport: report, valuationLoading: false, valuationError: '评估仍在处理，点击重试查询同一份报告。', valuationDirty: false })
        return
      }
      this._pendingValuationId = null
      if (!READY_STATUSES.includes(report.status)) throw new Error('估价未完成，请重新生成。')
      if (!report.target || report.target.type !== 'house' || report.target.id !== houseId) throw new Error('返回的估价与当前房源不一致，请重新生成。')
      const effective = report.effectiveUnitPrice
      const reportArea = report.target.areaSqm
      this._areaEdited = false
      this.setData({
        valuationReport: report, valuationLoading: false, valuationError: '', valuationDirty: false, canExport: true,
        evalPer: positive(effective) ? String(effective) : '', area: positive(reportArea) ? String(reportArea) : ''
      })
      this.calc()
    } catch (error) {
      if (!this._alive || seq !== this._valuationSeq) return
      if (!error || !['CLIENT_TIMEOUT', 'CLOUD_REQUEST_FAILED'].includes(error.code)) this._retryRequest = null
      this.setData({ valuationReport: null, valuationLoading: false, valuationError: errorMessage(error), canExport: false, evalPer: '', ...FINANCIAL_FIELDS })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!['salePer', 'area', 'age', 'rate', 'pricePerSqm', 'rentPerSqm'].includes(field) || this.data.exportingReport) return
    this.setData({ [field]: e.detail.value })
    if (field === 'area' && !this.data.isRent) {
      this._areaEdited = true
      this.invalidateValuation('面积已修改，请重新生成估价；原报告已失效。')
    } else if (!this.data.isRent) this.calc()
  },

  onPurpose(e) {
    const index = Number(e.detail.value)
    if (!PURPOSE_KEYS[index] || this.data.exportingReport) return
    this.setData({ purposeIndex: index })
    this.invalidateValuation('购房目的已修改，请重新生成估价。')
  },
  onSuite(e) { if (this.data.exportingReport) return; this.setData({ suiteIndex: Number(e.detail.value) }); this.calc() },
  onFullTwo(e) { if (this.data.exportingReport) return; this.setData({ fullTwoIndex: Number(e.detail.value) }); this.calc() },
  onFullFive(e) { if (this.data.exportingReport) return; this.setData({ fullFiveIndex: Number(e.detail.value) }); this.calc() },

  calcRentRatio() {
    const rent = parseNum(this.data.rentPerSqm), price = parseNum(this.data.pricePerSqm)
    if (!positive(rent) || !positive(price)) {
      this.setData({ rentRatioResult: '', annualReturn: '' })
      wx.showToast({ title: '请填写有效租金和房价', icon: 'none' })
      return
    }
    this.setData({ rentRatioResult: (rent / price * 100).toFixed(2) + '%', annualReturn: (rent / price * 12 * 100).toFixed(2) + '%' })
  },

  calc() {
    if (this.data.exportingReport) return
    const report = this.data.valuationReport
    const evalPer = report && report.effectiveUnitPrice
    const area = report && report.target && report.target.areaSqm
    const salePer = parseNum(this.data.salePer)
    const age = parseNum(this.data.age), rate = parseNum(this.data.rate)
    const missing = []
    if (!report || !READY_STATUSES.includes(report.status)) missing.push('有效估价报告')
    if (!positive(salePer)) missing.push('销售价')
    if (!positive(evalPer)) missing.push('采用评估价')
    if (!positive(area)) missing.push('房源面积')
    if (missing.length) {
      this.setData({ ...FINANCIAL_FIELDS, missingTip: '测算待补充：' + missing.join('、') })
      return
    }
    this.setData({ missingTip: '' })
    // Positive means the asking price is below the adopted appraisal price.
    const gap = (evalPer - salePer) * area * 0.85
    let grade = '无', gradeDesc = '销售价高于采用评估价，无折价空间'
    if (gap >= 500000) { grade = '高'; gradeDesc = '50万以上' }
    else if (gap >= 200000) { grade = '中'; gradeDesc = '20-50万' }
    else if (gap >= 0) { grade = '低'; gradeDesc = '0-20万' }
    const loanAmount = evalPer * area * 0.85
    const maxYears = positive(age) ? Math.max(1, Math.min(30, 70 - age)) : 30
    const r = Number.isFinite(rate) && rate >= 0 ? rate / 100 / 12 : 0.036 / 12
    const n = maxYears * 12
    const monthly = r > 0 ? loanAmount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : loanAmount / n
    const totalRepay = monthly * n
    const totalYuan = salePer * area
    const deed = totalYuan * (this.data.suiteIndex === 0 ? area <= 90 ? 0.01 : 0.015 : 0.03)
    const vat = this.data.fullTwoIndex === 1 ? totalYuan * 0.053 : 0
    const income = this.data.fullFiveIndex === 1 ? 0 : totalYuan * 0.01
    this.setData({
      gap: gap.toFixed(0), grade, gradeDesc, loanAmount: loanAmount.toFixed(0), maxYears,
      monthly: monthly.toFixed(2), totalInterest: (totalRepay - loanAmount).toFixed(0), totalRepay: totalRepay.toFixed(0),
      deedTax: deed.toFixed(0), vatTax: vat.toFixed(0), incomeTax: income.toFixed(0), totalTax: (deed + vat + income).toFixed(0),
      banks: this.data.demoMode ? [] : banks.filter(b => b.type === '国有银行').concat(banks.filter(b => b.type === '股份制银行').slice(0, 3)),
      risks: ['测算基于当前报告的采用评估价和面积，贷款额度及期限须以银行审批为准。', '腾退、占用、租赁和交付条件需结合拍卖公告与现场核实。', '税费沿用示例测算参数，实际应以当地交易时政策和房屋情况核算。']
    })
  },

  async exportPdf() {
    if (!this.data.canExport || this.data.valuationLoading || this.data.valuationDirty || this.data.valuationError || this.data.exportingReport) return
    this.setData({ exportingReport: true })
    try { return await reportExport.exportReport(this) }
    finally { if (this._alive) this.setData({ exportingReport: false }) }
  },

  goGuideDemo() {
    if (!this.data.demoMode || this.data.exportingReport) return
    const app = getApp()
    app.globalData.valuationDemo = true
    wx.switchTab({ url: '/pages/guide/guide' })
  },
  callBank(e) { wx.makePhoneCall({ phoneNumber: e.currentTarget.dataset.phone }) }
})
