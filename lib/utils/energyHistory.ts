/**
 * Energy history parsing helpers.
 *
 * The bridge reports energy history in several shapes depending on firmware
 * and meter type (plain numbers, arrays of samples, or keyed period objects).
 * These helpers tolerantly extract numeric kWh totals per period so they can
 * be exposed as numeric capabilities with Insights enabled.
 */

import { getTimeZoneOffsetMs, startOfLocalDay, startOfLocalMonth, startOfNextLocalMonth } from './timeZone';

const ENERGY_VALUE_KEYS = [
  'energy',
  'energyKwh',
  'kwh',
  'consumption',
  'totalConsumption',
  'consumptionKwh',
  'totalKwh',
  'value',
];

const PERIOD_KEYS: Record<'today' | 'month', string[]> = {
  today: ['today', 'day', 'daily', 'dayHistory'],
  month: ['month', 'monthly', 'monthHistory'],
};

export interface EnergyHistoryPeriods {
  todayKwh?: number;
  monthKwh?: number;
}

/**
 * Extract a kWh total from one history value: a number, a numeric string,
 * an array of samples (summed), or an object holding a known energy key.
 */
export function extractHistoryKwh(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (Array.isArray(value)) {
    const samples = value
      .map((item) => extractHistoryKwh(item))
      .filter((item): item is number => item !== undefined);
    if (!samples.length) {
      return undefined;
    }
    return samples.reduce((sum, item) => sum + item, 0);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ENERGY_VALUE_KEYS) {
      const candidate = record[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const parsed = Number.parseFloat(candidate.replace(',', '.'));
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract per-period kWh totals (today / this month) from a history payload.
 */
export function extractHistoryPeriods(history: unknown): EnergyHistoryPeriods {
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return {};
  }

  const record = history as Record<string, unknown>;
  const periods: EnergyHistoryPeriods = {};

  for (const key of PERIOD_KEYS.today) {
    if (record[key] !== undefined && record[key] !== null) {
      const kwh = extractHistoryKwh(record[key]);
      if (kwh !== undefined) {
        periods.todayKwh = Number(kwh.toFixed(3));
      }
      break;
    }
  }

  for (const key of PERIOD_KEYS.month) {
    if (record[key] !== undefined && record[key] !== null) {
      const kwh = extractHistoryKwh(record[key]);
      if (kwh !== undefined) {
        periods.monthKwh = Number(kwh.toFixed(3));
      }
      break;
    }
  }

  return periods;
}

// ---------------------------------------------------------------------------
// Official bridge format (REQUEST_ENERGY_HISTORY 395 / ENERGY_HISTORY 396),
// verified against the official Eaton xComfort Bridge app 2.4.1.
// ---------------------------------------------------------------------------

/** History resolution (`iType`): SHORT = minute intervals, LONG = months. */
export const HISTORY_ITYPE = { SHORT: 0, LONG: 1 } as const;
/** History value type (`vType`). */
export const HISTORY_VTYPE = { CONSUMPTION: 0, COSTS: 1, EMISSIONS: 2 } as const;

export interface OfficialHistoryItem {
  id: string | number;
  start: number;
  factor?: number;
  values: number[];
}

export interface OfficialHistoryPayload {
  iType: number;
  interval: number;
  vType: number;
  final?: boolean;
  items: OfficialHistoryItem[];
}

/** True for a 396 payload in the official `{iType, interval, vType, items}` shape. */
export function isOfficialEnergyHistory(value: unknown): value is OfficialHistoryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.iType === 'number'
    && typeof record.interval === 'number'
    && Array.isArray(record.items);
}

export interface HistoryQueryOptions {
  itemId: number;
  nowMs?: number;
  timeZone?: string;
}

/**
 * REQUEST_ENERGY_HISTORY payload for today's hourly consumption. Like the
 * official app, `from` is local midnight, `to` is omitted and `iValues`
 * covers the hours elapsed so far.
 */
export function buildTodayHistoryRequest(options: HistoryQueryOptions): Record<string, unknown> {
  const nowMs = options.nowMs ?? Date.now();
  const fromMs = startOfLocalDay(nowMs, options.timeZone);
  return {
    from: Math.floor(fromMs / 1000),
    iType: HISTORY_ITYPE.SHORT,
    interval: 60,
    iValues: Math.max(1, Math.ceil((nowMs - fromMs) / 3_600_000)),
    vType: HISTORY_VTYPE.CONSUMPTION,
    items: [options.itemId],
  };
}

/** REQUEST_ENERGY_HISTORY payload for this month's daily consumption. */
export function buildMonthHistoryRequest(options: HistoryQueryOptions): Record<string, unknown> {
  const nowMs = options.nowMs ?? Date.now();
  const fromMs = startOfLocalMonth(nowMs, options.timeZone);
  return {
    from: Math.floor(fromMs / 1000),
    iType: HISTORY_ITYPE.SHORT,
    interval: 1440,
    iValues: Math.max(1, Math.ceil((nowMs - fromMs) / 86_400_000)),
    vType: HISTORY_VTYPE.CONSUMPTION,
    items: [options.itemId],
  };
}

/**
 * REQUEST_TARIFF_INFO payload: the official app asks for yesterday through
 * tomorrow (local midnight − 1 day … + 2 days), in Unix seconds.
 */
export function buildTariffInfoRequest(nowMs: number = Date.now(), timeZone?: string): Record<string, number> {
  const midnight = Math.floor(startOfLocalDay(nowMs, timeZone) / 1000);
  return { from: midnight - 86_400, to: midnight + 172_800 };
}

/**
 * Today / this-month kWh for one item of an official 396 history payload.
 * Values are Wh × `factor`. A slot counts toward a period when its midpoint
 * falls inside it, which tolerates the bridge aligning daily slots to UTC.
 */
export function extractOfficialHistoryPeriods(
  history: OfficialHistoryPayload,
  itemId: string | number | undefined,
  nowMs: number = Date.now(),
  timeZone?: string,
): EnergyHistoryPeriods {
  if (history.vType !== HISTORY_VTYPE.CONSUMPTION) {
    return {};
  }

  const item = history.items.find((candidate) => itemId !== undefined && String(candidate.id) === String(itemId))
    ?? (history.items.length === 1 && itemId === undefined ? history.items[0] : undefined);
  if (!item || !Array.isArray(item.values) || typeof item.start !== 'number') {
    return {};
  }

  const factor = typeof item.factor === 'number' && Number.isFinite(item.factor) ? item.factor : 1;
  const sumWhBetween = (fromMs: number, toMs: number, slotMs: number): number | undefined => {
    let total = 0;
    let counted = 0;
    item.values.forEach((value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const midpoint = item.start * 1000 + index * slotMs + slotMs / 2;
      if (midpoint >= fromMs && midpoint < toMs) {
        total += value * factor;
        counted += 1;
      }
    });
    return counted > 0 ? total : undefined;
  };

  const periods: EnergyHistoryPeriods = {};
  const dayStart = startOfLocalDay(nowMs, timeZone);
  const monthStart = startOfLocalMonth(nowMs, timeZone);
  const monthEnd = startOfNextLocalMonth(nowMs, timeZone);

  if (history.iType === HISTORY_ITYPE.SHORT && history.interval === 60) {
    const wh = sumWhBetween(dayStart, dayStart + 86_400_000, 3_600_000);
    if (wh !== undefined) periods.todayKwh = Number((wh / 1000).toFixed(3));
  } else if (history.iType === HISTORY_ITYPE.SHORT && history.interval === 1440) {
    const wh = sumWhBetween(monthStart, monthEnd, 86_400_000);
    if (wh !== undefined) periods.monthKwh = Number((wh / 1000).toFixed(3));
  } else if (history.iType === HISTORY_ITYPE.LONG) {
    // Monthly values: slot n is n months after `start`.
    const startDate = new Date(item.start * 1000 + getTimeZoneOffsetMs(item.start * 1000, timeZone));
    const nowDate = new Date(nowMs + getTimeZoneOffsetMs(nowMs, timeZone));
    const index = (nowDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12
      + (nowDate.getUTCMonth() - startDate.getUTCMonth());
    const value = item.values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      periods.monthKwh = Number(((value * factor) / 1000).toFixed(3));
    }
  }

  return periods;
}
