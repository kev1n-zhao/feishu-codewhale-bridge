import dns from 'node:dns';
import { createInterface } from 'node:readline';
import pkg from '../../../package.json';
import { CodewhaleAdapter } from '../../agent/codewhale/adapter';
import { startChannel, type BridgeChannel } from '../../bot/channel';
import { runRegistrationWizard } from '../../bot/wizard';
import type { Controls } from '../../commands';
import { setSecret } from '../../config/keystore';
import { paths } from '../../config/paths';
import type { AppConfig } from '../../config/schema';
import { isComplete, secretKeyForApp } from '../../config/schema';
import {
  buildEncryptedAccountConfig,
  ensureSecretsGetterWrapper,
  loadConfig,
  saveConfig,
} from '../../config/store';
import { gcOldLogs, log } from '../../core/logger';
import { gcMediaCache } from '../../media/cache';
import { preFlightChecks } from '../preflight';
import {
  cleanupTmpFiles,
  register,
  sameAppOthers,
  unregisterSync,
  updateEntry,
  type ProcessEntry,
} from '../../runtime/registry';
import { SessionStore } from '../../session/store';
import { WorkspaceStore } from '../../workspace/store';

dns.setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (reason) => {
  log.fail('process', reason, { kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  log.fail('process', err, { kind: 'uncaughtException' });
});

const MEDIA_GC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StartOptions {
  config?: string;
  skipCheckLarkCli?: boolean;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const configPath = opts.config ?? paths.configFile;
  const existing = await loadConfig(configPath);

  let cfg: AppConfig;
  if (isComplete(existing)) {
    cfg = existing;
    cfg = await maybeMigratePlaintextSecret(cfg, configPath);
  } else {
    const fresh = await runRegistrationWizard();
    cfg = await persistEncrypted(fresh, configPath);
    console.log(`配置已保存到 ${configPath}\n`);
  }

  await preFlightChecks({ skipCheckLarkCli: opts.skipCheckLarkCli });

  const agent = new CodewhaleAdapter();
  if (!(await agent.isAvailable())) {
    console.error('✗ 未找到 codewhale CLI。请先安装 CodeWhale：');
    console.error('  https://github.com/Hmbown/CodeWhale');
    process.exit(1);
  }

  const sessions = new SessionStore();
  await sessions.load();
  const workspaces = new WorkspaceStore();
  await workspaces.load();

  await gcMediaCache(MEDIA_GC_MAX_AGE_MS);
  await gcOldLogs();

  const conflicts = sameAppOthers(cfg.accounts.app.id);
  if (conflicts.length > 0) {
    const proceed = await resolveConflict(cfg, conflicts);
    if (!proceed) {
      console.log('已取消启动。');
      process.exit(0);
    }
  }

  const entry = await register({
    appId: cfg.accounts.app.id,
    tenant: cfg.accounts.app.tenant,
    configPath,
    version: pkg.version,
  });
  log.info('registry', 'registered', { id: entry.id, pid: process.pid });

  let bridge: BridgeChannel;
  let restarting = false;

  let stopping = false;
  const stop = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\n收到 ${sig}，正在关闭...`);
    try {
      await bridge.disconnect();
    } catch (err) {
      console.error('[disconnect-failed]', err);
    }
    unregisterSync(entry.id);
    process.exit(0);
  };

  const controls: Controls = {
    configPath,
    cfg,
    processId: entry.id,
    async exit() {
      await stop('exit-command');
    },
    async restart() {
      if (restarting) return;
      restarting = true;
      try {
        const next = await loadConfig(configPath);
        if (!isComplete(next)) throw new Error('config incomplete after change');
        console.log(
          `[restart] connecting new bridge with appId=${next.accounts.app.id} tenant=${next.accounts.app.tenant}...`,
        );
        const next_bridge = await startChannel({
          cfg: next,
          agent,
          sessions,
          workspaces,
          controls,
        });
        console.log('[restart] disconnecting old bridge...');
        try {
          await bridge.disconnect();
        } catch (err) {
          console.warn('[restart] old disconnect failed:', err);
        }
        bridge = next_bridge;
        controls.cfg = next;
        await updateEntry(entry.id, {
          appId: next.accounts.app.id,
          tenant: next.accounts.app.tenant,
          configPath,
          botName: bridge.channel.botIdentity?.name,
        }).catch((err) =>
          log.warn('registry', 'update-failed', { err: String(err) }),
        );
        console.log('✓ 已用新凭据重连');
      } finally {
        restarting = false;
      }
    },
  };

  bridge = await startChannel({ cfg, agent, sessions, workspaces, controls });

  const botName = bridge.channel.botIdentity?.name;
  if (botName) {
    await updateEntry(entry.id, { botName }).catch((err) =>
      log.warn('registry', 'update-failed', { step: 'botName', err: String(err) }),
    );
  }

  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('exit', () => {
    unregisterSync(entry.id);
    cleanupTmpFiles();
  });

  await new Promise<void>(() => {});
}

async function resolveConflict(
  cfg: AppConfig,
  conflicts: ProcessEntry[],
): Promise<boolean> {
  console.log(
    `⚠️  检测到这个飞书应用已经有 ${conflicts.length} 个 bot 正在运行:`,
  );
  for (const e of conflicts) {
    const ago = formatAgo(Date.now() - new Date(e.startedAt).getTime());
    const label = e.botName ? `bot ${e.botName} (${e.appId})` : `bot ${e.appId}`;
    console.log(`   - ${label},进程 ${e.id},${ago}启动`);
  }
  console.log('');

  if (!process.stdin.isTTY) {
    console.warn(
      '⚠️  当前不是交互式启动,已自动取消。如需替换,先用 `kill <bot id>` 关掉旧的。\n',
    );
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
  try {
    const verb = conflicts.length > 1 ? '它们' : '那个';
    const answer = (await ask(`继续启动会先关掉${verb},是否继续? [y/N]: `))
      .trim()
      .toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      return false;
    }
    for (const e of conflicts) {
      try {
        process.kill(e.pid, 'SIGTERM');
        console.log(`✓ 已关掉 bot ${e.id}`);
      } catch (err) {
        console.warn(`✗ 关掉 bot ${e.id} 失败:${(err as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } finally {
    rl.close();
  }
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)} 秒前`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

async function maybeMigratePlaintextSecret(
  cfg: AppConfig,
  configPath: string,
): Promise<AppConfig> {
  const s = cfg.accounts.app.secret;

  if (typeof s === 'string' && !/^\$\{[A-Z][A-Z0-9_]*\}$/.test(s)) {
    try {
      const next = await buildEncryptedAccountConfig(
        cfg.accounts.app.id,
        cfg.accounts.app.tenant,
        cfg.preferences,
      );
      await setSecret(secretKeyForApp(cfg.accounts.app.id), s);
      await saveConfig(next, configPath);
      console.log('🔒 已把 App Secret 加密迁移到 ~/.lark-codewhale/secrets.enc');
      return next;
    } catch (err) {
      log.warn('config', 'migrate-encrypted-failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return cfg;
    }
  }

  if (typeof s === 'string') return cfg;

  try {
    const wrapperPath = await ensureSecretsGetterWrapper();
    if (needsProviderRewrite(cfg, wrapperPath)) {
      const next = await buildEncryptedAccountConfig(
        cfg.accounts.app.id,
        cfg.accounts.app.tenant,
        cfg.preferences,
      );
      await saveConfig(next, configPath);
      console.log('🔒 已把 secrets provider 切到 wrapper 形态');
      return next;
    }
  } catch (err) {
    log.warn('config', 'wrapper-refresh-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return cfg;
}

function needsProviderRewrite(cfg: AppConfig, wrapperPath: string): boolean {
  const provider = cfg.secrets?.providers?.bridge;
  if (!provider) return true;
  if (provider.command !== wrapperPath) return true;
  if (!Array.isArray(provider.args) || provider.args.length !== 0) return true;
  return false;
}

async function persistEncrypted(cfg: AppConfig, configPath: string): Promise<AppConfig> {
  const s = cfg.accounts.app.secret;
  if (typeof s !== 'string') {
    await saveConfig(cfg, configPath);
    return cfg;
  }
  const next = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
  );
  await setSecret(secretKeyForApp(cfg.accounts.app.id), s);
  await saveConfig(next, configPath);
  return next;
}