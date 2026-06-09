/**
 * Energy history parsing helpers.
 *
 * The bridge reports energy history in several shapes depending on firmware
 * and meter type (plain numbers, arrays of samples, or keyed period objects).
 * These helpers tolerantly extract numeric kWh totals per period so they can
 * be exposed as numeric capabilities with Insights enabled.
 */

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
