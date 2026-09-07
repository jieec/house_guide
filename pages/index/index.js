const app = getApp()

Page({
  data: {
    location: null,
    total: 0,
    records: [],
    quickModules: [
      { key: 'basic', name: '基本信息', icon: '🏠', color: '#eef4ff' },
      { key: 'analysis', name: '房源分析', icon: '📊', color: '#fff3ec' },
      { key: 'conclusion', name: '评估结论', icon: '✅', color: '#ecfbf3' },
      { key: 'mortgage', name: '按揭测算', icon: '🧮', color: '#f6f0ff' }
    ]
  },
  onShow() {
    const loc = app.globalData.location
    this.setData({
      location: loc,
      records: (wx.getStorageSync('records') || []).slice(0, 3)
    })
    this.loadStats()
  },
  loadStats() {
    if (!wx.cloud) return
    const db = wx.cloud.database()
    db.collection('houses').count()
      .then(res => this.setData({ total: res.total }))
      .catch(() => {})
  },
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
  }
})
