import { describe, expect, it } from 'vitest';
import {
  getAgentStopGraceMs,
  getMaxConcurrentRuns,
  getMessageReplyMode,
  getRequireMentionInGroup,
  getRunIdleTimeoutMs,
  getShowToolCalls,
  isAdmin,
  isChatAllowed,
  isUserAllowed,
  type AppConfig,
} from './schema';

function cfg(preferences: AppConfig['preferences'] = {}): AppConfig {
  return {
    accounts: {
      app: {
        id: 'cli_test',
        secret: { source: 'env', id: 'APP_SECRET' },
        tenant: 'feishu',
      },
    },
    preferences,
  };
}

describe('preference defaults', () => {
  it('keeps the safe chat defaults for fresh configs', () => {
    const fresh = cfg();

    expect(getMessageReplyMode(fresh)).toBe('markdown');
    expect(getShowToolCalls(fresh)).toBe(true);
    expect(getRequireMentionInGroup(fresh)).toBe(true);
    expect(getMaxConcurrentRuns(fresh)).toBe(10);
    expect(getRunIdleTimeoutMs(fresh)).toBeUndefined();
    expect(getAgentStopGraceMs(fresh)).toBe(5000);
  });

  it('preserves legacy text reply semantics until config is migrated', () => {
    expect(getMessageReplyMode(cfg({ messageReply: 'text' }))).toBe('markdown');
    expect(getMessageReplyMode(cfg({ messageReply: 'text', messageReplyMigrated: true }))).toBe('text');
  });
});

describe('preference clamps', () => {
  it('clamps concurrency, idle timeout, and stop grace into sane ranges', () => {
    expect(getMaxConcurrentRuns(cfg({ maxConcurrentRuns: 500 }))).toBe(50);
    expect(getMaxConcurrentRuns(cfg({ maxConcurrentRuns: 0 }))).toBe(10);
    expect(getRunIdleTimeoutMs(cfg({ runIdleTimeoutMinutes: 500 }))).toBe(120 * 60_000);
    expect(getAgentStopGraceMs(cfg({ agentStopGraceMs: 1 }))).toBe(100);
    expect(getAgentStopGraceMs(cfg({ agentStopGraceMs: 60_000 }))).toBe(30_000);
  });
});

describe('access control', () => {
  it('allows everyone when allowlists are empty', () => {
    const open = cfg({ access: {} });

    expect(isUserAllowed(open, 'ou_a')).toBe(true);
    expect(isChatAllowed(open, 'oc_a')).toBe(true);
    expect(isAdmin(open, 'ou_a')).toBe(true);
  });

  it('enforces user, chat, and admin allowlists when configured', () => {
    const locked = cfg({
      access: {
        allowedUsers: ['ou_allowed'],
        allowedChats: ['oc_allowed'],
        admins: ['ou_admin'],
      },
    });

    expect(isUserAllowed(locked, 'ou_allowed')).toBe(true);
    expect(isUserAllowed(locked, 'ou_other')).toBe(false);
    expect(isChatAllowed(locked, 'oc_allowed')).toBe(true);
    expect(isChatAllowed(locked, 'oc_other')).toBe(false);
    expect(isAdmin(locked, 'ou_admin')).toBe(true);
    expect(isAdmin(locked, 'ou_allowed')).toBe(false);
  });
});
