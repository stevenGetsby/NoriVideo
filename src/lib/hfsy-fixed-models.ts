import { composeModelKey } from '@/lib/model-config-contract'

export const HFSY_PROVIDER_ID = 'hfsy'
export const HFSY_TEXT_MODEL_ID = 'gpt-5.5'
export const HFSY_IMAGE_MODEL_ID = 'gpt-image-2'
export const HFSY_VIDEO_MODEL_ID = 'sd-2-vip'

export const HFSY_TEXT_MODEL_KEY = composeModelKey(HFSY_PROVIDER_ID, HFSY_TEXT_MODEL_ID)
export const HFSY_IMAGE_MODEL_KEY = composeModelKey(HFSY_PROVIDER_ID, HFSY_IMAGE_MODEL_ID)
export const HFSY_VIDEO_MODEL_KEY = composeModelKey(HFSY_PROVIDER_ID, HFSY_VIDEO_MODEL_ID)
