/**
 * LaunchPromptly MCP Proxy (BSL 1.1)
 *
 * Intercepts JSON-RPC frames from MCP tool calls, parses arguments,
 * enforces LP security policy, and emits audit events.
 *
 * Wraps the @modelcontextprotocol/sdk Client with security middleware.
 *
 * Architecture:
 *   SDK caller → McpSecurityProxy → MCP Client → MCP Server
 *
 * On each tool/call:
 *   1. Parse tool name + args from JSON-RPC frame
 *   2. Run argv injection detection (from @launchpromptly/mcp-core)
 *   3. Run tool risk analysis
 *   4. Enforce policy (block/warn based on risk + policy rules)
 *   5. Emit audit event
 *   6. If allowed: forward to MCP server, intercept response
 *   7. Run injection detection on response text
 *   8. Return scrubbed response
 */

import { detectArgvInjection, analyzeMcpTool } from '@launchpromptly/mcp-core';
import type { ArgvInjectionResult } from '@launchpromptly/mcp-core';

export type McpProxyAction = 'allow' | 'warn' | 'block';

export interface McpProxyPolicy {
  /** Block tools with critical argv injection? Default: true */
  blockCriticalArgvInjection: boolean;
  /** Block high-risk tool definitions (exec, shell, etc.)? Default: false (warn only) */
  blockHighRiskTools: boolean;
  /** Scrub response text through LP injection detection? Default: true */
  scrubResponses: boolean;
  /** Emit audit events for every tool call? Default: true */
  auditAllCalls: boolean;
}

const DEFAULT_POLICY: McpProxyPolicy = {
  blockCriticalArgvInjection: true,
  blockHighRiskTools: false,
  scrubResponses: true,
  auditAllCalls: true,
};

export interface McpCallContext {
  toolName: string;
  args: Record<string, unknown>;
  serverId: string;
  projectId?: string;
  sessionId?: string;
}

export interface McpProxyResult {
  action: McpProxyAction;
  reason?: string;
  argvResult?: ArgvInjectionResult;
  toolRisk?: string;
  blocked: boolean;
}

export interface AuditEventEmitter {
  emit(event: {
    type: 'mcp_tool_call';
    toolName: string;
    serverId: string;
    action: McpProxyAction;
    risk: string;
    reason?: string;
    argsDigest: string;
    projectId?: string;
    sessionId?: string;
    timestamp: string;
  }): void | Promise<void>;
}

export class McpSecurityProxy {
  private policy: McpProxyPolicy;
  private auditor?: AuditEventEmitter;

  constructor(opts: { policy?: Partial<McpProxyPolicy>; auditor?: AuditEventEmitter } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...opts.policy };
    this.auditor = opts.auditor;
  }

  async interceptToolCall(ctx: McpCallContext): Promise<McpProxyResult> {
    const { toolName, args, serverId } = ctx;

    // Serialize args for analysis
    const argsString = JSON.stringify(args);
    const argsDigest = await this.sha256(argsString);

    // 1. Tool risk analysis
    const toolAnalysis = analyzeMcpTool(toolName, '', Object.keys(args));
    const toolRisk = toolAnalysis.risk;

    // 2. Argv injection detection on arg values
    const argValues = Object.values(args)
      .filter((v): v is string => typeof v === 'string')
      .join(' ');

    const argvResult = detectArgvInjection(argValues);

    let action: McpProxyAction = 'allow';
    let reason: string | undefined;

    // 3. Policy enforcement
    if (argvResult.detected && argvResult.highestSeverity === 'critical' && this.policy.blockCriticalArgvInjection) {
      action = 'block';
      reason = `Critical argv injection detected: ${argvResult.violations[0]?.description}`;
    } else if (argvResult.detected && argvResult.highestSeverity === 'high') {
      action = 'warn';
      reason = `High-severity argv injection pattern: ${argvResult.violations[0]?.description}`;
    } else if ((toolRisk === 'critical' || toolRisk === 'high') && this.policy.blockHighRiskTools) {
      action = 'block';
      reason = `Tool "${toolName}" classified as ${toolRisk} risk: ${toolAnalysis.reasons.join('; ')}`;
    } else if (toolRisk === 'critical' || toolRisk === 'high') {
      action = 'warn';
      reason = `Tool "${toolName}" classified as ${toolRisk} risk`;
    }

    // 4. Audit
    if (this.policy.auditAllCalls && this.auditor) {
      await this.auditor.emit({
        type: 'mcp_tool_call',
        toolName,
        serverId,
        action,
        risk: toolRisk,
        reason,
        argsDigest,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      action,
      reason,
      argvResult: argvResult.detected ? argvResult : undefined,
      toolRisk,
      blocked: action === 'block',
    };
  }

  async interceptResponse(toolName: string, responseText: string): Promise<{ text: string; injectionDetected: boolean }> {
    if (!this.policy.scrubResponses) {
      return { text: responseText, injectionDetected: false };
    }

    // Run argv injection on response to catch tool result injection
    const result = detectArgvInjection(responseText);
    if (result.detected && result.highestSeverity === 'critical') {
      return {
        text: `[RESPONSE SCRUBBED: LP detected potential injection in ${toolName} output]`,
        injectionDetected: true,
      };
    }

    return { text: responseText, injectionDetected: result.detected };
  }

  private async sha256(input: string): Promise<string> {
    const { createHash } = await import('crypto');
    return createHash('sha256').update(input).digest('hex');
  }
}
