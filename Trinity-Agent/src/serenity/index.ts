/**
 * Serenity Self-Improvement Engine
 *
 * Tracks tool usage, detects patterns, creates skills automatically,
 * and generates insights to improve agent capabilities over time.
 */

export * from "./types.js";
export { SkillTracker } from "./skill-tracker.js";
export { SkillCreator } from "./skill-creator.js";
export { InsightGenerator } from "./insight-generator.js";
export { ReflectionEngine, type ReflectionCycleResult, type SkillScore } from "./reflection-engine.js";
export { default as SerenityReflectionEngine } from "./reflection-engine.js";

