import { ShadingCurrentState } from '../types';
import type { InfoEntry } from '../types';

/** Info codes the bridge uses for a locked shading actuator. */
const LOCKED_INFO_CODES = new Set(['1103', '1127']);

/**
 * Whether the shading safety function currently locks the actuator.
 *
 * `curstate` 4/5 (locked open / locked closed) is authoritative. Older
 * actuators without those states still report the "locked" info codes.
 * Note that the `shSafety` device field is only the *configuration* flag
 * ("safety function enabled"), not the live lock state.
 *
 * Returns undefined when the data says nothing about the lock.
 */
export function isShadingSafetyActive(curstate: unknown, info?: unknown): boolean | undefined {
  if (typeof curstate === 'number') {
    if (curstate === ShadingCurrentState.SAFETY_UP || curstate === ShadingCurrentState.SAFETY_DOWN) {
      return true;
    }
    if (curstate !== ShadingCurrentState.UNDEFINED) {
      return false;
    }
  }

  if (Array.isArray(info)) {
    return (info as InfoEntry[]).some((entry) => LOCKED_INFO_CODES.has(String(entry?.text ?? '')));
  }

  return undefined;
}

/** Movement reported by `curstate`, or undefined when it is unknown. */
export function shadingMotionFromCurstate(curstate: unknown): 'up' | 'down' | 'idle' | undefined {
  switch (curstate) {
    case ShadingCurrentState.MOVING_UP:
      return 'up';
    case ShadingCurrentState.MOVING_DOWN:
      return 'down';
    case ShadingCurrentState.STOPPED:
    case ShadingCurrentState.SAFETY_UP:
    case ShadingCurrentState.SAFETY_DOWN:
    case ShadingCurrentState.STOPPED_OVERTEMP:
    case ShadingCurrentState.STOPPED_OVERLOAD:
      return 'idle';
    default:
      return undefined;
  }
}

/**
 * Bridge `shPos` → Homey `windowcoverings_set`.
 *
 * The bridge reports 0 = fully open … 100 = fully closed (official app:
 * "up" icon at 0, "down" icon at 100; smart-scene condition "Closed − 95%").
 * Homey defines 0 = closed … 1 = open. Values outside 0..100 mean the
 * position is unknown and are ignored.
 */
export function bridgePositionToHomey(shPos: unknown): number | undefined {
  if (typeof shPos !== 'number' || !Number.isFinite(shPos) || shPos < 0 || shPos > 100) {
    return undefined;
  }
  return Math.round((1 - shPos / 100) * 100) / 100;
}

/** Homey `windowcoverings_set` (0 closed … 1 open) → bridge GO_TO value (0 open … 100 closed). */
export function homeyPositionToBridge(position: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(position) ? position : 0));
  return Math.round((1 - clamped) * 100);
}

/** `shControl` options that include the step buttons ("… + Steps"). */
const STEP_CONTROL_OPTIONS = new Set([3, 5, 6]);

/**
 * Whether the official app shows step up/down buttons for this actuator:
 * blinds with slats, or a control option with steps
 * (1 close/open, 2 close/stop/open, 3 close/stop/open + steps, 4 slider only,
 * 5 slider/stop + steps, 6 slider/close/stop/open + steps,
 * 7 slider/close/stop/open). Undefined when the bridge reports neither field.
 */
export function shadingSupportsSteps(device: object): boolean | undefined {
  const { shHasSlats, shControl } = device as { shHasSlats?: unknown; shControl?: unknown };
  const hasSlats = typeof shHasSlats === 'boolean' ? shHasSlats : undefined;
  const control = typeof shControl === 'number' ? shControl : undefined;
  if (hasSlats === undefined && control === undefined) {
    return undefined;
  }
  return hasSlats === true || (control !== undefined && STEP_CONTROL_OPTIONS.has(control));
}
