/**
 * Energy field extraction helpers shared between the protocol layer
 * (MessageHandler) and the energy meter driver.
 *
 * The bridge reports energy data under different key names depending on
 * firmware and meter type, so each value is resolved through an ordered list
 * of known aliases. Keeping the alias lists and the "first matching value"
 * helpers here ensures a new firmware alias only has to be added once.
 *
 * Authoritative field names (verified against the official Eaton app, energy
 * reducer for SET_ENERGY_METER/SET_ENERGY_METER_STATE 397/401): a meter
 * reports `power` (W), `energyDemand` (cumulative import) and `energyFeedIn`
 * (cumulative feed-in/export), plus `connectionState`. These real names are
 * listed first below; the remaining entries are tolerant fallbacks for other
 * firmware/payload shapes. NOTE: the unit of `energyDemand`/`energyFeedIn` is
 * not certain from the app (likely Wh or kWh) — if a real CEMx meter shows a
 * 1000x discrepancy in meter_power, scale these at the read site.
 */

/** Power (W) aliases. `power` is the real field; the rest are fallbacks. */
export const POWER_KEYS = [
  'power',
  'activePower',
  'currentPower',
  'powerW',
  'instantPower',
  'actualPower',
  'powerConsumption',
  'watts',
];

/**
 * Broader power alias list used when scanning raw bridge energy payloads,
 * including generic keys ('value') that are too ambiguous for device-level
 * state records.
 */
export const POWER_KEYS_BROAD = [
  'power',
  'activePower',
  'currentPower',
  'mainPower',
  'electricalPower',
  'powerW',
  'instantPower',
  'actualPower',
  'powerConsumption',
  'watt',
  'watts',
  'value',
];

/**
 * Cumulative imported energy aliases. `energyDemand` is the real meter field
 * (see header note on units); the rest are tolerant fallbacks.
 */
export const ENERGY_KEYS = [
  'energyDemand',
  'energy',
  'energyKwh',
  'kwh',
  'totalEnergy',
  'electricalEnergy',
  'consumption',
  'totalConsumption',
  'consumptionKwh',
  'totalKwh',
  'importEnergy',
  'meterPower',
];

// Cumulative fed-in / exported energy (e.g. solar) arrives as `energyFeedIn`.
// Not surfaced yet — it needs a dedicated export capability (manifest work)
// rather than sharing meter_power with imported energy.

export const CURRENT_KEYS = ['current', 'currentA', 'ampere', 'amperes', 'amps'];

export const VOLTAGE_KEYS = ['voltage', 'voltageV', 'volt', 'volts'];

export const PULSES_KEYS = ['pulses', 'pulse', 'pulseCount', 'impulses', 'counter'];

export const COST_KEYS = ['cost', 'energyCost', 'totalCost', 'totalPrice'];

export const TARIFF_KEYS = [
  'tariff',
  'tariffId',
  'currentTariff',
  'tariffPrice',
  'priceNow',
  'currentPrice',
  'pricePerKwh',
  'rate',
];

export const TARIFF_LABEL_KEYS = [
  'tariffLabel',
  'tariffName',
  'tariffText',
  'currentTariffName',
  'currentTariffLabel',
  'priceArea',
  'priceZone',
  'tariffCode',
];

export const CURRENCY_KEYS = [
  'currency',
  'currencyCode',
  'energyCurrency',
  'costCurrency',
  'tariffCurrency',
];

export const HISTORY_KEYS = [
  'history',
  'energyHistory',
  'consumptionHistory',
  'historicEnergy',
  'periods',
  'dayHistory',
  'daily',
  'weekHistory',
  'weekly',
  'monthHistory',
  'monthly',
  'yearHistory',
  'yearly',
];

export const LOAD_MODE_KEYS = [
  'loadMode',
  'mode',
  'controlMode',
  'priorityMode',
  'loadControlMode',
  'energyMode',
];

/**
 * First finite number among the keys. Numeric strings are accepted,
 * including comma decimal separators ("1,5").
 */
export function getFirstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.replace(',', '.'));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

/** First non-empty string among the keys, trimmed. */
export function getFirstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

/** First defined, non-null value among the keys. */
export function getFirstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

/** Resolve and normalize a load mode value from a raw payload. */
export function getLoadMode(source: Record<string, unknown>): string | undefined {
  const value = getFirstValue(source, LOAD_MODE_KEYS);
  if (typeof value === 'number' || typeof value === 'string') {
    return normalizeLoadMode(value);
  }

  return undefined;
}

/**
 * Normalize a load mode (protocol number or free-form string) to one of
 * 'normal' | 'energy_saving' | 'priority'.
 */
export function normalizeLoadMode(value: string | number): string {
  if (typeof value === 'number') {
    switch (value) {
      case 1:
        return 'energy_saving';
      case 2:
        return 'priority';
      case 0:
      default:
        return 'normal';
    }
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'saving' || normalized === 'energy_saving' || normalized === 'energysaving') {
    return 'energy_saving';
  }
  if (normalized === 'priority' || normalized === 'prio') {
    return 'priority';
  }
  return 'normal';
}

/** Map a normalized load mode back to its protocol value. */
export function loadModeToProtocolValue(mode: string): number {
  switch (mode) {
    case 'energy_saving':
      return 1;
    case 'priority':
      return 2;
    case 'normal':
    default:
      return 0;
  }
}
