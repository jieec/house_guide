App({
  globalData: {
    location: null
  },
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d5goolz85db8bfa79',
        traceUser: true
      })
    }
    const loc = wx.getStorageSync('location')
    if (loc) {
      this.globalData.location = loc
    }
  },
  setLocation(loc) {
    this.globalData.location = loc
    wx.setStorageSync('location', loc)
  },
  setCity(city) {
    if (!this.globalData.location) {
      this.globalData.location = {}
    }
    this.globalData.location.city = city
    wx.setStorageSync('location', this.globalData.location)
  }
})
