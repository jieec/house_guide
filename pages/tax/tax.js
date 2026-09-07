
Page({
  data: {
    totalPrice: '',
    area: '',
    suiteType: ['首套', '二套及以上'],
    suiteIndex: 0,
    fullTwoYears: ['不满2年', '满2年'],
    fullTwoIndex: 1,
    fullFiveOnly: ['否', '满五唯一'],
    fullFiveIndex: 1,
    deedTax: '',
    vatTax: '',
    incomeTax: '',
    totalTax: ''
  },
  async onLoad() {
  },
  calc() {
    const price = Number(this.data.totalPrice)
    const area = Number(this.data.area)
    if (!price || !area) {
      wx.showToast({ title: '请填写总价和面积', icon: 'none' })
      return
    }
    let deed = 0
    if (this.data.suiteIndex === 0) {
      deed = area <= 90 ? price * 0.01 : price * 0.015
    } else {
      deed = price * 0.03
    }
    let vat = 0
    if (this.data.fullTwoIndex === 0) {
      vat = price * 0.053
    }
    let income = 0
    if (this.data.fullFiveIndex === 0) {
      income = price * 0.01
    }
    const total = deed + vat + income
    this.setData({
      deedTax: deed.toFixed(0),
      vatTax: vat.toFixed(0),
      incomeTax: income.toFixed(0),
      totalTax: total.toFixed(0)
    })
  },
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },
  onSuite(e) {
    this.setData({ suiteIndex: Number(e.detail.value) })
  },
  onFullTwo(e) {
    this.setData({ fullTwoIndex: Number(e.detail.value) })
  },
  onFullFive(e) {
    this.setData({ fullFiveIndex: Number(e.detail.value) })
  }
})
