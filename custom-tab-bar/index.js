const tabs = [
  { pagePath: 'pages/index/index', text: '首页', icon: '⌂' },
  { pagePath: 'pages/houses/houses', text: '房源', icon: '▤' },
  { pagePath: 'pages/guide/guide', text: '指南', icon: '▥' },
  { pagePath: 'pages/mine/mine', text: '我的', icon: '○' }
]

Component({
  data: { selected: -1, tabs },
  lifetimes: { attached() { this.syncSelected() } },
  pageLifetimes: { show() { this.syncSelected() } },
  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current && String(current.route || '').replace(/^\//, '')
      const index = tabs.findIndex(tab => tab.pagePath === route)
      if (index >= 0) this.setData({ selected: index })
    },
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const target = tabs[index]
      if (!target) return
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current && String(current.route || '').replace(/^\//, '')
      if (route === target.pagePath) {
        this.setData({ selected: index })
        return
      }
      wx.switchTab({
        url: '/' + target.pagePath,
        fail: () => this.syncSelected()
      })
    }
  }
})
