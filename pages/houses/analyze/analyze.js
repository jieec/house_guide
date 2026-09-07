const banks = require('../../../utils/banks.js')

function parseNum(s) {
  if (s === null || s === undefined || s === '') return NaN
  const m = String(s).match(/-?[\d.]+/)
  return m ? Number(m[0]) : NaN
}

Page({
  data: {
    item: null,
    loading: true,
    isRent: false,
    rentPerSqm: '',
    pricePerSqm: '',
    rentRatioResult: '',

    area: '',
    salePer: '',
    saleTotal: '',
    missingTip: '',

    purposes: ['自住(首次刚需)', '投资', '极致性价比(金融客)'],
    purposeIndex: 2,
    suiteType: ['首套', '二套及以上'],
    suiteIndex: 0,
    fullTwo: ['满2年', '不满2年'],
    fullTwoIndex: 0,
    fullFive: ['否', '满五唯一'],
    fullFiveIndex: 0,
    evalPer: '',
    age: '35',
    rate: '3.6',

    gap: '',
    grade: '',
    gradeDesc: '',
    loanAmount: '',
    maxYears: 30,
    monthly: '',
    totalInterest: '',
    totalRepay: '',
    deedTax: '',
    vatTax: '',
    incomeTax: '',
    totalTax: '',
    banks: [],
    risks: []
  },

  async onLoad(options) {
    if (!options.id || !wx.cloud) {
      this.setData({ loading: false })
      return
    }
    const db = wx.cloud.database()
    db.collection('houses').doc(options.id).get()
      .then(res => {
        const item = res.data || {}
        const p = this.parseListing(item)
        this.setData(Object.assign({ item, loading: false }, p))
        this.calc()
      })
      .catch(() => {
        this.setData({ loading: false })
        wx.showToast({ title: '房源不存在', icon: 'none' })
      })
  },

  parseListing(item) {
    if (item.category === '租房') {
      const area = parseNum(item.area_sqm)
      const rent = parseNum(item.rent_month)
      return {
        isRent: true,
        area: isNaN(area) ? '' : String(area),
        rentPerSqm: !isNaN(area) && !isNaN(rent) && area > 0 ? (rent / area).toFixed(1) : ''
      }
    }
    const salePer = parseNum(item.unit_price)
    const saleTotal = parseNum(item.total_price)
    let area = parseNum(item.area_sqm)
    if (isNaN(area) && item.house_types) {
      const m = String(item.house_types).match(/(\d+)\s*~\s*(\d+)\s*平米/)
      if (m) {
        area = Math.round((Number(m[1]) + Number(m[2])) / 2)
      } else {
        const m2 = String(item.house_types).match(/(\d+)\s*平米/)
        if (m2) area = Number(m2[1])
      }
    }
    let salePerFinal = isNaN(salePer) ? NaN : salePer
    if (isNaN(salePerFinal) && !isNaN(saleTotal) && !isNaN(area) && area > 0) {
      salePerFinal = Math.round(saleTotal * 10000 / area)
    }
    let saleTotalFinal = isNaN(saleTotal) ? NaN : saleTotal
    if (isNaN(saleTotalFinal) && !isNaN(salePerFinal) && !isNaN(area) && area > 0) {
      saleTotalFinal = Math.round(salePerFinal * area / 10000)
    }
    return {
      isRent: false,
      salePer: isNaN(salePerFinal) ? '' : String(Math.round(salePerFinal)),
      saleTotal: isNaN(saleTotalFinal) ? '' : String(saleTotalFinal),
      area: isNaN(area) ? '' : String(area),
      evalPer: isNaN(salePerFinal) ? '' : String(Math.round(salePerFinal))
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onPurpose(e) {
    this.setData({ purposeIndex: Number(e.detail.value) })
  },
  onSuite(e) {
    this.setData({ suiteIndex: Number(e.detail.value) })
  },
  onFullTwo(e) {
    this.setData({ fullTwoIndex: Number(e.detail.value) })
  },
  onFullFive(e) {
    this.setData({ fullFiveIndex: Number(e.detail.value) })
  },

  calcRentRatio() {
    const rent = parseNum(this.data.rentPerSqm)
    const price = parseNum(this.data.pricePerSqm)
    if (isNaN(rent) || isNaN(price) || price <= 0) {
      wx.showToast({ title: '请填写租金和房价', icon: 'none' })
      return
    }
    const ratio = rent / price
    this.setData({
      rentRatioResult: (ratio * 100).toFixed(2) + '%',
      annualReturn: (ratio * 12 * 100).toFixed(2) + '%'
    })
  },

  calc() {
    const salePer = parseNum(this.data.salePer)
    const evalPer = parseNum(this.data.evalPer)
    const area = parseNum(this.data.area)
    const saleTotal = parseNum(this.data.saleTotal)
    const age = parseNum(this.data.age)
    const rate = parseNum(this.data.rate)
    const missing = []
    if (isNaN(salePer)) missing.push('销售价')
    if (isNaN(evalPer)) missing.push('评估价')
    if (isNaN(area) || area <= 0) missing.push('面积')
    if (missing.length) {
      this.setData({ missingTip: '缺少信息：' + missing.join('、') + '，请在上方填写后点「重新分析」' })
      wx.showToast({ title: '请补充：' + missing.join('、'), icon: 'none' })
      return
    }
    this.setData({ missingTip: '' })

    const gap = (salePer - evalPer) * area * 0.85
    let grade = ''
    let gradeDesc = ''
    if (gap >= 500000) { grade = '高'; gradeDesc = '50万以上' }
    else if (gap >= 200000) { grade = '中'; gradeDesc = '20-50万' }
    else if (gap >= 0) { grade = '低'; gradeDesc = '0-20万' }
    else { grade = '无'; gradeDesc = '无折价空间（销售价高于评估价）' }

    const loanAmount = evalPer * area * 0.85
    let maxYears = 30
    if (!isNaN(age) && age > 0) {
      maxYears = 70 - age
      if (maxYears > 30) maxYears = 30
      if (maxYears < 1) maxYears = 1
    }

    const r = isNaN(rate) ? 0.036 / 12 : rate / 100 / 12
    const n = maxYears * 12
    const monthly = r > 0 ? loanAmount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : loanAmount / n
    const totalRepay = monthly * n
    const totalInterest = totalRepay - loanAmount

    const totalYuan = isNaN(saleTotal) ? salePer * area : saleTotal * 10000
    let deed = 0
    if (this.data.suiteIndex === 0) {
      deed = totalYuan * (area <= 90 ? 0.01 : 0.015)
    } else {
      deed = totalYuan * 0.03
    }
    let vat = this.data.fullTwoIndex === 1 ? totalYuan * 0.053 : 0
    let income = this.data.fullFiveIndex === 1 ? 0 : totalYuan * 0.01
    const totalTax = deed + vat + income

    const risks = []
    risks.push('腾房风险：法拍房原业主是否配合腾房、房屋是否被占用需提前核实')
    risks.push('政策风险：限购/限售/信贷政策调整可能影响交易与贷款')
    risks.push('学区风险：学区划分可能调整，入学政策以当年官方发布为准')
    if (!isNaN(age) && age > 0 && age + maxYears > 70) {
      risks.push('房龄融资风险：年龄+贷款年限已接近上限，融资可能受限')
    }
    risks.push('房龄未收录：建议线下核实楼龄，房龄+贷款年限>70可能无法按揭')

    this.setData({
      gap: gap.toFixed(0),
      grade,
      gradeDesc,
      loanAmount: loanAmount.toFixed(0),
      maxYears,
      monthly: monthly.toFixed(2),
      totalInterest: totalInterest.toFixed(0),
      totalRepay: totalRepay.toFixed(0),
      deedTax: deed.toFixed(0),
      vatTax: vat.toFixed(0),
      incomeTax: income.toFixed(0),
      totalTax: totalTax.toFixed(0),
      banks: banks.filter(b => b.type === '国有银行').concat(banks.filter(b => b.type === '股份制银行').slice(0, 3)),
      risks
    })
  },

  callBank(e) {
    wx.makePhoneCall({ phoneNumber: e.currentTarget.dataset.phone })
  }
})
