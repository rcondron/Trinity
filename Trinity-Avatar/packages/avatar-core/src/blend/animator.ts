/**
 * The animation blender: composites base body motion + gesture layer + face
 * blendshapes (visemes + emotion) + micro-life, all against the audio clock,
 * and pushes the result onto whatever AvatarRig is loaded.
 */
import * as THREE from 'three';
import type { EmotionLabel, PoseFrame } from '@trinity-avatar/protocol';
import { addWeights, type FaceWeights } from '../face/arkit.js';
import { EmotionMachine } from '../face/emotions.js';
import { MicroLife } from '../face/microlife.js';
import {
  amplitudeToFaceWeights,
  charsToVisemes,
  sampleVisemes,
  type VisemeEvent,
} from '../face/visemes.js';
import {
  blendPoses,
  FootLocker,
  retargetFrame,
  type RetargetedPose,
} from '../retarget/retarget.js';
import type { AvatarRig, VrmBoneName } from '../vrm/rig.js';

export interface AnimatorDebugState {
  emotion: { label: EmotionLabel; level: number };
  gestureWeight: number;
  speaking: boolean;
  lipSyncMode: 'timestamps' | 'amplitude' | 'off';
}

export class Animator {
  readonly microLife = new MicroLife();
  readonly emotions = new EmotionMachine();
  readonly footLocker = new FootLocker();

  private rig: AvatarRig | null = null;
  private basePose: RetargetedPose | null = null;
  private gesturePose: RetargetedPose | null = null;
  private gestureWeight = 0;
  private gestureTargetWeight = 0;

  /** Lip sync state for the current speaking turn. */
  private visemeTrack: VisemeEvent[] = [];
  private audioClock: (() => number) | null = null; // seconds into turn audio
  private amplitude: (() => number) | null = null;
  private speaking = false;

  private readonly tmpQ = new THREE.Quaternion();
  private readonly deltaQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  setRig(rig: AvatarRig | null): void {
    this.rig = rig;
    this.footLocker.reset();
  }

  get currentRig(): AvatarRig | null {
    return this.rig;
  }

  // ── Speech / face inputs ────────────────────────────────────────────────

  /** Begin a speaking turn driven by character timestamps + an audio clock. */
  startSpeech(audioClock: () => number): void {
    this.visemeTrack = [];
    this.audioClock = audioClock;
    this.amplitude = null;
    this.speaking = true;
  }

  /** Begin a speaking turn driven only by an amplitude envelope (browser TTS fallback). */
  startAmplitudeSpeech(amplitude: () => number): void {
    this.visemeTrack = [];
    this.audioClock = null;
    this.amplitude = amplitude;
    this.speaking = true;
  }

  /** Append timestamps as they stream in (may arrive in chunks). */
  addTimestamps(chars: string[], startTimes: number[], durations: number[]): void {
    this.visemeTrack.push(...charsToVisemes(chars, startTimes, durations));
  }

  endSpeech(): void {
    this.speaking = false;
    this.visemeTrack = [];
    this.audioClock = null;
    this.amplitude = null;
  }

  setEmotion(label: EmotionLabel, intensity?: number): void {
    this.emotions.setEmotion(label, intensity);
    this.microLife.blink();
  }

  setGaze(target: 'user' | 'away' | 'up_thinking' | 'down'): void {
    const bias = { user: { x: 0, y: 0 }, away: { x: 0.35, y: 0 }, up_thinking: { x: 0.2, y: 0.3 }, down: { x: 0, y: -0.3 } }[target];
    this.microLife.gazeBias = bias;
  }

  // ── Body pose inputs ────────────────────────────────────────────────────

  /** Feed a pose frame from any motion backend (service or client fallback). */
  pushPoseFrame(frame: PoseFrame): void {
    if (!this.rig) return;
    const pose = retargetFrame(frame, this.rig.hipsRestY);
    if (frame.layer === 'base') {
      this.basePose = pose;
    } else {
      this.gesturePose = pose;
      this.gestureTargetWeight = frame.weight ?? 1;
    }
  }

  /** Fade the gesture layer out (barge-in, end of gesture stream). */
  stopGesture(): void {
    this.gestureTargetWeight = 0;
  }

  // ── Per-frame update ────────────────────────────────────────────────────

  update(dt: number): void {
    const rig = this.rig;
    if (!rig) return;

    // 1. Micro-life + emotion + visemes → one face weight map
    const micro = this.microLife.update(dt);
    const face: FaceWeights = { ...micro.face };
    addWeights(face, this.emotions.update(dt));

    let lipSyncMode: AnimatorDebugState['lipSyncMode'] = 'off';
    if (this.speaking) {
      if (this.audioClock) {
        addWeights(face, sampleVisemes(this.visemeTrack, this.audioClock()));
        lipSyncMode = 'timestamps';
      } else if (this.amplitude) {
        addWeights(face, amplitudeToFaceWeights(this.amplitude()));
        lipSyncMode = 'amplitude';
      }
    }
    this.lastDebug = {
      emotion: this.emotions.state,
      gestureWeight: this.gestureWeight,
      speaking: this.speaking,
      lipSyncMode,
    };
    rig.applyFace(face);

    // 2. Body: base ⊕ gesture layers
    this.gestureWeight +=
      (this.gestureTargetWeight - this.gestureWeight) * Math.min(1, 8 * dt);
    let pose = this.basePose;
    if (this.gesturePose && this.gestureWeight > 0.005 && pose) {
      pose = blendPoses(pose, this.gesturePose, this.gestureWeight);
    } else if (this.gesturePose && this.gestureWeight > 0.005) {
      pose = this.gesturePose;
    }

    if (pose) {
      for (const [name, q] of pose.rotations) {
        const bone = rig.getBone(name);
        if (!bone) continue;
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
      }
      const hips = rig.getBone('hips');
      if (hips) {
        // Foot locking: measure feet, offset hips to pin the planted one.
        const lf = rig.getBone('leftFoot');
        const rf = rig.getBone('rightFoot');
        if (lf && rf) {
          hips.position.set(pose.hipsPosition[0], pose.hipsPosition[1], pose.hipsPosition[2]);
          hips.updateWorldMatrix(true, true);
          const lp = lf.getWorldPosition(this.tmpV).clone();
          const rp = rf.getWorldPosition(this.tmpV);
          const [cx, cz] = this.footLocker.update(
            dt,
            [lp.x, lp.y, lp.z],
            [rp.x, rp.y, rp.z],
          );
          hips.position.x += cx;
          hips.position.z += cz;
        } else {
          hips.position.set(pose.hipsPosition[0], pose.hipsPosition[1], pose.hipsPosition[2]);
        }
      }
    }

    // 3. Micro-life body layer — multiplied on top of whatever the pose set
    this.composeBone(rig, 'head', micro.headPitch, micro.headYaw, micro.headRoll);
    this.composeBone(rig, 'spine', micro.spinePitch, 0, micro.spineRoll);
    this.composeBone(rig, 'chest', micro.breath * 0.02, 0, 0);

    // 4. Rig internals (VRM spring bones etc.)
    rig.update(dt);
  }

  private composeBone(
    rig: AvatarRig,
    name: VrmBoneName,
    pitch: number,
    yaw: number,
    roll: number,
  ): void {
    const bone = rig.getBone(name);
    if (!bone) return;
    this.deltaQ.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'XYZ'));
    this.tmpQ.copy(bone.quaternion).multiply(this.deltaQ);
    bone.quaternion.copy(this.tmpQ);
  }

  private lastDebug: AnimatorDebugState = {
    emotion: { label: 'neutral', level: 0 },
    gestureWeight: 0,
    speaking: false,
    lipSyncMode: 'off',
  };

  get debug(): AnimatorDebugState {
    return this.lastDebug;
  }
}
