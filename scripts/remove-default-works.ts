import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const LEGACY_DEFAULT_WORK_NAME = '默认作品'

function replacementWorkName(projects: Array<{ name: string }>) {
  const firstName = projects[0]?.name.trim() || '项目'
  if (projects.length <= 1) return firstName.slice(0, 50)
  return `${firstName} 等 ${projects.length} 个项目`.slice(0, 50)
}

async function main() {
  const legacyWorks = await prisma.work.findMany({
    where: { name: LEGACY_DEFAULT_WORK_NAME },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      workspaceOwnerId: true,
      projects: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      },
    },
  })

  let removed = 0
  let movedProjects = 0
  for (const legacyWork of legacyWorks) {
    await prisma.$transaction(async (tx) => {
      let targetWork = await tx.work.findFirst({
        where: {
          workspaceOwnerId: legacyWork.workspaceOwnerId,
          id: { not: legacyWork.id },
          name: { not: LEGACY_DEFAULT_WORK_NAME },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })

      if (!targetWork && legacyWork.projects.length > 0) {
        targetWork = await tx.work.create({
          data: {
            workspaceOwnerId: legacyWork.workspaceOwnerId,
            createdById: legacyWork.workspaceOwnerId,
            name: replacementWorkName(legacyWork.projects),
            members: {
              create: {
                userId: legacyWork.workspaceOwnerId,
                role: 'manager',
                canManage: true,
              },
            },
          },
          select: { id: true },
        })
      }

      if (targetWork && legacyWork.projects.length > 0) {
        const moved = await tx.project.updateMany({
          where: { workId: legacyWork.id },
          data: { workId: targetWork.id },
        })
        movedProjects += moved.count
      }

      const deleted = await tx.work.deleteMany({
        where: {
          id: legacyWork.id,
          projects: { none: {} },
        },
      })
      if (deleted.count !== 1) {
        throw new Error(`Legacy default work ${legacyWork.id} could not be removed safely.`)
      }
      removed += 1
    })
  }

  process.stdout.write(JSON.stringify({ removed, movedProjects }) + '\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
