import { describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '@larksuiteoapi/node-sdk';
import { buildCapabilityPrompt, buildPrompt } from './prompt';

function msg(content: string): NormalizedMessage {
  return {
    messageId: 'om_msg',
    chatId: 'oc_chat',
    chatType: 'group',
    threadId: 'omt_thread',
    senderId: 'ou_sender',
    senderName: 'Kevin',
    content,
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: Date.now(),
  };
}

describe('bridge prompt', () => {
  it('injects bridge context and lark capability contract before user text', () => {
    const prompt = buildPrompt([msg('写一个规格文档')], [], [], {
      projectScope: 'oc_chat',
      sessionScope: 'oc_chat:omt_thread',
      replyMode: 'card',
      capabilityPrompt: true,
    });

    expect(prompt).toContain('<bridge_context>');
    expect(prompt).toContain('project_scope: oc_chat');
    expect(prompt).toContain('session_scope: oc_chat:omt_thread');
    expect(prompt).toContain('<lark_capabilities version="1">');
    expect(prompt).toContain('__codewhale_cb');
    expect(prompt).toContain('只向当前 bridge_context.chat_id / thread_id 操作');
    expect(prompt.trim().endsWith('写一个规格文档')).toBe(true);
  });

  it('can disable the capability prompt without removing bridge context', () => {
    const prompt = buildPrompt([msg('hello')], [], [], {
      projectScope: 'oc_chat',
      sessionScope: 'oc_chat:omt_thread',
      replyMode: 'markdown',
      capabilityPrompt: false,
    });

    expect(prompt).toContain('<bridge_context>');
    expect(prompt).not.toContain('<lark_capabilities');
  });

  it('documents the kill switch through the capability builder', () => {
    const previous = process.env.LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT;
    process.env.LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT = '1';
    try {
      expect(buildCapabilityPrompt({
        projectScope: 'oc_chat',
        sessionScope: 'oc_chat',
        replyMode: 'text',
      })).toBe('');
    } finally {
      if (previous === undefined) delete process.env.LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT;
      else process.env.LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT = previous;
    }
  });
});
