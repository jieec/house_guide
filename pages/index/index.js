const app = getApp()

Page({
  data: {
    location: null,
    total: 0,
    records: [],
    quickModules: [
      { key: 'basic', name: '基本信息', desc: '房屋概况', iconBg: 'linear-gradient(135deg, #8B5CF6 0%, #7C5CFC 100%)' },
      { key: 'analysis', name: '房源分析', desc: '市场对比', iconBg: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' },
      { key: 'conclusion', name: '评估结论', desc: '价值判断', iconBg: 'linear-gradient(135deg, #7C5CFC 0%, #6D4EED 100%)' },
      { key: 'mortgage', name: '按揭测算', desc: '月供/利率', iconBg: 'linear-gradient(135deg, #8B5CF6 0%, #6D4EED 100%)' }
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
