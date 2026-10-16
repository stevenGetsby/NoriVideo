import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack(config, { dev }) {
    // A local mirror may live on an iCloud-managed Desktop. Keep regenerable
    // webpack cache on an explicitly selected local disk instead of restoring
    // dataless cache packs. Production builds keep their existing defaults.
    const localCacheDir = process.env.NORI_LOCAL_CACHE_DIR?.trim()
    if (dev && localCacheDir && config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem') {
      config.cache.cacheDirectory = path.join(path.resolve(localCacheDir), config.name || 'default')
    }
    return config
  },
  // Next 15 的 allowedDevOrigins 是顶层配置，不属于 experimental
  allowedDevOrigins: [
    'http://192.168.31.218:3000',
    'http://192.168.31.*:3000',
  ],
  experimental: {
    /**
     * Middleware 会把请求体克隆一份交给 Edge 运行时，Next 默认只克隆前
     * 10MB，超出部分被静默丢弃，导致 /api/frameos/materials 等多部分表单
     * 上传在 request.formData() 处报 "Failed to parse body as FormData."。
     * 这里放开到 220MB，覆盖素材上传接口自身的 200MB 单个文件上限。
     * 单文件上限仍以各路由内的校验为准。
     */
    middlewareClientMaxBodySize: '220mb',
  },
};

export default withNextIntl(nextConfig);
