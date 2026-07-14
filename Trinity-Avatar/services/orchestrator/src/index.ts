import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { DemoBrain } from './brains/demo.js';
import { HermesBrain } from './brains/hermes.js';
import { TrinityBrain } from './brains/trinity.js';
import type { BrainProvider } from './brains/types.js';
import { Session } from './session.js';

const log = (msg: string) => console.log(`[orchestrator] ${msg}`);

async function selectBrain(): Promise<BrainProvider> {
  const forced = config.brainBackend;
  const trinity = new TrinityBrain(config.trinity.bridgeUrl, config.trinity.token);

  if (forced === 'demo') return new DemoBrain();
  if (forced === 'hermes') return new HermesBrain(config.hermes.baseUrl, config.hermes.apiKey, config.hermes.model);
  if (forced === 'trinity') return trinity;

  // Auto-select: Trinity bridge if reachable → Hermes if configured → demo.
  if (await trinity.healthy()) {
    log(`brain: trinity (bridge at ${config.trinity.bridgeUrl})`);
    return trinity;
  }
  if (config.hermes.baseUrl) {
    log(`brain: hermes (${config.hermes.baseUrl}, model ${config.hermes.model})`);
    return new HermesBrain(config.hermes.baseUrl, config.hermes.apiKey, config.hermes.model);
  }
  log('brain: demo persona (no bridge reachable, no HERMES_BASE_URL) — FALLBACK');
  return new DemoBrain();
}

const brain = await selectBrain();
const elevenlabs = config.elevenlabs.apiKey
  ? {
      apiKey: config.elevenlabs.apiKey,
      voiceId: config.elevenlabs.voiceId,
      modelId: config.elevenlabs.modelId,
      outputFormat: config.elevenlabs.outputFormat,
    }
  : null;
log(elevenlabs ? `tts: elevenlabs (voice ${elevenlabs.voiceId})` : 'tts: browser speechSynthesis — FALLBACK');

const wss = new WebSocketServer({ port: config.port, path: '/session' });
wss.on('connection', (ws, req) => {
  log(`session connected from ${req.socket.remoteAddress}`);
  new Session(ws, { brain, elevenlabs, log });
});
wss.on('listening', () => log(`listening on ws://localhost:${config.port}/session`));
