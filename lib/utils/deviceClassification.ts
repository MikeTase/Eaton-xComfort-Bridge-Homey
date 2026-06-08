import { DEVICE_TYPES, COMPONENT_TYPES, INFO_TEXT_CODES } from '../XComfortProtocol';
import type { InfoEntry, XComfortComponent, XComfortDevice } from '../types';

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

const MOTION_TEXT_PATTERN = /\b(cbmd|cbma|motion|presence|occupancy|pir|detector|beveg|beweg|bewegung)\b/i;

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

export function hasTemperatureMetadata(info?: InfoEntry[]): boolean {
  return Array.isArray(info) && info.some((entry) => {
    return entry.text === INFO_TEXT_CODES.TEMPERATURE_STANDARD
      || entry.text === INFO_TEXT_CODES.TEMPERATURE_DIMMER;
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
