export class CanvasAgentToolError extends Error {
  constructor(readonly reason: string, readonly detail = '') {
    super(detail ? `${reason}: ${detail}` : reason)
    this.name = 'CanvasAgentToolError'
  }
}
