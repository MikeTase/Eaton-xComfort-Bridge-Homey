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
