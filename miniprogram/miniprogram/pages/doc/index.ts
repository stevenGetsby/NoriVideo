import { BRAND_NAME } from '../../config'

type DocKind = 'terms' | 'privacy' | 'about'

const TITLES: Record<DocKind, string> = {
  terms: '用户协议',
  privacy: '隐私政策',
  about: `关于${BRAND_NAME}`,
}

const CONTENT: Record<DocKind, string[]> = {
  terms: [
    `欢迎使用${BRAND_NAME}。本应用提供互动影游作品的浏览与游玩服务。`,
    '你在使用时应遵守法律法规，不得利用本应用制作、复制、发布、传播违法违规内容。',
    '作品均由创作者使用 AI 工具生成，页面会标注「AI 生成内容」。请理性看待作品情节，勿模仿危险行为。',
    '我们有权对违规内容进行处理。本协议未尽事宜，以相关法律法规为准。',
  ],
  privacy: [
    '我们仅收集实现功能所必需的信息：',
    '用户昵称：用于在你设置昵称时展示个人形象。',
    '相册（仅写入）：用于在你主动保存结局海报时写入图片，不会读取你的相册。',
    '登录态：用于保存你的游玩进度、收藏与评分。',
    `我们不会向第三方出售你的个人信息。详情见《${BRAND_NAME}隐私保护指引》。`,
  ],
  about: [
    `${BRAND_NAME}是一个互动影游内容平台。`,
    '在这里，你可以浏览、游玩由创作者生成的互动作品，解锁不同结局，收集成就。',
    '所有作品均标注「AI 生成内容」。',
    '版本 V1.0。',
  ],
}

Page({
  data: {
    kind: 'about' as DocKind,
    title: TITLES.about,
    paragraphs: CONTENT.about,
  },

  onLoad(options: Record<string, string | undefined>) {
    const k: DocKind = options.k === 'terms' || options.k === 'privacy' || options.k === 'about' ? options.k : 'about'
    this.setData({ kind: k, title: TITLES[k], paragraphs: CONTENT[k] })
    wx.setNavigationBarTitle({ title: TITLES[k] })
  },
})
