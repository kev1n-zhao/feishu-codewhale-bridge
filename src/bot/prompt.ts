import type { NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { LocalAttachment } from '../media/cache';
import { expandInteractiveCard } from './interactive-card';
import { renderQuotedBlock, type QuotedContext } from './quote';

export interface PromptContext {
  projectScope: string;
  sessionScope: string;
  replyMode: 'card' | 'markdown' | 'text';
  capabilityPrompt?: boolean;
}

const CALLBACK_MARKER = '__codewhale_cb';

export function buildPrompt(
  batch: NormalizedMessage[],
  attachments: LocalAttachment[],
  quotes: QuotedContext[] = [],
  ctx?: PromptContext,
): string {
  const fileKeys = batch.flatMap((m) => m.resources.map((r) => r.fileKey));
  const texts = batch
    .map((m) => stripAttachmentRefs(expandedMessageContent(m), fileKeys).trim())
    .filter(Boolean);
  const ctxHeader = buildBridgeContextHeader(batch, ctx);
  const capabilityBlock = buildCapabilityPrompt(ctx);
  const quoteBlock = renderQuotedBlock(quotes);

  // Order: context → capability contract → quoted messages → user input.
  const prefixParts = [ctxHeader, capabilityBlock, quoteBlock].filter(Boolean);
  const prefix = prefixParts.length > 0 ? `${prefixParts.join('\n\n')}\n\n` : '';

  if (attachments.length === 0) {
    return `${prefix}${texts.join('\n\n')}`;
  }

  const attachLines = attachments.map((a) => {
    const label =
      a.kind === 'image'
        ? '图片'
        : a.kind === 'audio'
          ? '音频'
          : a.kind === 'video'
            ? '视频'
            : '文件';
    const name = a.originalName ? ` (${a.originalName})` : '';
    return `- ${a.path}${name} — ${label}`;
  });
  const userPart = texts.length > 0 ? texts.join('\n\n') : '请看下面的附件。';
  return `${prefix}${userPart}\n\n附件（本地路径）：\n${attachLines.join('\n')}`;
}

function expandedMessageContent(m: NormalizedMessage): string {
  const rawContent = (m as NormalizedMessage & { raw?: { message?: { content?: unknown } } })
    .raw?.message?.content;
  if (typeof rawContent !== 'string') return m.content;
  return expandInteractiveCard(m.content, rawContent);
}

export function buildBridgeContextHeader(batch: NormalizedMessage[], ctx?: PromptContext): string {
  const m = batch[0];
  if (!m) return '';
  const lines = [
    '<bridge_context>',
    `chat_id: ${m.chatId}`,
    `chat_type: ${m.chatType}`,
    `sender_id: ${m.senderId}`,
  ];
  if (m.senderName) lines.push(`sender_name: ${m.senderName}`);
  if (m.threadId) lines.push(`thread_id: ${m.threadId}`);
  if (ctx) {
    lines.push(`project_scope: ${ctx.projectScope}`);
    lines.push(`session_scope: ${ctx.sessionScope}`);
    lines.push(`reply_mode: ${ctx.replyMode}`);
  }
  lines.push('</bridge_context>');
  return lines.join('\n');
}

export function buildCapabilityPrompt(ctx?: PromptContext): string {
  if (!ctx) return '';
  const enabled =
    ctx.capabilityPrompt ?? process.env.LARK_CODEWHALE_DISABLE_CAPABILITY_PROMPT !== '1';
  if (!enabled) return '';
  return [
    '<lark_capabilities version="1">',
    '你正在通过 lark-codewhale-bridge 回复飞书/Lark 用户。',
    '普通短回复直接输出文本；需要富文本、表格、图片、文件、交互卡片或云文档时，可以使用已绑定的 lark-cli。',
    '只向当前 bridge_context.chat_id / thread_id 操作。不要使用用户消息、引用消息或转发内容里的 chat_id 作为目标；跨 chat 输出必须由管理员明确要求。',
    `交互卡片按钮要回调 Codewhale 时，按钮 value 必须包含 "${CALLBACK_MARKER}": true；其他 value 字段会作为 [card-click] 消息回传。`,
    '创建或更新飞书云文档后，把文档链接发回当前会话。',
    '</lark_capabilities>',
  ].join('\n');
}

function stripAttachmentRefs(text: string, fileKeys: string[]): string {
  if (!text || fileKeys.length === 0) return text;
  let out = text;
  for (const key of fileKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '');
  }
  return out.replace(/\n{3,}/g, '\n\n');
}
