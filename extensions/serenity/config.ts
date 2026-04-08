/**
 * Configuration schema for the Serenity Self-Improvement Engine plugin
 */

import { Type } from "@sinclair/typebox";
import type { SerenityConfig } from "../../src/Serenity/types.js";

export const SerenityConfigSchema = {
  safeParse: (value: unknown): { success: boolean; data?: SerenityConfig; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } => {
    try {
      const config = value as Record<string, unknown>;
      
      const parsed: SerenityConfig = {
        enabled: typeof config.enabled === "boolean" ? config.enabled : true,
        metricsRetentionDays: typeof config.metricsRetentionDays === "number" ? config.metricsRetentionDays : 30,
        autoSkillCreation: typeof config.autoSkillCreation === "boolean" ? config.autoSkillCreation : true,
        insightSchedule: (config.insightSchedule === "daily" || config.insightSchedule === "weekly" || config.insightSchedule === "monthly") 
          ? config.insightSchedule 
          : "weekly",
        dataDir: typeof config.dataDir === "string" ? config.dataDir : "~/.Trinity/Serenity",
        minPatternSuccessRate: typeof config.minPatternSuccessRate === "number" ? config.minPatternSuccessRate : 0.7,
        minPatternOccurrences: typeof config.minPatternOccurrences === "number" ? config.minPatternOccurrences : 3,
      };
      
      return { success: true, data: parsed };
    } catch (error) {
      return { 
        success: false, 
        error: { 
          issues: [{ 
            path: [], 
            message: error instanceof Error ? error.message : "Configuration validation failed" 
          }] 
        } 
      };
    }
  },
  
  uiHints: {
    enabled: {
      label: "Enable Serenity",
      help: "Enable the Serenity self-improvement engine to track tool usage and create skills automatically",
    },
    metricsRetentionDays: {
      label: "Metrics Retention (days)",
      help: "How many days of tool usage metrics to retain",
    },
    autoSkillCreation: {
      label: "Auto-create Skills",
      help: "Automatically create skills from detected tool usage patterns",
    },
    insightSchedule: {
      label: "Insight Schedule",
      help: "How often to generate insights and recommendations",
    },
    dataDir: {
      label: "Data Directory",
      help: "Directory to store Serenity data files",
      advanced: true,
    },
    minPatternSuccessRate: {
      label: "Min Pattern Success Rate",
      help: "Minimum success rate (0-1) for patterns to become skills",
      advanced: true,
    },
    minPatternOccurrences: {
      label: "Min Pattern Occurrences",
      help: "Minimum number of occurrences for pattern detection",
      advanced: true,
    },
  },
};

export type SerenityConfig = {
  enabled: boolean;
  metricsRetentionDays: number;
  autoSkillCreation: boolean;
  insightSchedule: "daily" | "weekly" | "monthly";
  dataDir: string;
  minPatternSuccessRate: number;
  minPatternOccurrences: number;
};

