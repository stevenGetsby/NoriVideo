import sharp from 'sharp'
import { toFile } from 'openai'
import { toUploadFile } from './common'

function luminance(red: number, green: number, blue: number) {
  return Math.round((0.2126 * red) + (0.7152 * green) + (0.0722 * blue))
}

/**
 * Produces the OpenAI Images edit contract: a PNG mask whose dimensions match
 * the source image and whose transparent pixels are the region to replace.
 * Legacy FrameOS black/white masks are converted as white => transparent and
 * black => opaque. Existing alpha masks keep their alpha channel.
 */
export async function prepareOpenAIInpaintUploads(source: string, mask: string): Promise<{
  image: File
  mask: File
  width: number
  height: number
}> {
  const image = await toUploadFile(source, 0)
  const rawMaskFile = await toUploadFile(mask, 1)
  const sourceBuffer = Buffer.from(await image.arrayBuffer())
  const maskBuffer = Buffer.from(await rawMaskFile.arrayBuffer())

  const sourceMetadata = await sharp(sourceBuffer).metadata()
  const width = sourceMetadata.width
  const height = sourceMetadata.height
  if (!width || !height) {
    throw new Error('OPENAI_COMPAT_IMAGE_INPAINT_SOURCE_INVALID: source image dimensions are unavailable')
  }

  const normalized = await sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (normalized.info.channels !== 4) {
    throw new Error('OPENAI_COMPAT_IMAGE_INPAINT_MASK_INVALID: mask must decode as RGBA')
  }

  const pixels = normalized.data
  let hasInputTransparency = false
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 255) {
      hasInputTransparency = true
      break
    }
  }

  let hasEditablePixel = false
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = hasInputTransparency
      ? pixels[offset + 3]
      : 255 - luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    pixels[offset] = 0
    pixels[offset + 1] = 0
    pixels[offset + 2] = 0
    pixels[offset + 3] = alpha
    if (alpha < 255) hasEditablePixel = true
  }
  if (!hasEditablePixel) {
    throw new Error('OPENAI_COMPAT_IMAGE_INPAINT_MASK_EMPTY: mask contains no editable pixels')
  }

  const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return {
    image,
    mask: await toFile(png, 'mask.png', { type: 'image/png' }),
    width,
    height,
  }
}

