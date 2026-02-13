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
  LOGIN_RESPONSE: 32,
  TOKEN_APPLY: 33,
  TOKEN_APPLY_ACK: 34,
  TOKEN_RENEW: 37,
  TOKEN_RENEW_RESPONSE: 38,

  // Data Request Messages
  REQUEST_DEVICES: 240,

  // Device Control Messages
  DEVICE_DIM: 280,
  DEVICE_SWITCH: 281,
  DEVICE_SHADE: 282,
  SET_HEATING_STATE: 353,
  SET_DEVICE_SHADING_STATE: 355,

  // Response/Data Messages
  SET_ALL_DATA: 300,
  SET_HOME_DATA: 303,
  STATE_UPDATE: 310,
  ERROR_INFO: 295,
  SET_BRIDGE_STATE: 364,
} as const;

/**
 * Device Types (based on devType field)
 */
export const DEVICE_TYPES = {
  SWITCHING_ACTUATOR: 100,
  DIMMING_ACTUATOR: 101,
  
  // Shading
  SHADING_ACTUATOR: 102,
  
  // Heating / Sensors
  TEMPERATURE_SENSOR: 200,
  DOOR_WINDOW_SENSOR: 202,
  WALL_SWITCH: 220,
  HEATING_ACTUATOR: 440,
  HEATING_VALVE: 441,
  HEATING_WATER_VALVE: 442,
  RC_TOUCH: 450,
  TEMP_HUMIDITY_SENSOR: 451,
  WATER_GUARD: 497,
  WATER_SENSOR: 499,
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
  TEMPERATURE_DIMMER: '1109', // Temperature from dimming actuator
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
    HEARTBEAT: 30000, // 30 seconds
    RECONNECT_DELAY: 5000, // 5 seconds
  },
  LIMITS: {
    DIM_MIN: 1,
    DIM_MAX: 99,
    SALT_LENGTH: 12,
  },
} as const;


