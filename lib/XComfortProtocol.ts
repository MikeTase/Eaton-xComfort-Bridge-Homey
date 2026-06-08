/**
 * xComfort Bridge Protocol Constants
 *
 * This module defines all protocol constants, message types, and enums
 * used in the xComfort Bridge WebSocket communication.
 */

/**
 * Message Types for xComfort Bridge Protocol
 */
export const MESSAGE_TYPES = {
  // System Messages
  NACK: 0,
  ACK: 1,
  HEARTBEAT: 2,
  PING: 3,

  // Connection & Authentication Flow
  CONNECTION_START: 10,
  CONNECTION_CONFIRM: 11,
  SC_INIT_RESPONSE: 12,
  CONNECTION_DECLINED: 13,
  SC_INIT_REQUEST: 14,
  PUBLIC_KEY_RESPONSE: 15,
  SECRET_EXCHANGE: 16,
  SECRET_EXCHANGE_ACK: 17,

  // Authentication Messages
  LOGIN_REQUEST: 30,
  LOGIN_DENIED: 31,
  LOGIN_RESPONSE: 32,
  TOKEN_APPLY: 33,
  TOKEN_APPLY_ACK: 34,
  TOKEN_RENEW: 37,
  TOKEN_RENEW_RESPONSE: 38,

  // Data Request Messages
  REQUEST_DEVICES: 240,
  REQUEST_HOME_DATA: 242,
  DIAGNOSTICS: 243,

  // Device Control Messages
  SET_SCENE: 261,
  DEVICE_DIM: 280,
  DEVICE_SWITCH: 281,
  DEVICE_SHADE: 282,
  ROOM_DIM: 283,
  ROOM_SWITCH: 284,
  ACTIVATE_SCENE: 285,
  SET_REMOTE_CONFIG: 288,
  SET_HEATING_STATE: 353,
  SET_DEVICE_SHADING_STATE: 355,
  SET_DEVICE_ALARM_STATE: 356,
  SET_ROOM_HEATING_STATE: 363,

  // Response/Data Messages
  SET_DEVICE_STATE: 291,
  SET_ROOM_STATE: 293,
  SCENE_DELETED: 298,
  SET_ALL_DATA: 300,
  SET_SCENE_ID: 302,
  SET_HOME_DATA: 303,
  STATE_UPDATE: 310,
  ERROR_INFO: 295,
  SET_BRIDGE_STATE: 364,
  PUBLISH_MAIN_ELECTRICAL_ENERGY_USAGE: 401,
} as const;

/**
 * Device Types (based on devType field)
 */
export const DEVICE_TYPES = {
  SWITCHING_ACTUATOR: 100,
  DIMMING_ACTUATOR: 101,
  
  // Shading
  SHADING_ACTUATOR: 102,
  
  // Sensors / inputs
  MOTION_SENSOR: 200,
  ROCKER_SENSOR: 201,
  SWITCH: 202,
  DOOR_WINDOW_SENSOR: 202,
  ROCKER_BINARY_INPUT: 211,
  ROCKER: 220,
  WALL_SWITCH: 220,

  // Heating / temperature
  TEMP_SENSOR: 410,
  TEMPERATURE_SENSOR: 410,
  HEATING_ACTUATOR: 440,
  HEATING_VALVE: 441,
  HEATING_WATER_VALVE: 442,
  RC_TOUCH: 450,
  TEMP_HUMIDITY_SENSOR: 451,
  WATER_GUARD: 497,
  WATER_SENSOR: 499,
} as const;

/**
 * Component Types (based on compType field)
 */
export const COMPONENT_TYPES = {
  PUSH_BUTTON_1_CHANNEL: 1,
  PUSH_BUTTON_2_CHANNEL: 2,
  PUSH_BUTTON_4_CHANNEL: 3,
  BINARY_INPUT_230V: 19,
  BINARY_INPUT_BATTERY: 20,
  TEMPERATURE_SENSOR: 23,
  MOTION_SENSOR: 29,
  REMOTE_CONTROL_2_CHANNEL: 48,
  REMOTE_CONTROL_12_CHANNEL: 49,
  ROUTER_ACTUATOR: 52,
  HEATING_VALVE: 65,
  MULTI_HEATING_ACTUATOR: 71,
  LIGHT_SWITCH_ACTUATOR: 74,
  DOOR_WINDOW_SENSOR: 76,
  DIMMING_ACTUATOR: 77,
  RC_TOUCH: 78,
  HEATING_ACTUATOR_1_CHANNEL: 81,
  BRIDGE: 83,
  WATER_GUARD: 84,
  WATER_SENSOR: 85,
  SHADING_ACTUATOR: 86,
  PUSH_BUTTON_MULTI_SENSOR_1_CHANNEL: 87,
  PUSH_BUTTON_MULTI_SENSOR_2_CHANNEL: 88,
  PUSH_BUTTON_MULTI_SENSOR_4_CHANNEL: 89,
  WEATHER_STATION: 90,
} as const;

/**
 * Device usage values used by switching/dimming actuators.
 */
export const DEVICE_USAGE = {
  LIGHT: 0,
  LOAD: 1,
  SUM_HEATING: 2,
  SHADING: 3,
  WATER: 4,
  ROUTING: 5,
  WATER_HEATING: 6,
  VEHICLE_CHARGER: 7,
  HIGH_LOAD_APPLIANCE: 8,
  HEATING: 23,
  COOLING: 24,
  HEATING_COOLING: 25,
  SWITCH_HEATING_COOLING: 26,
  SWITCH_COOLING: 27,
  SWITCH_HEATING: 28,
} as const;

/**
 * WebSocket Close Codes
 */
export const WS_CLOSE_CODES = {
  ABNORMAL_CLOSURE: 1006,
} as const;

/**
 * Info Text Codes for Metadata
 */
export const INFO_TEXT_CODES = {
  TEMPERATURE_STANDARD: '1222', // Standard temperature sensor reading (°C)
  HUMIDITY_STANDARD: '1223', // Standard humidity sensor reading (%)
  DEVICE_TEMPERATURE: '1109', // Internal device/heater temperature (°C)
  TEMPERATURE_DIMMER: '1109', // Backwards-compatible alias
  SIGNAL_STRENGTH: '1111',
  BATTERY_LEVEL_0: '1113',
  BATTERY_LEVEL_25: '1114',
  BATTERY_LEVEL_50: '1115',
  BATTERY_LEVEL_75: '1116',
  BATTERY_LEVEL_100: '1117',
  BATTERY_LEVEL_UNKNOWN: '1118',
  MAINS_POWERED: '1119',
  PT1000_TEMPERATURE: '1224',
  DIMM_VALUE: '1225', // Heating demand / valve position from info
} as const;

/**
 * Client Configuration
 */
export const CLIENT_CONFIG = {
  TYPE: 'shl-app',
  ID: 'c956e43f999f8004',
  VERSION: '3.0.0',
  NAME: 'homey-xcomfort-bridge',
} as const;

/**
 * Protocol Configuration
 */
export const PROTOCOL_CONFIG = {
  ENCRYPTION: {
    ALGORITHM: 'aes-256-cbc',
    KEY_SIZE: 32,
    IV_SIZE: 16,
    BLOCK_SIZE: 16,
    RSA_SCHEME: 'RSAES-PKCS1-V1_5',
  },
  TIMEOUTS: {
    CONNECTION: 30000, // 30 seconds
    RECONNECT_CONNECTION: 45000, // 45 seconds - longer timeout for reconnection attempts
    HEARTBEAT: 30000, // 30 seconds
    RECONNECT_DELAY: 5000, // 5 seconds
  },
  LIMITS: {
    DIM_MIN: 1,
    DIM_MAX: 99,
    SALT_LENGTH: 12,
  },
} as const;
