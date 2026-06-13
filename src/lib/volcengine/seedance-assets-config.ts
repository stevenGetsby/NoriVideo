import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/crypto-utils'

export interface SeedanceAssetsConfig {
  accessKeyId: string
  secretAccessKey: string
  projectName: string
}

export async function getSeedanceAssetsConfig(userId: string): Promise<SeedanceAssetsConfig> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      arkAssetsAccessKeyId: true,
      arkAssetsSecretAccessKey: true,
      arkAssetsProjectName: true,
    },
  })

  const encryptedAk = pref?.arkAssetsAccessKeyId || ''
  const encryptedSk = pref?.arkAssetsSecretAccessKey || ''
  if (!encryptedAk || !encryptedSk) {
    throw new Error('SEEDANCE_ASSETS_CONFIG_REQUIRED: 请先在个人配置里填写火山素材库 AK/SK')
  }

  return {
    accessKeyId: decryptApiKey(encryptedAk),
    secretAccessKey: decryptApiKey(encryptedSk),
    projectName: (pref?.arkAssetsProjectName || 'default').trim() || 'default',
  }
}
