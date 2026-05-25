import { describe, expect, it } from 'vitest';
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { resolveScopes, scopeForMessage, sessionScopeFor } from './scope';
import type { ChatModeCache } from './chat-mode-cache';

const channel = {} as LarkChannel;

function cache(mode: 'p2p' | 'group' | 'topic'): ChatModeCache {
  return {
    resolve: async () => mode,
  } as unknown as ChatModeCache;
}

describe('scope resolution', () => {
  it('keeps project scope at chat id while splitting thread sessions', async () => {
    const scopes = await resolveScopes(channel, 'oc_chat', 'omt_thread', cache('topic'));

    expect(scopes.projectScope).toBe('oc_chat');
    expect(scopes.sessionScope).toBe('oc_chat:omt_thread');
    expect(scopes.chatMode).toBe('topic');
    expect(scopes.threadId).toBe('omt_thread');
  });

  it('uses chat id for non-thread sessions', async () => {
    expect(sessionScopeFor('oc_chat', undefined)).toBe('oc_chat');
    await expect(scopeForMessage(channel, {
      chatId: 'oc_chat',
      threadId: undefined,
    } as NormalizedMessage, cache('group'))).resolves.toBe('oc_chat');
  });
});
