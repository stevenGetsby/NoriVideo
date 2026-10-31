'use client'

import { useEffect, useRef, useState } from 'react'

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uPointer;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uAspect;
    float t = uTime * 0.16;
    vec2 drift = uPointer * 0.075 + vec2(sin(t * 0.7), cos(t * 0.6)) * 0.055;
    float cloud = fbm(p * 1.65 + drift + vec2(t * 0.07, -t * 0.04));
    float warp = fbm(p * 2.1 + cloud * 1.3 - drift);

    vec3 color = mix(vec3(0.025, 0.035, 0.095), vec3(0.065, 0.04, 0.13), vUv.y + cloud * 0.3);
    float cyanGlow = exp(-3.2 * length(p - vec2(-0.46 * uAspect + sin(t) * 0.09, 0.13)));
    float violetGlow = exp(-3.4 * length(p - vec2(0.43 * uAspect, -0.08 + cos(t * 0.8) * 0.08)));
    color += vec3(0.015, 0.38, 0.62) * cyanGlow * 0.85;
    color += vec3(0.34, 0.075, 0.58) * violetGlow * 0.9;

    float wave = 0.16 * sin(p.x * 2.25 + t) + 0.07 * sin(p.x * 4.4 - t * 0.7);
    float ribbon = exp(-abs(p.y - wave - (cloud - 0.5) * 0.26) * 9.0);
    float filament = exp(-abs(p.y - wave - (warp - 0.5) * 0.16) * 65.0);
    vec3 ribbonColor = mix(vec3(0.03, 0.65, 0.86), vec3(0.59, 0.25, 0.94), smoothstep(-0.65, 0.65, p.x));
    color += ribbonColor * ribbon * 0.23 + ribbonColor * filament * 0.32;

    vec2 orbit = p - vec2(0.12, 0.015);
    float angle = atan(orbit.y * 1.75, orbit.x);
    float ring = abs(length(orbit * vec2(1.0, 1.75)) - 0.29);
    float arc = smoothstep(-0.3, 0.5, sin(angle * 2.0 - t * 0.5));
    color += vec3(0.32, 0.62, 1.0) * exp(-ring * 150.0) * arc * 0.38;

    vec2 starGrid = p * 31.0;
    vec2 starCell = floor(starGrid);
    vec2 starPoint = fract(starGrid) - 0.5;
    float star = (1.0 - smoothstep(0.015, 0.075, length(starPoint))) * step(0.965, hash(starCell));
    color += vec3(0.65, 0.86, 1.0) * star * (0.25 + 0.3 * sin(t * 2.0 + hash(starCell) * 8.0));

    float vignette = 1.0 - smoothstep(0.25, 1.1, length(p * vec2(0.75, 1.25)));
    color *= 0.65 + vignette * 0.45;
    gl_FragColor = vec4(color, 1.0);
  }
`

export function AuthCreativeScene() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let dispose = () => {}

    const initialize = async () => {
      try {
        const THREE = await import('three')
        if (cancelled) return
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
        renderer.setClearColor(0x000000, 0)
        renderer.domElement.setAttribute('aria-hidden', 'true')
        host.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const uniforms = {
          uTime: { value: 4 },
          uAspect: { value: 1 },
          uPointer: { value: new THREE.Vector2() },
        }
        const geometry = new THREE.PlaneGeometry(2, 2)
        const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false })
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        const pointer = new THREE.Vector2()
        let width = 0
        let height = 0
        let frame = 0
        let lastFrame = 0
        let visible = true
        const resize = () => {
          const bounds = host.getBoundingClientRect()
          width = Math.max(1, Math.round(bounds.width))
          height = Math.max(1, Math.round(bounds.height))
          uniforms.uAspect.value = width / height
          renderer.setSize(width, height, false)
          if (reducedMotion.matches) renderer.render(scene, camera)
        }
        const render = (now: number) => {
          frame = 0
          if (cancelled || reducedMotion.matches || document.hidden || !visible) return
          const interval = width < 600 ? 1000 / 30 : 1000 / 45
          if (now - lastFrame >= interval) {
            uniforms.uTime.value = now / 1000
            uniforms.uPointer.value.lerp(pointer, 0.045)
            renderer.render(scene, camera)
            lastFrame = now
          }
          frame = requestAnimationFrame(render)
        }
        const schedule = () => {
          if (!frame && !cancelled && !reducedMotion.matches && !document.hidden && visible) frame = requestAnimationFrame(render)
        }
        const onPointerMove = (event: PointerEvent) => {
          const bounds = host.getBoundingClientRect()
          pointer.set(
            Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2)),
            Math.max(-1, Math.min(1, (0.5 - (event.clientY - bounds.top) / bounds.height) * 2)),
          )
        }
        const onMotionChange = () => {
          cancelAnimationFrame(frame)
          frame = 0
          if (reducedMotion.matches) renderer.render(scene, camera)
          else schedule()
        }
        const onVisibilityChange = () => {
          if (document.hidden) {
            cancelAnimationFrame(frame)
            frame = 0
          } else schedule()
        }
        const onContextLost = (event: Event) => {
          event.preventDefault()
          cancelAnimationFrame(frame)
          frame = 0
          setState('fallback')
        }
        const onContextRestored = () => {
          setState('ready')
          schedule()
        }
        const observer = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting
          if (visible) schedule()
          else {
            cancelAnimationFrame(frame)
            frame = 0
          }
        })
        observer.observe(host)
        const resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)
        window.addEventListener('pointermove', onPointerMove, { passive: true })
        document.addEventListener('visibilitychange', onVisibilityChange)
        reducedMotion.addEventListener('change', onMotionChange)
        renderer.domElement.addEventListener('webglcontextlost', onContextLost)
        renderer.domElement.addEventListener('webglcontextrestored', onContextRestored)
        resize()
        renderer.render(scene, camera)
        setState('ready')
        schedule()
        dispose = () => {
          cancelAnimationFrame(frame)
          observer.disconnect()
          resizeObserver.disconnect()
          window.removeEventListener('pointermove', onPointerMove)
          document.removeEventListener('visibilitychange', onVisibilityChange)
          reducedMotion.removeEventListener('change', onMotionChange)
          renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
          renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
          geometry.dispose()
          material.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        }
      } catch {
        if (!cancelled) setState('fallback')
      }
    }

    void initialize()
    return () => {
      cancelled = true
      dispose()
    }
  }, [])

  return (
    <div className={`nori-auth-creative-scene is-${state}`} data-scene-state={state}>
      <div className="nori-auth-scene-fallback" aria-hidden="true" />
      <div ref={hostRef} className="nori-auth-scene-renderer" aria-hidden="true" />
    </div>
  )
}
