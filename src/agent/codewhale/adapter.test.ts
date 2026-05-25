import { chmod, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodewhaleAdapter } from './adapter';

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env.CODEWHALE_ENV_OUT;
});

describe('CodewhaleAdapter lark env', () => {
  it('passes lark context into the child process environment', async () => {
    dir = await mkdtemp(join(tmpdir(), 'codewhale-adapter-'));
    const out = join(dir, 'env.json');
    const fake = join(dir, 'fake-codewhale.mjs');
    await writeFile(fake, [
      '#!/usr/bin/env node',
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.CODEWHALE_ENV_OUT, JSON.stringify({',
      '  chat: process.env.LARK_CODEWHALE_CHAT_ID,',
      '  thread: process.env.LARK_CODEWHALE_THREAD_ID,',
      '  project: process.env.LARK_CODEWHALE_PROJECT_SCOPE,',
      '  scope: process.env.LARK_CODEWHALE_SCOPE,',
      '  reply: process.env.LARK_CODEWHALE_REPLY_MODE,',
      '}));',
      'console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sess_1" }));',
      'console.log(JSON.stringify({ type: "result", session_id: "sess_1", result: "" }));',
    ].join('\n'));
    await chmod(fake, 0o700);
    process.env.CODEWHALE_ENV_OUT = out;

    const adapter = new CodewhaleAdapter({ binary: fake });
    const run = adapter.run({
      prompt: 'hello',
      cwd: dir,
      lark: {
        chatId: 'oc_chat',
        chatType: 'group',
        senderId: 'ou_sender',
        projectScope: 'oc_chat',
        sessionScope: 'oc_chat:omt_thread',
        replyMode: 'card',
        threadId: 'omt_thread',
      },
    });

    for await (const _evt of run.events) {
      // Drain the child.
    }
    const env = JSON.parse(await readFile(out, 'utf8')) as Record<string, string>;
    expect(env).toEqual({
      chat: 'oc_chat',
      thread: 'omt_thread',
      project: 'oc_chat',
      scope: 'oc_chat:omt_thread',
      reply: 'card',
    });
  });
});
