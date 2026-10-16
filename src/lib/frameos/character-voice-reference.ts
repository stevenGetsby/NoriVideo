export function characterVoiceMaterialId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).voiceMaterialId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function withCharacterVoiceMaterial(metadata: unknown, materialId: string | null) {
  const next: Record<string, unknown> = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata as Record<string, unknown> } : {}
  if (materialId) next.voiceMaterialId = materialId
  else delete next.voiceMaterialId
  return next
}

export function characterPairName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/(?:[_ -](?:voice|音色|音频))$/i, '').normalize('NFKC').trim().toLocaleLowerCase()
}

export function matchCharacterVoiceFile<T extends { name: string }>(imageName: string, voices: readonly T[]): T | null {
  const matches = voices.filter((file) => characterPairName(file.name) === characterPairName(imageName))
  return matches.length === 1 ? matches[0] : null
}

export function validateCharacterAudioFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) return '音色文件须为 1 字节–50MB'
  if (!/\.(mp3|wav|m4a|ogg)$/i.test(file.name) && !file.type.startsWith('audio/')) return '请选择 MP3、WAV、M4A 或 OGG 音频'
  return null
}
