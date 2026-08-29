import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  MAX_LOOK_PITCH_DOWN,
  MAX_LOOK_PITCH_UP,
  MAX_LOOK_YAW,
  type Seat,
} from "./layout.js";
import { DEFAULT_SENSITIVITY, lookResponse } from "./lookCurve.js";

/**
 * The seated first-person view.
 *
 * Three decisions carry this, and all three are about it feeling like a head
 * rather than a camera:
 *
 * 1. **No pointer lock.** This is a seated view with a bounded arc, not an
 *    FPS. Locking hides the cursor, raises the browser's "press ESC" overlay,
 *    and turns every bet button into a mode switch. Cursor position drives
 *    the look directly instead, so the cursor stays live and R3F's default
 *    raycasting keeps working untouched.
 * 2. **Damped, never snapped.** The cursor sets a target; the head eases
 *    toward it. A camera that tracks the cursor exactly reads as a machine.
 * 3. **Idle sway.** A perfectly still camera reads as a tripod. Two slow
 *    sines on incommensurate periods, so the motion never visibly loops.
 *
 * The look can also be released entirely, which is what lets a settings
 * overlay hand the cursor back without the view following it around.
 */

/** Bigger is snappier. Around 4 is "attentive person", 10 is "machine". */
const LOOK_LAMBDA = 4.2;

const SWAY_YAW = 0.009;
const SWAY_PITCH = 0.006;
const SWAY_BOB = 0.004;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface SeatedCameraProps {
  seat: Seat;
  /**
   * False while an overlay owns the cursor. The head holds where it was left
   * and keeps swaying; it does not recentre, because snapping the view every
   * time a panel opens would be worse than following the cursor was.
   */
  lookEnabled: boolean;
  /** 0..1. Reshapes the response curve, never the reachable arc. */
  sensitivity: number;
}

export function SeatedCamera({
  seat,
  lookEnabled,
  sensitivity = DEFAULT_SENSITIVITY,
}: SeatedCameraProps) {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);

  // Refs, not state: these change on every pointer move and every frame, and
  // re-rendering the scene graph at that rate is the whole thing to avoid.
  const target = useRef({ yaw: 0, pitch: 0 });
  const current = useRef({ yaw: 0, pitch: 0 });

  // Read inside the handler rather than closed over, so toggling the overlay
  // or dragging the slider does not tear down and re-add the listener.
  const settings = useRef({ lookEnabled, sensitivity });
  settings.current = { lookEnabled, sensitivity };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!settings.current.lookEnabled) return;

      const rect = domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      const s = settings.current.sensitivity;

      target.current.yaw = -lookResponse(nx, s) * MAX_LOOK_YAW;
      const pitch = -lookResponse(ny, s);
      target.current.pitch =
        pitch >= 0 ? pitch * MAX_LOOK_PITCH_UP : pitch * MAX_LOOK_PITCH_DOWN;
    };

    domElement.addEventListener("pointermove", onPointerMove);
    // No pointerleave handler on purpose: the head holds where it was left
    // rather than snapping forward the moment the cursor reaches a button.
    return () => domElement.removeEventListener("pointermove", onPointerMove);
  }, [domElement]);

  useEffect(() => {
    // Yaw about world up, then pitch about the turned head's own right. The
    // default XYZ order tilts the horizon as soon as both are non-zero.
    camera.rotation.order = "YXZ";
  }, [camera]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    current.current.yaw = THREE.MathUtils.damp(
      current.current.yaw,
      target.current.yaw,
      LOOK_LAMBDA,
      delta,
    );
    current.current.pitch = THREE.MathUtils.damp(
      current.current.pitch,
      target.current.pitch,
      LOOK_LAMBDA,
      delta,
    );

    // Periods chosen not to share a common multiple, so the sway never
    // resolves into a visible loop.
    const swayYaw = Math.sin(t * 0.31) * SWAY_YAW;
    const swayPitch = Math.sin(t * 0.23 + 1.1) * SWAY_PITCH;
    const bob = Math.sin(t * 0.19 + 2.3) * SWAY_BOB;

    camera.position.set(seat.x, seat.eyeY + bob, seat.z);
    camera.rotation.set(
      clamp(
        current.current.pitch + swayPitch,
        -MAX_LOOK_PITCH_DOWN,
        MAX_LOOK_PITCH_UP,
      ),
      seat.yaw + clamp(current.current.yaw + swayYaw, -MAX_LOOK_YAW, MAX_LOOK_YAW),
      0,
    );
  });

  return null;
}
