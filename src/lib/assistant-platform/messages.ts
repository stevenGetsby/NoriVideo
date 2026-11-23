import { convertToModelMessages, type UIMessage } from 'ai'

export async function toModelMessages(messages: UIMessage[]): Promise<Awaited<ReturnType<typeof convertToModelMessages>>> {
  return await convertToModelMessages(messages.map(({ id: _id, ...message }) => message))
}
