export const BRAND_NAME = '蓝喵剧场'
const env = wx.getAccountInfoSync().miniProgram.envVersion
export const API_BASE = env === 'release' ? 'https://lanmiaoai.com' : 'https://nori.45-76-215-9.sslip.io'
// 订阅消息模板 id：用户在公众平台后台选定模板后填入（非秘钥）。
export const TPL_WORK_LIVE = ''
export const TPL_CHAPTER_UPDATE = ''
