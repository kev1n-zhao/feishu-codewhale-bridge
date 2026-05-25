import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { ChatModeCache } from './chat-mode-cache';

export interface ResolvedScopes {
  /** Stable project/workspace key. One Feishu chat = one project cwd. */
  projectScope: string;
  /** Conversation key. Threads/topics get independent Codewhale sessions. */
  sessionScope: string;
  chatMode: 'p2p' | 'group' | 'topic';
  threadId?: string;
}

export function sessionScopeFor(chatId: string, threadId: string | undefined): string {
  return threadId ? `${chatId}:${threadId}` : chatId;
}

export async function resolveScopes(
  channel: LarkChannel,
  chatId: string,
  threadId: string | undefined,
  cache: ChatModeCache,
): Promise<ResolvedScopes> {
  const chatMode = await cache.resolve(channel, chatId);
  return {
    projectScope: chatId,
    sessionScope: sessionScopeFor(chatId, threadId),
    chatMode,
    ...(threadId ? { threadId } : {}),
  };
}

/**
 * Compute the **session scope** for a message.
 *
 *  - **project scope**: always `chatId`; one Feishu chat owns one cwd.
 *  - **session scope**: `chatId` for top-level messages, or
 *    `${chatId}:${threadId}` for any threaded message. This covers topic
 *    groups and regular group threads, matching the Feishu doc's "one
 *    thread = one session" model.
 *
 * Async because chat mode requires an API lookup (cached after first hit).
 * Callers typically await this once at intake/cardAction entry and pass
 * the resolved scope through.
 */
export async function scopeFor(
  channel: LarkChannel,
  chatId: string,
  threadId: string | undefined,
  cache: ChatModeCache,
): Promise<string> {
  return (await resolveScopes(channel, chatId, threadId, cache)).sessionScope;
}

/** Convenience overload from a NormalizedMessage. */
export async function scopeForMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  cache: ChatModeCache,
): Promise<string> {
  return scopeFor(channel, msg.chatId, msg.threadId, cache);
}
