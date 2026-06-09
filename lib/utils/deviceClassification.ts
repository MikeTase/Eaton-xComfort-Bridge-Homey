import { DEVICE_TYPES, COMPONENT_TYPES, INFO_TEXT_CODES } from '../XComfortProtocol';
import type { InfoEntry, XComfortComponent, XComfortDevice } from '../types';
import { getButtonChannelCount, getComponentModelName } from '../XComfortComponents';

const SWITCH_LIKE_DEVICE_TYPES = new Set<number>([
  DEVICE_TYPES.SWITCH,
  DEVICE_TYPES.DOOR_WINDOW_SENSOR,
  DEVICE_TYPES.MOTION_SENSOR,
  DEVICE_TYPES.ROCKER_SENSOR,
  DEVICE_TYPES.ROCKER_BINARY_INPUT,
]);

const TEMPERATURE_DEVICE_TYPES = new Set<number>([
  DEVICE_TYPES.TEMPERATURE_SENSOR,
  DEVICE_TYPES.TEMP_SENSOR,
  DEVICE_TYPES.TEMP_HUMIDITY_SENSOR,
]);

const WEATHER_DEVICE_TYPES = new Set<number>([
  DEVICE_TYPES.WEATHER_STATION,
]);

const ENERGY_COMPONENT_TYPES = new Set<number>([
  COMPONENT_TYPES.ENERGY_METER,
]);

const MOTION_TEXT_PATTERN = /\b(cbmd|cbma|motion|presence|occupancy|pir|detector|beveg|beweg|bewegung)\b/i;
const WEATHER_TEXT_PATTERN = /\b(weather|wind|rain|brightness|cws|csau|weer|wetter)\b/i;
const ENERGY_TEXT_PATTERN = /\b(energy|meter|cem|cemb|cemo|bridge energy|power meter|energie|strom)\b/i;

export function isSwitchLikeSensorDevice(device: XComfortDevice): boolean {
  return SWITCH_LIKE_DEVICE_TYPES.has(Number(device.devType ?? 0));
}

export function isDoorWindowSensorDevice(device: XComfortDevice, component?: XComfortComponent): boolean {
  return isSwitchLikeSensorDevice(device)
    && Number(device.compType ?? component?.compType ?? 0) === COMPONENT_TYPES.DOOR_WINDOW_SENSOR;
}

export function isMotionSensorDevice(device: XComfortDevice, component?: XComfortComponent): boolean {
  if (!isSwitchLikeSensorDevice(device) || isDoorWindowSensorDevice(device, component)) {
    return false;
  }

  const compType = Number(device.compType ?? component?.compType ?? 0);
  if (compType === COMPONENT_TYPES.MOTION_SENSOR) {
    return true;
  }

  const devType = Number(device.devType ?? 0);
  if (devType === DEVICE_TYPES.MOTION_SENSOR) {
    return true;
  }

  return MOTION_TEXT_PATTERN.test(getSearchText(device, component));
}

export function isGenericBinaryInputDevice(device: XComfortDevice, component?: XComfortComponent): boolean {
  const compType = Number(device.compType ?? component?.compType ?? 0);
  if (
    compType === COMPONENT_TYPES.BINARY_INPUT_230V ||
    compType === COMPONENT_TYPES.BINARY_INPUT_BATTERY
  ) {
    return true;
  }

  return isSwitchLikeSensorDevice(device)
    && !isDoorWindowSensorDevice(device, component)
    && !isMotionSensorDevice(device, component);
}

export function isTemperatureSensorDevice(device: XComfortDevice): boolean {
  const devType = Number(device.devType ?? 0);
  return TEMPERATURE_DEVICE_TYPES.has(devType) || hasTemperatureMetadata(device.info);
}

export function isWeatherStationDevice(device: XComfortDevice, component?: XComfortComponent): boolean {
  const devType = Number(device.devType ?? 0);
  const compType = Number(device.compType ?? component?.compType ?? 0);
  return WEATHER_DEVICE_TYPES.has(devType)
    || compType === COMPONENT_TYPES.WEATHER_STATION
    || hasWeatherMetadata(device.info)
    || WEATHER_TEXT_PATTERN.test(getSearchText(device, component));
}

export function isEnergyMeterDevice(device: XComfortDevice, component?: XComfortComponent): boolean {
  const compType = Number(device.compType ?? component?.compType ?? 0);
  return ENERGY_COMPONENT_TYPES.has(compType)
    || typeof device.power === 'number'
    || hasPowerMetadata(device.info)
    || ENERGY_TEXT_PATTERN.test(getSearchText(device, component));
}

export function hasTemperatureMetadata(info?: InfoEntry[]): boolean {
  return Array.isArray(info) && info.some((entry) => {
    return entry.text === INFO_TEXT_CODES.TEMPERATURE_STANDARD
      || entry.text === INFO_TEXT_CODES.TEMPERATURE_DIMMER;
  });
}

export function hasWeatherMetadata(info?: InfoEntry[]): boolean {
  return Array.isArray(info) && info.some((entry) => {
    return entry.text === INFO_TEXT_CODES.WIND_SPEED
      || entry.text === INFO_TEXT_CODES.RAIN
      || entry.text === INFO_TEXT_CODES.NO_RAIN
      || entry.text === INFO_TEXT_CODES.BRIGHTNESS;
  });
}

export function hasPowerMetadata(info?: InfoEntry[]): boolean {
  return Array.isArray(info) && info.some((entry) => {
    return entry.text === INFO_TEXT_CODES.POWER
      || entry.text === INFO_TEXT_CODES.POWER_CONSUMPTION;
  });
}

export function getDisplayName(device: XComfortDevice, fallbackPrefix: string): string {
  const baseName = device.name || `${fallbackPrefix} ${device.deviceId}`;
  return device.roomName ? `${device.roomName} - ${baseName}` : baseName;
}

export function getClassificationSettings(
  device: XComfortDevice,
  component?: XComfortComponent,
): Record<string, string | number> {
  const settings: Record<string, string | number> = {
    deviceType: Number(device.devType ?? 0),
  };

  const compType = Number(device.compType ?? component?.compType ?? 0);
  if (compType > 0) {
    settings.componentType = compType;
  }

  if (component?.name) {
    settings.componentName = component.name;
  } else if (device.componentName) {
    settings.componentName = device.componentName;
  }

  const componentModelName = getComponentModelName(compType);
  if (componentModelName) {
    settings.componentModelName = componentModelName;
  }

  const channelCount = getButtonChannelCount(compType);
  if (channelCount > 1) {
    settings.channelCount = channelCount;
  }

  const usageLabel = getUsageLabel(Number(device.usage ?? -1));
  if (usageLabel) {
    settings.deviceUsage = usageLabel;
  }

  const raw = component?.raw || {};
  const rawFields: Array<[string, string]> = [
    ['componentMode', 'mode'],
    ['componentModel', 'model'],
    ['componentTypeLabel', 'type'],
    ['componentDescription', 'description'],
  ];

  rawFields.forEach(([settingKey, rawKey]) => {
    const value = raw[rawKey];
    if (typeof value === 'string' || typeof value === 'number') {
      settings[settingKey] = value;
    }
  });

  return settings;
}

export function resolveBinaryState(state: { switch?: boolean; curstate?: unknown }): boolean | undefined {
  if (typeof state.switch === 'boolean') {
    return state.switch;
  }

  if (typeof state.curstate === 'number') {
    return state.curstate === 1;
  }

  if (typeof state.curstate === 'boolean') {
    return state.curstate;
  }

  return undefined;
}

function getUsageLabel(usage: number): string | null {
  switch (usage) {
    case 0:
      return 'Light';
    case 1:
      return 'Load';
    case 2:
      return 'Sum heating';
    case 3:
      return 'Shading';
    case 4:
      return 'Water';
    case 6:
      return 'Water heating';
    case 7:
      return 'Vehicle charger';
    case 8:
      return 'High-load appliance';
    case 21:
      return 'Sum cooling';
    case 22:
      return 'Sum heating/cooling';
    case 23:
      return 'Heating';
    case 24:
      return 'Cooling';
    case 25:
      return 'Heating/cooling';
    case 26:
      return 'Heating/cooling switch';
    case 27:
      return 'Cooling switch';
    case 28:
      return 'Heating switch';
    case 100:
      return 'Binary input';
    case 101:
      return 'Heating/cooling input';
    case 102:
      return 'Heating/cooling two-contact input';
    default:
      return null;
  }
}

function getSearchText(device: XComfortDevice, component?: XComfortComponent): string {
  const values = [
    device.name,
    device.componentName,
    component?.name,
    device.model,
    device.type,
    component?.raw?.model,
    component?.raw?.type,
    component?.raw?.mode,
    component?.raw?.description,
  ];

  return values
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .join(' ');
}
