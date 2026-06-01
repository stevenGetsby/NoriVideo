import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { getUserModelConfig } from '@/lib/config-service'

export class SuperAgentLLMClient {
  async callLLM(userId: string, systemPrompt: string, userPrompt: string): Promise<string> {
    const userConfig = await getUserModelConfig(userId)
    const analysisModelKey = userConfig.analysisModel?.trim() || ''

    if (!analysisModelKey) {
      throw new Error('analysisModel is required. Please configure it in profile settings.')
    }

    const completion = await runModelGatewayTextCompletion({
      userId,
      model: analysisModelKey,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: {
        temperature: 0.2,
        action: 'super-agent.plan',
      },
    })

    return getCompletionContent(completion)
  }
}

export const llmClient = new SuperAgentLLMClient()
