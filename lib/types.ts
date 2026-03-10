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
  | 'authenticated';

/**
 * Encryption context for AES
 */
export interface EncryptionContext {
  key: Buffer;
  iv: Buffer;
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

/**
 * Shading Actions
 */
export enum ShadingAction {
  OPEN = 0,
  CLOSE = 1,
  STOP = 2,
  STEP_OPEN = 3,
  STEP_CLOSE = 4,
  GO_TO = 5,
  CALIBRATION = 10,
  LOCK = 11,
  UNLOCK = 12,
  QUIT = 13
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
  value: number;
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

/**
 * Info entry for device metadata (temperature, humidity, etc.)
 */
export interface InfoEntry {
  text: string;
  value: string | number;
}

/**
 * Bridge Status Payload (Message 364)
 */
export interface BridgeStatus {
  tempOutside?: number;
  power?: number;
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
  raw?: Record<string, unknown>;
}

/**
 * Device state update payload
 */
export interface DeviceStateUpdate {
  switch?: boolean;
  dimmvalue?: number;
  power?: number;
  curstate?: unknown;

  // Shading
  shadsClosed?: number; 
  shPos?: number;
  shSafety?: number;
  // Heating
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;

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
  windowsOpen?: number;
  doorsOpen?: number;
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
