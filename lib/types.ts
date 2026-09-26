/**
 * xComfort Bridge - Shared TypeScript Interfaces
 *
 * This file contains all shared type definitions used across the application.
 * All modules should import types from here to avoid duplication.
 */

/** Logger function signature */
export type LoggerFunction = (...args: unknown[]) => void;

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Connection state machine states
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Authentication state values
 */
export type AuthState =
  | 'idle'
  | 'awaiting_public_key'
  | 'awaiting_secret_ack'
  | 'awaiting_login_response'
  | 'awaiting_token_apply'
  | 'awaiting_token_renew'
  | 'failed'
  | 'authenticated';

/**
 * Encryption context for AES
 */
export interface EncryptionContext {
  key: Buffer;
  iv: Buffer;
}

export type XComfortAuthMode = 'device' | 'user';

export interface XComfortAuthOptions {
  mode?: XComfortAuthMode;
  username?: string;
  /**
   * Session label sent as `client_id` in CONNECTION_CONFIRM. The official app
   * sends the phone's unique device id; the bridge uses it to clean up stale
   * sessions. Falls back to the legacy shared CLIENT_CONFIG.ID when unset.
   */
  clientId?: string;
}

// =============================================================================
// Device Types
// =============================================================================

/**
 * Climate/Heating Modes
 */
export enum ClimateMode {
  Unknown = 0,
  FrostProtection = 1,
  Eco = 2,
  Comfort = 3
}

/**
 * Climate/Heating States
 */
export enum ClimateState {
  Off = 0,
  HeatingAuto = 1,
  HeatingManual = 2,
  CoolingAuto = 3,
  CoolingManual = 4
}

/** Water guard alarm commands (`state` in SET_DEVICE_ALARM_STATE 356). */
export enum WaterGuardAlarmAction {
  TEST = 1,
  RESET = 2,
  MUTE = 3,
  MUTE_SECONDARY = 4,
}

/**
 * Shading commands (`state` in SET_DEVICE_SHADING_STATE 355 /
 * SET_ROOM_SHADING_STATE 354), as in the official app.
 */
export enum ShadingAction {
  OPEN = 0,
  CLOSE = 1,
  STOP = 2,
  STEP_DOWN = 3,
  STEP_UP = 4,
  GO_TO = 5,
  CALIBRATION = 10,
  LOCK = 11,
  UNLOCK = 12,
  QUIT = 13
}

/**
 * Reported shading actuator state (`curstate` of devType 102). This is a
 * different enum from the commands above; verified against the official app.
 * SAFETY_UP / SAFETY_DOWN mean the safety function (wind, rain, sensor or
 * bridge) currently locks the actuator in its open / closed position.
 */
export enum ShadingCurrentState {
  UNDEFINED = 0,
  STOPPED = 1,
  MOVING_UP = 2,
  MOVING_DOWN = 3,
  SAFETY_UP = 4,
  SAFETY_DOWN = 5,
  STOPPED_OVERTEMP = 6,
  STOPPED_OVERLOAD = 7
}

/**
 * Device from xComfort Bridge
 */
export interface XComfortDevice {
  deviceId: string;
  name: string;
  roomName?: string;
  roomId?: string;
  dimmable?: boolean;
  devType?: number;
  compId?: number;
  compType?: number;
  componentName?: string;
  info?: InfoEntry[];
  switch?: boolean;
  curstate?: unknown;
  errorState?: unknown;
  
  // Shading specific
  shadsClosed?: number;
  shPos?: number;
  shSafety?: number;
  shRuntime?: number;
  
  // Heating specific
  setpoint?: number;
  operationMode?: number;
  
  [key: string]: unknown;
}

export interface XComfortComponent {
  compId: string;
  name?: string;
  compType?: number;
  raw?: Record<string, unknown>;
}

/**
 * Room mode setpoint entry from xComfort
 */
export interface RoomModeSetpoint {
  mode: number | ClimateMode;
  /** Preset setpoint while heating. */
  value?: number;
  /** Preset setpoint while cooling. */
  valueCool?: number;
}

/**
 * Room/zone climate state from xComfort Bridge
 */
export interface XComfortRoom {
  roomId: string;
  name: string;
  temperatureOnly?: boolean;
  roomSensorId?: string | number;
  setpoint?: number;
  currentMode?: number | ClimateMode;
  mode?: number | ClimateMode;
  state?: number | ClimateState;
  temp?: number;
  humidity?: number;
  power?: number;
  valve?: number;
  lightsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  modes?: RoomModeSetpoint[];
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface XComfortScene {
  sceneId: string;
  name: string;
  order?: number;
  show?: boolean;
  icon?: string;
  sceneType?: string;
  conditionSummary?: string;
  scheduleSummary?: string;
  smart?: boolean;
  conditional?: boolean;
  deviceCount?: number;
  devices?: Array<Record<string, unknown>>;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Info entry for device metadata (temperature, humidity, etc.)
 */
export interface InfoEntry {
  text: string | number;
  value?: string | number;
}

/**
 * Bridge Status Payload (Message 364)
 */
export interface BridgeStatus {
  tempOutside?: number;
  power?: number;
  energy?: number;
  energyKwh?: number;
  current?: number;
  voltage?: number;
  pulses?: number;
  energyCost?: number;
  tariff?: number | string;
  tariffLabel?: string;
  currency?: string;
  energyHistory?: unknown;
  /** Effective energy control state: 'inactive' | 'normal' | 'energy_saving' | 'priority'. */
  loadMode?: string;
  /** Underlying energy control mode without a running priority ('inactive' | 'normal' | 'energy_saving'). */
  energyControlMode?: string;
  meterId?: number | string;
  energyMeters?: Array<Record<string, unknown>>;
  energyLoads?: Array<Record<string, unknown>>;
  energyTariffs?: Array<Record<string, unknown>>;
  appInfoCode?: string;
  appInfoMessage?: string;
  rawAppInfo?: Record<string, unknown>;
  connectionState?: number;
  heatingOn?: number;
  coolingOn?: number;
  lightsOn?: number;
  loadsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  presence?: number;
  shadsClosed?: number;
  wgWaterOff?: number;
  [key: string]: unknown;
}

export interface BridgeInfo {
  id?: string;
  name?: string;
  bridgeType?: number;
  bridgeModel?: string;
  firmwareVersion?: string;
  ipAddress?: string;
  homeScenesCount?: number;
  remoteAllowed?: boolean;
  remoteOnline?: boolean;
  raw?: Record<string, unknown>;
}

/**
 * Device state update payload
 */
export interface DeviceStateUpdate {
  switch?: boolean;
  dimmvalue?: number;
  power?: number;
  energy?: number;
  current?: number;
  voltage?: number;
  pulses?: number;
  tariff?: number | string;
  tariffLabel?: string;
  currency?: string;
  energyHistory?: unknown;
  loadMode?: string;
  energyCost?: number;
  curstate?: unknown;
  errorState?: unknown;

  // Shading
  shadsClosed?: number; 
  shPos?: number;
  shSafety?: number;
  // Heating
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;
  // Direct temperature/humidity fields of sensor devices (410/450/451)
  temp?: number;
  humidity?: number;
  /** Updated info of the device's component (e.g. motion 1125/1126, contact 1121-1124). */
  componentInfo?: InfoEntry[];

  metadata?: DeviceMetadata;
}

/**
 * Room state update payload
 */
export interface RoomStateUpdate {
  setpoint?: number;
  temp?: number;
  humidity?: number;
  power?: number;
  valve?: number;
  lightsOn?: number;
  /** Number of loads (non-light actuators) that are on. */
  loadsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  /** Number of closed shading actuators. */
  shadsClosed?: number;
  /** Presence detected in the room (> 0). */
  presence?: number;
  /** Power of the room's climate function (W); `power` is the room total. */
  heatingPower?: number;
  /**
   * Second room-climate temperature: the floor temperature with room
   * regulation (0), the room temperature with floor regulation (1).
   */
  tempAlt?: number;
  /** Climate regulation: 0 room temp, 1 floor temp, 2 effect (%), 3 room + floor limits. */
  regulation?: number;
  floorMin?: number;
  floorMax?: number;
  /** 1 mode set externally, 2 external mode sensor unknown, 3 sum actuator used for heating. */
  climateInfoId?: number;
  /** Energy control is limiting the room's heating. */
  eSaving?: number;
  currentMode?: number | ClimateMode;
  mode?: number | ClimateMode;
  state?: number | ClimateState;
  temperatureOnly?: boolean;
  modes?: RoomModeSetpoint[];
  raw?: Record<string, unknown>;
}

/**
 * Parsed device metadata
 */
export interface DeviceMetadata {
  temperature?: number;
  humidity?: number;
  heatingDemand?: number; // Added from DIMM_VALUE info code
  deviceTemperature?: number;
  valvePosition?: number;
  signalStrength?: number;
  signalStrengthDbm?: number;
  batteryLevel?: number;
  batteryPowered?: boolean;
  power?: number;
  windSpeed?: number;
  rain?: boolean;
  brightness?: number;
  /** Weather station: left / middle / right brightness sensors in lux (info 1243). */
  brightnessValues?: number[];
}

/**
 * Device state listener callback
 */
export type DeviceStateCallback = (
  deviceId: string,
  stateData: DeviceStateUpdate
) => void | Promise<void>;

/**
 * Room state listener callback
 */
export type RoomStateCallback = (
  roomId: string,
  stateData: RoomStateUpdate
) => void | Promise<void>;

// =============================================================================
// Protocol Types
// =============================================================================

/**
 * Protocol message structure
 */
export interface ProtocolMessage {
  type_int: number;
  mc?: number;
  ref?: number;
  payload?: Record<string, unknown>;
}

/**
 * State update item from bridge
 */
export interface StateUpdateItem {
  deviceId?: string;
  roomId?: string;
  compId?: string | number;
  switch?: boolean | number;
  dimmvalue?: number;
  power?: number;
  energy?: number;
  current?: number;
  voltage?: number;
  pulses?: number;
  tariff?: number | string;
  tariffLabel?: string;
  currency?: string;
  energyHistory?: unknown;
  loadMode?: string;
  energyCost?: number;
  temp?: number;
  humidity?: number;
  valve?: number;
  curstate?: unknown;
  info?: InfoEntry[];
  lightsOn?: number;
  loadsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  presence?: number;
  
  // Shading specific
  shadsClosed?: number;
  shPos?: number;
  shSafety?: number;
  // Heating specific
  setpoint?: number;
  currentMode?: number | ClimateMode;
  mode?: number | ClimateMode;
  state?: number | ClimateState;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;
  temperatureOnly?: boolean;
  modes?: RoomModeSetpoint[];
  
  errorState?: unknown;
}
