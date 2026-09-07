const calc = require('../../utils/calc.js')

Page({
  data: {
    loanAmount: '',
    rateTypes: ['LPR利率', '基础利率'],
    rateTypeIndex: 0,
    rate: '3.6',
    years: ['5年', '10年', '15年', '20年', '25年', '30年'],
    yearsIndex: 5,
    payMethods: ['等额本息', '等额本金'],
    payMethodIndex: 0,
    monthly: '',
    firstMonth: '',
    totalRepay: '',
    totalInterest: ''
  },
  onShow() {
    const saved = wx.getStorageSync('mortgage')
    if (saved) {
      this.setData(saved)
    }
  },
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },
  onRateType(e) {
    this.setData({ rateTypeIndex: Number(e.detail.value) })
  },
  onYears(e) {
    this.setData({ yearsIndex: Number(e.detail.value) })
  },
  onPayMethod(e) {
    this.setData({ payMethodIndex: Number(e.detail.value) })
  },
  calc() {
    const amount = Number(this.data.loanAmount)
    const rate = Number(this.data.rate)
    const years = Number(this.data.years[this.data.yearsIndex].replace('年', ''))
    if (!amount || !rate) {
      wx.showToast({ title: '请填写贷款金额和利率', icon: 'none' })
      return
    }
    let monthly = ''
    let firstMonth = ''
    let totalRepay = ''
    let totalInterest = ''
    if (this.data.payMethodIndex === 0) {
      const m = calc.monthlyPaymentEqualPrincipal(amount, rate, years)
      monthly = m.toFixed(2)
      totalRepay = (m * years * 12).toFixed(0)
      totalInterest = calc.totalInterestEqualPrincipal(amount, rate, years).toFixed(0)
    } else {
      const first = calc.firstPaymentEqualInstallment(amount, rate, years)
      firstMonth = first.toFixed(2)
      totalInterest = calc.totalInterestEqualInstallment(amount, rate, years).toFixed(0)
      totalRepay = (amount + Number(totalInterest)).toFixed(0)
    }
    this.setData({ monthly, firstMonth, totalRepay, totalInterest })
  },
  save() {
    const d = this.data
    wx.setStorageSync('mortgage', {
      loanAmount: d.loanAmount,
      rateTypeIndex: d.rateTypeIndex,
      rate: d.rate,
      yearsIndex: d.yearsIndex,
      payMethodIndex: d.payMethodIndex,
      monthly: d.monthly,
      firstMonth: d.firstMonth,
      totalRepay: d.totalRepay,
      totalInterest: d.totalInterest
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
