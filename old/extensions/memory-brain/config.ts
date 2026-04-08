import { Type } from "@sinclair/typebox";
import type { TrinityPluginConfigSchema } from "Trinity/plugin-sdk";

export const memoryBrainConfigSchema: TrinityPluginConfigSchema = {
  safeParse: (value: unknown) => {
    try {
      const parsed = Type.Object({
        apiUrl: Type.Optional(Type.String({ default: "http://localhost:8100" })),
        collection: Type.Optional(Type.String({ default: "memories" })),
        autoRecall: Type.Optional(Type.Boolean({ default: true })),
        autoCapture: Type.Optional(Type.Boolean({ default: true })),
        recallTopK: Type.Optional(Type.Number({ default: 3 })),
        recallMinScore: Type.Optional(Type.Number({ default: 0.5 })),
        recallTokenBudget: Type.Optional(Type.Number({ default: 2000 })),
        captureMaxChars: Type.Optional(Type.Number({ default: 2000 })),
      }).parse(value);
      return { success: true, data: parsed };
    } catch (error) {
      return {
        success: false,
        error: {
          issues: [{ path: [], message: String(error) }],
        },
      };
    }
  },
  uiHints: {
    apiUrl: {
      label: "Brain API URL",
      help: "URL of the Trinity-Brain API service",
      placeholder: "http://localhost:8100",
    },
    collection: {
      label: "Collection Name",
      help: "Milvus collection name for memories",
      placeholder: "memories",
    },
    autoRecall: {
      label: "Auto Recall",
      help: "Automatically inject relevant memories before agent starts",
    },
    autoCapture: {
      label: "Auto Capture",
      help: "Automatically capture important information from conversations",
    },
    recallTopK: {
      label: "Recall Top-K",
      help: "Maximum number of memories to recall",
    },
    recallMinScore: {
      label: "Recall Min Score",
      help: "Minimum similarity score for memory recall",
    },
    recallTokenBudget: {
      label: "Recall Token Budget",
      help: "Maximum tokens to spend on recalled memories",
    },
    captureMaxChars: {
      label: "Capture Max Characters",
      help: "Maximum characters to capture in a single memory",
    },
  },
};

export type MemoryBrainConfig = {
  apiUrl?: string;
  collection?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  recallTopK?: number;
  recallMinScore?: number;
  recallTokenBudget?: number;
  captureMaxChars?: number;
};
