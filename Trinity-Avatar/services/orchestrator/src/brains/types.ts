import type { EmotionLabel, GazeTarget, GestureCue, LocomotionMode } from '@trinity-avatar/protocol';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StructuredReply {
  text: string;
  emotion: EmotionLabel;
  gestures: GestureCue[];
  locomotion?: { mode: LocomotionMode; speed?: number };
  gaze?: { target: GazeTarget };
}

export interface BrainProvider {
  readonly id: 'hermes' | 'trinity' | 'demo';
  /**
   * Produce a reply. Implementations stream spoken-text deltas through
   * onDelta as soon as they have them; the resolved StructuredReply carries
   * the final text plus behavior directives. Must respect the abort signal
   * (barge-in).
   */
  respond(
    history: ChatTurn[],
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<StructuredReply>;
}

/** Emotion/gesture vocabulary shared by prompt + parsers. */
export const EMOTIONS: EmotionLabel[] = [
  'neutral',
  'happy',
  'thoughtful',
  'surprised',
  'concerned',
  'amused',
  'excited',
  'sad',
];

export const GESTURE_VOCAB = [
  'wave hello',
  'nod in agreement',
  'shake head',
  'shrug',
  'hand on chin thinking',
  'lean forward attentively',
  'open arms welcoming',
  'point forward',
  'pace slowly',
  'stand at ease',
];
