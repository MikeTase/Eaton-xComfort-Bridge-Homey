/**
 * Small protocol helpers verified against the official Eaton xComfort
 * Bridge app 2.4.1 (see docs/official-app-2.4.1/).
 */

/**
 * The official app sends every floating-point field (setpoints, offsets,
 * hysteresis) rounded to two decimals with ±0.001 added, so the JSON value
 * always carries a fraction (21 → 21.001). The bridge's typed JSON parser
 * expects a float there; mirror that encoding.
 */
export function toBridgeFloat(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded >= 0 ? rounded + 0.001 : rounded - 0.001;
}

export interface ConnectionDeclineInfo {
  errorId?: number;
  meaning: string;
  /** True when retrying soon cannot succeed (client/version problems). */
  permanent: boolean;
}

const DECLINE_REASONS: Record<number, { meaning: string; permanent: boolean }> = {
  800: { meaning: 'invalid connection handshake', permanent: false },
  801: { meaning: 'secure channel not opened first', permanent: false },
  802: { meaning: 'client version declined by the bridge', permanent: true },
  803: { meaning: 'wrong client version format', permanent: true },
  804: { meaning: 'wrong client type', permanent: true },
  805: { meaning: 'remote access not allowed', permanent: true },
  806: { meaning: 'connection closed before reuse (stale session)', permanent: false },
};

/** Decode a CONNECTION_DECLINED (13) payload `{error_id, error_message}`. */
export function describeConnectionDecline(payload: unknown): ConnectionDeclineInfo {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const errorId = Number(record.error_id);
  const known = Number.isFinite(errorId) ? DECLINE_REASONS[errorId] : undefined;
  const bridgeMessage = typeof record.error_message === 'string' ? record.error_message : '';

  if (known) {
    return { errorId, meaning: known.meaning, permanent: known.permanent };
  }

  return {
    errorId: Number.isFinite(errorId) ? errorId : undefined,
    meaning: bridgeMessage || 'declined (stale session or unknown reason)',
    permanent: false,
  };
}
