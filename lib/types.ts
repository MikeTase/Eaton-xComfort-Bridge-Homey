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
  HeatingManual = 2
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
  GO_TO = 5
}

/**
 * Device from xComfort Bridge
 */
export interface XComfortDevice {
  deviceId: string;
  name: string;
  dimmable?: boolean;
  devType?: number;
  compId?: number;
  compType?: number;
  info?: InfoEntry[];
  
  // Shading specific
  shRuntime?: number;
  shSafety?: number;
  
  // Heating specific
  setpoint?: number;
  operationMode?: number;
  
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
  [key: string]: unknown;
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
  shSafety?: number;

  // Heating
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;

  metadata?: DeviceMetadata;
}

/**
 * Parsed device metadata
 */
export interface DeviceMetadata {
  temperature?: number;
  humidity?: number;
}

/**
 * Device state listener callback
 */
export type DeviceStateCallback = (
  deviceId: string,
  stateData: DeviceStateUpdate
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
  switch?: boolean | number;
  dimmvalue?: number;
  power?: number;
  curstate?: unknown;
  info?: InfoEntry[];
  lightsOn?: number;
  loadsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  presence?: number;
  
  // Shading specific
  shadsClosed?: number;
  shSafety?: number;

  // Heating specific
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;
  
  errorState?: unknown;
}

