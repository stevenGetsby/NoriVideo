import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { filterWorksByQuery } from '@/components/frameos/works/work-search'
import {
  excludeExistingMemberCandidates,
  fetchAllMemberCandidates,
} from '@/components/frameos/works/member-candidates'
import { eligibleMoveTargets } from '@/components/frameos/works/move-targets'
import {
  buildMemberChangeSet,
  isProtectedMember,
} from '@/components/frameos/works/member-change-set'
import {
  normalizeWorkProject,
  type WorkSummary,
} from '@/components/frameos/works/types'
import {
  projectAspectRatio,
  projectGenreLabel,
} from '@/components/frameos/works/project-metadata'
import {
  buildMemberCandidateExclusionWhere,
  buildWorkSearchWhere,
} from '@/lib/works/filters'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function work(input: Partial<WorkSummary> & Pick<WorkSummary, 'id' | 'name'>): WorkSummary {
  return {
    createdAt: '',
    updatedAt: '',
    projectCount: input.projects?.length ?? 0,
    projects: [],
    ...input,
  }
}

describe('works search and move contracts', () => {
  it('matches project descriptions as well as work and project names', () => {
    const works = [
      work({
        id: 'work-a',
        name: '北境故事',
        projects: [
          { id: 'project-a', name: '第一集', description: '发生在伦敦的悬疑短剧', createdAt: '', updatedAt: '' },
          { id: 'project-b', name: '第二集', description: '无关内容', createdAt: '', updatedAt: '' },
        ],
      }),
      work({ id: 'work-b', name: '其他项目' }),
    ]

    const result = filterWorksByQuery(works, '  伦敦  ')

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('work-a')
    expect(result[0]?.projects.map((project) => project.id)).toEqual(['project-a'])
  })

  it('only offers manageable, real, non-source works as move targets', () => {
    const targets = eligibleMoveTargets([
      work({ id: 'source', name: '当前项目', canManage: true }),
      work({ id: 'manageable', name: '可管理项目', canManage: true }),
      work({ id: 'read-only', name: '只读项目', canManage: false }),
      work({ id: 'unknown', name: '未知权限' }),
      work({ id: 'virtual', name: '未归属', virtual: true, canManage: true }),
    ], 'source')

    expect(targets.map((target) => target.id)).toEqual(['manageable'])
  })

  it('uses the same project-description search predicate on the server', () => {
    expect(buildWorkSearchWhere('  海外风格  ')).toEqual({
      OR: [
        { name: { contains: '海外风格' } },
        { projects: { some: { OR: [
          { name: { contains: '海外风格' } },
          { description: { contains: '海外风格' } },
        ], deletedAt: null } } },
      ],
    })
    expect(buildWorkSearchWhere('   ')).toBeNull()
  })
})

describe('member candidate completeness and exclusions', () => {
  it('loads every advertised page, preserves search scope and de-duplicates users', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'https://nori.local')
      const page = Number(url.searchParams.get('page'))
      expect(url.searchParams.get('workId')).toBe('work-a')
      expect(url.searchParams.get('keyword')).toBe('张 三')
      expect(url.searchParams.get('pageSize')).toBe('100')
      expect(init?.signal).toBe(controller.signal)
      const payload = page === 1
        ? {
          candidates: [
            { userId: 'user-a', name: '成员 A', role: 'writer' },
            { userId: 'duplicate', name: '旧名称', role: 'asset' },
          ],
          pagination: { totalPages: 2 },
        }
        : {
          candidates: [
            { userId: 'duplicate', name: '新名称', role: 'asset' },
            { userId: 'user-b', name: '成员 B', role: 'storyboard' },
          ],
          pagination: { totalPages: 2 },
        }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const candidates = await fetchAllMemberCandidates({
      path: '/api/works/member-candidates?workId=work-a&limit=20',
      keyword: ' 张 三 ',
      signal: controller.signal,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(candidates.map((candidate) => candidate.id)).toEqual(['user-a', 'duplicate', 'user-b'])
    expect(candidates.find((candidate) => candidate.id === 'duplicate')?.name).toBe('新名称')
  })

  it('removes existing members in the client projection and Prisma query', () => {
    expect(excludeExistingMemberCandidates([
      { id: 'existing', name: '已有成员' },
      { id: 'new', name: '新成员' },
    ], ['existing'])).toEqual([{ id: 'new', name: '新成员' }])

    expect(buildMemberCandidateExclusionWhere({
      actorId: 'actor',
      creatorId: 'creator',
      workId: 'work-a',
      projectId: 'project-a',
    })).toEqual({
      id: { notIn: ['actor', 'creator'] },
      workMemberships: { none: { workId: 'work-a' } },
      projectMemberships: { none: { projectId: 'project-a' } },
    })
  })

  it('stages one save plan and never removes creators or management accounts', () => {
    const members = [
      { userId: 'creator', name: '创建人', role: 'creator', isCreator: true, canRemove: false },
      { userId: 'admin', name: '管理账号', accountRole: 'admin', canRemove: true },
      { userId: 'writer', name: '编剧账号', accountRole: 'writer', canRemove: true },
    ]
    const changeSet = buildMemberChangeSet(members, [
      { id: 'asset', name: '资产账号', role: 'asset' },
      { id: 'asset', name: '重复资产账号', role: 'asset' },
      { id: 'writer', name: '已有编剧', role: 'writer' },
    ], ['creator', 'admin', 'writer'])

    expect(changeSet.additions.map((member) => member.id)).toEqual(['asset'])
    expect(changeSet.removals.map((member) => member.userId)).toEqual(['writer'])
    expect(isProtectedMember(members[0]!)).toBe(true)
    expect(isProtectedMember(members[1]!)).toBe(true)
    expect(isProtectedMember(members[2]!)).toBe(false)
  })
})

describe('works surface wiring', () => {
  it('matches the evidenced collapsed works grid and compact empty/search states', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const dialogs = readSource('src/components/frameos/works/FosWorksDialogs.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(client).toContain('没有匹配「{searchQuery}」的项目或作品')
    expect(styles).toContain('grid-template-columns: repeat(auto-fill,minmax(220px,231px))')
    expect(styles).toContain('.works-project-body.is-empty { display: flex; min-height: 112px;')
    expect(styles).toMatch(/\.works-project-canvas-entry\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/)
    expect(styles).toContain('transform: translateY(-4px)')
    expect(styles).toContain('transform: translateY(-4px) scale(1.04)')
    expect(styles).not.toContain('@keyframes works-card-in')
    expect(dialogs).toContain('className="works-member-search"')
    expect(dialogs).toContain('placeholder="搜索并添加成员"')
    expect(dialogs).not.toContain('className="fos-input pl-9"')
    expect(styles).toContain('.works-member-search > .fos-input { padding-left: 36px; padding-right: 12px; }')
    expect(dialogs).toContain('{open ? <div id={listboxId} className="works-candidate-list" role="listbox"')
    expect(dialogs).toContain('if (!open) {')
    expect(dialogs).toContain('onFocusCapture={() => setOpen(true)}')
    expect(dialogs).toContain("title={projects.length > 1 ? '批量移动作品' : '移动作品'}")
    expect(dialogs).toContain('搜索并选择目标项目')
    expect(dialogs).toContain('>确定</button>')
    expect(dialogs).toContain('disabled={saving || loading || !hasChanges}')
    expect(dialogs).toContain('<span className="works-role-badge">管理员</span>')
    expect(dialogs).toContain("method: 'POST'")
    expect(dialogs).toContain("method: 'DELETE'")
    expect(styles).toContain('.works-member-row.is-pending-removal')
  })

  it('clears both the works search draft and applied query with Escape', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')

    expect(client).toContain("if (event.key !== 'Escape') return")
    expect(client).toContain("setSearchInput('')")
    expect(client).toContain("setSearchQuery('')")
    expect(client).toContain('onClick={clearSearch}')
  })

  it('uses real project metadata and preserves FrameOS empty-field behavior', () => {
    const normalized = normalizeWorkProject({
      id: 'project-a',
      name: '作品 A',
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      budget_level: 'premium2',
      budget_level_name: '海外精品版',
      genre_name: '都市悬疑',
      aspect_ratio: '16:9',
      art_style: 'live-action',
    })

    expect(normalized).toMatchObject({
      budgetLevel: 'premium2',
      budgetLevelName: '海外精品版',
      genreName: '都市悬疑',
      aspectRatio: '16:9',
      artStyle: 'live-action',
    })
    expect(projectGenreLabel(normalized!)).toBe('都市悬疑')
    expect(projectAspectRatio(normalized!)).toBe('16:9')
    expect(projectGenreLabel({ id: 'empty', name: '空作品', createdAt: '', updatedAt: '' })).toBe('未分类')
    expect(projectAspectRatio({ id: 'empty', name: '空作品', createdAt: '', updatedAt: '' })).toBeNull()
    expect(projectGenreLabel({
      id: 'narration',
      name: '解说作品',
      createdAt: '',
      updatedAt: '',
      novelPromotionData: { contentType: 'narration', workflowMode: 'narration' },
    })).toBe('解说模式')
    expect(normalizeWorkProject({
      id: 'narration-normalized',
      name: '结构化解说作品',
      novel_promotion_data: {
        content_type: 'narration',
        material_type: 'novel-outline',
        target_episode_count: 24,
        workflow_mode: 'narration',
        _count: { episodes: 15 },
      },
    })?.novelPromotionData).toMatchObject({
      contentType: 'narration',
      materialType: 'novel-outline',
      targetEpisodeCount: 24,
      workflowMode: 'narration',
      episodeCount: 15,
    })
  })

  it('wires accessible project menus without hiding the canvas entry', () => {
    const panels = readSource('src/components/frameos/works/FosWorkPanels.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(panels).toContain('role="menu"')
    expect(panels).toContain('role="menuitem"')
    expect(panels).toContain("event.key === 'Escape'")
    expect(panels).toContain("if (!menuOpen) onToggleMenu()")
    expect(panels).toContain("if (menuOpen) onToggleMenu()")
    expect(panels).not.toContain('onMouseEnter={() => { if (!menuOpen) onToggleMenu() }}')
    expect(panels).toContain('<ViewportPopover anchorRef={menuTrigger}')
    expect(panels).not.toContain('onMouseLeave={() => { if (menuOpen) onToggleMenu() }}')
    expect(panels).toContain('data-testid="project-card-canvas-entry"')
    expect(styles).toContain('.works-project-card:focus-within .works-project-menu-wrap')
    expect(styles).toContain('.fos-menu-item:focus-visible')
  })

  it('matches the updated batch-move controls and project edition tones', () => {
    const panels = readSource('src/components/frameos/works/FosWorkPanels.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(panels).toContain('className="works-batch-count">已选 <strong>{selectedProjectIds.length}</strong> 项')
    expect(panels).toContain('>全选</button>')
    expect(panels).toContain('>清空</button>')
    expect(panels).toContain('批量移动作品')
    expect(panels).toContain("if (!level) return ' is-toolbox'")
    expect(panels).toContain("if (level === 'efficient') return ' is-efficient'")
    expect(styles).toContain('.works-project-edition.is-efficient')
    expect(styles).toContain('.works-project-edition.is-toolbox')
  })

  it('keeps stable totals while using matched totals for server pagination', () => {
    const client = readSource('src/components/frameos/FosProjectsClient.tsx')
    const service = readSource('src/lib/works/service.ts')

    expect(client).toContain('filterWorksByQuery(works, searchQuery)')
    expect(client).toContain('<span>{worksTotal} 个项目</span>')
    expect(service).toContain('const matchedTotal = searchedTotal ?? total')
    expect(service).toContain('totalPages: Math.ceil(matchedTotal / pageSize)')
  })

  it('locks the complete project payload synchronously during submission', () => {
    const dialog = readSource('src/components/frameos/CreateProjectDialog.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(dialog).toContain('const submittingRef = useRef(false)')
    expect(dialog).toContain('if (submittingRef.current) return')
    expect(dialog).toContain('submittingRef.current = true')
    expect(dialog).toContain('submittingRef.current = false')
    expect(dialog).toContain('aria-busy={submitting}')
    expect(dialog).toContain('<fieldset className="create-project-payload-fields" disabled={submitting}>')
    expect(dialog).toContain('if (submittingRef.current || !file) return')
    expect(styles).toContain('.create-project-payload-fields { display: contents; }')
  })
})
