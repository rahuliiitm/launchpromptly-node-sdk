#!/usr/bin/env node
/**
 * launchpromptly mcp scan
 *
 * Scans IDE MCP configuration files for security risks:
 *   - STDIO server inventory
 *   - Argv injection patterns
 *   - CVE matches against installed MCP packages
 *   - IDE config drift detection
 *
 * Usage:
 *   npx launchpromptly mcp scan
 *   npx launchpromptly mcp scan --ide cursor
 *   npx launchpromptly mcp scan --output json
 *   npx launchpromptly mcp scan --watch
 */

import { parseMcpConfig, detectArgvInjection, matchMcpCve, analyzeMcpTool, IDE_CONFIG_PATHS } from '@launchpromptly/mcp-core';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

interface ScanResult {
  configPath: string;
  exists: boolean;
  servers: Array<{
    name: string;
    command: string;
    args: string[];
    isStdio: boolean;
    argvRisks: string[];
    toolRisks: string[];
    cveMatches: string[];
    overallSeverity: string;
  }>;
  totalRisks: number;
}

async function scanConfig(configPath: string): Promise<ScanResult> {
  if (!existsSync(configPath)) {
    return { configPath, exists: false, servers: [], totalRisks: 0 };
  }

  const entries = await parseMcpConfig(configPath);
  const servers: ScanResult['servers'] = [];

  for (const entry of entries) {
    const argvResult = detectArgvInjection([entry.command, ...entry.args]);
    const toolAnalysis = analyzeMcpTool(entry.name, '', entry.args);
    const cveMatches = matchMcpCve(entry.command);

    const argvRisks = argvResult.violations.map(v =>
      `${SEVERITY_ICON[v.severity]} [${v.ruleId}] ${v.description}`,
    );
    const toolRisks = toolAnalysis.reasons.map(r => `${SEVERITY_ICON[toolAnalysis.risk]} ${r}`);
    const cveRisks = cveMatches.map(c => `${SEVERITY_ICON[c.severity]} ${c.cveId}: ${c.description}`);

    const severities = [
      argvResult.highestSeverity ?? 'info',
      toolAnalysis.risk,
      cveMatches[0]?.severity ?? 'info',
    ];
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    const overallSeverity = severityOrder.find(s => severities.includes(s)) ?? 'info';

    servers.push({
      name: entry.name,
      command: entry.command,
      args: entry.args,
      isStdio: entry.isStdio,
      argvRisks,
      toolRisks,
      cveMatches: cveRisks,
      overallSeverity,
    });
  }

  const totalRisks = servers.reduce(
    (sum, s) => sum + s.argvRisks.length + s.toolRisks.length + s.cveMatches.length,
    0,
  );

  return { configPath, exists: true, servers, totalRisks };
}

function printResult(result: ScanResult): void {
  if (!result.exists) {
    console.log(`  ⚪ ${result.configPath} — not found`);
    return;
  }

  const total = result.servers.length;
  const risky = result.servers.filter(s => s.overallSeverity !== 'info').length;

  console.log(`\n📁 ${result.configPath}`);
  console.log(`   ${total} server(s) found, ${risky} with risks`);

  for (const server of result.servers) {
    console.log(`\n   ${SEVERITY_ICON[server.overallSeverity]} ${server.name}`);
    console.log(`      command: ${server.command} ${server.args.slice(0, 3).join(' ')}`);
    console.log(`      transport: ${server.isStdio ? 'STDIO (⚠️ higher risk)' : 'HTTP'}`);

    for (const risk of [...server.argvRisks, ...server.toolRisks, ...server.cveMatches]) {
      console.log(`      ${risk}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ideFilter = args[args.indexOf('--ide') + 1] as string | undefined;
  const outputJson = args.includes('--output') && args[args.indexOf('--output') + 1] === 'json';

  const paths: string[] = [];
  if (ideFilter && IDE_CONFIG_PATHS[ideFilter]) {
    paths.push(...IDE_CONFIG_PATHS[ideFilter]);
  } else {
    for (const p of Object.values(IDE_CONFIG_PATHS)) {
      paths.push(...p);
    }
  }

  const deduped = [...new Set(paths)];

  if (!outputJson) {
    console.log('\n🛡️  LaunchPromptly MCP Security Scan\n');
    console.log('Scanning MCP configuration files...');
  }

  const results: ScanResult[] = [];
  for (const configPath of deduped) {
    const result = await scanConfig(configPath);
    results.push(result);
    if (!outputJson) printResult(result);
  }

  if (outputJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const totalServers = results.flatMap(r => r.servers).length;
  const totalRisks = results.reduce((sum, r) => sum + r.totalRisks, 0);
  const critical = results.flatMap(r => r.servers).filter(s => s.overallSeverity === 'critical').length;

  console.log('\n' + '─'.repeat(50));
  console.log(`\n📊 Summary: ${totalServers} servers across ${results.filter(r => r.exists).length} config files`);
  console.log(`   Total risks: ${totalRisks} | Critical: ${critical}`);

  if (critical > 0) {
    console.log('\n⚠️  Critical risks detected. Run with --output json for machine-readable output.');
    console.log('   Consider using launchpromptly mcp proxy to intercept and enforce policy.\n');
    process.exit(1);
  } else if (totalRisks > 0) {
    console.log('\n⚠️  Risks detected. Review and apply the MCP proxy for protection.\n');
    process.exit(0);
  } else {
    console.log('\n✅ No risks detected. Your MCP config looks clean.\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Scan failed:', err);
  process.exit(2);
});
