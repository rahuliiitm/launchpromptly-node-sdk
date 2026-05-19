/**
 * LaunchPromptly MCP Defense Module
 *
 * Exports:
 *   - McpSecurityProxy — intercepts JSON-RPC tool calls, enforces policy
 *   - IdeConfigWatcherDaemon — monitors IDE MCP config for drift
 */

export { McpSecurityProxy } from './proxy';
export type { McpProxyPolicy, McpProxyAction, McpCallContext, McpProxyResult, AuditEventEmitter } from './proxy';

export { IdeConfigWatcherDaemon } from './ide-watcher';
export type { WatcherAlert, WatcherAlertLevel, WatcherAlertCallback } from './ide-watcher';

export { spawnSandboxed } from './stdio-sandbox';
export type { SandboxedProcessOptions, SandboxedProcess } from './stdio-sandbox';
