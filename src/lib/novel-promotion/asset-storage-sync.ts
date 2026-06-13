import { prisma } from '@/lib/prisma'
import { ensureStorageObjectAvailable } from '@/lib/storage/ensure-object'

function parseImageUrlList(value: string | null | undefined): string[] {
  if (!value) return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    }
  } catch {
    // Keep legacy comma-separated values supported.
  }
  return trimmed.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

async function ensureMany(values: Array<string | null | undefined>): Promise<{ checked: number; available: number }> {
  let checked = 0
  let available = 0
  for (const value of values) {
    if (!value?.trim()) continue
    checked += 1
    const key = await ensureStorageObjectAvailable(value)
    if (key) available += 1
  }
  return { checked, available }
}

export async function ensureProjectAssetImagesOnStorage(projectId: string): Promise<{
  checked: number
  available: number
}> {
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: {
        include: {
          appearances: true,
        },
      },
      locations: {
        include: {
          selectedImage: true,
          images: true,
        },
      },
    },
  })
  if (!project) return { checked: 0, available: 0 }

  const candidates: string[] = []
  for (const character of project.characters) {
    for (const appearance of character.appearances) {
      if (appearance.imageUrl) candidates.push(appearance.imageUrl)
      candidates.push(...parseImageUrlList(appearance.imageUrls))
      if (appearance.seedanceAssetImageUrl) candidates.push(appearance.seedanceAssetImageUrl)
    }
  }
  for (const location of project.locations) {
    if (location.selectedImage?.imageUrl) candidates.push(location.selectedImage.imageUrl)
    for (const image of location.images) {
      if (image.imageUrl) candidates.push(image.imageUrl)
    }
  }

  const unique = Array.from(new Set(candidates))
  return await ensureMany(unique)
}
