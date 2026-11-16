import { randomBytes } from 'crypto'
import { MP_CHANNEL_CODE_LENGTH, MP_SHARE_ID_LENGTH, MP_SLUG_LENGTH } from './constants'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
// 小写 base32，去掉容易混淆的 0/1/l/o
const BASE32 = '23456789abcdefghijkmnpqrstuvwxyz'

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export function newSlug(): string {
  return randomFrom(BASE62, MP_SLUG_LENGTH)
}

export function newShareId(): string {
  return randomFrom(BASE62, MP_SHARE_ID_LENGTH)
}

export function newChannelCode(): string {
  return randomFrom(BASE32, MP_CHANNEL_CODE_LENGTH)
}

export function isShareId(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9A-Za-z]{${MP_SHARE_ID_LENGTH}}$`).test(value)
}

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9A-Za-z]{${MP_SLUG_LENGTH}}$`).test(value)
}

export function isChannelCode(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[${BASE32}]{${MP_CHANNEL_CODE_LENGTH}}$`).test(value)
}

/** 昵称默认值：观众 + openid 前 6 位的 base62 化。 */
export function defaultNickname(openid: string): string {
  const head = openid.slice(0, 6)
  let out = ''
  for (const char of head) {
    const code = char.charCodeAt(0)
    out += BASE62[code % 62]
  }
  return `观众${out}`
}
