import { apiDelete, apiGet, apiPost } from '@/services/api-client';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  created_at: string;
}

export async function fetchThread(): Promise<ChatMessage[]> {
  const payload = await apiGet<{ data: ChatMessage[] }>('/chat');
  return payload.data;
}

export async function sendMessage(
  message: string,
): Promise<{ question: ChatMessage; answer: ChatMessage }> {
  const payload = await apiPost<{ data: { question: ChatMessage; answer: ChatMessage } }>(
    '/chat',
    { message },
  );
  return payload.data;
}

export async function clearThread(): Promise<void> {
  await apiDelete('/chat');
}
