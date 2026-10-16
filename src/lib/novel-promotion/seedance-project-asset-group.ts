import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'
import type { SeedanceAssetsApi } from '@/lib/volcengine/seedance-assets-client'

const GROUP_NAME_MAX_LENGTH = 64

function cleanGroupName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function seedanceProjectAssetGroupName(input: {
  projectId: string
  projectName: string
}): string {
  const suffix = input.projectId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'project'
  const prefix = cleanGroupName(input.projectName) || '未命名项目'
  const tail = ` · Nori项目素材 · ${suffix}`
  return `${prefix.slice(0, Math.max(1, GROUP_NAME_MAX_LENGTH - tail.length))}${tail}`
}

function listedGroups(result: Awaited<ReturnType<SeedanceAssetsApi['listAssetGroups']>>) {
  return result.AssetGroups || result.Groups || result.Items || []
}

/**
 * A Seedance asset group belongs to the Nori project, not to a character or a
 * single uploaded material. The row lock prevents the app and worker from
 * creating two groups for the same project concurrently.
 */
export async function ensureSeedanceProjectAssetGroup(input: {
  projectId: string
  volcengineProjectName: string
  client: SeedanceAssetsApi
  ownershipScope?: string
}): Promise<string> {
  const scope = input.ownershipScope || input.volcengineProjectName
  const current = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      deletedAt: true,
      seedanceAssetGroupId: true,
      seedanceAssetsProjectName: true,
    },
  })
  if (!current) throw new Error('SEEDANCE_ASSET_PROJECT_NOT_FOUND: 项目不存在')
  if (current.deletedAt) throw new Error('SEEDANCE_ASSET_PROJECT_NOT_FOUND: 项目已删除')
  if (
    current.seedanceAssetGroupId
    && current.seedanceAssetsProjectName === scope
  ) {
    return current.seedanceAssetGroupId
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${input.projectId} FOR UPDATE`
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        seedanceAssetGroupId: true,
        seedanceAssetsProjectName: true,
      },
    })
    if (!project) throw new Error('SEEDANCE_ASSET_PROJECT_NOT_FOUND: 项目不存在')
    if (project.deletedAt) throw new Error('SEEDANCE_ASSET_PROJECT_NOT_FOUND: 项目已删除')
    if (
      project.seedanceAssetGroupId
      && project.seedanceAssetsProjectName === scope
    ) {
      return project.seedanceAssetGroupId
    }

    const legacyName = seedanceProjectAssetGroupName({
      projectId: project.id,
      projectName: project.name,
    })
    // Kuaizi has no ProjectName isolation. Match only a full project/account-scoped name.
    const suffix = createHash('sha256').update(JSON.stringify([scope, project.id])).digest('hex').slice(0, 24)
    const groupName = input.ownershipScope ? `${legacyName.slice(0, 39)}-${suffix}` : legacyName
    const groups = await input.client.listAssetGroups({
      projectName: input.volcengineProjectName,
      pageSize: 20,
    })
    let groupId = listedGroups(groups).find((group) => group.Name === groupName)?.Id || ''
    if (!groupId) {
      const created = await input.client.createAssetGroup({
        name: groupName,
        description: `Nori project asset group for ${project.name} (${project.id})`,
        projectName: input.volcengineProjectName,
      })
      groupId = created.Id
    }
    if (!groupId) throw new Error('CreateAssetGroup did not return group id')

    await tx.project.update({
      where: { id: project.id },
      data: {
        seedanceAssetGroupId: groupId,
        seedanceAssetsProjectName: scope,
      },
    })
    return groupId
  }, { timeout: 30_000 })
}
