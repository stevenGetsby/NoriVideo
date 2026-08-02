const LOCAL_ORIGIN = 'http://localhost'
const NEXT_IMAGE_PATH = '/_next/image'
const COS_SIGN_PATH = '/api/storage/sign'
const MAX_NEXT_UNWRAP_DEPTH = 5
const STORAGE_KEY_PREFIXES = ['images/', 'video/', 'voice/'] as const

function isStorageKey(value: string): boolean {
  return STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value, LOCAL_ORIGIN)
  } catch {
    return null
  }
}

export function unwrapNextImageUrl(input: string): string {
  let current = input.trim()
  if (!current) return current

  for (let i = 0; i < MAX_NEXT_UNWRAP_DEPTH; i += 1) {
    const parsed = tryParseUrl(current)
    if (!parsed || parsed.pathname !== NEXT_IMAGE_PATH) {
      return current
    }

    const nestedUrl = parsed.searchParams.get('url')
    if (!nestedUrl) {
      return current
    }

    let decoded = nestedUrl
    try {
      decoded = decodeURIComponent(nestedUrl)
    } catch {
      decoded = nestedUrl
    }

    if (!decoded || decoded === current) {
      return current
    }

    current = decoded
  }

  return current
}

export function toDisplayImageUrl(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  const unwrapped = unwrapNextImageUrl(raw)
  if (isStorageKey(unwrapped)) {
    return `${COS_SIGN_PATH}?key=${encodeURIComponent(unwrapped)}`
  }

  return unwrapped
}

/** Audio is proxied same-origin so browser metadata/range requests work even
 * when the private object store returns attachment-oriented headers. */
export function toPlayableAudioUrl(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null
  const unwrapped = unwrapNextImageUrl(raw)
  if (isStorageKey(unwrapped)) {
    return `${COS_SIGN_PATH}?key=${encodeURIComponent(unwrapped)}&inline=1`
  }
  const parsed = tryParseUrl(unwrapped)
  if (parsed?.pathname === COS_SIGN_PATH) {
    const key = parsed.searchParams.get('key')
    if (key) return `${COS_SIGN_PATH}?key=${encodeURIComponent(key)}&inline=1`
  }
  return unwrapped
}

/** WebGL textures require readable same-origin bytes, not a redirect to a
 * storage origin that may intentionally omit CORS headers. */
export function toCanvasTextureUrl(input: string | null | undefined): string | null {
  const displayUrl = toDisplayImageUrl(input)
  if (!displayUrl) return null
  const parsed = tryParseUrl(displayUrl)
  if (!parsed || parsed.pathname !== COS_SIGN_PATH) return displayUrl

  parsed.searchParams.set('inline', '1')
  return /^https?:\/\//i.test(displayUrl)
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function resolveOriginalImageUrl(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  const unwrapped = unwrapNextImageUrl(raw)
  if (isStorageKey(unwrapped)) {
    return `${COS_SIGN_PATH}?key=${encodeURIComponent(unwrapped)}`
  }

  const parsed = tryParseUrl(unwrapped)
  if (parsed?.pathname === COS_SIGN_PATH) {
    const key = parsed.searchParams.get('key')
    if (key) {
      let decodedKey = key
      try {
        decodedKey = decodeURIComponent(key)
      } catch {
        decodedKey = key
      }
      return `${COS_SIGN_PATH}?key=${encodeURIComponent(decodedKey)}`
    }
  }

  return unwrapped
}
