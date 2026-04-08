/**
 * Automatic skill creation from tool usage patterns
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillPattern, ToolCallMetric } from "./types.js";

/**
 * Detects patterns in tool usage and creates skills automatically
 */
export class SkillCreator {
  private skillsDir: string;
  private minOccurrences: number;
  private minSuccessRate: number;

  constructor(skillsDir: string, minOccurrences = 3, minSuccessRate = 0.7) {
    this.skillsDir = skillsDir;
    this.minOccurrences = minOccurrences;
    this.minSuccessRate = minSuccessRate;
  }

  /**
   * Detect patterns from recent tool usage metrics
   */
  detectPatterns(recentMetrics: ToolCallMetric[]): SkillPattern[] {
    const patterns: SkillPattern[] = [];
    const sessionGroups = this.groupMetricsBySession(recentMetrics);

    // Look for sequences of 3+ tools used together successfully
    for (const [sessionKey, metrics] of sessionGroups) {
      const sequences = this.extractToolSequences(metrics, 3);
      
      for (const sequence of sequences) {
        if (sequence.length >= 3) {
          patterns.push(...this.analyzeSequence(sequence));
        }
      }
    }

    // Aggregate similar patterns and filter by frequency and success rate
    const aggregatedPatterns = this.aggregatePatterns(patterns);
    
    return aggregatedPatterns.filter(
      (pattern) =>
        pattern.occurrences >= this.minOccurrences &&
        pattern.successRate >= this.minSuccessRate
    );
  }

  /**
   * Group metrics by session key to analyze sequences
   */
  private groupMetricsBySession(metrics: ToolCallMetric[]): Map<string, ToolCallMetric[]> {
    const groups = new Map<string, ToolCallMetric[]>();
    
    for (const metric of metrics) {
      const existing = groups.get(metric.sessionKey) || [];
      existing.push(metric);
      groups.set(metric.sessionKey, existing);
    }

    // Sort each session's metrics by timestamp
    for (const [sessionKey, sessionMetrics] of groups) {
      sessionMetrics.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      groups.set(sessionKey, sessionMetrics);
    }

    return groups;
  }

  /**
   * Extract tool sequences from a session's metrics
   */
  private extractToolSequences(metrics: ToolCallMetric[], minLength: number): ToolCallMetric[][] {
    const sequences: ToolCallMetric[][] = [];
    
    // Look for consecutive successful tool calls
    let currentSequence: ToolCallMetric[] = [];
    
    for (const metric of metrics) {
      if (metric.success) {
        currentSequence.push(metric);
      } else {
        // Tool failure breaks the sequence
        if (currentSequence.length >= minLength) {
          sequences.push([...currentSequence]);
        }
        currentSequence = [];
      }
    }
    
    // Add the final sequence if it's long enough
    if (currentSequence.length >= minLength) {
      sequences.push(currentSequence);
    }
    
    return sequences;
  }

  /**
   * Analyze a tool sequence to create a skill pattern
   */
  private analyzeSequence(sequence: ToolCallMetric[]): SkillPattern[] {
    const toolNames = sequence.map((m) => m.toolName);
    const toolSequence = [...new Set(toolNames)]; // Remove duplicates while preserving order
    
    if (toolSequence.length < 3) {
      return [];
    }

    // Generate a trigger pattern based on the tools involved
    const triggerPattern = this.generateTriggerPattern(toolSequence);
    
    // Calculate success rate (all tools in sequence were successful)
    const successRate = sequence.every((m) => m.success) ? 1.0 : 0.0;
    
    // Extract common parameters
    const commonParams = this.extractCommonParams(sequence);
    
    // Generate description
    const description = this.generateDescription(toolSequence);

    const pattern: SkillPattern = {
      toolSequence,
      triggerPattern,
      successRate,
      lastUsed: sequence[sequence.length - 1].timestamp,
      occurrences: 1,
      commonParams,
      description,
    };

    return [pattern];
  }

  /**
   * Generate a trigger pattern based on tool names
   */
  private generateTriggerPattern(toolNames: string[]): string {
    // Simple heuristic: create a pattern based on tool names
    const patterns: Record<string, string> = {
      web_search: "search|find|look up",
      web_fetch: "get|fetch|retrieve|read",
      browser: "navigate|open|click|browse",
      exec: "run|execute|command",
      write: "create|write|save|generate",
      read: "read|open|view|check",
      edit: "edit|modify|update|change",
      message: "send|notify|message|alert",
    };

    const keywords = toolNames
      .map((tool) => patterns[tool] || tool)
      .join("|");

    return `(?i)(${keywords})`;
  }

  /**
   * Extract common parameters from a sequence
   */
  private extractCommonParams(sequence: ToolCallMetric[]): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    
    // Look for parameters that appear in multiple tools
    const allParams = sequence
      .map((m) => m.params || {})
      .filter((p) => Object.keys(p).length > 0);
    
    if (allParams.length === 0) {
      return params;
    }

    // Find common parameter keys
    const commonKeys = Object.keys(allParams[0]).filter((key) =>
      allParams.every((p) => key in p)
    );

    for (const key of commonKeys) {
      const values = allParams.map((p) => p[key]);
      const uniqueValues = [...new Set(values)];
      
      // If all values are the same, it's a common parameter
      if (uniqueValues.length === 1) {
        params[key] = uniqueValues[0];
      }
    }

    return params;
  }

  /**
   * Generate a human-readable description
   */
  private generateDescription(toolNames: string[]): string {
    const descriptions: Record<string, string> = {
      web_search: "search the web",
      web_fetch: "fetch web content",
      browser: "interact with browser",
      exec: "execute commands",
      write: "write files",
      read: "read files",
      edit: "edit files",
      message: "send messages",
      tts: "convert text to speech",
      image: "analyze images",
    };

    const actions = toolNames.map((tool) => descriptions[tool] || tool);
    
    if (actions.length === 2) {
      return `${actions[0]} and ${actions[1]}`;
    } else if (actions.length === 3) {
      return `${actions[0]}, ${actions[1]}, and ${actions[2]}`;
    } else {
      return `${actions.slice(0, -1).join(", ")}, and ${actions[actions.length - 1]}`;
    }
  }

  /**
   * Aggregate similar patterns and combine their statistics
   */
  private aggregatePatterns(patterns: SkillPattern[]): SkillPattern[] {
    const patternMap = new Map<string, SkillPattern>();
    
    for (const pattern of patterns) {
      const key = pattern.toolSequence.join("->");
      const existing = patternMap.get(key);
      
      if (existing) {
        // Combine patterns with the same tool sequence
        existing.occurrences += 1;
        existing.successRate = (existing.successRate + pattern.successRate) / 2;
        existing.lastUsed = pattern.lastUsed > existing.lastUsed ? pattern.lastUsed : existing.lastUsed;
        
        // Merge common params (only keep params that are common across all instances)
        const mergedParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(existing.commonParams || {})) {
          if (pattern.commonParams?.[key] === value) {
            mergedParams[key] = value;
          }
        }
        existing.commonParams = mergedParams;
      } else {
        patternMap.set(key, { ...pattern });
      }
    }
    
    return Array.from(patternMap.values());
  }

  /**
   * Generate a SKILL.md file for a pattern
   */
  generateSkillMd(pattern: SkillPattern): string {
    const skillName = this.generateSkillName(pattern);
    const timestamp = new Date().toISOString().split("T")[0];
    
    return `# ${skillName}

*Auto-generated skill from pattern detection*  
*Created: ${timestamp}*  
*Success Rate: ${(pattern.successRate * 100).toFixed(1)}%*  
*Occurrences: ${pattern.occurrences}*

## Description

${pattern.description || "Automated sequence of tool calls"}

## Trigger Pattern

\`\`\`
${pattern.triggerPattern}
\`\`\`

## Tool Sequence

${pattern.toolSequence.map((tool, i) => `${i + 1}. \`${tool}\``).join("\n")}

## Steps

${pattern.toolSequence.map((tool, i) => `${i + 1}. **${tool}**: Use the ${tool} tool`).join("\n")}

## Common Parameters

${this.formatCommonParams(pattern.commonParams)}

## Usage

This skill is triggered when the user's request matches the pattern and involves ${pattern.description}.

## Lessons Learned

- ${timestamp}: Pattern detected from ${pattern.occurrences} successful sequences
- Success rate: ${(pattern.successRate * 100).toFixed(1)}%
- Last observed: ${pattern.lastUsed}

## Notes

This is an automatically generated skill. Review and modify as needed based on actual usage patterns.
`;
  }

  /**
   * Generate a skill name from the pattern
   */
  private generateSkillName(pattern: SkillPattern): string {
    const toolNames = pattern.toolSequence.map((tool) => 
      tool.replace(/_/g, "-").toLowerCase()
    );
    
    return `auto-${toolNames.join("-")}`;
  }

  /**
   * Format common parameters for display
   */
  private formatCommonParams(params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return "None detected.";
    }
    
    return Object.entries(params)
      .map(([key, value]) => `- **${key}**: \`${JSON.stringify(value)}\``)
      .join("\n");
  }

  /**
   * Save an auto-generated skill to the workspace
   */
  saveAutoSkill(name: string, content: string): string {
    const autoSkillsDir = join(this.skillsDir, "auto");
    const skillDir = join(autoSkillsDir, name);
    const skillFile = join(skillDir, "SKILL.md");
    
    // Ensure directories exist
    if (!existsSync(autoSkillsDir)) {
      mkdirSync(autoSkillsDir, { recursive: true });
    }
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }
    
    // Write the skill file
    writeFileSync(skillFile, content, "utf-8");
    
    return skillFile;
  }
}
