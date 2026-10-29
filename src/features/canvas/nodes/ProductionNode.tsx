'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MediaImage } from '@/components/media/MediaImage'
import type { CanvasNodeData } from '../types'
import { CanvasNodeVideo } from './CanvasNodeVideo'

function readNodeData(data: NodeProps['data']): CanvasNodeData {
  return (data || {}) as CanvasNodeData
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const colors = {
    neutral: 'rgba(255,255,255,0.06)',
    success: 'rgba(52,211,153,0.14)',
    warning: 'rgba(251,191,36,0.14)',
  }
  const textColors = {
    neutral: 'rgba(245,245,250,0.62)',
    success: '#6ee7b7',
    warning: '#fcd34d',
  }

  return (
    <span
      style={{
        flex: 'none',
        borderRadius: 999,
        background: colors[tone],
        color: textColors[tone],
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        padding: '2px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function ProductionNodeImpl(props: NodeProps) {
  const data = readNodeData(props.data)
  const isPanel = props.type === 'production_panel'
  const isVideo = props.type === 'production_video'
  const isStoryboard = props.type === 'production_storyboard'
  const hasVisual = Boolean(data.imageUrl || data.videoUrl)
  const hue = isVideo ? '#a78bfa' : isPanel ? '#38bdf8' : '#6e7bff'
  const fallbackTitle = isVideo ? '分镜视频' : isPanel ? '分镜画面' : isStoryboard ? '分镜组' : '剧集'
  const legacyStatusLabels: Record<string, string> = {
    Video: '视频',
    Panel: '分镜画面',
    Storyboard: '分镜组',
    Episode: '剧集',
  }
  const statusLabel = data.statusLabel
    ? legacyStatusLabels[data.statusLabel] || data.statusLabel
    : isVideo ? '视频' : isPanel ? '分镜画面' : isStoryboard ? '分镜组' : '剧集'

  return (
    <div
      style={{
        width: isPanel || isVideo ? 260 : 300,
        borderRadius: 16,
        background: props.selected
          ? 'linear-gradient(#24242e, #1b1b23)'
          : '#1b1b23',
        border: props.selected
          ? `1px solid color-mix(in srgb, ${hue} 82%, transparent)`
          : '0.5px solid #34343f',
        boxShadow: props.selected
          ? `0 0 0 1px color-mix(in srgb, ${hue} 26%, transparent), 0 6px 18px rgba(0,0,0,0.28), 0 0 26px -10px ${hue}`
          : '0 2px 8px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        cursor: 'grab',
        transition: 'border-color .15s ease, box-shadow .15s ease',
      }}
    >
      <Handle type="source" id="input" position={Position.Left} style={{ background: hue }} />

      {hasVisual ? (
        <div style={{ aspectRatio: '16 / 9', background: '#08080c', position: 'relative' }}>
          {data.videoUrl ? (
            <CanvasNodeVideo src={data.videoUrl} fit="cover" />
          ) : (
            <MediaImage
              src={data.imageUrl || ''}
              alt=""
              draggable={false}
              width={640}
              height={360}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>
      ) : (
        <div
          style={{
            height: isPanel ? 120 : 92,
            background: `radial-gradient(80% 110% at 50% 0%, color-mix(in srgb, ${hue} 16%, transparent), transparent 72%), linear-gradient(145deg, rgba(36,36,46,0.96), rgba(27,27,35,0.99))`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(245,245,250,0.36)',
            fontSize: 12,
            fontWeight: 600,
            borderBottom: '0.5px solid rgba(255,255,255,0.06)',
          }}
        >
          {isVideo ? '等待视频结果' : isPanel ? '等待分镜图' : '生产数据节点'}
        </div>
      )}

      <div style={{ padding: '10px 12px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div
            style={{
              minWidth: 0,
              color: 'rgba(255,255,255,0.92)',
              fontSize: 13,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.title || fallbackTitle}
          </div>
          <Badge tone={data.hasVideo ? 'success' : data.hasImage ? 'warning' : 'neutral'}>
            {statusLabel}
          </Badge>
        </div>

        {data.subtitle ? (
          <div
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 11,
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.subtitle}
          </div>
        ) : null}

        {data.description ? (
          <div
            style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 7,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {data.description}
          </div>
        ) : null}

        {data.prompt ? (
          <div
            style={{
              color: 'rgba(255,255,255,0.32)',
              fontSize: 11,
              lineHeight: 1.45,
              marginTop: data.description ? 8 : 6,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {data.prompt}
          </div>
        ) : null}

        {data.stats ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {Object.entries(data.stats).map(([key, value]) => (
              <Badge key={key}>{key}: {value}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Handle type="source" id="output" position={Position.Right} style={{ background: hue }} />
    </div>
  )
}

export const ProductionNode = memo(ProductionNodeImpl)
ProductionNode.displayName = 'ProductionNode'
