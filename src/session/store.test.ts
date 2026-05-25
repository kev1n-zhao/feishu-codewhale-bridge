import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from './store';

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('SessionStore project clearing', () => {
  it('clears project root and thread sessions without touching other chats', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lark-codewhale-session-'));
    const store = new SessionStore(join(dir, 'sessions.json'));
    store.set('oc_a', 'sess-root', '/repo');
    store.set('oc_a:thread', 'sess-thread', '/repo');
    store.set('oc_b', 'sess-other', '/repo');

    expect(store.clearProject('oc_a')).toBe(2);

    expect(store.getRaw('oc_a')).toBeUndefined();
    expect(store.getRaw('oc_a:thread')).toBeUndefined();
    expect(store.getRaw('oc_b')?.sessionId).toBe('sess-other');
    await store.flush();
  });
});
