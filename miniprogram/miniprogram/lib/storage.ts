export interface KvStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const wxStorage: KvStorage = {
  getItem(key) {
    const value = wx.getStorageSync(key)
    if (value === '' || value == null) return null
    return typeof value === 'string' ? value : String(value)
  },
  setItem(key, value) {
    wx.setStorageSync(key, value)
  },
  removeItem(key) {
    wx.removeStorageSync(key)
  },
}

export const storageKey = (slug: string) => `mp:${slug}`
