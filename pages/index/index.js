const app = getApp()

// 1286 -> 1,286
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

Page({
  data: {
    location: null,
    hasLoc: false,
    locTitle: '',
    locDesc: '',
    total: 0,
    statText: '实时数据',
    quickModules: [
      { key: 'basic', name: '基本信息', desc: '房屋概况', iconBg: 'linear-gradient(135deg, #695C93 0%, #372C57 100%)' },
      { key: 'analysis', name: '房源分析', desc: '市场对比', iconBg: 'linear-gradient(135deg, #5F7EB8 0%, #4A5F96 100%)' },
      { key: 'conclusion', name: '评估结论', desc: '价值判断', iconBg: 'linear-gradient(135deg, #96688A 0%, #7A4E6C 100%)' },
      { key: 'mortgage', name: '按揭测算', desc: '月供/利率', iconBg: 'linear-gradient(135deg, #C0A055 0%, #A8743F 100%)' }
    ]
  },

  onShow() {
    const loc = app.globalData.location
    const hasLoc = !!(loc && (loc.city || loc.province))

    this.setData({
      location: loc,
      hasLoc,
      locTitle: hasLoc ? [loc.province, loc.city, loc.district].filter(Boolean).join(' ') : '',
      locDesc: hasLoc ? [loc.estate || '未填写楼盘', loc.community].filter(Boolean).join(' · ') : ''
    })

    this.loadStats()
  },

  loadStats() {
    if (!wx.cloud) return
    const db = wx.cloud.database()
    db.collection('houses').count()
      .then((res) => {
        const total = res.total || 0
        this.setData({
          total,
          statText: total > 0 ? '已收录 ' + thousands(total) + ' 套' : '实时数据'
        })
      })
      .catch(() => {})
  },

  goLocation() {
    wx.navigateTo({ url: '/pages/location/location' })
  },

  goModule(e) {
    const key = e.currentTarget.dataset.key
    wx.navigateTo({ url: '/pages/' + key + '/' + key })
  },

  goGuide() {
    wx.switchTab({ url: '/pages/guide/guide' })
  }
})
