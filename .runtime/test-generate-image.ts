import { getOrCreateTestModeSession, getTestModeModelKeys } from '../src/lib/test-mode'
import { generateImage } from '../src/lib/generator-api'
import { prisma } from '../src/lib/prisma'

async function main() {
  try {
    const session = await getOrCreateTestModeSession()
    const { imageModel } = getTestModeModelKeys()
    const result = await generateImage(
      session.user.id,
      imageModel,
      '商品摄影棚风格，一只浅色帆布托特包，正面有可爱的狗狗图案，干净白色背景，柔和自然光，高级电商商品图，1024x1024',
      { size: '1024x1024', responseFormat: 'b64_json' },
    )

    console.log(JSON.stringify({
      success: result.success,
      hasImageUrl: Boolean(result.imageUrl),
      imageUrlPrefix: result.imageUrl?.slice(0, 32),
      imageBase64Length: result.imageBase64?.length || 0,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

void main()
