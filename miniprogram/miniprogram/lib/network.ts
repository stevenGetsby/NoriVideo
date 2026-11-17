import { getSettings, type Quality } from './settings'

export function pickQuality(setting: Quality, networkType: string): 480 | 720 {
  if (setting === '480') return 480
  if (setting === '720') return 720
  return networkType === 'wifi' || networkType === '5g' || networkType === '4g' ? 720 : 480
}

export function resolveQuality(): Promise<480 | 720> {
  const { quality } = getSettings()
  if (quality !== 'auto') return Promise.resolve(pickQuality(quality, ''))
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(pickQuality('auto', res.networkType)),
      fail: () => resolve(480),
    })
  })
}

export function isWifi(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(res.networkType === 'wifi'),
      fail: () => resolve(false),
    })
  })
}
