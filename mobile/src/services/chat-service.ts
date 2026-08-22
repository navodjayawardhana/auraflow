import { apiDelete, apiGet, apiPost } from '@/services/api-client';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  body: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  /** Null until the first question names it — an unused chat has nothing to be called. */
  title: string | null;
  message_count: number;
  last_activity_at: string | null;
}

export interface Thread {
  /** Null only when the account has never chatted; the first message creates one. */
  conversation: Conversation | null;
  messages: ChatMessage[];
}

/** Omit the id for the conversation the user was last in. */
export async function fetchThread(conversationId?: number): Promise<Thread> {
  const query = conversationId === undefined ? '' : `?conversation=${conversationId}`;
  const payload = await apiGet<{
    data: ChatMessage[];
    meta: { conversation: Conversation | null };
  }>(`/chat${query}`);

  return { conversation: payload.meta.conversation, messages: payload.data };
}

export async function fetchConversations(): Promise<Conversation[]> {
  const payload = await apiGet<{ data: Conversation[] }>('/chat/conversations');
  return payload.data;
}

export async function startConversation(): Promise<Conversation> {
  const payload = await apiPost<{ data: Conversation }>('/chat/conversations');
  return payload.data;
}

export async function sendMessage(
  message: string,
  conversationId?: number,
): Promise<{ question: ChatMessage; answer: ChatMessage; conversation: Conversation }> {
  const payload = await apiPost<{
    data: { question: ChatMessage; answer: ChatMessage; conversation: Conversation };
  }>('/chat', { message, ...(conversationId === undefined ? {} : { conversation_id: conversationId }) });

  return payload.data;
}

/** Destructive. Omitting the id wipes every conversation on the account, not just one. */
export async function clearThread(conversationId?: number): Promise<void> {
  await apiDelete(`/chat${conversationId === undefined ? '' : `?conversation=${conversationId}`}`);
}
