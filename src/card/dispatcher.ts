import type { CardActionEvent, LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter } from '../agent/types';
import type { ActiveRuns } from '../bot/active-runs';
import type { ChatModeCache } from '../bot/chat-mode-cache';
import type { PendingQueue } from '../bot/pending-queue';
import { runCommandHandler, type CommandContext, type Controls } from '../commands';
import { isChatAllowed, isUserAllowed } from '../config/schema';
import { log } from '../core/logger';
import type { SessionStore } from '../session/store';
import type { WorkspaceStore } from '../workspace/store';
import { resolveScopes } from '../bot/scope';

/** Marker key on a button's value object that flags the cardAction as
 * a callback that should be forwarded back to the agent (Codewhale) instead
 * of dispatched to a built-in command handler. The double-underscore
 * sigils make it virtually impossible to collide with normal payload
 * fields the agent might set.
 */
const CODEWHALE_CB_MARKER = '__codewhale_cb';

export interface CardDispatchDeps {
  channel: LarkChannel;
  evt: CardActionEvent;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  activeRuns: ActiveRuns;
  agent: AgentAdapter;
  controls: Controls;
  pending: PendingQueue;
  chatModeCache: ChatModeCache;
}

export async function handleCardAction(deps: CardDispatchDeps): Promise<void> {
  const value = deps.evt.action.value;
  if (!value || typeof value !== 'object') return;
  const payload = value as Record<string, unknown>;

  const operatorId = deps.evt.operator.openId;
  const chatId = deps.evt.chatId;

  // CardKit 2.0 form submits drop user-input values from action.value; they
  // arrive on raw.action.form_value. The SDK forwards the raw event when
  // includeRawEvent: true is set on the channel options.
  const raw = (deps.evt as CardActionEvent & { raw?: unknown }).raw as
    | { action?: { form_value?: Record<string, unknown> } }
    | undefined;
  const formValue = raw?.action?.form_value;

  // Resolve the click's session scope. For threaded messages we need the
  // carrier message's thread_id so the action targets the right session.
  // Done before the access check so we know the chat mode (p2p vs group)
  // and can skip the chat allowlist for DMs.
  const { scope, projectScope, threadId, mode } = await resolveScope(deps);

  // Access control. Operator must be on the same allowlists as message
  // senders. Silent drop — sending a denial card to an unauthorized user
  // just confirms the bot exists.
  if (!isUserAllowed(deps.controls.cfg, operatorId)) {
    log.info('cardAction', 'skip-not-allowed-user', {
      operator: operatorId.slice(-6),
    });
    return;
  }
  // `allowedChats` is group-only — see intakeMessage in bot/channel.ts for
  // the rationale (p2p chat_ids aren't a meaningful access boundary, the
  // user check above is authoritative for DMs).
  if (mode !== 'p2p' && !isChatAllowed(deps.controls.cfg, chatId)) {
    log.info('cardAction', 'skip-not-allowed-chat', {
      chatId: chatId.slice(-6),
    });
    return;
  }

  // Codewhale-driven callback: the button was rendered by codewhale itself via
  // lark-cli, with `__codewhale_cb` set on the value. Forward the click back
  // into the scope's pending queue so codewhale resumes its session and sees
  // the click as a follow-up message, with full context of what it sent.
  if (CODEWHALE_CB_MARKER in payload) {
    forwardToCodewhale(deps, payload, formValue, scope, projectScope, threadId, mode);
    return;
  }

  const cmd = typeof payload.cmd === 'string' ? payload.cmd : '';
  if (!cmd) return;
  log.info('cardAction', 'cmd', { cmd, scope });

  const ctx: CommandContext = {
    channel: deps.channel,
    msg: makeFakeMsg(deps.evt, threadId, mode),
    scope,
    projectScope,
    chatMode: mode,
    sessions: deps.sessions,
    workspaces: deps.workspaces,
    activeRuns: deps.activeRuns,
    agent: deps.agent,
    controls: deps.controls,
    formValue,
    fromCardAction: true,
  };

  const [name, ...rest] = cmd.split('.');
  const sub = rest.join(' ');
  const args = composeArgs(sub, payload);

  try {
    const ok = await runCommandHandler(name ?? '', args, ctx);
    if (!ok) log.warn('cardAction', 'unknown', { cmd });
  } catch (err) {
    log.fail('cardAction', err, { cmd });
  }
}

async function resolveScope(
  deps: CardDispatchDeps,
): Promise<{
  scope: string;
  projectScope: string;
  threadId: string | undefined;
  mode: 'p2p' | 'group' | 'topic';
}> {
  const chatId = deps.evt.chatId;
  const mode = await deps.chatModeCache.resolve(deps.channel, chatId);
  if (mode === 'p2p') {
    return { scope: chatId, projectScope: chatId, threadId: undefined, mode };
  }
  // Group/topic card — need the carrier message's thread_id to compose scope.
  // One API call per click; could cache by messageId if it ever becomes hot.
  const threadId = await lookupMessageThreadId(deps.channel, deps.evt.messageId);
  const scopes = await resolveScopes(deps.channel, chatId, threadId, deps.chatModeCache);
  return {
    scope: scopes.sessionScope,
    projectScope: scopes.projectScope,
    threadId: scopes.threadId,
    mode,
  };
}

async function lookupMessageThreadId(
  channel: LarkChannel,
  messageId: string,
): Promise<string | undefined> {
  try {
    const r = (await channel.rawClient.im.v1.message.get({
      path: { message_id: messageId },
    })) as { data?: { items?: { thread_id?: string }[] } };
    return r?.data?.items?.[0]?.thread_id;
  } catch (err) {
    log.warn('cardAction', 'thread-id-lookup-failed', {
      messageId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function forwardToCodewhale(
  deps: CardDispatchDeps,
  payload: Record<string, unknown>,
  formValue: Record<string, unknown> | undefined,
  scope: string,
  projectScope: string,
  threadId: string | undefined,
  mode: 'p2p' | 'group' | 'topic',
): void {
  // Strip the marker so codewhale only sees the meaningful fields it set.
  const { [CODEWHALE_CB_MARKER]: _marker, ...codewhalePayload } = payload;
  const merged = {
    ...codewhalePayload,
    bridge_context: {
      chat_id: deps.evt.chatId,
      chat_mode: mode,
      project_scope: projectScope,
      session_scope: scope,
      operator_id: deps.evt.operator.openId,
      ...(threadId ? { thread_id: threadId } : { thread_lookup: 'missing' }),
    },
    ...(formValue ? { form_value: formValue } : {}),
  };
  log.info('cardAction', 'forward-codewhale', {
    scope,
    payload: JSON.stringify(merged).slice(0, 200),
  });
  const synthetic: NormalizedMessage = {
    messageId: deps.evt.messageId,
    chatId: deps.evt.chatId,
    chatType: mode === 'p2p' ? 'p2p' : 'group',
    threadId,
    senderId: deps.evt.operator.openId,
    senderName: deps.evt.operator.name,
    content: `[card-click] ${JSON.stringify(merged)}`,
    rawContentType: 'card_action',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
  deps.pending.push(scope, synthetic);
}

/** Turn a button payload like {cmd:'ws.use', name:'proj-a'} into the arg
 * string the text-command handler expects: 'use proj-a'. Accepts `arg`
 * (preferred, generic) or `name` (legacy ws cards). */
function composeArgs(sub: string, payload: Record<string, unknown>): string {
  if (!sub) return '';
  const arg =
    (typeof payload.arg === 'string' && payload.arg) ||
    (typeof payload.name === 'string' && payload.name) ||
    '';
  return arg ? `${sub} ${arg}` : sub;
}

function makeFakeMsg(
  evt: CardActionEvent,
  threadId: string | undefined,
  mode: 'p2p' | 'group' | 'topic',
): NormalizedMessage {
  return {
    messageId: evt.messageId,
    chatId: evt.chatId,
    chatType: mode === 'p2p' ? 'p2p' : 'group',
    threadId,
    senderId: evt.operator.openId,
    senderName: evt.operator.name,
    content: '',
    rawContentType: 'interactive',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
}
