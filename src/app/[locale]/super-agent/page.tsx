/**
 * Super Agent 页面
 * 路径: /[locale]/super-agent
 */

'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Navbar from '@/components/Navbar'
import { SuperInputBox } from '@/components/super-agent/SuperInputBox'

export default function SuperAgentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [router, status])

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--glass-bg-canvas)' }}>
        <div style={{ color: 'var(--glass-text-tertiary)' }}>加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--glass-bg-canvas)' }}>
      <Navbar />
      <div className="container mx-auto px-4 py-12">
        {/* 页面标题 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--glass-text-primary)' }}>
            智能视频制作助手
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--glass-text-tertiary)' }}>
            用自然语言描述你的需求，AI 将自动分析、规划并生成完整的视频项目
          </p>
        </div>

        {/* Super Input Box */}
        <SuperInputBox
          locale="zh"
          placeholder="描述你想要的视频，例如：制作一个15秒的数字人口播视频，介绍我们的新产品..."
        />

        {/* 功能说明 */}
        <div className="mt-16 max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold mb-6 text-center" style={{ color: 'var(--glass-text-primary)' }}>
            工作流程
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { num: '1', title: '项目初始化', desc: '创建项目和剧集，配置视频参数' },
              { num: '2', title: '故事分析', desc: '分析角色、场景、道具，切分片段，生成剧本' },
              { num: '3', title: '分镜生成', desc: '生成详细分镜，包括摄影计划和配音行' },
            ].map((item) => (
              <div
                key={item.num}
                className="p-6"
                style={{
                  background: 'var(--glass-bg-surface)',
                  borderRadius: 'var(--glass-radius-md)',
                  border: '1px solid var(--glass-stroke-base)',
                  boxShadow: 'var(--glass-shadow-sm)',
                }}
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: 'var(--glass-tone-info-bg)' }}
                >
                  <span className="text-2xl font-bold" style={{ color: 'var(--glass-tone-info-fg)' }}>
                    {item.num}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--glass-text-primary)' }}>
                  {item.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--glass-text-tertiary)' }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 提示信息 */}
        <div className="mt-12 max-w-4xl mx-auto">
          <div
            className="p-6"
            style={{
              background: 'var(--glass-tone-info-bg)',
              borderRadius: 'var(--glass-radius-md)',
              border: '1px solid var(--glass-stroke-base)',
            }}
          >
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--glass-tone-info-fg)' }}>
              提示
            </h3>
            <ul className="text-sm space-y-1" style={{ color: 'var(--glass-text-secondary)' }}>
              <li>描述越详细，生成的内容越精准</li>
              <li>可以指定视频类型、风格、时长等参数</li>
              <li>生成后可以在工作区中逐帧编辑所有内容</li>
              <li>首次使用请确保已在个人设置中配置 API 密钥</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
