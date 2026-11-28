import type { CanvasAgentCandidate, CanvasAgentProvider } from './model-catalog'

// Kept separate from the ordinary generation provider contract: registering
// a chat transport here must not expose it to any other feature.
export const CANVAS_AGENT_PROVIDER_PRESETS: Record<CanvasAgentProvider, { name: string; baseURL: string; envKey: string }> = {
  openlux: { name: 'OpenLux API', baseURL: 'https://api.openlux.ai/v1', envKey: 'OPENLUX_API_KEY' },
  openai: { name: 'OpenAI 官方', baseURL: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY' },
}

// Do not mark a model verified based only on its protocol documentation.
// Registration needs a reviewed recording of that model's tool stream.
export const CANVAS_AGENT_MODEL_CANDIDATES: readonly CanvasAgentCandidate[] = [
  {
    providerId: 'openlux', modelId: 'gemini-3.8-flash', displayName: 'OpenLux Gemini 3.8 Flash',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'openlux', modelId: 'deepseek-v4.1-flash', displayName: 'OpenLux DeepSeek V4.1 Flash',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'openlux', modelId: 'deepseek-v4-pro', displayName: 'OpenLux DeepSeek V4 Pro',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'openlux', modelId: 'qwen3.8-max', displayName: 'OpenLux Qwen 3.8 Max',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'openlux', modelId: 'kimi-k2.6', displayName: 'OpenLux Kimi K2.6',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'openlux', modelId: 'claude-sonnet-5', displayName: 'OpenLux Claude Sonnet 5',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
]
