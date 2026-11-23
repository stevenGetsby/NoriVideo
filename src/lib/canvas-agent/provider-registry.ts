import type { CanvasAgentCandidate, CanvasAgentProvider } from './model-catalog'

// Kept separate from the ordinary generation provider contract: registering
// a chat transport here must not expose it to any other feature.
export const CANVAS_AGENT_PROVIDER_PRESETS: Record<CanvasAgentProvider, { name: string; baseURL: string; envKey: string }> = {
  deepseek: { name: 'DeepSeek 官方', baseURL: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' },
  kimi: { name: 'Kimi 官方', baseURL: 'https://api.moonshot.ai/v1', envKey: 'KIMI_API_KEY' },
  openai: { name: 'OpenAI 官方', baseURL: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY' },
}

// Do not mark a model verified based only on its protocol documentation.
// Registration needs a reviewed recording of that model's tool stream.
export const CANVAS_AGENT_MODEL_CANDIDATES: readonly CanvasAgentCandidate[] = [
  {
    providerId: 'deepseek', modelId: 'deepseek-flash', displayName: 'DeepSeek V4.1 Flash',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
  {
    providerId: 'deepseek', modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro',
    protocol: 'chat-completions', toolStreamingVerified: false,
  },
]
