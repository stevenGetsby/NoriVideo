/** Ignore reads started before a newer read or a successful mutation. */
export function createLatestRequestTracker() {
  let revision = 0
  return {
    begin: () => ++revision,
    invalidate: () => { revision += 1 },
    isCurrent: (request: number) => request === revision,
  }
}
