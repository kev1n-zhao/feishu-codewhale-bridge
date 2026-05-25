import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { log } from '../../core/logger';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateCodewhaleEvent } from './stream-json';

export interface CodewhaleAdapterOptions {
  binary?: string;
}

type CodewhaleChild = ChildProcessByStdio<null, Readable, Readable>;

export class CodewhaleAdapter implements AgentAdapter {
  readonly id = 'codewhale';
  readonly displayName = 'Codewhale';

  private readonly binary: string;

  constructor(opts: CodewhaleAdapterOptions = {}) {
    this.binary = opts.binary ?? 'codewhale';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  run(opts: AgentRunOptions): AgentRun {
    const args = [
      'exec',
      '--auto',
      '--output-format',
      'stream-json',
    ];
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);
    args.push(opts.prompt);

    const env: Record<string, string> = { ...process.env, LARK_CODEWHALE: '1' } as Record<string, string>;
    if (opts.lark) {
      env.LARK_CODEWHALE_CHAT_ID = opts.lark.chatId;
      env.LARK_CODEWHALE_CHAT_TYPE = opts.lark.chatType;
      env.LARK_CODEWHALE_SENDER_ID = opts.lark.senderId;
      env.LARK_CODEWHALE_PROJECT_SCOPE = opts.lark.projectScope;
      env.LARK_CODEWHALE_SCOPE = opts.lark.sessionScope;
      env.LARK_CODEWHALE_REPLY_MODE = opts.lark.replyMode;
      if (opts.lark.threadId) env.LARK_CODEWHALE_THREAD_ID = opts.lark.threadId;
    }

    const child: CodewhaleChild = spawn(this.binary, args, {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    log.info('agent', 'spawn', {
      pid: child.pid ?? null,
      cwd: opts.cwd ?? process.cwd(),
      hasSession: Boolean(opts.sessionId),
      promptChars: opts.prompt.length,
      model: opts.model,
    });

    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      let nl = stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim()) log.warn('agent', 'stderr', { line });
        nl = stderrBuffer.indexOf('\n');
      }
    });

    let runtimeError: Error | null = null;
    child.on('error', (err) => { runtimeError = err; });

    const stopGraceMs = opts.stopGraceMs ?? 5000;

    return {
      events: createEventStream(child, stderrChunks, () => runtimeError),
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        log.info('agent', 'stop-sigterm', { pid: child.pid ?? null, graceMs: stopGraceMs });
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              log.warn('agent', 'stop-sigkill', { pid: child.pid ?? null });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      },
      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, timeoutMs);
          const onExit = () => { clearTimeout(timer); resolve(true); };
          child.once('exit', onExit);
        });
      },
    };
  }
}

async function* createEventStream(
  child: CodewhaleChild, stderrChunks: Buffer[], getError: () => Error | null,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getError();
    yield { type: 'error', message: err ? `spawn codewhale failed: ${err.message}` : 'spawn returned no pid' };
    return;
  }

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch {
        log.warn('agent', 'stream-json-parse-failed', { line: trimmed.slice(0, 200) });
        continue;
      }
      log.info('agent', 'stream-raw', { raw: trimmed.slice(0, 300) });
      let eventCount = 0;
      for (const ev of translateCodewhaleEvent(parsed)) {
        eventCount++;
        log.info('agent', 'stream-event', { type: ev.type, detail: JSON.stringify(ev).slice(0, 300) });
        yield ev;
      }
      if (eventCount === 0) {
        log.info('agent', 'stream-no-event', { raw: trimmed.slice(0, 300) });
      }
    }
  } finally { rl.close(); }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else child.once('exit', (code) => resolve(code));
  });
  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    yield { type: 'error', message: `codewhale exited code ${exitCode}${stderr ? ': ' + stderr.slice(0, 500) : ''}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `codewhale runtime error: ${runtimeError.message}` };
  }
}
