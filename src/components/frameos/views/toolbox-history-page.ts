export const TOOLBOX_HISTORY_PAGE_SIZE = 12

export function formatToolboxHistoryPageLabel(page: number, total: number | null) {
  if (total === null) return `第 ${page} 页 · 每页 ${TOOLBOX_HISTORY_PAGE_SIZE} 条`
  const pageCount = Math.max(1, Math.ceil(total / TOOLBOX_HISTORY_PAGE_SIZE))
  return `第 ${Math.min(page, pageCount)} / ${pageCount} 页 · 共 ${total} 条 · 每页 ${TOOLBOX_HISTORY_PAGE_SIZE} 条`
}
