/**
 * Sensor state decoding verified against the official Eaton xComfort Bridge
 * app 2.4.1 (see docs/official-app-2.4.1/).
 */

/** Door/window component modes: which contact state sends ON (curstate 1). */
const CONTACT_ON_WHEN_CLOSED_MODES = new Set(['1308', '1310']); // window / door
const CONTACT_ON_WHEN_OPENED_MODES = new Set(['1309', '1311']); // window / door

/** Component info codes for the contact state (value = time of last change). */
const CONTACT_OPEN_CODES = new Set(['1121', '1123']); // window open / door open
const CONTACT_CLOSED_CODES = new Set(['1122', '1124']); // window closed / door closed

function infoCodes(info: unknown): string[] {
  if (!Array.isArray(info)) {
    return [];
  }
  return info
    .map((entry) => (entry && typeof entry === 'object' ? String((entry as { text?: unknown }).text ?? '') : ''))
    .filter((code) => code.length > 0);
}

export interface ContactStateInput {
  curstate?: unknown;
  switch?: unknown;
  /** Device or component mode, e.g. "1308". */
  mode?: unknown;
  /** Component info entries (1121-1124 carry the contact state). */
  componentInfo?: unknown;
}

/**
 * Whether a door/window contact is open.
 *
 * The channel's ON/OFF (`curstate`) means open or closed depending on the
 * configured mode (1308/1310 "ON when closed", 1309/1311 "ON when opened").
 * When the mode is unknown, the component's info codes are used, and as a
 * last resort the historic default ("ON when closed").
 */
export function resolveContactOpen(input: ContactStateInput): boolean | undefined {
  const mode = input.mode !== undefined && input.mode !== null ? String(input.mode) : '';
  const on = typeof input.curstate === 'number'
    ? input.curstate === 1
    : typeof input.switch === 'boolean'
      ? input.switch
      : undefined;

  if (on !== undefined && CONTACT_ON_WHEN_OPENED_MODES.has(mode)) {
    return on;
  }
  if (on !== undefined && CONTACT_ON_WHEN_CLOSED_MODES.has(mode)) {
    return !on;
  }

  const codes = infoCodes(input.componentInfo);
  if (codes.some((code) => CONTACT_OPEN_CODES.has(code))) {
    return true;
  }
  if (codes.some((code) => CONTACT_CLOSED_CODES.has(code))) {
    return false;
  }

  // Unknown mode and no info: keep the historic default (1308, ON when closed).
  if (typeof input.curstate === 'number') {
    return input.curstate !== 1;
  }
  return typeof input.switch === 'boolean' ? input.switch : undefined;
}

/**
 * Water guard (LeakageStop, devType 497) `curstate`:
 * 0 unknown, 1 water on, 2 water off, 3 leak alarm, 4 leak alarm muted,
 * 5 test alarm, 7 overtemperature. Returns whether a leak alarm is active.
 */
export function resolveWaterGuardLeak(curstate: unknown): boolean | undefined {
  if (typeof curstate !== 'number') {
    return undefined;
  }
  return curstate === 3 || curstate === 4;
}

/** Component info codes of a motion sensor (value = time of the change). */
const MOTION_CODE = '1125';
const NO_MOTION_CODE = '1126';

export interface MotionStateInput {
  curstate?: unknown;
  switch?: unknown;
  /** Component info entries (1125 motion / 1126 no motion). */
  componentInfo?: unknown;
}

/**
 * Whether a motion sensor currently detects motion.
 *
 * The channel's ON/OFF is used when the bridge reports it. Motion sensors
 * without a channel state (official demo: devType 200 on compType 29) show
 * motion only through the component info codes 1125 (motion) / 1126 (no
 * motion), which is what the official app displays.
 */
export function resolveMotionDetected(input: MotionStateInput): boolean | undefined {
  if (typeof input.switch === 'boolean') {
    return input.switch;
  }
  if (typeof input.curstate === 'number') {
    return input.curstate === 1;
  }
  if (typeof input.curstate === 'boolean') {
    return input.curstate;
  }

  const codes = infoCodes(input.componentInfo);
  if (codes.includes(MOTION_CODE)) {
    return true;
  }
  if (codes.includes(NO_MOTION_CODE)) {
    return false;
  }
  return undefined;
}
