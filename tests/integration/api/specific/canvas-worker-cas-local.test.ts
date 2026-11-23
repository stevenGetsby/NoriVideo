import { expect, it, vi } from 'vitest'
import { waitForTaskTerminalState } from '../../../system/helpers/tasks'

const external = vi.hoisted(() => ({ generate: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/workers/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workers/utils')>(),
  resolveVideoSourceFromGeneration: external.generate,
  uploadVideoSourceToCos: external.upload,
}))
vi.mock('@/lib/workers/video-poster-warmup', () => ({ warmVideoPoster: vi.fn() }))

// Run the real queue, worker lifecycle and MySQL writes, substituting only
// provider and storage I/O. Never use the app's normal database or queue.
it.skipIf(process.env.NORI_ISOLATED_CANVAS_RACE_DB !== '1')(
  'preserves a real queued worker result and both edits through the actual MySQL revision CAS',
  async () => {
    const url = new URL(process.env.DATABASE_URL || '')
    const socket = url.searchParams.get('socket')
    if (url.protocol !== 'mysql:' || url.hostname !== 'localhost' || url.pathname !== '/nori_canvas_race'
      || !socket || !/^\/tmp\/nori-canvas-race-[^/]+\/mysql\.sock$/.test(socket)) {
      throw new Error('Use a disposable nori_canvas_race database on an isolated Unix socket.')
    }
    const { prisma } = await import('@/lib/prisma')
    if (process.env.REDIS_HOST !== '127.0.0.1' || !/^\d+$/.test(process.env.NORI_CANVAS_RACE_REDIS_PID || '')) {
      throw new Error('Use the disposable Redis process started by the canvas fixture script.')
    }
    const { redis, queueRedis } = await import('@/lib/redis')
    const { addTaskJob, getQueueByType } = await import('@/lib/task/queues')
    const { createVideoWorker } = await import('@/lib/workers/video.worker')
    let worker: ReturnType<typeof createVideoWorker> | undefined
    let finishGeneration: () => void = () => undefined
    try {
      expect(await redis.info('server')).toContain(`process_id:${process.env.NORI_CANVAS_RACE_REDIS_PID}\r\n`)
      const [server] = await prisma.$queryRaw<{ noNetwork: number | bigint; dbName: string }[]>
        `SELECT @@skip_networking AS noNetwork, DATABASE() AS dbName`
      expect(Number(server.noNetwork)).toBe(1)
      expect(server.dbName).toBe('nori_canvas_race')
      const { applyCanvasOperationsInTransaction } = await import('@/lib/canvas/persistence')
      const { readCanvasNodeSummaries } = await import('@/lib/canvas/summary-db-reader')
      const user = await prisma.user.create({ data: { name: `synthetic-race-${crypto.randomUUID()}` } })
      const work = await prisma.work.create({ data: { name: '合成项目', workspaceOwnerId: user.id, createdById: user.id } })
      const project = await prisma.project.create({ data: { name: '合成作品', userId: user.id, workId: work.id, createdById: user.id, creationMode: 'canvas' } })
      const canvas = await prisma.canvas.create({ data: { title: '合成画布并发', projectId: project.id, userId: user.id } })
      const asset = await prisma.frameosToolboxAsset.create({
        data: { userId: user.id, projectId: project.id, type: 'video', status: 'processing' },
      })
      const task = await prisma.task.create({ data: {
        userId: user.id, projectId: project.id, type: 'toolbox_video', status: 'queued',
        targetType: 'FrameosToolboxAsset', targetId: asset.id, progress: 47,
      } })
      const oldHistory = { id: 'synthetic-previous', status: 'ready', prompt: '旧历史。'.repeat(10_000), createdAt: '2026-11-21T00:00:00.000Z' }
      const video = await prisma.canvasNode.create({ data: {
        canvasId: canvas.id, type: 'video', position: { x: 31, y: 42 }, size: { width: 200, height: 100 },
        status: 'RUNNING', taskId: task.id,
        data: { title: '合成视频', history: [oldHistory, { id: 'synthetic-current', status: 'processing', assetId: asset.id }], generation: { assetId: asset.id, taskId: task.id } },
      } })
      const text = await prisma.canvasNode.create({ data: {
        canvasId: canvas.id, type: 'text', position: { x: 400, y: 42 }, data: { text: '原文' },
      } })
      const initial = (await readCanvasNodeSummaries(project.id, canvas.id)).find((node) => node.id === video.id)!
      expect(initial.status).toBe('RUNNING')
      expect(initial.data).not.toHaveProperty('history')

      const save = (input: Parameters<typeof applyCanvasOperationsInTransaction>[1]['input']) =>
        prisma.$transaction((tx) => applyCanvasOperationsInTransaction(tx, {
          projectId: project.id, canvasId: canvas.id, userId: user.id, input, deltaOnly: true,
        }))
      const terminalKey = 'video/synthetic-terminal.mp4'
      const providerGate = new Promise<void>((resolve) => { finishGeneration = resolve })
      external.generate.mockImplementation(async () => {
        await providerGate
        return { url: 'https://provider.example/synthetic-terminal.mp4' }
      })
      external.upload.mockResolvedValue(terminalKey)
      worker = createVideoWorker()
      await worker.waitUntilReady()
      const job = await addTaskJob({
        taskId: task.id, type: 'toolbox_video', userId: user.id, projectId: project.id,
        targetType: task.targetType, targetId: asset.id, locale: 'zh',
        payload: { canvasId: canvas.id, nodeId: video.id, prompt: '合成视频提示词', videoModel: 'nori::seedance2.0', textOnly: true },
      }, { attempts: 1 })
      await vi.waitFor(() => expect(external.generate).toHaveBeenCalledTimes(1), { timeout: 7000 })
      const b = await save({ expectedRevision: 0, clientId: 'tab-B', changeSummary: null, ops: [{
        type: 'node.upsert', node: {
          id: text.id, type: 'text', position: { x: 400, y: 42 }, size: null,
          status: text.status, taskId: null, runId: null, mediaObjectId: null, parentNodeId: null, data: { text: '标签 B 保留的正文' },
        },
      }] })
      expect(b.canvas.revision).toBe(1)

      finishGeneration()
      expect(await waitForTaskTerminalState(task.id)).toMatchObject({ status: 'completed', errorMessage: null })
      await vi.waitFor(async () => expect(await job.getState()).toBe('completed'))
      const confirmed = await prisma.canvasNode.findUniqueOrThrow({ where: { id: video.id } })
      expect(confirmed).toMatchObject({ status: 'SUCCEEDED', data: { contentUrl: terminalKey } })
      const terminal = (await readCanvasNodeSummaries(project.id, canvas.id)).find((node) => node.id === video.id)!
      expect(terminal.status).toBe('SUCCEEDED')
      expect(terminal.detailVersion).not.toBe(initial.detailVersion)
      const a = { expectedRevision: 0, clientId: 'tab-A', changeSummary: null, ops: [
        { type: 'node.update_geometry' as const, id: video.id, position: { x: 311, y: 424 } },
      ] }
      await expect(save(a)).rejects.toMatchObject({ code: 'CONFLICT' })
      const rebased = await save({ ...a, expectedRevision: 1 })
      expect(rebased.canvas.revision).toBe(2)
      expect(rebased.delta.nodes).toEqual([])
      expect(rebased.delta.geometry).toEqual([{ id: video.id, position: { x: 311, y: 424 } }])
      const final = await prisma.canvasNode.findUniqueOrThrow({ where: { id: video.id } })
      expect(final.data).toEqual(confirmed.data)
      expect(final.data).toMatchObject({ contentUrl: terminalKey, history: [oldHistory, expect.objectContaining({ status: 'ready', url: terminalKey })] })
      expect((await prisma.canvasNode.findUniqueOrThrow({ where: { id: text.id } })).data).toEqual({ text: '标签 B 保留的正文' })
    } finally {
      finishGeneration()
      await worker?.close()
      await getQueueByType('video').close()
      redis.disconnect()
      queueRedis.disconnect()
      await prisma.$disconnect()
    }
  },
)
