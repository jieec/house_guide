
Page({
  data: {
    age: '',
    loanYears: '',
    ageRisk: false,
    risks: [
      { key: 'policy', name: '宏观政策风险', desc: '房地产调控政策变化、信贷政策收紧、限购限售调整', checked: false },
      { key: 'school', name: '学区划分规划改变', desc: '学区政策调整可能导致对口学校变化,影响房价', checked: false },
      { key: 'execution', name: '执行环节风险', desc: '拍卖执行过程中的程序瑕疵、产权纠纷、查封顺位', checked: false },
      { key: 'owner', name: '上一任业主是否配合', desc: '腾房交割时原业主配合度,直接影响入住时间', checked: false },
      { key: 'vacate', name: '法拍房腾房风险', desc: '房屋被占用、租赁未到期等导致的腾退困难', checked: false }
    ]
  },
  onShow() {
    const saved = wx.getStorageSync('risk')
    if (saved) {
      this.setData(saved)
    }
    const basic = wx.getStorageSync('basic') || {}
    if (basic.age && !this.data.age) {
      this.setData({ age: basic.age })
      this.checkAgeRisk()
    }
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
    if (field === 'age' || field === 'loanYears') {
      this.checkAgeRisk()
    }
  },
  checkAgeRisk() {
    const age = Number(this.data.age)
    const years = Number(this.data.loanYears)
    const risk = age > 0 && (age >= 45 || (years > 0 && age + years > 70))
    this.setData({ ageRisk: risk })
  },
  onCheck(e) {
    const key = e.currentTarget.dataset.key
    const risks = this.data.risks.map((r) => {
      if (r.key === key) {
        r.checked = !r.checked
      }
      return r
    })
    this.setData({ risks })
  },
  save() {
    wx.setStorageSync('risk', {
      age: this.data.age,
      loanYears: this.data.loanYears,
      ageRisk: this.data.ageRisk,
      risks: this.data.risks
    })
    wx.showToast({ title: '已保存', icon: 'success' })
  }
})
