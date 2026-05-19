#!/usr/bin/env node
/**
 * `npx launchpromptly dev`
 *
 * Starts a local launchpromptly-scanner container (Docker required) and
 * prints the LP_SCANNER_URL export. Falls back gracefully to regex-only mode
 * if Docker is unavailable.
 *
 * Usage:
 *   npx launchpromptly dev
 *   npx launchpromptly dev --port 7080 --tag latest
 *
 * License: BSL-1.1 (converts to Apache-2.0 after 4 years)
 */

import { execSync, spawn } from 'child_process';
import { createInterface } from 'readline';

const SCANNER_IMAGE = 'ghcr.io/launchpromptly/scanner';
const CONTAINER_NAME = 'lp-scanner-dev';
const DEFAULT_PORT = 7080;
const HEALTH_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 60_000;

function parseArgs() {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let tag = 'latest';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    if (args[i] === '--tag' && args[i + 1]) tag = args[++i];
  }
  return { port, tag };
}

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isContainerRunning(name: string): boolean {
  try {
    const out = execSync(`docker inspect --format '{{.State.Running}}' ${name} 2>/dev/null`).toString().trim();
    return out === 'true';
  } catch {
    return false;
  }
}

async function waitForHealth(url: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function main() {
  const { port, tag } = parseArgs();
  const imageRef = `${SCANNER_IMAGE}:${tag}`;
  const scannerUrl = `http://localhost:${port}`;

  console.log('LaunchPromptly Dev Scanner\n');

  if (!isDockerAvailable()) {
    console.warn('⚠  Docker not found or not running.');
    console.warn('   Falling back to regex-only mode (no ML detection).');
    console.warn('   Start Docker and re-run `npx launchpromptly dev` for full ML capabilities.\n');
    printFallback();
    return;
  }

  // Stop old container if already running
  if (isContainerRunning(CONTAINER_NAME)) {
    console.log(`♻  Stopping existing ${CONTAINER_NAME} container...`);
    execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
    execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
  }

  console.log(`⬇  Pulling ${imageRef}...`);
  try {
    execSync(`docker pull ${imageRef}`, { stdio: 'inherit' });
  } catch {
    console.warn(`⚠  Could not pull ${imageRef}. Using cached image if available.`);
  }

  console.log(`\n🚀 Starting scanner on port ${port}...`);
  const dockerArgs = [
    'run', '--rm', '-d',
    '--name', CONTAINER_NAME,
    '-p', `${port}:7080`,
    '-e', 'LP_AUTH_REQUIRED=false',
    '-e', 'LOG_LEVEL=info',
    '--memory', '4g',
    imageRef,
  ];

  const proc = spawn('docker', dockerArgs, { stdio: 'pipe' });
  let containerId = '';
  proc.stdout.on('data', (d: Buffer) => { containerId = d.toString().trim(); });
  proc.stderr.on('data', (d: Buffer) => { process.stderr.write(d); });
  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`docker run failed (exit ${code})`))));
  });

  console.log(`   Container: ${containerId.substring(0, 12)}`);
  console.log('   Waiting for scanner to be healthy...');

  const healthy = await waitForHealth(scannerUrl);
  if (!healthy) {
    console.error('\n✗ Scanner did not become healthy within 60 s.');
    console.error('  Check logs: docker logs lp-scanner-dev');
    printFallback();
    process.exit(1);
  }

  console.log(`\n✓ Scanner is ready at ${scannerUrl}\n`);
  console.log('Set this in your shell to use the scanner:');
  console.log(`\n  export LP_SCANNER_URL=${scannerUrl}\n`);
  console.log('Or in your .env:');
  console.log(`\n  LP_SCANNER_URL=${scannerUrl}\n`);
  console.log('Press Ctrl+C to stop.\n');

  // Keep alive + stream logs
  const logProc = spawn('docker', ['logs', '-f', CONTAINER_NAME], { stdio: ['ignore', 'inherit', 'inherit'] });

  const rl = createInterface({ input: process.stdin });
  process.on('SIGINT', () => {
    console.log('\n\nStopping scanner...');
    logProc.kill();
    try {
      execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
      execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' });
    } catch {}
    console.log('Scanner stopped. Goodbye!');
    process.exit(0);
  });

  await new Promise<void>((resolve) => rl.on('close', resolve));
}

function printFallback() {
  console.log('The SDK will use regex-only detection (no ML scores).');
  console.log('No LP_SCANNER_URL needs to be set in fallback mode.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
