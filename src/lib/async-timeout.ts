export class AsyncTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsyncTimeoutError'
  }
}

export async function withAsyncTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AsyncTimeoutError(message))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
