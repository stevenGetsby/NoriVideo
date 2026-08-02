import sharp from 'sharp'

const MAX_DIMENSION = 8_192

export type CanvasImageTile = {
  body: Buffer
  width: number
  height: number
  row: number
  col: number
}

export type CanvasImageTileSelection = { row: number; col: number }

async function normalizeImage(input: Buffer) {
  const result = await sharp(input, { limitInputPixels: 80_000_000 })
    .rotate()
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  if (!result.info.width || !result.info.height) throw new Error('无法读取图片尺寸')
  return result
}

export async function splitCanvasImage(input: Buffer, rows: number, cols: number, selectedCells?: CanvasImageTileSelection[]): Promise<CanvasImageTile[]> {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 6 || cols > 6 || rows * cols < 2 || rows * cols > 25) {
    throw new Error('宫格行列数必须在 1–6 之间，且切片总数不能超过 25')
  }
  const selected = selectedCells === undefined
    ? null
    : new Set(selectedCells.map((cell) => {
      if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.col < 0 || cell.row >= rows || cell.col >= cols) throw new Error('宫格选择区域无效')
      return `${cell.row}:${cell.col}`
    }))
  if (selected && selected.size === 0) throw new Error('请至少选择一个需要切分的宫格')
  const normalized = await normalizeImage(input)
  const tiles: CanvasImageTile[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (selected && !selected.has(`${row}:${col}`)) continue
      const left = Math.floor(normalized.info.width * col / cols)
      const top = Math.floor(normalized.info.height * row / rows)
      const right = Math.floor(normalized.info.width * (col + 1) / cols)
      const bottom = Math.floor(normalized.info.height * (row + 1) / rows)
      const width = Math.max(1, right - left)
      const height = Math.max(1, bottom - top)
      const body = await sharp(normalized.data)
        .extract({ left, top, width, height })
        .jpeg({ quality: 94, mozjpeg: true })
        .toBuffer()
      tiles.push({ body, width, height, row, col })
    }
  }
  return tiles
}

export async function cropCanvasImage(
  input: Buffer,
  crop: { x: number; y: number; width: number; height: number },
): Promise<CanvasImageTile> {
  const values = [crop.x, crop.y, crop.width, crop.height]
  if (values.some((value) => !Number.isFinite(value)) || crop.x < 0 || crop.y < 0 || crop.width < 0.02 || crop.height < 0.02 || crop.x + crop.width > 1.0001 || crop.y + crop.height > 1.0001) {
    throw new Error('聚焦区域格式无效')
  }
  const normalized = await normalizeImage(input)
  const left = Math.min(normalized.info.width - 1, Math.max(0, Math.floor(normalized.info.width * crop.x)))
  const top = Math.min(normalized.info.height - 1, Math.max(0, Math.floor(normalized.info.height * crop.y)))
  const right = Math.min(normalized.info.width, Math.max(left + 1, Math.ceil(normalized.info.width * (crop.x + crop.width))))
  const bottom = Math.min(normalized.info.height, Math.max(top + 1, Math.ceil(normalized.info.height * (crop.y + crop.height))))
  const width = right - left
  const height = bottom - top
  const body = await sharp(normalized.data)
    .extract({ left, top, width, height })
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer()
  return { body, width, height, row: 0, col: 0 }
}

export async function upscaleCanvasImage(input: Buffer, requestedScale: number): Promise<CanvasImageTile> {
  if (requestedScale !== 2 && requestedScale !== 4) throw new Error('超清倍数仅支持 2× 或 4×')
  const normalized = await normalizeImage(input)
  const scale = Math.min(
    requestedScale,
    MAX_DIMENSION / normalized.info.width,
    MAX_DIMENSION / normalized.info.height,
  )
  if (scale <= 1) throw new Error('原图尺寸已达到 8192px 上限')
  const width = Math.max(1, Math.floor(normalized.info.width * scale))
  const height = Math.max(1, Math.floor(normalized.info.height * scale))
  const body = await sharp(normalized.data)
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.4 })
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer()
  return { body, width, height, row: 0, col: 0 }
}
