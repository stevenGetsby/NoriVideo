'use client'

import { createElement, useEffect, useRef, useState } from 'react'
import { Box, Camera, LoaderCircle, Pause, Play, RotateCcw, X } from '@/components/ui/icons'

type ModelViewerElement = HTMLElement & {
  cameraOrbit?: string
  cameraTarget?: string
  fieldOfView?: string
  toBlob?: (options?: { idealAspect?: boolean }) => Promise<Blob>
}

export function CanvasModel3DViewer({ src, compact = false }: { src: string; compact?: boolean }) {
  const viewerRef = useRef<ModelViewerElement | null>(null)
  const [ready, setReady] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [moduleReady, setModuleReady] = useState(false)

  useEffect(() => {
    let active = true
    void import('@google/model-viewer').then(() => { if (active) setModuleReady(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    setReady(false)
    const viewer = viewerRef.current
    if (!viewer) return
    const loaded = () => setReady(true)
    viewer.addEventListener('load', loaded)
    return () => viewer.removeEventListener('load', loaded)
  }, [moduleReady, src])

  const resetCamera = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.cameraOrbit = '0deg 75deg 105%'
    viewer.cameraTarget = 'auto auto auto'
    viewer.fieldOfView = 'auto'
  }

  const capture = async () => {
    const blob = await viewerRef.current?.toBlob?.({ idealAspect: true })
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '3d-view.png'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`nori-canvas-model-viewer nodrag nowheel nopan${compact ? ' is-compact' : ''}`}>
      {moduleReady ? createElement('model-viewer', {
        ref: (element: ModelViewerElement | null) => { viewerRef.current = element },
        src,
        'camera-controls': '',
        'auto-rotate': autoRotate ? '' : undefined,
        'auto-rotate-delay': '0',
        'rotation-per-second': '18deg',
        'shadow-intensity': '1',
        'shadow-softness': '0.85',
        exposure: '1.05',
        'environment-image': 'neutral',
        'interaction-prompt': 'none',
        'touch-action': 'pan-y',
        alt: '3D 模型预览',
      }) : null}
      {!ready ? <div className="nori-canvas-model-loading"><LoaderCircle className="animate-spin" /><span>正在载入 3D 模型…</span></div> : null}
      {!compact && ready ? <div className="nori-canvas-model-controls"><button type="button" title={autoRotate ? '暂停自动旋转' : '继续自动旋转'} onClick={() => setAutoRotate((value) => !value)}>{autoRotate ? <Pause /> : <Play />}</button><button type="button" title="重置机位" onClick={resetCamera}><RotateCcw /></button><button type="button" title="保存当前视角" onClick={() => void capture()}><Camera /></button></div> : null}
    </div>
  )
}

export function CanvasModel3DDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-model-dialog">
        <header><span><Box />3D 预览 · {title}</span><button type="button" title="关闭" onClick={onClose}><X /></button></header>
        <CanvasModel3DViewer src={src} />
      </div>
    </div>
  )
}
