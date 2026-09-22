const calc = require('../../utils/calc.js')
const reportExport = require('../../utils/report-export.js')
const app = getApp()
const cf = require('../../utils/commfetch.js')

Page({
  data: {
    evalSources: ['世联评估', '贝壳评估系统爬取', '手动输入'],
    evalSourceIndex: 0,
    salePrice: '',
    evalPrice: '',
    auctionPrice: '',
    returnRate: '',
    age: '',
    listingPrice: '',
    recentDealPrice: '',
    discountRate: '10',
    suggestPrice: '',
    bizTypes: ['住宅', '公寓', '商铺', '写字楼'],
    bizIndex: 0,
    rentPerSqm: '',
    pricePerSqm: '',
    rentRatioResult: '',
    annualReturnResult: '',
    dealVolume: '',
    trendNote: '',
    basePolicy: '',
    localPolicy: '',
    autoFilled: false
  },
  onShow() {
    const saved = wx.getStorageSync('analysis')
    if (saved) {
      this.setData(saved)
    }
    this.autoFill()
  },
  autoFill() {
    const basic = wx.getStorageSync('basic') || {}
    const d = {}
    if (basic.avgPrice) {
      d.salePrice = basic.avgPrice
      d.evalPrice = d.evalPrice || basic.avgPrice
      d.listingPrice = basic.avgPrice
      d.pricePerSqm = basic.avgPrice
    }
    if (basic.recentDealPrice) d.recentDealPrice = basic.recentDealPrice
    if (basic.age) d.age = basic.age
    if (basic.recentDealVolume) d.dealVolume = basic.recentDealVolume
    const any = Object.keys(d).length > 0
    this.setData({ ...d, autoFilled: any })
    const loc = app.globalData.location
    if (loc && loc.city && (loc.community || loc.estate)) {
      cf.getRentAvg(loc.city, loc.community || loc.estate).then(rent => {
        if (rent) this.setData({ rentPerSqm: rent })
      })
    }
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },
  onEvalSource(e) {
    this.setData({ evalSourceIndex: Number(e.detail.value) })
  },
  onBizChange(e) {
    this.setData({ bizIndex: Number(e.detail.value) })
  },
  calcSuggest() {
    const recent = Number(this.data.recentDealPrice)
    const discount = Number(this.data.discountRate || 0)
    if (!recent) {
      wx.showToast({ title: '请先填近期成交价', icon: 'none' })
      return
    }
    const suggest = calc.suggestDealPrice(recent, discount)
    this.setData({ suggestPrice: suggest.toFixed(0) })
  },
  calcRentRatio() {
    const rent = Number(this.data.rentPerSqm)
    const price = Number(this.data.pricePerSqm)
    if (!rent || !price) {
      wx.showToast({ title: '请填写租金和房价', icon: 'none' })
      return
    }
    const ratio = calc.rentRatio(rent, price)
    const annual = calc.annualReturn(ratio)
    this.setData({
      rentRatioResult: (ratio * 100).toFixed(2) + '%',
      annualReturnResult: (annual * 100).toFixed(2) + '%'
    })
  },
  exportPdf() {
    reportExport.exportReport(this)
  },
  save() {
    const d = this.data
    wx.setStorageSync('analysis', {
      evalSourceIndex: d.evalSourceIndex,
      salePrice: d.salePrice,
      evalPrice: d.evalPrice,
      auctionPrice: d.auctionPrice,
      returnRate: d.returnRate,
      age: d.age,
      listingPrice: d.listingPrice,
      recentDealPrice: d.recentDealPrice,
      discountRate: d.discountRate,
      suggestPrice: d.suggestPrice,
      bizIndex: d.bizIndex,
      rentPerSqm: d.rentPerSqm,
      pricePerSqm: d.pricePerSqm,
      rentRatioResult: d.rentRatioResult,
      annualReturnResult: d.annualReturnResult,
      dealVolume: d.dealVolume,
      trendNote: d.trendNote,
      basePolicy: d.basePolicy,
      localPolicy: d.localPolicy
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
