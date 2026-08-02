import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { ALL_ACCOUNT_PERMISSIONS } from '../src/lib/account/permissions'

const prisma = new PrismaClient()

async function main() {
  const username = (process.env.NORI_OWNER_USERNAME || process.argv[2] || 'xyz').trim()
  const password = process.env.NORI_OWNER_PASSWORD || ''
  if (!username) throw new Error('NORI_OWNER_USERNAME is required')

  const existing = await prisma.user.findUnique({ where: { name: username } })
  const existingPlatformAdmin = await prisma.user.findFirst({
    where: { role: 'super_admin' },
    select: { id: true, name: true },
  })
  if (existingPlatformAdmin && existingPlatformAdmin.name !== username) {
    throw new Error(`Platform Admin already exists: ${existingPlatformAdmin.name}`)
  }
  if (!existing && password.length < 8) {
    throw new Error('A new management account requires NORI_OWNER_PASSWORD with at least 8 characters')
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined
  const owner = await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            role: 'super_admin',
            status: 'active',
            permissions: ALL_ACCOUNT_PERMISSIONS,
            workspaceOwnerId: null,
            parentAccountId: null,
            ...(passwordHash ? { password: passwordHash, sessionVersion: { increment: 1 } } : {}),
          },
        })
      : await tx.user.create({
          data: {
            name: username,
            password: passwordHash,
            role: 'super_admin',
            status: 'active',
            permissions: ALL_ACCOUNT_PERMISSIONS,
            workspaceOwnerId: null,
            parentAccountId: null,
          },
        })

    await tx.userBalance.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0,
      },
      update: {},
    })

    await tx.user.updateMany({
      where: {
        id: { not: user.id },
        role: 'admin',
      },
      data: {
        status: 'active',
        permissions: ALL_ACCOUNT_PERMISSIONS,
        workspaceOwnerId: null,
        parentAccountId: user.id,
      },
    })

    await tx.user.updateMany({
      where: {
        id: { not: user.id },
        workspaceOwnerId: null,
        role: { in: ['writer', 'asset', 'storyboard'] },
      },
      data: {
        role: 'writer',
        status: 'active',
        permissions: ['read', 'scriptWrite'],
        workspaceOwnerId: user.id,
        parentAccountId: user.id,
      },
    })
    await tx.user.updateMany({
      where: {
        id: { not: user.id },
        workspaceOwnerId: user.id,
        parentAccountId: null,
        role: { in: ['writer', 'asset', 'storyboard'] },
      },
      data: { parentAccountId: user.id },
    })
    return user
  })

  process.stdout.write(`Platform Admin ready: ${owner.name}\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
