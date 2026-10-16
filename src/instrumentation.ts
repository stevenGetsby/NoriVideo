export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge' || process.env.NODE_ENV !== 'production'
    || process.env.NORI_APP_SURFACE === 'admin' || process.env.SERVICE_MODE === 'web') {
    return
  }

  const { registerProductionInstrumentation } = await import('./instrumentation-runtime')
  await registerProductionInstrumentation()
}
