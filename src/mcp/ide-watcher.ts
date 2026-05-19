/**
 * IDE Config Watcher Daemon
 *
 * Monitors ~/.cursor/mcp.json and other IDE MCP config files for drift.
 * Runs as a background process and alerts when:
 *   - A new STDIO MCP server is added
 *   - A known-risky command is found in an existing server config
 *   - The config file changes unexpectedly
 *
 * Uses @launchpromptly/mcp-core for detection logic.
 */

import { watch } from 'fs';
import { detectIdeConfigDrift, IDE_CONFIG_PATHS } from '@launchpromptly/mcp-core';

export type WatcherAlertLevel = 'info' | 'warn' | 'critical';

export interface WatcherAlert {
  configPath: string;
  level: WatcherAlertLevel;
  message: string;
  risks: string[];
  timestamp: string;
}

export type WatcherAlertCallback = (alert: WatcherAlert) => void | Promise<void>;

interface WatcherState {
  configPath: string;
  lastHash: string | undefined;
  watcher: ReturnType<typeof watch> | null;
}

export class IdeConfigWatcherDaemon {
  private states = new Map<string, WatcherState>();
  private onAlert: WatcherAlertCallback;
  private running = false;

  constructor(opts: { onAlert: WatcherAlertCallback }) {
    this.onAlert = opts.onAlert;
  }

  async start(ide?: string): Promise<void> {
    this.running = true;
    const paths = ide
      ? (IDE_CONFIG_PATHS[ide] ?? [])
      : Object.values(IDE_CONFIG_PATHS).flat();

    for (const configPath of paths) {
      await this.watchPath(configPath);
    }
  }

  stop(): void {
    this.running = false;
    for (const state of this.states.values()) {
      state.watcher?.close();
    }
    this.states.clear();
  }

  private async watchPath(configPath: string): Promise<void> {
    // Initial scan
    const initial = await detectIdeConfigDrift(configPath, undefined);
    this.states.set(configPath, {
      configPath,
      lastHash: initial.currentHash === 'missing' ? undefined : initial.currentHash,
      watcher: null,
    });

    if (initial.riskEntries.length > 0) {
      await this.emitAlert(configPath, initial.riskEntries.flatMap(e => e.risks), false);
    }

    // File watcher
    try {
      const watcher = watch(configPath, { persistent: false }, async (event) => {
        if (!this.running) return;
        if (event !== 'change') return;

        const state = this.states.get(configPath);
        const result = await detectIdeConfigDrift(configPath, state?.lastHash);

        if (state) {
          state.lastHash = result.currentHash;
        }

        if (result.changed) {
          const allRisks = result.riskEntries.flatMap(e => e.risks);
          await this.emitAlert(configPath, allRisks, true);
        }
      });

      const state = this.states.get(configPath);
      if (state) state.watcher = watcher;
    } catch {
      // File doesn't exist yet — skip watcher (poll-based fallback could go here)
    }
  }

  private async emitAlert(configPath: string, risks: string[], changed: boolean): Promise<void> {
    const hasCritical = risks.some(r =>
      r.toLowerCase().includes('critical') || r.toLowerCase().includes('executes') || r.toLowerCase().includes('rce'),
    );
    const level: WatcherAlertLevel = hasCritical ? 'critical' : risks.length > 0 ? 'warn' : 'info';

    await this.onAlert({
      configPath,
      level,
      message: changed
        ? `MCP config file changed: ${configPath}`
        : `MCP config risk detected: ${configPath}`,
      risks,
      timestamp: new Date().toISOString(),
    });
  }
}
