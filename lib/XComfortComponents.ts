import { COMPONENT_TYPES } from './XComfortProtocol';

const COMPONENT_MODEL_NAMES: Record<number, string> = {
  [COMPONENT_TYPES.PUSH_BUTTON_1_CHANNEL]: '1-Channel Pushbutton',
  [COMPONENT_TYPES.PUSH_BUTTON_2_CHANNEL]: '2-Channel Pushbutton',
  [COMPONENT_TYPES.PUSH_BUTTON_4_CHANNEL]: '4-Channel Pushbutton',
  [COMPONENT_TYPES.REMOTE_CONTROL_2_CHANNEL]: '2-Channel Remote Control',
  [COMPONENT_TYPES.RC_TOUCH]: 'RC Touch',
  [COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_1_CHANNEL]: '1-Channel Pushbutton Multi Sensor',
  [COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_2_CHANNEL]: '2-Channel Pushbutton Multi Sensor',
  [COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_4_CHANNEL]: '4-Channel Pushbutton Multi Sensor',
};

const MULTI_CHANNEL_COMPONENTS: Record<number, number> = {
  [COMPONENT_TYPES.PUSH_BUTTON_2_CHANNEL]: 2,
  [COMPONENT_TYPES.PUSH_BUTTON_4_CHANNEL]: 4,
  [COMPONENT_TYPES.REMOTE_CONTROL_2_CHANNEL]: 2,
  [COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_2_CHANNEL]: 2,
  [COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_4_CHANNEL]: 4,
};

const WALL_SWITCH_COMPONENTS = new Set<number>([
  COMPONENT_TYPES.PUSH_BUTTON_1_CHANNEL,
  COMPONENT_TYPES.PUSH_BUTTON_2_CHANNEL,
  COMPONENT_TYPES.PUSH_BUTTON_4_CHANNEL,
  COMPONENT_TYPES.REMOTE_CONTROL_2_CHANNEL,
  COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_1_CHANNEL,
  COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_2_CHANNEL,
  COMPONENT_TYPES.PUSH_BUTTON_MULTI_SENSOR_4_CHANNEL,
]);

export function isSupportedWallSwitchComponentType(compType?: number): boolean {
  return typeof compType === 'number' && WALL_SWITCH_COMPONENTS.has(compType);
}

export function getButtonChannelCount(compType?: number): number {
  if (typeof compType !== 'number') {
    return 1;
  }

  return MULTI_CHANNEL_COMPONENTS[compType] ?? 1;
}

export function getComponentModelName(compType?: number): string | null {
  if (typeof compType !== 'number') {
    return null;
  }

  return COMPONENT_MODEL_NAMES[compType] ?? null;
}
