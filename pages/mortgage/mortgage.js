const calc = require('../../utils/calc.js')

Page({
  data: {
    showContent: false,
    loanAmount: '',
    rateTypes: ['LPR利率', '基础利率'],
    rateTypeIndex: 0,
    rate: '3.6',
    years: ['5年', '10年', '15年', '20年', '25年', '30年'],
    yearsIndex: 5,
    payMethods: ['等额本息', '等额本金'],
    payMethodIndex: 0,
    
    // 等额本息结果
    monthlyEqualPrincipal: '',
    totalRepayEqualPrincipal: '',
    totalInterestEqualPrincipal: '',
    
    // 等额本金结果
    firstMonthEqualInstallment: '',
    lastMonthEqualInstallment: '',
    totalRepayEqualInstallment: '',
    totalInterestEqualInstallment: '',
    
    // 组合贷款结果
    monthlyCombined: '',
    totalRepayCombined: '',
    totalInterestCombined: '',
    commercialAmount: '',
    fundAmount: ''
  },
  onShow() {
    const saved = wx.getStorageSync('mortgage')
    
    // 触发入场动画
    this.setData({ 
      showContent: false,
      ...(saved || {})
    })
    setTimeout(() => {
      this.setData({ showContent: true })
    }, 100)
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
    
    // 等额本息
    const monthlyEqualPrincipal = calc.monthlyPaymentEqualPrincipal(amount, rate, years)
    const totalRepayEqualPrincipal = (monthlyEqualPrincipal * years * 12).toFixed(0)
    const totalInterestEqualPrincipal = calc.totalInterestEqualPrincipal(amount, rate, years).toFixed(0)
    
    // 等额本金
    const firstMonthEqualInstallment = calc.firstPaymentEqualInstallment(amount, rate, years)
    const totalInterestEqualInstallment = calc.totalInterestEqualInstallment(amount, rate, years).toFixed(0)
    const totalRepayEqualInstallment = (amount + Number(totalInterestEqualInstallment)).toFixed(0)
    const lastMonthEqualInstallment = calc.lastPaymentEqualInstallment(amount, rate, years)
    
    // 组合贷款 (假设商贷70%、公积金30%)
    const commercialAmount = amount * 0.7
    const fundAmount = amount * 0.3
    const commercialRate = rate
    const fundRate = rate * 0.7 // 公积金利率通常更低
    
    const monthlyCommercial = calc.monthlyPaymentEqualPrincipal(commercialAmount, commercialRate, years)
    const monthlyFund = calc.monthlyPaymentEqualPrincipal(fundAmount, fundRate, years)
    const monthlyCombined = monthlyCommercial + monthlyFund
    const totalRepayCombined = (monthlyCombined * years * 12).toFixed(0)
    const totalInterestCombined = (
      calc.totalInterestEqualPrincipal(commercialAmount, commercialRate, years) +
      calc.totalInterestEqualPrincipal(fundAmount, fundRate, years)
    ).toFixed(0)
    
    this.setData({
      // 等额本息
      monthlyEqualPrincipal: monthlyEqualPrincipal.toFixed(2),
      totalRepayEqualPrincipal,
      totalInterestEqualPrincipal,
      
      // 等额本金
      firstMonthEqualInstallment: firstMonthEqualInstallment.toFixed(2),
      lastMonthEqualInstallment: lastMonthEqualInstallment.toFixed(2),
      totalRepayEqualInstallment,
      totalInterestEqualInstallment,
      
      // 组合贷款
      monthlyCombined: monthlyCombined.toFixed(2),
      totalRepayCombined,
      totalInterestCombined,
      commercialAmount: commercialAmount.toFixed(0),
      fundAmount: fundAmount.toFixed(0)
    })
  },
  save() {
    const d = this.data
    wx.setStorageSync('mortgage', {
      loanAmount: d.loanAmount,
      rateTypeIndex: d.rateTypeIndex,
      rate: d.rate,
      yearsIndex: d.yearsIndex,
      payMethodIndex: d.payMethodIndex,
      monthlyEqualPrincipal: d.monthlyEqualPrincipal,
      totalRepayEqualPrincipal: d.totalRepayEqualPrincipal,
      totalInterestEqualPrincipal: d.totalInterestEqualPrincipal,
      firstMonthEqualInstallment: d.firstMonthEqualInstallment,
      lastMonthEqualInstallment: d.lastMonthEqualInstallment,
      totalRepayEqualInstallment: d.totalRepayEqualInstallment,
      totalInterestEqualInstallment: d.totalInterestEqualInstallment,
      monthlyCombined: d.monthlyCombined,
      totalRepayCombined: d.totalRepayCombined,
      totalInterestCombined: d.totalInterestCombined,
      commercialAmount: d.commercialAmount,
      fundAmount: d.fundAmount
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
