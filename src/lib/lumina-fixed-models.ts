import { composeModelKey } from '@/lib/model-config-contract'

export const LUMINA_PROVIDER_ID = 'lumina'
export const LUMINA_GPT55_MODEL_ID = 'gpt-5.5'
export const LUMINA_GPT55_MODEL_KEY = composeModelKey(LUMINA_PROVIDER_ID, LUMINA_GPT55_MODEL_ID)
