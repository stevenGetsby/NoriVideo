import { AsyncLocalStorage } from 'node:async_hooks'
import type { UserPromptOverrides } from './user-overrides'

interface PromptContext {
  userId: string
  overrides: UserPromptOverrides
}

export const promptContextStorage = new AsyncLocalStorage<PromptContext>()

export function getActivePromptOverrides(): UserPromptOverrides | null {
  return promptContextStorage.getStore()?.overrides ?? null
}
