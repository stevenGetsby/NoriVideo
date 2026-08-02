'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Grid3X3, LoaderCircle, Maximize2, Minimize2, RefreshCcw, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toCanvasTextureUrl, toDisplayImageUrl } from '@/lib/media/image-url'
import {
  panoramaCaptureResultMessage,
  type PanoramaCaptureCommitResult,
} from '../panorama-capture'

type PanoramaRuntime = {
  camera: import('three').PerspectiveCamera
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
  renderer: import('three').WebGLRenderer
  scene: import('three').Scene
  container: HTMLDivElement
}

type CaptureMode = 'current' | 'four' | 'twelve'

const VIEW_NAMES = ['前方', '右侧', '后方', '左侧']

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('截图失败：未生成有效图像')), 'image/jpeg', 0.94)
    } catch {
      reject(new Error('截图失败：全景图跨域读取受限或渲染异常'))
    }
  })
}

export function CanvasPanoramaDialog({
  src,
  title,
  readOnly = false,
  onCapture,
  onClose,
}: {
  src: string
  title: string
  readOnly?: boolean
  onCapture: (files: File[], mode: CaptureMode) => Promise<PanoramaCaptureCommitResult>
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<PanoramaRuntime | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState<CaptureMode | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [gridVisible, setGridVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const textureSrc = toCanvasTextureUrl(src) || src
  const fallbackSrc = toDisplayImageUrl(src) || src

  useEffect(() => setPortalRoot(document.body), [])

  const resetView = useCallback(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.camera.position.set(0, 0, 0.01)
    runtime.camera.up.set(0, 1, 0)
    runtime.camera.lookAt(0, 0, -1)
    runtime.controls.target.set(0, 0, -1)
    runtime.controls.update()
    runtime.renderer.render(runtime.scene, runtime.camera)
  }, [])

  useEffect(() => {
    let disposed = false
    let frame = 0
    let observer: ResizeObserver | null = null
    let resizeFallback: (() => void) | null = null
    let runtime: PanoramaRuntime | null = null
    let runtimeDisposed = false
    const container = containerRef.current
    if (!container || !portalRoot) return
    const disposeRuntime = () => {
      if (!runtime || runtimeDisposed) return
      runtimeDisposed = true
      runtime.controls.dispose()
      runtime.scene.traverse((object) => {
        if (!('geometry' in object)) return
        const mesh = object as import('three').Mesh
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => {
          const map = (material as import('three').MeshBasicMaterial).map
          map?.dispose()
          material?.dispose()
        })
      })
      runtime.renderer.dispose()
      runtime.renderer.domElement.remove()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        if (disposed) return
        const scene = new THREE.Scene()
        scene.background = new THREE.Color('#05070b')
        const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 100)
        camera.position.set(0, 0, 0.01)
        camera.lookAt(0, 0, -1)
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.domElement.className = 'nori-canvas-panorama-webgl'
        container.appendChild(renderer.domElement)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.enablePan = false
        controls.rotateSpeed = -0.3
        controls.minDistance = 0.01
        controls.maxDistance = 0.01
        controls.target.set(0, 0, -1)

        runtime = { camera, controls, renderer, scene, container }
        const texture = await new THREE.TextureLoader().loadAsync(textureSrc)
        if (disposed) { texture.dispose(); disposeRuntime(); return }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = THREE.RepeatWrapping
        texture.repeat.x = -1
        const geometry = new THREE.SphereGeometry(12, 96, 64)
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
        scene.add(new THREE.Mesh(geometry, material))
        runtimeRef.current = runtime
        const resize = () => {
          const width = Math.max(1, container.clientWidth)
          const height = Math.max(1, container.clientHeight)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
          renderer.setSize(width, height, false)
        }
        resize()
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(resize)
          observer.observe(container)
        } else {
          resizeFallback = resize
          window.addEventListener('resize', resizeFallback)
        }
        const animate = () => {
          if (disposed) return
          controls.update()
          renderer.render(scene, camera)
          frame = requestAnimationFrame(animate)
        }
        animate()
        setLoading(false)
      } catch (loadFailure) {
        disposeRuntime()
        if (!disposed) {
          setLoading(false)
          setLoadError(loadFailure instanceof Error ? loadFailure.message : '全景图加载失败，请检查网络后重试')
        }
      }
    })()
    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      if (resizeFallback) window.removeEventListener('resize', resizeFallback)
      disposeRuntime()
    }
  }, [loadAttempt, portalRoot, textureSrc])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (fullscreen) setFullscreen(false)
        else if (!capturing) onClose()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [capturing, fullscreen, onClose])

  const capture = async (mode: CaptureMode) => {
    if (readOnly) return
    const runtime = runtimeRef.current
    if (!runtime) return
    setCapturing(mode)
    setError(null)
    const { camera, controls, renderer, scene, container } = runtime
    const originalPosition = camera.position.clone()
    const originalQuaternion = camera.quaternion.clone()
    const originalTarget = controls.target.clone()
    const originalAspect = camera.aspect
    const width = 1_600
    const height = 900
    const configs = mode === 'current'
      ? [{ yaw: null as number | null, pitch: null as number | null, name: '当前视角' }]
      : mode === 'four'
        ? VIEW_NAMES.map((name, index) => ({ yaw: index * Math.PI / 2, pitch: 0, name }))
        : [-35, 0, 35].flatMap((pitch) => VIEW_NAMES.map((name, index) => ({ yaw: index * Math.PI / 2, pitch: pitch * Math.PI / 180, name: `${name}-${pitch < 0 ? '俯' : pitch > 0 ? '仰' : '平'}` })))
    try {
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const files: File[] = []
      for (let index = 0; index < configs.length; index += 1) {
        const config = configs[index]
        if (config.yaw !== null && config.pitch !== null) {
          const direction = {
            x: Math.sin(config.yaw) * Math.cos(config.pitch),
            y: Math.sin(config.pitch),
            z: -Math.cos(config.yaw) * Math.cos(config.pitch),
          }
          camera.position.set(0, 0, 0.01)
          camera.lookAt(direction.x, direction.y, direction.z)
          controls.target.set(direction.x, direction.y, direction.z)
          controls.update()
        }
        renderer.render(scene, camera)
        const blob = await canvasBlob(renderer.domElement)
        files.push(new File([blob], `${title}-${config.name}-${index + 1}.jpg`, { type: 'image/jpeg' }))
      }
      const result = await onCapture(files, mode)
      if (result.failed > 0) setError(panoramaCaptureResultMessage(result))
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : '截图失败')
    } finally {
      camera.position.copy(originalPosition)
      camera.quaternion.copy(originalQuaternion)
      controls.target.copy(originalTarget)
      camera.aspect = originalAspect
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false)
      controls.update()
      renderer.render(scene, camera)
      setCapturing(null)
    }
  }

  if (!portalRoot) return null

  return createPortal(
    <div className="nori-canvas-panorama-overlay" onPointerDown={(event) => event.stopPropagation()}>
    <div
      className={`nori-canvas-panorama-dialog${fullscreen ? ' is-fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`全景预览：${title}`}
    >
      <header>
        <div><span>全景预览</span><small>{title}</small></div>
        <div>
          <button type="button" title="重置视角" onClick={resetView}><RefreshCcw /></button>
          <button type="button" title={gridVisible ? '隐藏构图参考' : '显示构图参考'} className={gridVisible ? 'is-active' : ''} onClick={() => setGridVisible((value) => !value)}><Grid3X3 /></button>
          <button type="button" title={fullscreen ? '退出全屏' : '全屏预览'} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" title="退出全景" onClick={onClose}><X /></button>
        </div>
      </header>
      <div ref={containerRef} className="nori-canvas-panorama-stage">
        {gridVisible ? <div className="nori-canvas-panorama-grid"><i /><i /><i /><i /></div> : null}
        {loading ? <div className="nori-canvas-panorama-state"><LoaderCircle className="animate-spin" />全景加载中...</div> : null}
        {loadError ? <MediaImage className="nori-canvas-panorama-fallback" src={fallbackSrc} alt={`${title} 平面预览`} /> : null}
        {loadError ? (
          <div className="nori-canvas-panorama-state is-error">
            <span>交互式全景加载失败，已显示平面预览</span>
            <small>{loadError}</small>
            <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}><RefreshCcw />重试加载</button>
          </div>
        ) : null}
      </div>
      <footer>
        <span>{readOnly ? '拖动环视 · 滚轮缩放视野 · 当前为只读模式' : '拖动环视 · 滚轮缩放视野 · 截图会作为新图片节点发送到画布'}</span>
        {error ? <b>{error}</b> : null}
        {!readOnly ? <>
          <button type="button" disabled={Boolean(capturing) || loading || Boolean(loadError)} onClick={() => void capture('current')}>{capturing === 'current' ? <LoaderCircle className="animate-spin" /> : <Camera />}当前视角截图</button>
          <button type="button" disabled={Boolean(capturing) || loading || Boolean(loadError)} onClick={() => void capture('four')}>{capturing === 'four' ? <LoaderCircle className="animate-spin" /> : <Grid3X3 />}四视角截图</button>
          <button type="button" className="is-primary" disabled={Boolean(capturing) || loading || Boolean(loadError)} onClick={() => void capture('twelve')}>{capturing === 'twelve' ? <LoaderCircle className="animate-spin" /> : <Grid3X3 />}十二宫格截图</button>
        </> : null}
      </footer>
    </div>
    </div>,
    portalRoot,
  )
}
