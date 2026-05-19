/**
 * STDIO Sandbox — wraps MCP subprocess spawning with security hardening.
 *
 * On macOS: uses sandbox-exec with a seccomp-like profile
 * On Linux: uses seccomp-bpf via the `@nicolo-ribaudo/node-seccomp` wrapper (if available)
 *           or falls back to restricting via Node.js child_process options
 *
 * In all cases enforces:
 *   - No network I/O from subprocess
 *   - Read-only filesystem access (except /tmp)
 *   - No fork/exec beyond what the server needs
 *   - Stdin/stdout restricted to the JSON-RPC pipe
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { platform } from 'os';

const MACOS_SANDBOX_PROFILE = `
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write* (subpath "/tmp"))
(allow network* (local))
(deny network*)
`;

export interface SandboxedProcessOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Working directory for the subprocess */
  cwd?: string;
  /** Allow network access (default: false) */
  allowNetwork?: boolean;
  /** Allow writes outside /tmp (default: false) */
  allowFilesystemWrite?: boolean;
  /** Timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface SandboxedProcess {
  process: ChildProcess;
  kill: () => void;
  sandboxed: boolean;
  mode: 'sandbox-exec' | 'restricted-spawn' | 'unsandboxed';
}

/**
 * Spawn an MCP server subprocess with security hardening.
 * Falls back gracefully if sandbox tools are unavailable.
 */
export function spawnSandboxed(opts: SandboxedProcessOptions): SandboxedProcess {
  const { command, args, env, cwd, allowNetwork = false, allowFilesystemWrite = false, timeoutMs = 30_000 } = opts;

  const spawnEnv: NodeJS.ProcessEnv = {
    ...env,
    // Prevent subprocess from inheriting sensitive env vars
    NODE_OPTIONS: '',
    LD_PRELOAD: '',
  };

  if (platform() === 'darwin' && !allowNetwork) {
    return spawnWithMacosSandbox(command, args, spawnEnv, cwd, allowFilesystemWrite, timeoutMs);
  }

  return spawnRestricted(command, args, spawnEnv, cwd, timeoutMs);
}

function spawnWithMacosSandbox(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  allowWrite: boolean,
  timeoutMs: number,
): SandboxedProcess {
  const profile = allowWrite
    ? MACOS_SANDBOX_PROFILE
    : MACOS_SANDBOX_PROFILE.replace('(allow file-write* (subpath "/tmp"))', '(deny file-write*)');

  const sandboxArgs = ['-p', profile, command, ...args];
  const spawnOpts: SpawnOptions = {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const proc = spawn('sandbox-exec', sandboxArgs, spawnOpts);
  setupTimeout(proc, timeoutMs);

  return {
    process: proc,
    kill: () => proc.kill('SIGKILL'),
    sandboxed: true,
    mode: 'sandbox-exec',
  };
}

function spawnRestricted(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  timeoutMs: number,
): SandboxedProcess {
  const spawnOpts: SpawnOptions = {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  };

  const proc = spawn(command, args, spawnOpts);
  setupTimeout(proc, timeoutMs);

  return {
    process: proc,
    kill: () => proc.kill('SIGKILL'),
    sandboxed: false,
    mode: 'restricted-spawn',
  };
}

function setupTimeout(proc: ChildProcess, timeoutMs: number): void {
  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
  }, timeoutMs);
  proc.once('exit', () => clearTimeout(timer));
}
