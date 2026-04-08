/**
 * Periodic analysis and insight generation for the Serenity Self-Improvement Engine
 */

import type { Insight, ToolCallMetric, ToolStats } from "./types.js";

/**
 * Generates insights from tool usage metrics and memory data
 */
export class InsightGenerator {
  /**
   * Generate insights from metrics and memory data
   */
  generateInsights(memories: unknown[], metrics: ToolCallMetric[]): Insight[] {
    const insights: Insight[] = [];
    const timestamp = new Date().toISOString();
    
    // Analyze tool usage patterns
    insights.push(...this.analyzeToolUsage(metrics, timestamp));
    
    // Analyze failure patterns
    insights.push(...this.analyzeFailurePatterns(metrics, timestamp));
    
    // Analyze peak usage times
    insights.push(...this.analyzeUsageTime(metrics, timestamp));
    
    // Analyze request types (from memory if available)
    insights.push(...this.analyzeRequestTypes(memories, timestamp));
    
    // Generate recommendations
    insights.push(...this.generateRecommendations(metrics, timestamp));
    
    return insights.filter((insight) => insight.significance > 0.3);
  }

  /**
   * Analyze tool usage patterns
   */
  private analyzeToolUsage(metrics: ToolCallMetric[], timestamp: string): Insight[] {
    const insights: Insight[] = [];
    
    if (metrics.length === 0) {
      return insights;
    }

    // Group by tool name
    const toolGroups = new Map<string, ToolCallMetric[]>();
    for (const metric of metrics) {
      const existing = toolGroups.get(metric.toolName) || [];
      existing.push(metric);
      toolGroups.set(metric.toolName, existing);
    }

    // Find most used tools
    const sortedTools = Array.from(toolGroups.entries())
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 5);

    if (sortedTools.length > 0) {
      const [topTool, topMetrics] = sortedTools[0];
      const percentage = ((topMetrics.length / metrics.length) * 100).toFixed(1);
      
      insights.push({
        id: `tool-usage-${Date.now()}`,
        text: `The ${topTool} tool accounts for ${percentage}% of all tool usage (${topMetrics.length} out of ${metrics.length} calls). This suggests it's a core capability.`,
        kind: "pattern",
        entities: [topTool],
        createdAt: timestamp,
        significance: 0.7,
        metadata: {
          toolName: topTool,
          usage: topMetrics.length,
          percentage: parseFloat(percentage),
        },
      });
    }

    // Identify underused tools
    const underusedTools = Array.from(toolGroups.entries())
      .filter(([, toolMetrics]) => toolMetrics.length === 1)
      .map(([toolName]) => toolName);

    if (underusedTools.length > 2) {
      insights.push({
        id: `underused-tools-${Date.now()}`,
        text: `Several tools are rarely used: ${underusedTools.slice(0, 3).join(", ")}. Consider if these are needed or if there are barriers to their usage.`,
        kind: "trend",
        entities: underusedTools,
        createdAt: timestamp,
        significance: 0.5,
        metadata: {
          underusedTools,
          count: underusedTools.length,
        },
      });
    }

    return insights;
  }

  /**
   * Analyze failure patterns
   */
  private analyzeFailurePatterns(metrics: ToolCallMetric[], timestamp: string): Insight[] {
    const insights: Insight[] = [];
    
    const failures = metrics.filter((m) => !m.success);
    if (failures.length === 0) {
      return insights;
    }

    const failureRate = (failures.length / metrics.length) * 100;
    
    // High failure rate warning
    if (failureRate > 20) {
      insights.push({
        id: `high-failure-rate-${Date.now()}`,
        text: `Tool failure rate is ${failureRate.toFixed(1)}% (${failures.length} out of ${metrics.length} calls). This is higher than normal and may indicate system issues.`,
        kind: "warning",
        entities: [],
        createdAt: timestamp,
        significance: 0.8,
        metadata: {
          failureRate,
          totalFailures: failures.length,
          totalCalls: metrics.length,
        },
      });
    }

    // Analyze failure patterns by tool
    const failuresByTool = new Map<string, ToolCallMetric[]>();
    for (const failure of failures) {
      const existing = failuresByTool.get(failure.toolName) || [];
      existing.push(failure);
      failuresByTool.set(failure.toolName, existing);
    }

    // Find tools with high failure rates
    for (const [toolName, toolFailures] of failuresByTool) {
      const toolMetrics = metrics.filter((m) => m.toolName === toolName);
      const toolFailureRate = (toolFailures.length / toolMetrics.length) * 100;
      
      if (toolFailureRate > 30 && toolMetrics.length >= 3) {
        // Analyze common error messages
        const errorMessages = toolFailures
          .map((f) => f.errorMessage)
          .filter(Boolean);
        const commonError = this.findMostCommon(errorMessages);
        
        insights.push({
          id: `tool-reliability-${toolName}-${Date.now()}`,
          text: `The ${toolName} tool has a ${toolFailureRate.toFixed(1)}% failure rate. ${commonError ? `Common error: "${commonError}"` : "Consider investigating the root cause."}`,
          kind: "warning",
          entities: [toolName],
          createdAt: timestamp,
          significance: 0.6,
          metadata: {
            toolName,
            failureRate: toolFailureRate,
            commonError,
            failureCount: toolFailures.length,
          },
        });
      }
    }

    return insights;
  }

  /**
   * Analyze usage times to find peak periods
   */
  private analyzeUsageTime(metrics: ToolCallMetric[], timestamp: string): Insight[] {
    const insights: Insight[] = [];
    
    if (metrics.length < 10) {
      return insights; // Need sufficient data
    }

    // Group by hour of day
    const hourlyUsage = new Map<number, number>();
    for (const metric of metrics) {
      const hour = new Date(metric.timestamp).getHours();
      hourlyUsage.set(hour, (hourlyUsage.get(hour) || 0) + 1);
    }

    // Find peak hour
    const sortedHours = Array.from(hourlyUsage.entries())
      .sort(([, a], [, b]) => b - a);

    if (sortedHours.length > 0) {
      const [peakHour, peakUsage] = sortedHours[0];
      const peakPercentage = (peakUsage / metrics.length) * 100;
      
      if (peakPercentage > 20) {
        const timeString = `${peakHour}:00-${(peakHour + 1) % 24}:00`;
        
        insights.push({
          id: `peak-usage-${Date.now()}`,
          text: `Peak usage occurs between ${timeString} with ${peakPercentage.toFixed(1)}% of all tool calls. This represents your most active working period.`,
          kind: "trend",
          entities: [],
          createdAt: timestamp,
          significance: 0.6,
          metadata: {
            peakHour,
            peakUsage,
            peakPercentage,
            timeString,
          },
        });
      }
    }

    return insights;
  }

  /**
   * Analyze request types from memory (if available)
   */
  private analyzeRequestTypes(memories: unknown[], timestamp: string): Insight[] {
    const insights: Insight[] = [];
    
    // This would need to be implemented based on the memory format
    // For now, we'll return a placeholder insight if memories exist
    if (memories.length > 50) {
      insights.push({
        id: `memory-growth-${Date.now()}`,
        text: `Memory collection has grown to ${memories.length} entries, indicating active learning and knowledge accumulation.`,
        kind: "trend",
        entities: ["memory"],
        createdAt: timestamp,
        significance: 0.5,
        metadata: {
          memoryCount: memories.length,
        },
      });
    }

    return insights;
  }

  /**
   * Generate strategic recommendations
   */
  private generateRecommendations(metrics: ToolCallMetric[], timestamp: string): Insight[] {
    const insights: Insight[] = [];
    
    if (metrics.length < 10) {
      return insights;
    }

    // Analyze tool diversity
    const uniqueTools = new Set(metrics.map((m) => m.toolName)).size;
    const toolDiversity = uniqueTools / metrics.length;
    
    if (toolDiversity < 0.3) {
      insights.push({
        id: `tool-diversity-${Date.now()}`,
        text: `You're using ${uniqueTools} different tools out of ${metrics.length} total calls. Consider exploring additional capabilities to broaden your workflow automation.`,
        kind: "recommendation",
        entities: [],
        createdAt: timestamp,
        significance: 0.5,
        metadata: {
          uniqueTools,
          totalCalls: metrics.length,
          diversity: toolDiversity,
        },
      });
    }

    // Analyze performance trends
    const avgDuration = metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length;
    const recentMetrics = metrics.slice(-Math.floor(metrics.length / 2));
    const recentAvgDuration = recentMetrics.reduce((sum, m) => sum + m.durationMs, 0) / recentMetrics.length;
    
    const performanceChange = ((recentAvgDuration - avgDuration) / avgDuration) * 100;
    
    if (Math.abs(performanceChange) > 20) {
      const trend = performanceChange > 0 ? "increased" : "decreased";
      const impact = performanceChange > 0 ? "This may indicate system load or complexity growth." : "This suggests improved efficiency.";
      
      insights.push({
        id: `performance-trend-${Date.now()}`,
        text: `Average tool execution time has ${trend} by ${Math.abs(performanceChange).toFixed(1)}% recently. ${impact}`,
        kind: "trend",
        entities: [],
        createdAt: timestamp,
        significance: 0.6,
        metadata: {
          avgDuration,
          recentAvgDuration,
          performanceChange,
        },
      });
    }

    return insights;
  }

  /**
   * Find the most common item in an array
   */
  private findMostCommon<T>(items: T[]): T | null {
    if (items.length === 0) return null;
    
    const counts = new Map<T, number>();
    for (const item of items) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    
    let maxCount = 0;
    let mostCommon: T | null = null;
    
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    }
    
    return mostCommon;
  }
}

