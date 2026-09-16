export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge' || process.env.NODE_ENV !== 'production') {
    return
  }

  const { registerProductionInstrumentation } = await import('./instrumentation-runtime')
  await registerProductionInstrumentation()
}
