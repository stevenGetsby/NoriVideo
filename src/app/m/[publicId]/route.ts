import { NextRequest, NextResponse } from 'next/server'
import * as storage from '@/lib/storage'
import { getMediaObjectByPublicId } from '@/lib/media/service'
import { ensureCanvasThumbnail, normalizeCanvasThumbnailWidth } from '@/lib/media/thumbnail'
import { ensureVideoPoster, normalizeVideoPosterWidth } from '@/lib/media/video-poster'

export const runtime = 'nodejs'

const DERIVATIVE_SIGNING_BUCKET_SECONDS = 6 * 60 * 60
const STATIC_RASTER_EXT = /\.(png|jpe?g|webp)$/i
const VIDEO_EXT = /\.(mp4|webm|mov)$/i

function buildEtag(
  media: { sha256?: string | null; id: string; updatedAt?: string | null },
  variant?: string | null,
) {
  const suffix = variant ? `-${variant}` : ''
  if (media.sha256) return `"${media.sha256}${suffix}"`
  return `W/"media-${media.id}-${media.updatedAt || '0'}${suffix}"`
}

function derivativeRedirectCacheSeconds(bucketSeconds: number): number {
  const storageType = typeof storage.getStorageType === 'function' ? storage.getStorageType() : 'tos'
  if (storageType === 'tos') {
    return Math.max(60, Math.ceil((bucketSeconds * 1000 - Date.now() % (bucketSeconds * 1000)) / 1000))
  }
  return 600
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params
  const media = await getMediaObjectByPublicId(publicId)

  if (!media) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }
  if (!media.storageKey) {
    return NextResponse.json({ error: 'Media storage key missing' }, { status: 500 })
  }

  const thumbnailParam = request.nextUrl.searchParams.get('thumbnail')
  const posterParam = request.nextUrl.searchParams.get('poster')
  const variant = posterParam ? `p${posterParam}` : thumbnailParam ? `t${thumbnailParam}` : null
  const etag = buildEtag({
    id: media.id,
    sha256: media.sha256,
    updatedAt: media.updatedAt || null,
  }, variant)

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  // Plain playback (player, grids, style refs) follows the 302 straight to
  // object storage so bytes skip the web process. Canvas byte consumers
  // (frame sampler, waveform, WebGL textures) need same-origin readable bytes,
  // so they request ?proxy=1 and keep the proxy. PUBLIC_MEDIA_REDIRECT=0 forces
  // the proxy for everyone.
  const forceProxy = process.env.PUBLIC_MEDIA_REDIRECT === '0'
    || request.nextUrl.searchParams.get('proxy') === '1'
  if (!forceProxy) {
    if (posterParam) {
      const isVideo = Boolean(media.mimeType?.startsWith('video/') || VIDEO_EXT.test(media.storageKey))
      if (!isVideo || thumbnailParam) {
        return NextResponse.json({ error: 'Video poster requires a video media object' }, { status: 400 })
      }
      try {
        const posterKey = await ensureVideoPoster(media.storageKey, normalizeVideoPosterWidth(posterParam))
        const signedUrl = await storage.getSignedObjectUrl(posterKey, 3600, {
          signingBucketSeconds: DERIVATIVE_SIGNING_BUCKET_SECONDS,
          responseCacheControl: 'private, max-age=86400',
        })
        return new NextResponse(null, {
          status: 302,
          headers: {
            Location: new URL(signedUrl, request.nextUrl.origin).toString(),
            'Cache-Control': `public, max-age=${derivativeRedirectCacheSeconds(DERIVATIVE_SIGNING_BUCKET_SECONDS)}`,
          },
        })
      } catch {
        return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=600' } })
      }
    }

    if (thumbnailParam) {
      let width: ReturnType<typeof normalizeCanvasThumbnailWidth>
      try {
        width = normalizeCanvasThumbnailWidth(thumbnailParam)
      } catch {
        return NextResponse.json({ error: 'Unsupported thumbnail width' }, { status: 400 })
      }
      if (STATIC_RASTER_EXT.test(media.storageKey)) {
        try {
          const thumbnailKey = await ensureCanvasThumbnail(media.storageKey, width)
          const signedUrl = await storage.getSignedObjectUrl(thumbnailKey, 3600, {
            signingBucketSeconds: DERIVATIVE_SIGNING_BUCKET_SECONDS,
            responseCacheControl: 'private, max-age=86400',
          })
          return new NextResponse(null, {
            status: 302,
            headers: {
              Location: new URL(signedUrl, request.nextUrl.origin).toString(),
              'Cache-Control': `public, max-age=${derivativeRedirectCacheSeconds(DERIVATIVE_SIGNING_BUCKET_SECONDS)}`,
            },
          })
        } catch {
          // Fall through to the original media redirect if thumbnail generation fails.
        }
      }
    }

    const signedUrl = await storage.getSignedObjectUrl(media.storageKey, 3600, {
      signingBucketSeconds: 3600,
      responseCacheControl: 'private, max-age=86400',
    })
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: new URL(signedUrl, request.nextUrl.origin).toString(),
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  const fetchUrl = storage.toFetchableUrl(storage.getSignedUrl(media.storageKey))
  const range = request.headers.get('range')

  const upstream = await fetch(fetchUrl, {
    headers: range ? { Range: range } : undefined,
  })

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502
    return NextResponse.json({ error: 'Failed to fetch media' }, { status })
  }

  const contentType = media.mimeType || upstream.headers.get('content-type') || 'application/octet-stream'
  const contentLength = upstream.headers.get('content-length')
  const contentRange = upstream.headers.get('content-range')
  const acceptRanges = upstream.headers.get('accept-ranges') || (contentType.startsWith('video/') ? 'bytes' : null)

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', etag)
  if (contentLength) headers.set('Content-Length', contentLength)
  if (contentRange) headers.set('Content-Range', contentRange)
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges)

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  })
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params
  const media = await getMediaObjectByPublicId(publicId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }

  const etag = buildEtag({
    id: media.id,
    sha256: media.sha256,
    updatedAt: media.updatedAt || null,
  })

  const headers = new Headers()
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', etag)
  if (media.mimeType) headers.set('Content-Type', media.mimeType)
  if (media.sizeBytes != null) headers.set('Content-Length', String(media.sizeBytes))
  return new Response(null, { status: 200, headers })
}
