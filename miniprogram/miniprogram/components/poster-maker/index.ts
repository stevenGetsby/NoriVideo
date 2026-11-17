import { BRAND_NAME } from '../../config'
import { request } from '../../lib/api'
import { ensureLogin } from '../../lib/auth'
import {
  ENDING_TYPE_COLOR, ENDING_TYPE_LABEL, POSTER_CARD, POSTER_GRADIENT_START, POSTER_H, POSTER_QR, POSTER_W,
  coverCrop, endingMiddle, fitText, workMiddle, wrapText,
} from '../../lib/poster-layout'
import { generateShareId, registerShare } from '../../lib/share'
import { track } from '../../lib/track'

export interface PosterPayload {
  kind: 'work' | 'ending'
  slug: string
  workTitle: string
  tagline: string
  tags: string[]
  background: string
  endingTitle?: string
  endingType?: string
  endingNodeId?: string
  rarityText?: string
}

type CanvasImage = ReturnType<WechatMiniprogram.Canvas['createImage']>
type Ctx = WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D

function downloadTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => (res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('download failed'))),
      fail: () => reject(new Error('download failed')),
    })
  })
}

function loadImage(canvas: WechatMiniprogram.Canvas, src: string): Promise<CanvasImage> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

Component({
  data: {
    busy: false,
  },
  methods: {
    async make(payload: PosterPayload) {
      if (this.data.busy) return
      this.setData({ busy: true })
      wx.showLoading({ title: '海报生成中', mask: true })
      try {
        await ensureLogin()
        const shareId = generateShareId()
        registerShare(shareId, payload.slug, 'poster', payload.endingNodeId)
        const { url } = await request<{ url: string }>('POST', '/api/mp/wxacode', { shareId }, { auth: 'required' })
        const [bgPath, codePath] = await Promise.all([downloadTemp(payload.background), downloadTemp(url)])
        const canvas = await this.canvasNode()
        const dpr = Math.min(wx.getWindowInfo().pixelRatio || 1, 1.5)
        canvas.width = POSTER_W * dpr
        canvas.height = POSTER_H * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        const [bg, code, logo] = await Promise.all([
          loadImage(canvas, bgPath),
          loadImage(canvas, codePath),
          loadImage(canvas, '/assets/logo.png'),
        ])
        this.draw(ctx, payload, bg, code, logo)
        const { tempFilePath } = await new Promise<{ tempFilePath: string }>((resolve, reject) => {
          wx.canvasToTempFilePath({ canvas, success: resolve, fail: () => reject(new Error('export failed')) })
        })
        track('poster_create', { w: payload.slug, o: payload.kind })
        wx.showShareImageMenu({
          path: tempFilePath,
          fail: (err) => {
            if (!/cancel/i.test(err.errMsg || '')) wx.showToast({ title: '海报生成失败，请重试', icon: 'none' })
          },
        })
      } catch {
        wx.showToast({ title: '海报生成失败，请重试', icon: 'none' })
      } finally {
        wx.hideLoading()
        this.setData({ busy: false })
      }
    },

    canvasNode(): Promise<WechatMiniprogram.Canvas> {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery().select('#poster-canvas').fields({ node: true, size: true }, (res) => {
          const node = (res as { node?: WechatMiniprogram.Canvas } | null)?.node
          if (node) resolve(node)
          else reject(new Error('canvas missing'))
        }).exec()
      })
    },

    draw(ctx: Ctx, payload: PosterPayload, bg: CanvasImage, code: CanvasImage, logo: CanvasImage) {
      ctx.clearRect(0, 0, POSTER_W, POSTER_H)
      const crop = coverCrop(bg.width, bg.height)
      ctx.drawImage(bg, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, POSTER_W, POSTER_H)
      const gradient = ctx.createLinearGradient(0, POSTER_H * POSTER_GRADIENT_START, 0, POSTER_H)
      gradient.addColorStop(0, 'rgba(14,15,26,0)')
      gradient.addColorStop(1, 'rgba(14,15,26,0.92)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, POSTER_H * POSTER_GRADIENT_START, POSTER_W, POSTER_H * (1 - POSTER_GRADIENT_START))

      ctx.textBaseline = 'middle'
      ctx.drawImage(logo, 40, 60, 48, 48)
      ctx.fillStyle = '#F5F6FF'
      ctx.font = '600 28px sans-serif'
      ctx.fillText(BRAND_NAME, 104, 84)

      const measure = (text: string) => ctx.measureText(text).width
      if (payload.kind === 'ending') {
        this.drawEndingMiddle(ctx, payload, measure)
      } else {
        this.drawWorkMiddle(ctx, payload, measure)
      }

      ctx.fillStyle = '#181A2B'
      roundRect(ctx, POSTER_CARD.x, POSTER_CARD.y, POSTER_CARD.w, POSTER_CARD.h, POSTER_CARD.r)
      ctx.fill()
      const textMaxW = POSTER_QR.x - 72 - 24
      ctx.font = '26px sans-serif'
      ctx.fillStyle = '#A3A8C3'
      ctx.fillText('长按识别小程序码', 72, POSTER_CARD.y + 62)
      ctx.font = '600 30px sans-serif'
      ctx.fillStyle = '#F5F6FF'
      ctx.fillText(fitText(`一起来玩《${payload.workTitle}》`, textMaxW, measure), 72, POSTER_CARD.y + 122)
      ctx.drawImage(code, POSTER_QR.x, POSTER_QR.y, POSTER_QR.size, POSTER_QR.size)

      ctx.font = '20px sans-serif'
      ctx.fillStyle = 'rgba(245,246,255,0.6)'
      ctx.fillText('AI 生成内容', 40, 1310)
    },

    drawEndingMiddle(ctx: Ctx, payload: PosterPayload, measure: (text: string) => number) {
      const type = payload.endingType || 'normal'
      const label = ENDING_TYPE_LABEL[type] || ENDING_TYPE_LABEL.normal
      ctx.font = '700 56px sans-serif'
      const nameLines = wrapText(payload.endingTitle || '', 670, 2, measure)
      const middle = endingMiddle(nameLines.length, Boolean(payload.rarityText))

      ctx.font = '24px sans-serif'
      const tagW = measure(label) + 32
      ctx.fillStyle = ENDING_TYPE_COLOR[type] || ENDING_TYPE_COLOR.normal
      roundRect(ctx, 40, middle.tagY, tagW, 44, 8)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(label, 56, middle.tagY + 22)

      ctx.font = '30px sans-serif'
      ctx.fillStyle = '#A3A8C3'
      ctx.fillText(fitText(`我在《${payload.workTitle}》达成了`, 670, measure), 40, middle.lineY + 15)

      ctx.font = '700 56px sans-serif'
      ctx.fillStyle = '#FFFFFF'
      nameLines.forEach((line, i) => ctx.fillText(line, 40, middle.nameY + i * middle.nameLineH + 33))

      if (payload.rarityText && middle.rarityY !== null) {
        ctx.font = '26px sans-serif'
        ctx.fillStyle = '#FFB547'
        ctx.fillText(payload.rarityText, 40, middle.rarityY + 13)
      }
    },

    drawWorkMiddle(ctx: Ctx, payload: PosterPayload, measure: (text: string) => number) {
      ctx.font = '700 56px sans-serif'
      const nameLines = wrapText(payload.workTitle, 670, 2, measure)
      ctx.font = '30px sans-serif'
      const taglineLines = wrapText(payload.tagline, 670, 2, measure)
      const middle = workMiddle(nameLines.length, taglineLines.length)

      ctx.font = '700 56px sans-serif'
      ctx.fillStyle = '#FFFFFF'
      nameLines.forEach((line, i) => ctx.fillText(line, 40, middle.nameY + i * middle.nameLineH + 33))

      ctx.font = '30px sans-serif'
      ctx.fillStyle = '#A3A8C3'
      taglineLines.forEach((line, i) => ctx.fillText(line, 40, middle.taglineY + i * middle.taglineLineH + 15))

      if (middle.tagsY !== null && payload.tags.length) {
        ctx.font = '24px sans-serif'
        let x = 40
        for (const tag of payload.tags.slice(0, 3)) {
          const text = fitText(tag, 200, measure)
          const w = measure(text) + 32
          if (x + w > POSTER_W - 40) break
          ctx.fillStyle = '#22253A'
          roundRect(ctx, x, middle.tagsY, w, 40, 8)
          ctx.fill()
          ctx.fillStyle = '#A3A8C3'
          ctx.fillText(text, x + 16, middle.tagsY + 20)
          x += w + 16
        }
      }
    },
  },
})
