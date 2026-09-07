const app = getApp()

Page({
  data: {
    location: null,
    records: [],
    user: null
  },
  onShow() {
    this.setData({
      location: app.globalData.location,
      records: wx.getStorageSync('records') || [],
      user: app.globalData.user
    })
  },
  goLocation() {
    wx.navigateTo({ url: '/pages/location/location' })
  },
  removeRecord(e) {
    const id = e.currentTarget.dataset.id
    const records = this.data.records.filter(r => r.id !== id)
    wx.setStorageSync('records', records)
    this.setData({ records })
    wx.showToast({ title: '已删除', icon: 'none' })
  },
  clearAll() {
    wx.showModal({
      title: '清除数据',
      content: '将清除定位、表单和登记记录等本地数据，确定吗？',
      confirmText: '清除',
      confirmColor: '#ff4d3a',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync()
          app.globalData.location = null
          this.setData({ location: null, records: [] })
          wx.showToast({ title: '已清除', icon: 'success' })
        }
      }
    })
  },
  about() {
    wx.showModal({
      title: '关于',
      content: '购房指南 v1.0\n定位选房 · 评估分析 · 房源数据参考',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
