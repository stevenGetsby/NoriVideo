import { expect, it } from 'vitest'
import { parseCanvasAgentRecording } from '../../helpers/canvas-agent-recording'

const part = { reportedModelId: 'vendor-model-v1', stream: 'data: {"type":"fixture-event"}\n\n' }
const valid = { source: 'provider-capture', providerId: 'openai', modelId: 'vendor-model-v1', first: part, followUp: part }

it('accepts only the minimal review envelope, not raw HTTP headers, keys or synthetic fixtures', () => {
  expect(parseCanvasAgentRecording(JSON.stringify(valid))).toEqual(valid)
  for (const invalid of [
    { ...valid, source: 'synthetic' },
    { ...valid, headers: { Authorization: 'secret' } },
    { ...valid, first: { ...part, stream: 'Authorization: Bearer private-token' } },
    { ...valid, modelId: 'https://example.invalid' },
    { ...valid, followUp: { ...part, stream: 'data: {"text":"sk-private-secret-value"}\n\n' } },
  ]) expect(() => parseCanvasAgentRecording(JSON.stringify(invalid))).toThrow('脱敏录制')
})
