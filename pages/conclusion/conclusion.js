const calc = require('../../utils/calc.js')

Page({
  data: {
    purposes: ['自住(首次刚需)', '投资', '极致性价比(金融客)'],
    purposeIndex: 0,
    salePrice: '',
    evalPrice: '',
    area: '',
    gap: '',
    grade: '',
    gradeDesc: '',
    records: []
  },
  onShow() {
    const saved = wx.getStorageSync('conclusion')
    const records = wx.getStorageSync('records') || []
    if (saved) {
      this.setData({
        purposeIndex: saved.purposeIndex || 0,
        salePrice: saved.salePrice || '',
        evalPrice: saved.evalPrice || '',
        area: saved.area || '',
        gap: saved.gap || '',
        grade: saved.grade || '',
        gradeDesc: saved.gradeDesc || ''
      })
    }
    this.setData({ records })
    const basic = wx.getStorageSync('basic') || {}
    if (basic.avgPrice) {
      this.setData({
        salePrice: this.data.salePrice || basic.avgPrice,
        evalPrice: this.data.evalPrice || basic.avgPrice
      })
    }
    if (basic.area && !this.data.area) {
      this.setData({ area: basic.area })
    }
  },
  onPurpose(e) {
    this.setData({ purposeIndex: Number(e.detail.value) })
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },
  calcBest() {
    const sale = Number(this.data.salePrice)
    const evalP = Number(this.data.evalPrice)
    const area = Number(this.data.area)
    if (!sale || !evalP || !area) {
      wx.showToast({ title: '请完整填写销售价/评估价/面积', icon: 'none' })
      return
    }
    const gap = calc.bestValueGap(sale, evalP, area)
    const g = calc.valueGrade(gap)
    this.setData({
      gap: gap.toFixed(0),
      grade: g.grade,
      gradeDesc: g.desc
    })
  },
  removeRecord(e) {
    const id = e.currentTarget.dataset.id
    const records = this.data.records.filter((r) => r.id !== id)
    wx.setStorageSync('records', records)
    this.setData({ records })
  }
})
