/**
 * Serenity Self-Improvement Engine Plugin
 *
 * Tracks tool usage, detects patterns, creates skills automatically,
 * and generates insights for continuous improvement.
 */

import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { TrinityPluginApi } from "Trinity/plugin-sdk";
import { SerenityConfigSchema, type SerenityConfig } from "./config.js";
import {
  SkillTracker,
  SkillCreator,
  InsightGenerator,
  type ToolCallMetric,
  type SkillPattern,
  type Insight,
} from "../../src/Serenity/index.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const SerenityPlugin = {
  id: "Serenity",
  name: "Serenity Self-Improvement Engine",
  description: "Tracks tool usage, detects patterns, creates skills automatically, and generates insights",
  kind: "enhancement" as const,
  configSchema: SerenityConfigSchema,

  register(api: TrinityPluginApi) {
    const cfg: SerenityConfig = (api.pluginConfig as SerenityConfig) || {
      enabled: true,
      metricsRetentionDays: 30,
      autoSkillCreation: true,
      insightSchedule: "weekly",
      dataDir: "~/.Trinity/Serenity",
      minPatternSuccessRate: 0.7,
      minPatternOccurrences: 3,
    };

    if (!cfg.enabled) {
      api.logger.info("Serenity: plugin disabled in config");
      return;
    }

    // Resolve data directory
    const dataDir = cfg.dataDir.startsWith("~/") 
      ? join(homedir(), cfg.dataDir.slice(2))
      : resolve(cfg.dataDir);

    // Resolve skills directory
    const skillsDir = api.config.workspaceDir 
      ? join(api.config.workspaceDir, "skills")
      : join(process.cwd(), "workspace", "skills");

    // Initialize Serenity components
    const skillTracker = new SkillTracker(dataDir, cfg.metricsRetentionDays);
    const skillCreator = new SkillCreator(skillsDir, cfg.minPatternOccurrences, cfg.minPatternSuccessRate);
    const insightGenerator = new InsightGenerator();

    api.logger.info(`Serenity: plugin registered (data: ${dataDir}, skills: ${skillsDir})`);

    // ========================================================================
    // Helper Functions
    // ========================================================================

    function expandHomeDir(path: string): string {
      return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
    }

    function saveInsights(insights: Insight[]): void {
      const insightsFile = join(dataDir, "insights.json");
      try {
        const existing = existsSync(insightsFile) 
          ? JSON.parse(readFileSync(insightsFile, "utf-8")) as Insight[]
          : [];
        
        // Merge with existing insights, avoiding duplicates
        const allInsights = [...existing];
        for (const insight of insights) {
          if (!allInsights.find(i => i.id === insight.id)) {
            allInsights.push(insight);
          }
        }
        
        // Keep only recent insights (last 100)
        const recentInsights = allInsights
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 100);
        
        writeFileSync(insightsFile, JSON.stringify(recentInsights, null, 2), "utf-8");
      } catch (error) {
        api.logger.warn(`Serenity: failed to save insights: ${error}`);
      }
    }

    function loadInsights(): Insight[] {
      const insightsFile = join(dataDir, "insights.json");
      try {
        if (existsSync(insightsFile)) {
          return JSON.parse(readFileSync(insightsFile, "utf-8")) as Insight[];
        }
      } catch (error) {
        api.logger.warn(`Serenity: failed to load insights: ${error}`);
      }
      return [];
    }

    function listAutoSkills(): Array<{ name: string; path: string }> {
      const autoSkillsDir = join(skillsDir, "auto");
      try {
        if (!existsSync(autoSkillsDir)) {
          return [];
        }
        
        const { readdirSync, statSync } = await import("node:fs");
        const entries = readdirSync(autoSkillsDir);
        const skills: Array<{ name: string; path: string }> = [];
        
        for (const entry of entries) {
          const entryPath = join(autoSkillsDir, entry);
          const skillFile = join(entryPath, "SKILL.md");
          
          if (statSync(entryPath).isDirectory() && existsSync(skillFile)) {
            skills.push({ name: entry, path: skillFile });
          }
        }
        
        return skills;
      } catch (error) {
        api.logger.warn(`Serenity: failed to list auto skills: ${error}`);
        return [];
      }
    }

    // ========================================================================
    // Hooks
    // ========================================================================

    // Track tool calls
    api.on("after_tool_call", async (event, ctx) => {
      if (!cfg.enabled) return;

      const metric: ToolCallMetric = {
        toolName: event.toolName,
        success: !event.error,
        durationMs: event.durationMs || 0,
        errorMessage: event.error,
        timestamp: new Date().toISOString(),
        sessionKey: ctx.sessionKey || "unknown",
        params: event.params,
        result: event.result,
      };

      try {
        skillTracker.recordToolCall(metric);
        api.logger.debug(`Serenity: recorded ${event.toolName} call (success: ${metric.success})`);
      } catch (error) {
        api.logger.warn(`Serenity: failed to record tool call: ${error}`);
      }
    });

    // Pattern detection and auto-skill creation on session end
    api.on("agent_end", async (event, ctx) => {
      if (!cfg.enabled || !cfg.autoSkillCreation || !event.success) return;

      try {
        // Get recent metrics for pattern detection
        const recentMetrics = skillTracker.getRecentMetrics(7);
        
        if (recentMetrics.length < 10) return; // Need sufficient data
        
        // Detect patterns
        const patterns = skillCreator.detectPatterns(recentMetrics);
        
        if (patterns.length > 0) {
          api.logger.info(`Serenity: detected ${patterns.length} patterns`);
          
          // Create skills for new patterns
          let createdSkills = 0;
          for (const pattern of patterns) {
            const skillName = `auto-${pattern.toolSequence.join("-").replace(/_/g, "-").toLowerCase()}`;
            const skillPath = join(skillsDir, "auto", skillName, "SKILL.md");
            
            // Only create if it doesn't already exist
            if (!existsSync(skillPath)) {
              const skillContent = skillCreator.generateSkillMd(pattern);
              try {
                skillCreator.saveAutoSkill(skillName, skillContent);
                createdSkills++;
                api.logger.info(`Serenity: created skill "${skillName}"`);
              } catch (error) {
                api.logger.warn(`Serenity: failed to create skill "${skillName}": ${error}`);
              }
            }
          }
          
          if (createdSkills > 0) {
            api.logger.info(`Serenity: created ${createdSkills} new auto-skills`);
          }
        }
      } catch (error) {
        api.logger.warn(`Serenity: pattern detection failed: ${error}`);
      }
    });

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "Serenity_stats",
        label: "Serenity Stats",
        description: "Show tool usage statistics and performance metrics.",
        parameters: Type.Object({
          tool_name: Type.Optional(Type.String({ description: "Filter by specific tool name" })),
          days: Type.Optional(Type.Number({ description: "Number of days to analyze (default: 30)" })),
          top_n: Type.Optional(Type.Number({ description: "Show top N tools (default: 10)" })),
        }),
        async execute(_toolCallId, params) {
          const { tool_name, days, top_n } = params as {
            tool_name?: string;
            days?: number;
            top_n?: number;
          };

          try {
            if (tool_name) {
              // Show stats for a specific tool
              const stats = skillTracker.getStats(tool_name, days);
              const toolStats = stats[tool_name];
              
              if (!toolStats) {
                return {
                  content: [{ type: "text", text: `No usage data found for tool "${tool_name}"` }],
                  details: { toolName: tool_name, found: false },
                };
              }
              
              const text = `Tool: ${tool_name}
Total Calls: ${toolStats.totalCalls}
Success Rate: ${(toolStats.successRate * 100).toFixed(1)}%
Average Duration: ${toolStats.avgDuration.toFixed(0)}ms
${toolStats.trend !== undefined ? `Trend: ${toolStats.trend > 0 ? '+' : ''}${(toolStats.trend * 100).toFixed(1)}%\n` : ''}
${Object.keys(toolStats.errorBreakdown).length > 0 ? `Errors: ${Object.entries(toolStats.errorBreakdown).map(([err, count]) => `${err} (${count})`).join(', ')}` : 'No errors'}`;

              return {
                content: [{ type: "text", text }],
                details: { toolName: tool_name, stats: toolStats },
              };
            } else {
              // Show top tools
              const topTools = skillTracker.getTopTools(top_n || 10, days);
              
              if (topTools.length === 0) {
                return {
                  content: [{ type: "text", text: "No tool usage data available" }],
                  details: { topTools: [] },
                };
              }
              
              const text = `Top ${topTools.length} Tools (${days || 30} days):

${topTools.map((tool, i) => 
  `${i + 1}. ${tool.toolName}: ${tool.stats.totalCalls} calls, ${(tool.stats.successRate * 100).toFixed(1)}% success, ${tool.stats.avgDuration.toFixed(0)}ms avg`
).join('\n')}`;

              return {
                content: [{ type: "text", text }],
                details: { topTools, period: days || 30 },
              };
            }
          } catch (error) {
            api.logger.warn(`Serenity_stats failed: ${error}`);
            return {
              content: [{ type: "text", text: `Stats retrieval failed: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "Serenity_stats" }
    );

    api.registerTool(
      {
        name: "Serenity_insights",
        label: "Serenity Insights",
        description: "Generate and display usage insights and recommendations.",
        parameters: Type.Object({
          regenerate: Type.Optional(Type.Boolean({ description: "Force regeneration of insights" })),
        }),
        async execute(_toolCallId, params) {
          const { regenerate } = params as { regenerate?: boolean };

          try {
            let insights: Insight[] = [];
            
            if (regenerate) {
              // Generate fresh insights
              const recentMetrics = skillTracker.getRecentMetrics(30);
              const memories: unknown[] = []; // TODO: integrate with memory system
              
              insights = insightGenerator.generateInsights(memories, recentMetrics);
              
              if (insights.length > 0) {
                saveInsights(insights);
                api.logger.info(`Serenity: generated ${insights.length} new insights`);
              }
            } else {
              // Load existing insights
              insights = loadInsights();
            }
            
            if (insights.length === 0) {
              return {
                content: [{ type: "text", text: "No insights available. Try running with regenerate=true or use the system for a while to accumulate data." }],
                details: { insights: [] },
              };
            }
            
            // Sort by significance and recency
            insights.sort((a, b) => {
              const significanceDiff = b.significance - a.significance;
              if (Math.abs(significanceDiff) > 0.1) {
                return significanceDiff;
              }
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            
            const topInsights = insights.slice(0, 5);
            const text = `Recent Insights:

${topInsights.map((insight, i) => 
  `${i + 1}. [${insight.kind.toUpperCase()}] ${insight.text}
   Significance: ${(insight.significance * 100).toFixed(0)}% | Created: ${insight.createdAt.split('T')[0]}
   ${insight.entities.length > 0 ? `Related: ${insight.entities.join(', ')}` : ''}`
).join('\n\n')}`;

            return {
              content: [{ type: "text", text }],
              details: { insights: topInsights, total: insights.length },
            };
          } catch (error) {
            api.logger.warn(`Serenity_insights failed: ${error}`);
            return {
              content: [{ type: "text", text: `Insight generation failed: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "Serenity_insights" }
    );

    api.registerTool(
      {
        name: "Serenity_skills",
        label: "Serenity Skills",
        description: "List auto-created skills from pattern detection.",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params) {
          try {
            const skills = listAutoSkills();
            
            if (skills.length === 0) {
              return {
                content: [{ type: "text", text: "No auto-created skills found. Skills will be created as patterns are detected in your tool usage." }],
                details: { skills: [] },
              };
            }
            
            const text = `Auto-Created Skills (${skills.length}):

${skills.map((skill, i) => `${i + 1}. ${skill.name} (${skill.path})`).join('\n')}

Skills are automatically created when Serenity detects patterns in your tool usage. Each skill represents a sequence of tools that you commonly use together.`;

            return {
              content: [{ type: "text", text }],
              details: { skills, count: skills.length },
            };
          } catch (error) {
            api.logger.warn(`Serenity_skills failed: ${error}`);
            return {
              content: [{ type: "text", text: `Skills listing failed: ${error}` }],
              details: { error: String(error) },
            };
          }
        },
      },
      { name: "Serenity_skills" }
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const Serenity_cli = program.command("Serenity").description("Serenity self-improvement commands");

        Serenity_cli
          .command("stats")
          .description("Display tool usage statistics")
          .option("--tool <name>", "Filter by tool name")
          .option("--days <n>", "Number of days to analyze", "30")
          .option("--top <n>", "Show top N tools", "10")
          .action(async (opts) => {
            try {
              const days = parseInt(opts.days);
              const topN = parseInt(opts.top);
              
              if (opts.tool) {
                const stats = skillTracker.getStats(opts.tool, days);
                const toolStats = stats[opts.tool];
                
                if (!toolStats) {
                  console.log(`No usage data found for tool "${opts.tool}"`);
                  return;
                }
                
                console.log(`Tool: ${opts.tool}`);
                console.log(`Total Calls: ${toolStats.totalCalls}`);
                console.log(`Success Rate: ${(toolStats.successRate * 100).toFixed(1)}%`);
                console.log(`Average Duration: ${toolStats.avgDuration.toFixed(0)}ms`);
                
                if (toolStats.trend !== undefined) {
                  console.log(`Trend: ${toolStats.trend > 0 ? '+' : ''}${(toolStats.trend * 100).toFixed(1)}%`);
                }
                
                if (Object.keys(toolStats.errorBreakdown).length > 0) {
                  console.log(`Errors:`);
                  for (const [error, count] of Object.entries(toolStats.errorBreakdown)) {
                    console.log(`  ${error}: ${count}`);
                  }
                }
              } else {
                const topTools = skillTracker.getTopTools(topN, days);
                
                if (topTools.length === 0) {
                  console.log("No tool usage data available");
                  return;
                }
                
                console.log(`Top ${topTools.length} Tools (${days} days):\n`);
                for (const [i, tool] of topTools.entries()) {
                  console.log(`${i + 1}. ${tool.toolName}`);
                  console.log(`   Calls: ${tool.stats.totalCalls}`);
                  console.log(`   Success: ${(tool.stats.successRate * 100).toFixed(1)}%`);
                  console.log(`   Avg Duration: ${tool.stats.avgDuration.toFixed(0)}ms`);
                  console.log();
                }
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        Serenity_cli
          .command("insights")
          .description("Generate and display usage insights")
          .option("--regenerate", "Force regeneration of insights")
          .action(async (opts) => {
            try {
              let insights: Insight[] = [];
              
              if (opts.regenerate) {
                const recentMetrics = skillTracker.getRecentMetrics(30);
                const memories: unknown[] = [];
                
                insights = insightGenerator.generateInsights(memories, recentMetrics);
                
                if (insights.length > 0) {
                  saveInsights(insights);
                  console.log(`Generated ${insights.length} new insights\n`);
                }
              } else {
                insights = loadInsights();
              }
              
              if (insights.length === 0) {
                console.log("No insights available. Try --regenerate or use the system for a while to accumulate data.");
                return;
              }
              
              insights.sort((a, b) => {
                const significanceDiff = b.significance - a.significance;
                if (Math.abs(significanceDiff) > 0.1) {
                  return significanceDiff;
                }
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              });
              
              console.log(`Recent Insights:\n`);
              for (const [i, insight] of insights.slice(0, 5).entries()) {
                console.log(`${i + 1}. [${insight.kind.toUpperCase()}] ${insight.text}`);
                console.log(`   Significance: ${(insight.significance * 100).toFixed(0)}% | Created: ${insight.createdAt.split('T')[0]}`);
                if (insight.entities.length > 0) {
                  console.log(`   Related: ${insight.entities.join(', ')}`);
                }
                console.log();
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        Serenity_cli
          .command("skills")
          .description("List auto-created skills")
          .action(async () => {
            try {
              const skills = listAutoSkills();
              
              if (skills.length === 0) {
                console.log("No auto-created skills found.");
                console.log("Skills will be created as patterns are detected in your tool usage.");
                return;
              }
              
              console.log(`Auto-Created Skills (${skills.length}):\n`);
              for (const [i, skill] of skills.entries()) {
                console.log(`${i + 1}. ${skill.name}`);
                console.log(`   Path: ${skill.path}`);
              }
              
              console.log("\nSkills are automatically created when Serenity detects patterns in your tool usage.");
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        Serenity_cli
          .command("reset")
          .description("Clear all metrics data")
          .option("--confirm", "Confirm the reset operation")
          .action(async (opts) => {
            if (!opts.confirm) {
              console.log("This will clear all tool usage metrics. Use --confirm to proceed.");
              return;
            }
            
            try {
              skillTracker.clearMetrics();
              console.log("All metrics data has been cleared.");
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });
      },
      { commands: ["Serenity"] }
    );

    // ========================================================================
    // Service Registration
    // ========================================================================

    api.registerService({
      id: "Serenity",
      async start() {
        api.logger.info(`Serenity: service started (data dir: ${dataDir})`);
      },
      stop() {
        api.logger.info("Serenity: service stopped");
      },
    });
  },
};

export default SerenityPlugin;

