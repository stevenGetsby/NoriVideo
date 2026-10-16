import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

/** Exact-pixel cutout of the supplied 272px IP sheet, not a generative redraw. */
export async function extractLanmiaoCat(input) {
  const { data, info } = await sharp(input).extract({ left: 0, top: 60, width: 272, height: 212 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const background = new Uint8Array(width * height)
  const queue = []
  const nearWhite = (index) => {
    const offset = index * 3
    const channels = [data[offset], data[offset + 1], data[offset + 2]]
    return Math.min(...channels) >= 211 && Math.max(...channels) - Math.min(...channels) <= 36
  }
  const push = (index) => {
    if (index < 0 || index >= background.length || background[index] || !nearWhite(index)) return
    background[index] = 1
    queue.push(index)
  }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1) }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]
    const x = index % width
    if (x > 0) push(index - 1)
    if (x + 1 < width) push(index + 1)
    push(index - width)
    push(index + width)
  }
  const output = Buffer.alloc(width * height * 4)
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const from = index * 3, to = index * 4
      if (background[index]) continue
      output[to] = data[from]; output[to + 1] = data[from + 1]; output[to + 2] = data[from + 2]; output[to + 3] = 255
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      // Unmatte only the outer antialiased ink edge; enclosed pale ear/belly
      // pixels are never color-keyed. The cropped lower body is not invented.
      const touchesBackground = [-1, 1, -width, width].some((delta) => {
        const candidate = index + delta
        return candidate >= 0 && candidate < background.length && Math.abs(candidate % width - x) <= 1 && background[candidate]
      })
      if (!touchesBackground || Math.min(data[from], data[from + 1], data[from + 2]) < 85) continue
      let ink = null
      for (let radius = 1; radius <= 3 && !ink; radius++) {
        for (let dy = -radius; dy <= radius && !ink; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const offset = (ny * width + nx) * 3
            if (data[offset] < 65 && data[offset + 1] < 135 && data[offset + 2] < 175) {
              ink = [data[offset], data[offset + 1], data[offset + 2]]
              break
            }
          }
        }
      }
      if (!ink) continue
      let numerator = 0, denominator = 0
      for (let channel = 0; channel < 3; channel++) {
        numerator += (data[from + channel] - 255) * (ink[channel] - 255)
        denominator += (ink[channel] - 255) ** 2
      }
      const alpha = Math.max(0, Math.min(1, numerator / denominator))
      if (alpha >= .98 || alpha <= 0) continue
      output[to + 3] = Math.round(alpha * 255)
      for (let channel = 0; channel < 3; channel++) output[to + channel] = Math.max(0, Math.min(255, Math.round((data[from + channel] - 255 * (1 - alpha)) / alpha)))
    }
  }
  // The slogan's lowest antialiased pixels slightly cross the initial crop.
  // Discard only tiny detached fragments confined to that top strip. The cat
  // and its separate, source-cropped tail remain untouched.
  const seen = new Uint8Array(width * height)
  for (let seed = 0; seed < seen.length; seed++) {
    if (seen[seed] || !output[seed * 4 + 3]) continue
    const component = [seed]
    seen[seed] = 1
    let maxY = 0
    for (let head = 0; head < component.length; head++) {
      const current = component[head], x = current % width, y = Math.floor(current / width)
      maxY = Math.max(maxY, y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, index = ny * width + nx
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[index] || !output[index * 4 + 3]) continue
        seen[index] = 1
        component.push(index)
      }
    }
    if (maxY < 8 && component.length < 256) for (const index of component) output.fill(0, index * 4, index * 4 + 4)
  }
  left = width; top = height; right = -1; bottom = -1
  for (let index = 0; index < seen.length; index++) if (output[index * 4 + 3]) {
    const x = index % width, y = Math.floor(index / width)
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw Error('No cat silhouette detected')
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 }
  const png = await sharp(output, { raw: { width, height, channels: 4 } }).extract(bounds).png().toBuffer()
  return { png, bounds: { ...bounds, top: top + 60 }, sourceWidth: 272, sourceHeight: 272 }
}

async function square(png, size) {
  const { data, info } = await sharp(png).resize(size, size, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  const left = Math.floor((size - info.width) / 2), top = Math.floor((size - info.height) / 2)
  return await sharp(data).extend({
    left, right: size - info.width - left, top, bottom: size - info.height - top,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer()
}

export async function buildLanmiaoAssets(source, root = process.cwd()) {
  const backup = path.join(root, '.runtime/lanmiao-brand/previous')
  const output = path.join(root, 'public/brand')
  await fs.mkdir(backup, { recursive: true })
  await fs.mkdir(output, { recursive: true })
  const original = await fs.readFile(source)
  await fs.writeFile(path.join(root, '.runtime/lanmiao-brand/ip-source.png'), original)
  const result = await extractLanmiaoCat(original)
  const cat = result.png
  const icon = await square(cat, 128)
  const apple = await square(cat, 180)
  const logo = await square(cat, 256)
  const small = await square(cat, 64)
  await fs.writeFile(path.join(output, 'lanmiao-cat.png'), cat)
  await fs.writeFile(path.join(output, 'lanmiao-cat-icon.png'), icon)
  await fs.writeFile(path.join(output, 'lanmiao-cat-apple.png'), apple)
  const sizes = [16, 32, 48, 64]
  const frames = await Promise.all(sizes.map((size) => square(cat, size)))
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach((frame, index) => {
    const entry = 6 + 16 * index
    header[entry] = sizes[index]; header[entry + 1] = sizes[index]
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  })
  const ico = Buffer.concat([header, ...frames])
  // Standalone embedded PNG is deliberate: external href resources in SVG
  // favicons can be blocked by browsers' image-document security policy.
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>蓝喵</title><image width="128" height="128" href="data:image/png;base64,${icon.toString('base64')}"/></svg>`)
  const aliases = new Map([
    ['logo.png', logo], ['logo 2.png', logo], ['logo-small.png', small], ['logo-small 2.png', small],
    ['icon.png', icon], ['icon 2.png', icon], ['icon.svg', svg],
    ['logo.ico', ico], ['logo 2.ico', ico], ['favicon.ico', ico],
    ['nori-view/nori-onion-logo.png', small],
  ])
  for (const [file, bytes] of aliases) {
    const destination = path.join(root, 'public', file)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const old = await fs.readFile(destination).catch(() => null)
    const oldPath = path.join(backup, file)
    await fs.mkdir(path.dirname(oldPath), { recursive: true })
    if (old) await fs.writeFile(oldPath, old, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error })
    await fs.writeFile(destination, bytes)
  }
  return { bounds: result.bounds, alpha: true, aliasesUpdated: [...aliases.keys()], originalPreserved: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Provide the supplied IP PNG as the source argument')
  console.log(JSON.stringify(await buildLanmiaoAssets(process.argv[2]), null, 2))
}
