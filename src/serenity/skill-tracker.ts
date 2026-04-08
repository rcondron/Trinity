/**
 * Tool/skill usage tracking for the Serenity Self-Improvement Engine
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ToolCallMetric, ToolStats } from "./types.js";

/**
 * Tracks tool usage metrics and provides statistics
 */
export class SkillTracker {
  private metricsFile: string;
  private retentionDays: number;

  constructor(dataDir: string, retentionDays = 30) {
    this.metricsFile = join(dataDir, "metrics.json");
    this.retentionDays = retentionDays;
    this.ensureDataDir();
  }

  /**
   * Ensure the data directory exists
   */
  private ensureDataDir(): void {
    const dir = dirname(this.metricsFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load existing metrics from disk
   */
  private loadMetrics(): ToolCallMetric[] {
    if (!existsSync(this.metricsFile)) {
      return [];
    }

    try {
      const content = readFileSync(this.metricsFile, "utf-8");
      const metrics = JSON.parse(content) as ToolCallMetric[];
      return Array.isArray(metrics) ? metrics : [];
    } catch (error) {
      console.warn(`Failed to load metrics: ${error}`);
      return [];
    }
  }

  /**
   * Save metrics to disk
   */
  private saveMetrics(metrics: ToolCallMetric[]): void {
    try {
      const content = JSON.stringify(metrics, null, 2);
      writeFileSync(this.metricsFile, content, "utf-8");
    } catch (error) {
      console.warn(`Failed to save metrics: ${error}`);
    }
  }

  /**
   * Prune old metrics beyond the retention window
   */
  private pruneOldMetrics(metrics: ToolCallMetric[]): ToolCallMetric[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffTime = cutoffDate.getTime();

    return metrics.filter((metric) => {
      const metricTime = new Date(metric.timestamp).getTime();
      return metricTime >= cutoffTime;
    });
  }

  /**
   * Record a tool call metric
   */
  recordToolCall(metric: ToolCallMetric): void {
    const metrics = this.loadMetrics();
    metrics.push(metric);

    // Prune old metrics to maintain rolling window
    const prunedMetrics = this.pruneOldMetrics(metrics);
    
    this.saveMetrics(prunedMetrics);
  }

  /**
   * Get statistics for a specific tool or all tools
   */
  getStats(toolName?: string, days?: number): Record<string, ToolStats> {
    const metrics = this.loadMetrics();
    const cutoffDate = new Date();
    if (days !== undefined) {
      cutoffDate.setDate(cutoffDate.getDate() - days);
    } else {
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    }
    const cutoffTime = cutoffDate.getTime();

    // Filter metrics by time window and optionally by tool name
    const filteredMetrics = metrics.filter((metric) => {
      const metricTime = new Date(metric.timestamp).getTime();
      const inTimeWindow = metricTime >= cutoffTime;
      const matchesTool = !toolName || metric.toolName === toolName;
      return inTimeWindow && matchesTool;
    });

    // Group metrics by tool name
    const groupedMetrics = new Map<string, ToolCallMetric[]>();
    for (const metric of filteredMetrics) {
      const existing = groupedMetrics.get(metric.toolName) || [];
      existing.push(metric);
      groupedMetrics.set(metric.toolName, existing);
    }

    // Calculate stats for each tool
    const stats: Record<string, ToolStats> = {};
    for (const [tool, toolMetrics] of groupedMetrics) {
      const successfulCalls = toolMetrics.filter((m) => m.success);
      const failedCalls = toolMetrics.filter((m) => !m.success);

      // Calculate error breakdown
      const errorBreakdown: Record<string, number> = {};
      for (const failedCall of failedCalls) {
        const error = failedCall.errorMessage || "Unknown error";
        errorBreakdown[error] = (errorBreakdown[error] || 0) + 1;
      }

      // Calculate average duration
      const totalDuration = toolMetrics.reduce((sum, m) => sum + m.durationMs, 0);
      const avgDuration = toolMetrics.length > 0 ? totalDuration / toolMetrics.length : 0;

      // Calculate trend (simple: compare last week vs previous week)
      let trend: number | undefined;
      if (days === undefined || days >= 14) {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const lastWeek = toolMetrics.filter((m) => new Date(m.timestamp) >= oneWeekAgo);
        const previousWeek = toolMetrics.filter((m) => {
          const date = new Date(m.timestamp);
          return date >= twoWeeksAgo && date < oneWeekAgo;
        });

        if (previousWeek.length > 0) {
          trend = (lastWeek.length - previousWeek.length) / previousWeek.length;
        }
      }

      stats[tool] = {
        totalCalls: toolMetrics.length,
        successRate: toolMetrics.length > 0 ? successfulCalls.length / toolMetrics.length : 0,
        avgDuration,
        errorBreakdown,
        trend,
      };
    }

    return stats;
  }

  /**
   * Get top tools by usage count
   */
  getTopTools(limit = 10, days?: number): Array<{ toolName: string; stats: ToolStats }> {
    const stats = this.getStats(undefined, days);
    const tools = Object.entries(stats)
      .map(([toolName, toolStats]) => ({ toolName, stats: toolStats }))
      .sort((a, b) => b.stats.totalCalls - a.stats.totalCalls)
      .slice(0, limit);

    return tools;
  }

  /**
   * Get all metrics within the specified time window
   */
  getRecentMetrics(days = 7): ToolCallMetric[] {
    const metrics = this.loadMetrics();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTime = cutoffDate.getTime();

    return metrics.filter((metric) => {
      const metricTime = new Date(metric.timestamp).getTime();
      return metricTime >= cutoffTime;
    });
  }

  /**
   * Clear all metrics (for testing or reset)
   */
  clearMetrics(): void {
    this.saveMetrics([]);
  }
}

