export const MAX_MATERIAL_FILE_BYTES = 200 * 1024 * 1024
export const MAX_MATERIAL_BATCH_FILES = 100
export const MAX_MATERIAL_TITLE_LENGTH = 160

export function isImageUpload(file: { name: string; type: string }) {
  return file.type.startsWith('image/')
    || ((!file.type || file.type === 'application/octet-stream') && /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp)$/i.test(file.name))
}

export function materialTitleFromFilename(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_MATERIAL_TITLE_LENGTH) || '未命名素材'
}
