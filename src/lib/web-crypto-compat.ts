// `crypto.randomUUID` is secure-context only, so plain-HTTP deployments lose it
// and every canvas node creation throws "crypto.randomUUID is not a function".
function randomUuidV4() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

if (typeof window !== 'undefined' && typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, writable: true, value: randomUuidV4 })
}
