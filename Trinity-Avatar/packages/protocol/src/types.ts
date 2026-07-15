/** Hand-maintained TypeScript twins of schemas/messages.json ($defs). */

export type EmotionLabel =
  | 'neutral'
  | 'happy'
  | 'thoughtful'
  | 'surprised'
  | 'concerned'
  | 'amused'
  | 'excited'
  | 'sad';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type LocomotionMode = 'idle' | 'pace' | 'approach' | 'retreat' | 'wander';
export type GazeTarget = 'user' | 'away' | 'up_thinking' | 'down';
export type BrainBackend = 'hermes' | 'trinity' | 'demo';
export type TtsBackend = 'elevenlabs' | 'browser';
export type SttBackend = 'elevenlabs' | 'browser' | 'none';
export type MotionBackend = 'ardy' | 'clips' | 'client';

export interface ClientHello {
  type: 'client_hello';
  sessionId?: string;
  capabilities?: {
    audioFormats?: string[];
    sttMode?: 'client' | 'server' | 'none';
    [k: string]: unknown;
  };
}

export interface UserText {
  type: 'user_text';
  text: string;
  tClientSent?: number;
}

export interface UserTranscript {
  type: 'user_transcript';
  text: string;
  final: boolean;
  tSpeechEnd?: number;
}

export interface Interrupt {
  type: 'interrupt';
  reason?: 'barge_in' | 'user_cancel';
}

export interface ServerStatus {
  type: 'server_status';
  brain: BrainBackend;
  tts: TtsBackend;
  stt?: SttBackend;
  motion?: MotionBackend;
  detail?: string;
}

export interface AgentTextDelta {
  type: 'agent_text_delta';
  text: string;
  turnId: string;
}

export interface GestureCue {
  prompt: string;
  atChar?: number;
}

export interface AgentReply {
  type: 'agent_reply';
  turnId: string;
  text: string;
  emotion?: EmotionLabel;
  gestures?: GestureCue[];
  locomotion?: { mode: LocomotionMode; speed?: number };
  gaze?: { target: GazeTarget };
}

export interface TtsAudioChunk {
  type: 'tts_audio_chunk';
  turnId: string;
  seq: number;
  audioB64: string;
  sampleRate: number;
  format: 'pcm_s16le' | 'mp3';
}

export interface TtsTimestamps {
  type: 'tts_timestamps';
  turnId: string;
  chars: string[];
  startTimes: number[];
  durations: number[];
}

export interface TtsEnd {
  type: 'tts_end';
  turnId: string;
}

export interface Emotion {
  type: 'emotion';
  label: EmotionLabel;
  intensity?: number;
}

export interface Gesture {
  type: 'gesture';
  prompt: string;
  turnId?: string;
}

export interface Locomotion {
  type: 'locomotion';
  mode: LocomotionMode;
  speed?: number;
}

export interface Gaze {
  type: 'gaze';
  target: GazeTarget;
}

export type LatencyStage =
  | 'stt'
  | 'brain_first_token'
  | 'brain_total'
  | 'tts_first_audio'
  | 'motion_first_frame';

export interface LatencyMark {
  type: 'latency_mark';
  turnId: string;
  stage: LatencyStage;
  ms: number;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface MotionRequest {
  type: 'motion_request';
  prompt: string;
  loop?: boolean;
  layer?: 'base' | 'gesture';
  requestId?: string;
}

export interface MotionStop {
  type: 'motion_stop';
  layer: 'base' | 'gesture' | 'all';
  fadeMs?: number;
}

export interface PoseFrame {
  type: 'pose_frame';
  t: number;
  layer: 'base' | 'gesture';
  rootPos: Vec3;
  rotations: Quat[];
  weight?: number;
}

export interface MotionStatus {
  type: 'motion_status';
  backend: 'ardy' | 'clips';
  fps?: number;
  detail?: string;
}

export type Message =
  | ClientHello
  | UserText
  | UserTranscript
  | Interrupt
  | ServerStatus
  | AgentTextDelta
  | AgentReply
  | TtsAudioChunk
  | TtsTimestamps
  | TtsEnd
  | Emotion
  | Gesture
  | Locomotion
  | Gaze
  | LatencyMark
  | ErrorMessage
  | MotionRequest
  | MotionStop
  | PoseFrame
  | MotionStatus;

export type MessageType = Message['type'];
