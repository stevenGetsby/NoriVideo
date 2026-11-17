export const BRAND_NAME = '蓝喵剧场'
const env = wx.getAccountInfoSync().miniProgram.envVersion
export const API_BASE = env === 'release' ? 'https://lanmiaoai.com' : 'https://nori.45-76-215-9.sslip.io'
