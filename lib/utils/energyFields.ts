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
 * Energy control mode as used by the bridge (ENERGY_CONTROL_SET_MODE 392,
 * SET_ENERGY_STATE 393 and `eControl` in 300/386). Verified against the
 * official app: 0 = inactive, 1 = normal ("AUTO": loads run at normal and
 * cheap tariff), 2 = energy saving (cheap tariff only). "Priority" is not a
 * mode value but a temporary `prio: true` flag on top of the current mode.
 */
export const ENERGY_CONTROL_MODE = {
  INACTIVE: 0,
  NORMAL: 1,
  ENERGY_SAVING: 2,
} as const;

/**
 * Energy control priority load type (`prioType`): which load group gets
 * priority while `prio` is active.
 */
export const ENERGY_PRIORITY_TYPE = {
  CLIMATE: 0,
  WATER_HEATING: 1,
  EV_CHARGING: 2,
  HIGH_LOAD_APPLIANCE: 3,
} as const;

/** Default priority duration in minutes (the official app offers 30..300). */
export const DEFAULT_PRIORITY_DURATION_MINUTES = 60;

/**
 * Normalize a load mode (protocol number or free-form string) to one of
 * 'inactive' | 'normal' | 'energy_saving' | 'priority'.
 */
export function normalizeLoadMode(value: string | number): string {
  if (typeof value === 'number') {
    switch (value) {
      case ENERGY_CONTROL_MODE.INACTIVE:
        return 'inactive';
      case ENERGY_CONTROL_MODE.ENERGY_SAVING:
        return 'energy_saving';
      case ENERGY_CONTROL_MODE.NORMAL:
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
  if (normalized === 'inactive' || normalized === 'off' || normalized === 'disabled') {
    return 'inactive';
  }
  return 'normal';
}

/**
 * Read the bridge's energy control state from a 386/300 payload (nested
 * `eControl`) or a 393 SET_ENERGY_STATE payload (top-level fields).
 * An active priority wins over the underlying mode.
 */
export function resolveEnergyControlMode(payload: Record<string, unknown>): string | undefined {
  const nested = payload.eControl;
  const control = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : payload;

  if (control.prio === true) {
    return 'priority';
  }

  if (typeof control.mode === 'number' && Number.isFinite(control.mode)) {
    return normalizeLoadMode(control.mode);
  }

  if (typeof control.loadMode === 'string') {
    return normalizeLoadMode(control.loadMode);
  }

  return undefined;
}

/** Map a normalized, non-priority load mode back to its protocol value. */
export function loadModeToProtocolValue(mode: string): number {
  switch (mode) {
    case 'inactive':
      return ENERGY_CONTROL_MODE.INACTIVE;
    case 'energy_saving':
      return ENERGY_CONTROL_MODE.ENERGY_SAVING;
    case 'normal':
    default:
      return ENERGY_CONTROL_MODE.NORMAL;
  }
}

export interface EnergyControlModeOptions {
  /** Bridge mode to keep underneath a priority (defaults to normal). */
  currentMode?: string;
  /** Required for 'priority': which load group to prioritize. */
  prioType?: number;
  /** Priority duration in minutes. */
  prioDuration?: number;
}

/**
 * Build the official ENERGY_CONTROL_SET_MODE (392) payload.
 * Plain modes also clear any running priority, like the official app's
 * "cancel priority" action does.
 */
export function buildEnergyControlModePayload(
  mode: string,
  options: EnergyControlModeOptions = {},
): Record<string, unknown> {
  const normalizedMode = normalizeLoadMode(mode);

  if (normalizedMode !== 'priority') {
    return { mode: loadModeToProtocolValue(normalizedMode), prio: false };
  }

  if (typeof options.prioType !== 'number' || !Number.isInteger(options.prioType)) {
    throw new Error('Priority mode needs a load type (water heater, EV charger, climate or high-load appliance)');
  }

  const baseMode = options.currentMode ? normalizeLoadMode(options.currentMode) : 'normal';
  const keptMode = baseMode === 'energy_saving' ? ENERGY_CONTROL_MODE.ENERGY_SAVING : ENERGY_CONTROL_MODE.NORMAL;
  const duration = Number.isFinite(options.prioDuration) && (options.prioDuration as number) > 0
    ? Math.round(options.prioDuration as number)
    : DEFAULT_PRIORITY_DURATION_MINUTES;

  return {
    mode: keptMode,
    prio: true,
    prioType: options.prioType,
    prioDuration: duration,
  };
}

/**
 * Derive the energy-control priority type from an actuator `usage`
 * (DEVICE_USAGE) or a network meter `usage` (meter usage enum).
 */
export function resolvePriorityType(options: { deviceUsage?: unknown; meterUsage?: unknown }): number | undefined {
  const deviceUsage = Number(options.deviceUsage);
  if (Number.isFinite(deviceUsage)) {
    if (deviceUsage === 6) return ENERGY_PRIORITY_TYPE.WATER_HEATING; // WATER_HEATING
    if (deviceUsage === 7) return ENERGY_PRIORITY_TYPE.EV_CHARGING; // VEHICLE_CHARGER
    if (deviceUsage === 8) return ENERGY_PRIORITY_TYPE.HIGH_LOAD_APPLIANCE; // HIGH_LOAD_APPLIANCE
    if (deviceUsage === 2 || (deviceUsage >= 21 && deviceUsage <= 28)) return ENERGY_PRIORITY_TYPE.CLIMATE;
  }

  const meterUsage = Number(options.meterUsage);
  if (Number.isFinite(meterUsage)) {
    if (meterUsage === 2) return ENERGY_PRIORITY_TYPE.EV_CHARGING; // EV_CHARGING
    if (meterUsage === 4) return ENERGY_PRIORITY_TYPE.CLIMATE; // HEATPUMP
    if (meterUsage === 5) return ENERGY_PRIORITY_TYPE.HIGH_LOAD_APPLIANCE; // SPECIAL_APPLIANCE
    if (meterUsage === 6) return ENERGY_PRIORITY_TYPE.WATER_HEATING; // WATER_HEATER
  }

  return undefined;
}
