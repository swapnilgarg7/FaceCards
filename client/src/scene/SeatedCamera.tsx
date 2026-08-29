import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  MAX_LOOK_PITCH_DOWN,
  MAX_LOOK_PITCH_UP,
  MAX_LOOK_YAW,
  type Seat,
} from "./layout.js";
import {
  KEY_PITCH_SPEED,
  KEY_YAW_SPEED,
  NO_LOOK_AXES,
  keyLookScale,
  stepLookOffset,
  type LookAxes,
} from "./keyboardLook.js";
import { DEFAULT_SENSITIVITY, lookResponse } from "./lookCurve.js";
import { applyDragLook, dragLookScale } from "./mobileView.js";
import { dampAngle } from "./damp.js";

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
 *
 * On a phone none of the first point survives contact, because there is no
 * cursor to follow: a finger has no position until it is down, so an absolute
 * mapping would snap the view to wherever somebody happened to touch. `drag`
 * mode turns the same head with accumulated deltas instead, into the same
 * clamped arc, and letting go leaves it where it was put. See
 * `mobileView.ts`; everything below the input is unchanged.
 *
 * W, A, S and D turn the head too, and they *add* to the cursor rather than
 * taking over from it: there is no mode and nothing to switch between. All of
 * the arithmetic, including the anti-windup that makes holding a key against
 * the edge of the arc cost nothing, is in `keyboardLook.ts` where it can be
 * tested without a renderer.
 */

/** Bigger is snappier. Around 4 is "attentive person", 10 is "machine". */
const LOOK_LAMBDA = 4.2;

/** Matches the avatars', so everyone re-seats as one movement. */
const RESEAT_LAMBDA = 3.4;

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
  /**
   * Which way the held look keys are pushing, updated outside React.
   *
   * A ref because it is read once per frame and must never cause a render;
   * optional because the scene is perfectly usable on the cursor alone, and a
   * test or a screenshot rig should not have to fake a keyboard.
   */
  lookKeys?: RefObject<LookAxes> | undefined;
  /**
   * How the pointer turns the head. `hover` follows cursor position, which is
   * what a mouse is; `drag` accumulates while a finger is down, which is what
   * a touchscreen is. Both write the same `target`, so switching between them
   * - a tablet with a trackpad, say - does not move the view.
   */
  lookMode?: "hover" | "drag";
}

export function SeatedCamera({
  seat,
  lookEnabled,
  sensitivity = DEFAULT_SENSITIVITY,
  lookKeys,
  lookMode = "hover",
}: SeatedCameraProps) {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);

  // Refs, not state: these change on every pointer move and every frame, and
  // re-rendering the scene graph at that rate is the whole thing to avoid.
  const target = useRef({ yaw: 0, pitch: 0 });
  const current = useRef({ yaw: 0, pitch: 0 });
  // What the keys have added on top of wherever the cursor is pointing. Kept
  // apart from `target` so a pointer move does not wipe it out, and so it can
  // be clamped against the composed angle rather than on its own.
  const keyOffset = useRef({ yaw: 0, pitch: 0 });

  // Where the seat itself is, kept apart from the look and the sway so the
  // idle bob never feeds back into the damping.
  const base = useRef({ x: seat.x, z: seat.z, yaw: seat.yaw });
  const seated = useRef(false);

  // Read inside the handler rather than closed over, so toggling the overlay
  // or dragging the slider does not tear down and re-add the listener.
  const settings = useRef({ lookEnabled, sensitivity });
  settings.current = { lookEnabled, sensitivity };

  useEffect(() => {
    if (lookMode === "drag") {
      // One finger only. A second touch is a pinch or a stray palm, and
      // averaging two of them into one heading is how a view starts to swim.
      let held: number | null = null;
      let last = { x: 0, y: 0 };

      const onDown = (event: PointerEvent) => {
        if (held !== null || !settings.current.lookEnabled) return;
        held = event.pointerId;
        last = { x: event.clientX, y: event.clientY };
        // So a drag that leaves the canvas - over the action bar, off the top
        // of the screen - keeps turning the head instead of stopping dead.
        try {
          domElement.setPointerCapture(event.pointerId);
        } catch {
          // Capture is a convenience; the window listeners below still work.
        }
      };

      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== held) return;
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        last = { x: event.clientX, y: event.clientY };
        // Checked here rather than at pointerdown as well, so a menu opening
        // mid-drag stops the view immediately rather than at the next release.
        if (!settings.current.lookEnabled) return;
        target.current = applyDragLook(
          target.current,
          dx,
          dy,
          dragLookScale(settings.current.sensitivity),
        );
      };

      const onEnd = (event: PointerEvent) => {
        if (event.pointerId !== held) return;
        try {
          domElement.releasePointerCapture(event.pointerId);
        } catch {
          // Already released, or never captured. Either way we are done.
        }
        held = null;
      };

      domElement.addEventListener("pointerdown", onDown);
      domElement.addEventListener("pointermove", onMove);
      domElement.addEventListener("pointerup", onEnd);
      domElement.addEventListener("pointercancel", onEnd);
      return () => {
        domElement.removeEventListener("pointerdown", onDown);
        domElement.removeEventListener("pointermove", onMove);
        domElement.removeEventListener("pointerup", onEnd);
        domElement.removeEventListener("pointercancel", onEnd);
      };
    }

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
  }, [domElement, lookMode]);

  useEffect(() => {
    // Yaw about world up, then pitch about the turned head's own right. The
    // default XYZ order tilts the horizon as soon as both are non-zero.
    camera.rotation.order = "YXZ";
  }, [camera]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Keys first, so the damping below eases towards an angle that already
    // includes them. Released along with the cursor when an overlay is up:
    // the head holds where it was left rather than drifting behind a menu.
    const axes = (lookEnabled ? lookKeys?.current : null) ?? NO_LOOK_AXES;
    const scale = keyLookScale(sensitivity);
    keyOffset.current.yaw = stepLookOffset(
      keyOffset.current.yaw,
      axes.yaw,
      KEY_YAW_SPEED * scale,
      delta,
      target.current.yaw,
      -MAX_LOOK_YAW,
      MAX_LOOK_YAW,
    );
    keyOffset.current.pitch = stepLookOffset(
      keyOffset.current.pitch,
      axes.pitch,
      KEY_PITCH_SPEED * scale,
      delta,
      target.current.pitch,
      -MAX_LOOK_PITCH_DOWN,
      MAX_LOOK_PITCH_UP,
    );

    const wantYaw = target.current.yaw + keyOffset.current.yaw;
    const wantPitch = target.current.pitch + keyOffset.current.pitch;

    // Ease to the seat when the table re-flows around a new arrival, rather
    // than cutting, which at first person reads as being teleported.
    if (!seated.current) {
      base.current = { x: seat.x, z: seat.z, yaw: seat.yaw };
      seated.current = true;
    } else {
      base.current.x = THREE.MathUtils.damp(
        base.current.x,
        seat.x,
        RESEAT_LAMBDA,
        delta,
      );
      base.current.z = THREE.MathUtils.damp(
        base.current.z,
        seat.z,
        RESEAT_LAMBDA,
        delta,
      );
      base.current.yaw = dampAngle(
        base.current.yaw,
        seat.yaw,
        RESEAT_LAMBDA,
        delta,
      );
    }

    current.current.yaw = THREE.MathUtils.damp(
      current.current.yaw,
      wantYaw,
      LOOK_LAMBDA,
      delta,
    );
    current.current.pitch = THREE.MathUtils.damp(
      current.current.pitch,
      wantPitch,
      LOOK_LAMBDA,
      delta,
    );

    // Periods chosen not to share a common multiple, so the sway never
    // resolves into a visible loop.
    const swayYaw = Math.sin(t * 0.31) * SWAY_YAW;
    const swayPitch = Math.sin(t * 0.23 + 1.1) * SWAY_PITCH;
    const bob = Math.sin(t * 0.19 + 2.3) * SWAY_BOB;

    camera.position.set(base.current.x, seat.eyeY + bob, base.current.z);
    camera.rotation.set(
      clamp(
        current.current.pitch + swayPitch,
        -MAX_LOOK_PITCH_DOWN,
        MAX_LOOK_PITCH_UP,
      ),
      base.current.yaw +
        clamp(current.current.yaw + swayYaw, -MAX_LOOK_YAW, MAX_LOOK_YAW),
      0,
    );
  });

  return null;
}
