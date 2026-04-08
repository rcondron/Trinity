/**
 * Type definitions for the Serenity Self-Improvement Engine
 */

/**
 * Metrics for a single tool call
 */
export interface ToolCallMetric {
  /** Name of the tool that was called */
  toolName: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Duration of the tool call in milliseconds */
  durationMs: number;
  /** Error message if the tool call failed */
  errorMessage?: string;
  /** Timestamp when the tool was called */
  timestamp: string;
  /** Session key that identifies the session */
  sessionKey: string;
  /** Optional parameters passed to the tool */
  params?: Record<string, unknown>;
  /** Optional result from the tool */
  result?: unknown;
}

/**
 * A detected pattern of tool usage that could be automated
 */
export interface SkillPattern {
  /** Sequence of tools used together in order */
  toolSequence: string[];
  /** Pattern that triggers this sequence (from user prompt analysis) */
  triggerPattern: string;
  /** Success rate of this pattern (0-1) */
  successRate: number;
  /** Last time this pattern was detected */
  lastUsed: string;
  /** Number of times this pattern has been observed */
  occurrences: number;
  /** Parameters that tend to be used with this pattern */
  commonParams?: Record<string, unknown>;
  /** Human-readable description of what this pattern does */
  description?: string;
}

/**
 * An insight generated from analyzing usage patterns
 */
export interface Insight {
  /** Unique identifier for this insight */
  id: string;
  /** Human-readable text describing the insight */
  text: string;
  /** Type of insight */
  kind: "pattern" | "trend" | "recommendation" | "warning";
  /** Entities or tools this insight relates to */
  entities: string[];
  /** When this insight was created */
  createdAt: string;
  /** Significance score (0-1) */
  significance: number;
  /** Optional data supporting this insight */
  metadata?: Record<string, unknown>;
}

/**
 * Statistics about tool usage
 */
export interface ToolStats {
  /** Total number of calls */
  totalCalls: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average duration in milliseconds */
  avgDuration: number;
  /** Breakdown of error types */
  errorBreakdown: Record<string, number>;
  /** Recent trend (positive = increasing usage) */
  trend?: number;
}

/**
 * Configuration for the Serenity engine
 */
export interface SerenityConfig {
  /** Whether Serenity is enabled */
  enabled: boolean;
  /** How long to retain metrics (days) */
  metricsRetentionDays: number;
  /** Whether to automatically create skills from patterns */
  autoSkillCreation: boolean;
  /** How often to generate insights */
  insightSchedule: "daily" | "weekly" | "monthly";
  /** Directory to store Serenity data */
  dataDir: string;
  /** Minimum success rate for patterns to become skills */
  minPatternSuccessRate: number;
  /** Minimum occurrences for pattern detection */
  minPatternOccurrences: number;
}

