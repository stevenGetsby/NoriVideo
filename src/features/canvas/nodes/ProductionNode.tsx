'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from '../types'

function readNodeData(data: NodeProps['data']): CanvasNodeData {
  return (data || {}) as CanvasNodeData
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const colors = {
    neutral: 'rgba(71,85,105,0.12)',
    success: 'rgba(16,185,129,0.16)',
    warning: 'rgba(245,158,11,0.18)',
  }

  return (
    <span
      style={{
        borderRadius: 999,
        background: colors[tone],
        color: '#334155',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 8px',
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

  return (
    <div
      style={{
        width: isPanel || isVideo ? 260 : 300,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.92)',
        border: props.selected ? '2px solid #2563eb' : '1px solid rgba(148,163,184,0.42)',
        boxShadow: props.selected
          ? '0 18px 48px rgba(37,99,235,0.22)'
          : '0 14px 34px rgba(15,23,42,0.14)',
        overflow: 'hidden',
        cursor: 'grab',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#64748b' }} />

      <div
        style={{
          padding: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          borderBottom: '1px solid rgba(226,232,240,0.9)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: '#0f172a',
              fontSize: 13,
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.title || 'Production node'}
          </div>
          {data.subtitle ? (
            <div
              style={{
                color: '#64748b',
                fontSize: 11,
                marginTop: 3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {data.subtitle}
            </div>
          ) : null}
        </div>
        <Badge tone={data.hasVideo ? 'success' : data.hasImage ? 'warning' : 'neutral'}>
          {data.statusLabel || (isVideo ? 'Video' : isPanel ? 'Panel' : isStoryboard ? 'Storyboard' : 'Episode')}
        </Badge>
      </div>

      {hasVisual ? (
        <div style={{ aspectRatio: '16 / 9', background: '#0f172a', position: 'relative' }}>
          {data.videoUrl ? (
            <video
              src={data.videoUrl}
              muted
              playsInline
              controls
              className="nodrag"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <img
              src={data.imageUrl || ''}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>
      ) : (
        <div
          style={{
            height: isPanel ? 120 : 92,
            background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {isVideo ? '等待视频结果' : isPanel ? '等待分镜图' : '生产数据节点'}
        </div>
      )}

      <div style={{ padding: 12 }}>
        {data.description ? (
          <div
            style={{
              color: '#334155',
              fontSize: 12,
              lineHeight: 1.45,
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
              color: '#64748b',
              fontSize: 11,
              lineHeight: 1.4,
              marginTop: data.description ? 8 : 0,
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
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {Object.entries(data.stats).map(([key, value]) => (
              <Badge key={key}>{key}: {value}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#64748b' }} />
    </div>
  )
}

export const ProductionNode = memo(ProductionNodeImpl)
ProductionNode.displayName = 'ProductionNode'
