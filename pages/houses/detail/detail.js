
Page({
  data: {
    item: null,
    tagsList: [],
    locationDetails: []
  },
  async onLoad(options) {
    if (!options.id) return
    if (!wx.cloud) return
    const db = wx.cloud.database()
    db.collection('houses').doc(options.id).get()
      .then(res => {
        const item = res.data || {}
        this.setData({
          item,
          tagsList: item.tags ? item.tags.split(' / ').filter(t => t) : [],
          locationDetails: this.buildLocationDetails(item)
        })
      })
      .catch(() => {
        wx.showToast({ title: '房源不存在', icon: 'none' })
      })
  },
  buildLocationDetails(item) {
    const tags = (item.tags || '').split(' / ').filter(t => t.trim())
    const cats = [
      { title: '交通出行', icon: '🚇', re: /号线|地铁|轻轨|公交|站约|交通/ },
      { title: '教育资源', icon: '🏫', re: /学校|学区|学位|幼儿园|小学|中学|大学/ },
      { title: '医疗配套', icon: '🏥', re: /医院|三甲/ },
      { title: '商业购物', icon: '🛍️', re: /商场|购物|商圈|超市|商业|广场/ },
      { title: '景观环境', icon: '🌳', re: /江景|海景|湖景|公园|绿化/ },
      { title: '居住品质', icon: '🏠', re: /电梯|车位|人车分流|装修|满五|全装|首付|总价/ }
    ]
    const details = []
    const used = new Set()
    if (item.metro) {
      const extra = tags.filter(t => /公交|交通|轻轨/.test(t) && !/^距.+米/.test(t))
      details.push({ icon: '🚇', title: '交通出行', text: [item.metro].concat(extra).join('、') })
    }
    for (const c of cats) {
      const hits = []
      for (const t of tags) {
        if (used.has(t)) continue
        if (item.metro && (t === item.metro || /^距.+米$/.test(t))) {
          used.add(t)
          continue
        }
        if (c.re.test(t)) {
          hits.push(t)
          used.add(t)
        }
      }
      if (c.title === '交通出行' && item.metro) continue
      if (hits.length) {
        details.push({ icon: c.icon, title: c.title, text: hits.join('、') })
      }
    }
    const rest = tags.filter(t => !used.has(t))
    if (rest.length) {
      details.push({ icon: '📌', title: '其他信息', text: rest.join('、') })
    }
    return details
  },
  copyUrl() {
    if (!this.data.item || !this.data.item.url) return
    wx.setClipboardData({
      data: this.data.item.url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    })
  },
  goAnalyze() {
    if (!this.data.item) return
    wx.navigateTo({ url: '/pages/houses/analyze/analyze?id=' + this.data.item._id })
  },
  callPhone() {
    const tel = this.data.item && this.data.item.tel
    if (!tel) return
    wx.makePhoneCall({ phoneNumber: tel })
  }
})
