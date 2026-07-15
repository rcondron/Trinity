import { describe, expect, it } from 'vitest';
import {
  parseMessage,
  serializeMessage,
  isValidMessage,
  ProtocolError,
  SOMA_JOINTS,
  SOMA_PARENTS,
  SOMA_TO_VRM,
  SOMA_JOINT_COUNT,
  type PoseFrame,
} from '../src/index.js';

const identity: [number, number, number, number] = [0, 0, 0, 1];

describe('protocol validation', () => {
  it('accepts a valid user_text message', () => {
    const msg = parseMessage(JSON.stringify({ type: 'user_text', text: 'hello' }));
    expect(msg.type).toBe('user_text');
  });

  it('rejects unknown message types', () => {
    expect(() => parseMessage({ type: 'bogus' })).toThrow(ProtocolError);
  });

  it('rejects user_text with empty text', () => {
    expect(() => parseMessage({ type: 'user_text', text: '' })).toThrow(ProtocolError);
  });

  it('rejects extra properties', () => {
    expect(() => parseMessage({ type: 'interrupt', extra: 1 })).toThrow(ProtocolError);
  });

  it('round-trips an agent_reply with gestures and locomotion', () => {
    const reply = {
      type: 'agent_reply',
      turnId: 't1',
      text: 'Hi there!',
      emotion: 'happy',
      gestures: [{ prompt: 'wave hello', atChar: 0 }],
      locomotion: { mode: 'idle' },
      gaze: { target: 'user' },
    };
    const wire = serializeMessage(parseMessage(reply) as never);
    expect(JSON.parse(wire)).toEqual(reply);
  });

  it('rejects invalid emotion labels', () => {
    expect(() => parseMessage({ type: 'emotion', label: 'angry_dance' })).toThrow(ProtocolError);
  });

  it('validates pose frames with exactly 24 joint rotations', () => {
    const frame: PoseFrame = {
      type: 'pose_frame',
      t: 0.033,
      layer: 'base',
      rootPos: [0, 0.95, 0],
      rotations: Array.from({ length: SOMA_JOINT_COUNT }, () => identity),
    };
    expect(isValidMessage(frame)).toBe(true);
    expect(isValidMessage({ ...frame, rotations: frame.rotations.slice(0, 23) })).toBe(false);
  });

  it('rejects out-of-range latency and intensity values', () => {
    expect(() =>
      parseMessage({ type: 'latency_mark', turnId: 't', stage: 'stt', ms: -5 }),
    ).toThrow(ProtocolError);
    expect(() => parseMessage({ type: 'emotion', label: 'happy', intensity: 1.5 })).toThrow(
      ProtocolError,
    );
  });
});

describe('SOMA skeleton definition', () => {
  it('has 24 joints with matching parents array', () => {
    expect(SOMA_JOINTS).toHaveLength(24);
    expect(SOMA_PARENTS).toHaveLength(24);
  });

  it('parents always precede children (topological order)', () => {
    SOMA_PARENTS.forEach((p, i) => {
      if (i === 0) expect(p).toBe(-1);
      else expect(p).toBeLessThan(i);
    });
  });

  it('maps every joint to a VRM bone or explicit null', () => {
    for (const j of SOMA_JOINTS) {
      expect(SOMA_TO_VRM).toHaveProperty(j);
    }
    expect(SOMA_TO_VRM.pelvis).toBe('hips');
    expect(SOMA_TO_VRM.left_hand).toBeNull();
  });
});
