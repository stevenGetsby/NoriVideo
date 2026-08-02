import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('canvas 3D studio UI permissions', () => {
  it('keeps the 3D studio available to read-only users without exposing scene mutations', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const node = source('src/features/canvas/nodes/Studio3DNode.tsx')

    expect(dialog).toContain('readOnly = false')
    expect(dialog).toContain('if (readOnly) return')
    expect(dialog).toContain('if (!readOnly && group && !object?.locked) runtime.transform.attach(group)')
    expect(dialog).toContain("'只读查看 · WASD / QE 移动导演视角'")
    expect(dialog).toContain('title="添加对象"')
    expect(dialog).toContain('!readOnly && contextMenu && (contextObject || contextCamera || contextCrowd.length > 0)')
    expect(dialog).toContain('{!readOnly && pickerType ?')
    expect(dialog).toContain('disabled={readOnly}')
    expect(dialog).toContain('readOnly={readOnly}')
    expect(dialog).toContain('if (readOnly || sendingCaptures || selected.length === 0) return')
    expect(node).toContain("editor.runNodeAction(id, 'studio_3d')")
    expect(node).toContain("editor.readOnly ? '查看导演台' : '进入导演台'")
    expect(node).not.toContain("!editor.readOnly && editor.runNodeAction(id, 'studio_3d')")
  })

  it('provides persistent capture staging, scene search and explicit director/camera modes', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const captures = source('src/features/canvas/components/CanvasStudioCapturePanel.tsx')
    const graph = source('src/features/canvas/CanvasGraph.tsx')

    expect(dialog).toContain('placeholder="请输入" aria-label="搜索场景元素"')
    expect(dialog).toContain("viewMode === 'director'")
    expect(dialog).toContain("viewMode === 'camera'")
    expect(dialog).toContain('studio.panoramaRadius')
    expect(dialog).toContain('studio.scenePosition')
    expect(dialog).toContain('studio.sceneRotation')
    expect(dialog).toContain('studio.sceneScale')
    expect(dialog).toContain('onStageCaptures(drafts)')
    expect(dialog).toContain('depthWrite: false')
    expect(dialog).toContain('sphere.renderOrder = -1_000')
    expect(captures).toContain('发送到画布')
    expect(captures).toContain('!readOnly && captures.length > 0')
    expect(graph).toContain('onStageCaptures={handleStudioStageCaptures}')
    expect(graph).toContain('studioCaptureId: capture.id')
  })

  it('keeps the independent document authoritative while mirroring only a bounded node summary', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const node = source('src/features/canvas/nodes/Studio3DNode.tsx')

    expect(dialog).toContain("studioSaveState === 'error' && !studioDocumentReady")
    expect(dialog).toContain('const flushed = await flushStudioDocument()')
    expect(dialog).toContain('adoptServerStudioDocument')
    expect(dialog).toContain('mergeStudioDocumentAndRetry')
    expect(dialog).toContain('onSummaryChange(summarizeCanvasStudioScene(studioRef.current))')
    expect(graph).toContain('studioSummary: summary, studioScene: undefined')
    expect(graph).toContain('/studio-document`, { cache: \'no-store\' }')
    expect(graph).toContain('onSummaryChange={handleStudioSummaryChange}')
    expect(node).toContain('normalizeCanvasStudioSummary(data.studioSummary, data.studioScene)')
    expect(graph).not.toContain('updateNodeData(studioNodeId, { studioScene: scene })')
  })

  it('retains successful screenshot batches and reports actual success and failure totals', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const graph = source('src/features/canvas/CanvasGraph.tsx')

    expect(graph).toContain('settleWithConcurrency(drafts, CANVAS_UPLOAD_CONCURRENCY')
    expect(graph).toContain("result.status === 'fulfilled' ? [result.value] : []")
    expect(graph).toContain("result.status === 'rejected'")
    expect(graph).toContain('return { sentIds: accepted.map((capture) => capture.id), created: created.length, failed }')
    expect(dialog).toContain('staged.captures.length')
    expect(dialog).toContain('成功 ${staged.captures.length} 张，失败 ${staged.failed} 张')
    expect(dialog).toContain('const sentIds = new Set(result.sentIds)')
    expect(dialog).toContain('成功 ${result.created} 张，失败 ${result.failed} 张')
    expect(dialog).toContain('disabled={closing || capturing || sendingCaptures || uploading}')
  })

  it('renders real Three.js object labels and binds them to the scene preference', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain('new THREE.CanvasTexture(canvas)')
    expect(dialog).toContain('new THREE.Sprite(material)')
    expect(dialog).toContain('const STUDIO_LABEL_WORLD_HEIGHT = 0.2')
    expect(dialog).toContain('context.measureText(text).width + 112')
    expect(dialog).not.toContain('sprite.scale.set(2, 0.5, 1)')
    expect(dialog).toContain('sprite.userData.studioLabel = true')
    expect(dialog).toContain('label.visible = studio.showLabels')
    expect(dialog).toContain('updateStudioLabel(label, object.name)')
    expect(dialog).toContain('texture.dispose()')
    expect(dialog).toContain('skinnedMesh.skeleton.dispose()')
  })

  it('repopulates scene objects whenever the WebGL runtime is rebuilt', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain('const [runtimeGeneration, setRuntimeGeneration] = useState(0)')
    expect(dialog).toContain('setRuntimeGeneration((generation) => generation + 1)')
    expect(dialog).toContain('[objectSignature, ready, runtimeGeneration]')
    expect(dialog).toContain('[cameraSignature, ready, runtimeGeneration]')
    expect(dialog).toContain('[runtimeGeneration, studio.objects, studio.showLabels]')
  })

  it('provides object and crowd context actions without exposing them in read-only mode', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain("openContextMenu(event, 'object', object.id)")
    expect(dialog).toContain("openContextMenu(event, 'crowd', entry.crowdId)")
    expect(dialog).toContain('contextMenuRef.current) setContextMenu(null)')
    expect(dialog).toContain('patchCrowd(entry.crowdId')
    expect(dialog).toContain('duplicateCrowd(contextMenu.id)')
    expect(dialog).toContain('deleteCrowd(contextMenu.id)')
    expect(dialog).toContain("openContextMenu(event, 'camera', camera.id)")
    expect(dialog).toContain('!readOnly && contextMenu && (contextObject || contextCamera || contextCrowd.length > 0)')
    expect(dialog).toContain('nori-canvas-studio-crowd-members')
    expect(dialog).toContain('disabled={readOnly}')
  })

  it('detects actual GLTF skeletons and only enables executable mapped-joint posing', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain('mesh.isSkinnedMesh')
    expect(dialog).toContain('mesh.skeleton.bones')
    expect(dialog).toContain('inspectStudioModelRig(gltf.scene)')
    expect(dialog).toContain('applyStudioModelPose(rig, object)')
    expect(dialog).toContain('runtime.groups.get(object.id) !== wrapper')
    expect(dialog).toContain("'完整'")
    expect(dialog).toContain("'部分匹配'")
    expect(dialog).toContain("'无骨骼'")
    expect(dialog).toContain("disabled={selected?.kind === 'model' && !selectedRigReport?.poseCapable}")
    expect(dialog).toContain("availableJoints={selected.kind === 'model' ? selectedRigJoints : undefined}")
  })

  it('renders and updates the FrameOS pose skeleton with clickable joint handles', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain('function createStudioPoseHelper')
    expect(dialog).toContain("point.userData.studioPoseJointId = joint.id")
    expect(dialog).toContain('updateStudioPoseHelper(runtime')
    expect(dialog).toContain("propertyTabRef.current === 'pose'")
    expect(dialog).toContain('raycaster.intersectObjects(Array.from(runtime.poseHelper.points.values()), false)')
    expect(dialog).toContain('const hit = poseHit || raycaster.intersectObjects')
    expect(dialog).toContain("{ label: '外展', index: 2, min: -90, max: 90 }")
    expect(dialog).toContain('type="range" aria-label={label}')
  })

  it('persists director navigation and exposes the verified FrameOS viewport controls', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const css = source('src/features/canvas/canvas.css')

    expect(dialog).toContain('controls.addEventListener(\'end\', persistDirectorView)')
    expect(dialog).toContain('directorCamera: next')
    expect(dialog).toContain('className="nori-canvas-studio-reset-view"')
    expect(dialog).toContain('aria-label="3D 导演台快捷键帮助"')
    expect(dialog).toContain('V / R / S')
    expect(dialog).toContain('选中对象时相对视角移动物体；未选中时移动导演视角')
    expect(dialog).toContain('选中对象时升降物体；未选中时升降导演视角')
    expect(dialog).toContain('在左侧列表或视口点击机位，可用 Gizmo 拖动位置与旋转')
    expect(dialog).toContain('退出 3D 导演台')
    expect(dialog).toContain('moveStudioPositionRelativeToView(object.position, currentView, navigationKey)')
    expect(dialog).toContain("(key === 's' && (Boolean(selected) || sceneSelectedRef.current))")
    expect(dialog).toContain('if (event.metaKey || event.ctrlKey || event.altKey) return')
    expect(dialog).toContain('title="缩放 S"')
    expect(dialog).toContain('else if (helpOpenRef.current) setHelpOpen(false)')
    expect(dialog).toContain('title="收起参数栏"')
    expect(dialog).toContain('setPropertiesCollapsed(false)')
    expect(css).toContain('.nori-canvas-studio-layout.is-properties-collapsed')
    expect(css.match(/FrameOS 3D director surface/g)).toHaveLength(1)
  })

  it('provides real GLTF surface snapping, camera markers and manual camera aiming', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toContain('target.snapSurface')
    expect(dialog).toContain('snapStudioMannequinToSurface(runtime')
    expect(dialog).toContain('checked={selected.snapSurface === true}')
    expect(dialog).toContain('createStudioCameraMarker(runtime.THREE)')
    expect(dialog).toContain('runtime.transform.attach(cameraGroup)')
    expect(dialog).toContain('手动（坐标/旋转）')
    expect(dialog).toContain('updateCameraRotationAxis(selectedCamera')
    expect(dialog).toContain('directorCaptureCamera = {')
    expect(dialog).toContain('cameraId: camera?.id || null')
  })

  it('matches the camera inspector with live preview and camera-grouped screenshots', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')
    const captures = source('src/features/canvas/components/CanvasStudioCapturePanel.tsx')
    const css = source('src/features/canvas/canvas.css')

    expect(dialog).toContain('aria-label="机位面板"')
    expect(dialog).toContain('摄像机截图')
    expect(dialog).toContain('nori-canvas-studio-camera-preview')
    expect(dialog).toContain('cameraPreviewRuntimeRef.current')
    expect(dialog).toContain("const selectedCameraAspectRatio = selectedCamera?.aspectRatio || 'auto'")
    expect(dialog).toContain('renderStudioCameraFrame(runtime, preview.renderer, preview.camera)')
    expect(dialog).toContain('runtime.cameraGroups.forEach((group) =>')
    expect(dialog).toContain('transformHelper.visible = false')
    expect(dialog).toContain('runtime.poseHelper.root.visible = false')
    expect(captures).toContain('captureGroups.map((group)')
    expect(captures).toContain('nori-canvas-studio-capture-group')
    expect(captures).toContain('group.cameraId === activeCameraId')
    expect(css).toContain('.nori-canvas-studio-inspector-tabs')
    expect(css).toContain('.nori-canvas-studio-camera-preview')
  })

  it('gives the Dutch-angle camera preset an actual non-zero roll', () => {
    const dialog = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(dialog).toMatch(/name: '荷兰角'[^\n]+roll: -(?:[1-9]|[1-9]\d)/)
    expect(dialog).toContain('studioCameraRotationFromTarget(preset.position, preset.target, preset.roll || 0)')
  })

  it('limits uploaded-asset maintenance controls to asset writers', () => {
    const assets = source('src/features/canvas/components/CanvasProjectAssets.tsx')

    expect(assets).toContain("hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])")
    expect(assets).toContain("hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['canvasWrite'])")
    expect(assets).toContain("if (!canEditAssets) return")
    expect(assets).toContain("material.source === 'upload' && canEditAssets")
    expect(assets).toContain('<button type="button" onClick={() => onInsert(material)}>添加</button>')
  })
})
