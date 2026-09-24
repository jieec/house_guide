Component({
  properties: { title: { type: String, value: '' } },
  data: { toolbarHeight: 64 },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const statusHeight = info.statusBarHeight || 20
      this.setData({ toolbarHeight: statusHeight + 48 })
    }
  }
})
