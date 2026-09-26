/**
 * Minimal time-zone helpers for bridge requests that are expressed in the
 * user's local calendar (energy history, tariff windows). Homey apps run in
 * UTC, so local boundaries are derived from the Homey's configured IANA
 * time zone via Intl.
 */

function getParts(epochMs: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return parts;
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
export function getTimeZoneOffsetMs(epochMs: number, timeZone?: string): number {
  if (!timeZone) {
    return 0;
  }
  try {
    const p = getParts(epochMs, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(epochMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Convert a local wall-clock time in `timeZone` to a UTC epoch (ms). */
function localToEpochMs(year: number, month: number, day: number, timeZone?: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  const result = guess - offset;
  // Re-check once in case the offset differs at the result (DST switch day).
  const correctedOffset = getTimeZoneOffsetMs(result, timeZone);
  return correctedOffset === offset ? result : guess - correctedOffset;
}

function getLocalDate(epochMs: number, timeZone?: string): { year: number; month: number; day: number } {
  if (!timeZone) {
    const date = new Date(epochMs);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  try {
    const p = getParts(epochMs, timeZone);
    return { year: p.year, month: p.month, day: p.day };
  } catch {
    const date = new Date(epochMs);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
}

/** Start of the local day containing `epochMs`, as epoch milliseconds. */
export function startOfLocalDay(epochMs: number, timeZone?: string): number {
  const { year, month, day } = getLocalDate(epochMs, timeZone);
  return localToEpochMs(year, month, day, timeZone);
}

/** Start of the local month containing `epochMs`, as epoch milliseconds. */
export function startOfLocalMonth(epochMs: number, timeZone?: string): number {
  const { year, month } = getLocalDate(epochMs, timeZone);
  return localToEpochMs(year, month, 1, timeZone);
}

/** Start of the next local month after the one containing `epochMs`. */
export function startOfNextLocalMonth(epochMs: number, timeZone?: string): number {
  const { year, month } = getLocalDate(epochMs, timeZone);
  return month === 12
    ? localToEpochMs(year + 1, 1, 1, timeZone)
    : localToEpochMs(year, month + 1, 1, timeZone);
}
