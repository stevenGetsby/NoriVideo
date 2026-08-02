import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/crypto-utils'
import { getServiceSeedanceAssetsConfig, getServiceStorageConfig } from '@/lib/service-config'

export interface SeedanceAssetsConfig {
  accessKeyId: string
  secretAccessKey: string
  projectName: string
}

function readUsableSecret(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (!normalized || !/^[\x20-\x7E]+$/.test(normalized)) return ''
  if (/^(?:your[-_ ]|placeholder$|replace[-_ ]?me$)/i.test(normalized)) return ''
  return normalized
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

  const projectName = (pref?.arkAssetsProjectName || 'default').trim() || 'default'
  const encryptedAk = readUsableSecret(pref?.arkAssetsAccessKeyId)
  const encryptedSk = readUsableSecret(pref?.arkAssetsSecretAccessKey)
  if (encryptedAk && encryptedSk) {
    return {
      accessKeyId: decryptApiKey(encryptedAk),
      secretAccessKey: decryptApiKey(encryptedSk),
      projectName,
    }
  }

  const platformAssets = getServiceSeedanceAssetsConfig()
  const assetsAk = readUsableSecret(platformAssets?.accessKeyId)
  const assetsSk = readUsableSecret(platformAssets?.secretAccessKey)
  if (assetsAk && assetsSk) {
    return {
      accessKeyId: assetsAk,
      secretAccessKey: assetsSk,
      projectName: readUsableSecret(platformAssets?.projectName) || projectName,
    }
  }

  const environmentAssetsAk = readUsableSecret(process.env.ARK_ASSETS_ACCESS_KEY_ID)
  const environmentAssetsSk = readUsableSecret(process.env.ARK_ASSETS_SECRET_ACCESS_KEY)
  if (environmentAssetsAk && environmentAssetsSk) {
    return {
      accessKeyId: environmentAssetsAk,
      secretAccessKey: environmentAssetsSk,
      projectName: readUsableSecret(process.env.ARK_ASSETS_PROJECT_NAME) || projectName,
    }
  }

  // CreateAsset and TOS can use the same Volcengine IAM AK/SK. This final
  // fallback keeps existing single-credential deployments working.
  const platformTos = getServiceStorageConfig()?.tos
  const platformAk = readUsableSecret(platformTos?.accessKey)
  const platformSk = readUsableSecret(platformTos?.secretKey)
  if (platformAk && platformSk) {
    return {
      accessKeyId: platformAk,
      secretAccessKey: platformSk,
      projectName,
    }
  }

  const environmentAk = readUsableSecret(process.env.TOS_ACCESS_KEY)
  const environmentSk = readUsableSecret(process.env.TOS_SECRET_KEY)
  if (environmentAk && environmentSk) {
    return {
      accessKeyId: environmentAk,
      secretAccessKey: environmentSk,
      projectName,
    }
  }

  throw new Error('SEEDANCE_ASSETS_CONFIG_REQUIRED: 请在管理平台配置具备 CreateAsset 权限的 TOS AK/SK')
}
