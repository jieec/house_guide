const app = getApp()
const regionData = require('../../utils/region.js')
const CITY_LIST = require('../../utils/cities.js')

Page({
  data: {
    provinces: [],
    cities: [],
    districts: [],
    pIndex: 0,
    cIndex: 0,
    dIndex: 0,
    districtInput: '',
    estate: '',
    buildingCount: '',
    community: '',
    locating: false
  },
  async onLoad() {
    const provinces = regionData.map((r) => r.name)
    this.setData({ provinces })
    this.refreshCities(0)
    const loc = app.globalData.location
    if (loc && loc.province) {
      const pIndex = provinces.indexOf(loc.province)
      if (pIndex >= 0) {
        this.setData({
          pIndex,
          estate: loc.estate || '',
          buildingCount: loc.buildingCount || '',
          community: loc.community || ''
        })
        this.refreshCities(pIndex)
        const cities = this.data.cities
        const cIndex = cities.indexOf(loc.city)
        if (cIndex >= 0) {
          this.setData({ cIndex })
          this.refreshDistricts(pIndex, cIndex)
          const dIndex = this.data.districts.indexOf(loc.district)
          if (dIndex >= 0) {
            this.setData({ dIndex })
          } else if (loc.district) {
            this.setData({ districtInput: loc.district })
          }
        }
      }
    }
  },
  refreshCities(pIndex) {
    const cities = regionData[pIndex].cities.map((c) => c.name)
    this.setData({ cities, cIndex: 0, districtInput: '' })
    this.refreshDistricts(pIndex, 0)
  },
  refreshDistricts(pIndex, cIndex) {
    const districts = regionData[pIndex].cities[cIndex].districts
    this.setData({ districts, dIndex: 0, districtInput: '' })
  },
  locateMe() {
    if (this.data.locating) return
    this.setData({ locating: true })
    const self = this
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        self.setData({ locating: false })
        let best = null
        let minD = Infinity
        for (const c of CITY_LIST) {
          const d = (c.lat - res.latitude) * (c.lat - res.latitude) + (c.lng - res.longitude) * (c.lng - res.longitude)
          if (d < minD) {
            minD = d
            best = c
          }
        }
        const distKm = Math.sqrt(minD) * 111
        if (!best || distKm > 300) {
          wx.showToast({ title: '当前位置超出覆盖范围', icon: 'none' })
          return
        }
        const cityName = best.name
        const norm = (s) => String(s || '').replace(/市$/, '')
        let found = false
        for (let p = 0; p < regionData.length; p++) {
          const cities = regionData[p].cities
          for (let c = 0; c < cities.length; c++) {
            if (norm(cities[c].name) === norm(cityName)) {
              self.setData({ pIndex: p })
              self.refreshCities(p)
              self.setData({ cIndex: c })
              self.refreshDistricts(p, c)
              found = true
              break
            }
          }
          if (found) break
        }
        if (found) {
          wx.showToast({ title: '已定位到 ' + cityName, icon: 'success' })
        } else {
          wx.showToast({ title: '定位到 ' + cityName + '，请手动确认', icon: 'none' })
        }
      },
      fail() {
        self.setData({ locating: false })
        wx.showToast({ title: '未授权定位，请手动选择', icon: 'none' })
      }
    })
  },
  onProvinceChange(e) {
    const pIndex = Number(e.detail.value)
    this.setData({ pIndex })
    this.refreshCities(pIndex)
  },
  onCityChange(e) {
    const cIndex = Number(e.detail.value)
    this.setData({ cIndex })
    this.refreshDistricts(this.data.pIndex, cIndex)
  },
  onDistrictChange(e) {
    this.setData({ dIndex: Number(e.detail.value) })
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },
  save() {
    const d = this.data
    const district = d.districts.length ? d.districts[d.dIndex] : d.districtInput
    const loc = {
      province: d.provinces[d.pIndex],
      city: d.cities[d.cIndex],
      district: district || '',
      estate: d.estate,
      buildingCount: d.buildingCount,
      community: d.community
    }
    if (!loc.city) {
      wx.showToast({ title: '请选择城市', icon: 'none' })
      return
    }
    app.setLocation(loc)
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 800)
  }
})
