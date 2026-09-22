const allBanks = require('../../utils/banks.js')
const reportExport = require('../../utils/report-export.js')

Page({
  data: {
    evalPrice: '',
    loanAmount: '',
    rate: '3.6',
    age: '',
    maxYears: 30,
    bankTypes: ['全部', '国有银行', '股份制银行'],
    bankTypeIndex: 0,
    banks: allBanks
  },
  onShow() {
    const saved = wx.getStorageSync('finance')
    if (saved) {
      this.setData(saved)
    }
    const basic = wx.getStorageSync('basic') || {}
    if (basic.avgPrice) {
      const evalP = Number(basic.avgPrice)
      const area = Number(basic.area)
      const loan = area && evalP ? Math.round(evalP * area * 0.85) : ''
      this.setData({ evalPrice: this.data.evalPrice || basic.avgPrice })
      if (loan) this.setData({ loanAmount: String(loan) })
    }
    this.filterBanks()
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
    if (field === 'evalPrice') {
      const v = Number(e.detail.value)
      this.setData({ loanAmount: v ? (v * 0.85).toFixed(0) : '' })
    }
    if (field === 'age') {
      const age = Number(e.detail.value)
      let years = age ? 70 - age : 30
      if (years > 30) years = 30
      if (years < 1) years = 1
      this.setData({ maxYears: years })
    }
  },
  onBankType(e) {
    this.setData({ bankTypeIndex: Number(e.detail.value) })
    this.filterBanks()
  },
  filterBanks() {
    const type = this.data.bankTypes[this.data.bankTypeIndex]
    const banks = type === '全部' ? allBanks : allBanks.filter((b) => b.type === type)
    this.setData({ banks })
  },
  callBank(e) {
    const phone = e.currentTarget.dataset.phone
    wx.makePhoneCall({ phoneNumber: phone })
  },
  exportPdf() {
    reportExport.exportReport(this)
  },
  save() {
    const d = this.data
    wx.setStorageSync('finance', {
      evalPrice: d.evalPrice,
      loanAmount: d.loanAmount,
      rate: d.rate,
      age: d.age,
      maxYears: d.maxYears,
      bankTypeIndex: d.bankTypeIndex
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
