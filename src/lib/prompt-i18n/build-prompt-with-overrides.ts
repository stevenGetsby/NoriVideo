import { buildPrompt } from './build-prompt'
import { loadUserPromptOverrides, resolveUserTemplateOverride } from './user-overrides'
import type { BuildPromptInput } from './types'

/**
 * buildPrompt 的增强版本，自动从数据库加载用户的自定义 prompt 模板覆盖。
 * 如果用户为对应的 promptId + locale 设置了自定义模板，优先使用自定义模板。
 * 否则回退到默认文件模板。
 */
export async function buildPromptWithUserOverrides(
  userId: string,
  input: BuildPromptInput,
): Promise<string> {
  const overrides = await loadUserPromptOverrides(userId)
  const override = resolveUserTemplateOverride(overrides, input.promptId, input.locale)

  return buildPrompt({
    ...input,
    templateOverride: override || input.templateOverride,
  })
}
