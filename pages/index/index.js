const app = getApp()

Page({
  data: {
    location: null,
    total: 0,
    records: [],
    quickModules: [
      { key: 'basic', name: '基本信息', icon: '⌂', desc: '房屋概况' },
      { key: 'analysis', name: '房源分析', icon: '◒', desc: '市场对比' },
      { key: 'conclusion', name: '评估结论', icon: '✓', desc: '价值判断' },
      { key: 'mortgage', name: '按揭测算', icon: '＋', desc: '月供/利率' }
    ],
    showContent: false
  },
  onShow() {
    const loc = app.globalData.location
    this.setData({
      location: loc,
      records: (wx.getStorageSync('records') || []).slice(0, 3),
      showContent: false
    })
    this.loadStats()
    
    // 触发入场动画
    setTimeout(() => {
      this.setData({ showContent: true })
    }, 50)
  },
  loadStats() {
    if (!wx.cloud) return
    const db = wx.cloud.database()
    db.collection('houses').count()
      .then(res => this.setData({ total: res.total }))
      .catch(() => {})
  },
  goHome() {},
  goLocation() {
    wx.navigateTo({ url: '/pages/location/location' })
  },
  goHouses() {
    wx.switchTab({ url: '/pages/houses/houses' })
  },
  goModule(e) {
    const key = e.currentTarget.dataset.key
    wx.navigateTo({ url: '/pages/' + key + '/' + key })
  },
  goGuide() {
    wx.switchTab({ url: '/pages/guide/guide' })
  },
  goMine() {
    wx.switchTab({ url: '/pages/mine/mine' })
  }
})
