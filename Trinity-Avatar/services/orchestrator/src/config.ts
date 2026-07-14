import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// .env lives at the Trinity-Avatar root; also honor a service-local one.
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(env('ORCHESTRATOR_PORT', '8790')),

  brainBackend: env('BRAIN_BACKEND') as '' | 'hermes' | 'trinity' | 'demo',

  hermes: {
    baseUrl: env('HERMES_BASE_URL'),
    apiKey: env('HERMES_API_KEY'),
    model: env('HERMES_MODEL', 'NousResearch/Hermes-3-Llama-3.1-8B'),
  },

  trinity: {
    bridgeUrl: env('TRINITY_BRIDGE_URL', 'http://127.0.0.1:4711'),
    token: env('TRINITY_BRIDGE_TOKEN'),
  },

  elevenlabs: {
    apiKey: env('ELEVENLABS_API_KEY'),
    voiceId: env('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM'),
    modelId: env('ELEVENLABS_MODEL_ID', 'eleven_turbo_v2_5'),
    outputFormat: env('ELEVENLABS_OUTPUT_FORMAT', 'pcm_16000'),
  },
};

export type Config = typeof config;
