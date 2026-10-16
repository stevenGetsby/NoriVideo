// Browser-only adapter: production keeps the real next-auth/react imports.
// The isolated preview never sends credentials to a business/production API.
export async function signIn(_provider: string, options: Record<string, unknown>) {
  const response = await fetch('/__fixture/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  return await response.json()
}
export async function getSession() {
  return await (await fetch('/__fixture/auth/session')).json()
}
