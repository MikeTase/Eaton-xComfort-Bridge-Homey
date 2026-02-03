import { Buffer } from 'buffer';

export interface BridgeConfig {
  ip: string;
  authKey: string;
  logger?: LoggerFunction;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

export type LoggerFunction = (...args: unknown[]) => void;

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'renewing'
  | 'token_renewed'
  | 'error';

export type AuthState =
  | 'idle'
  | 'awaiting_connection'
  | 'awaiting_public_key'
  | 'awaiting_secret_ack'
  | 'awaiting_login_response'
  | 'awaiting_token_apply'
  | 'awaiting_token_renew'
  | 'authenticated';

export interface EncryptionContext {
  key: Buffer;
  iv: Buffer;
}

export interface ConnectionEvents {
  connected: [];
  disconnected: [code: number, reason: string];
  reconnecting: [attempt: number];
  stateChange: [state: ConnectionState];
  error: [error: Error];
}

export enum ClimateMode {
  FrostProtection = 1,
  Eco = 2,
  Comfort = 3
}

export enum ClimateState {
  Off = 0,
  HeatingAuto = 1,
  HeatingManual = 2
}

export enum ShadingAction {
  OPEN = 0,
  CLOSE = 1,
  STOP = 2,
  STEP_OPEN = 3,
  STEP_CLOSE = 4,
  GO_TO = 5
}

export interface XComfortDevice {
  deviceId: string;
  name: string;
  dimmable?: boolean;
  devType?: number;
  info?: InfoEntry[];
  shRuntime?: number;
  shSafety?: number;
  setpoint?: number;
  operationMode?: number;
  [key: string]: unknown;
}

export interface InfoEntry {
  text: string;
  value: string | number;
}

export interface BridgeStatus {
  tempOutside?: number;
  power?: number;
  heatingOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  [key: string]: unknown;
}

export interface DeviceMetadata {
  temperature?: number;
  humidity?: number;
}

export interface DeviceStateUpdate {
  switch?: boolean;
  dimmvalue?: number;
  power?: number;
  curstate?: unknown;
  shadsClosed?: number; 
  shSafety?: number;
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;
  metadata?: DeviceMetadata;
}

export type DeviceStateCallback = (
  deviceId: string,
  stateData: DeviceStateUpdate
) => void | Promise<void>;

export interface XComfortRoom {
  roomId: string;
  name: string;
  devices?: unknown[];
  [key: string]: unknown;
}

export interface RoomStateUpdate {
  switch?: boolean;
  dimmvalue?: number;
  lightsOn?: number;
  loadsOn?: number;
  windowsOpen?: number;
  doorsOpen?: number;
  presence?: number;
  shadsClosed?: number;
  power?: number;
  errorState?: unknown;
}

export type RoomStateCallback = (
  roomId: string,
  stateData: RoomStateUpdate
) => void | Promise<void>;

export interface XComfortScene {
  sceneId?: number;
  name?: string;
  devices?: unknown[];
  [key: string]: unknown;
}

export interface ProtocolMessage {
  type_int: number;
  mc?: number;
  ref?: number;
  payload?: Record<string, unknown>;
}

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
  shadsClosed?: number;
  shSafety?: number;
  setpoint?: number;
  operationMode?: number | ClimateMode;
  tempState?: number | ClimateState;
  errorState?: unknown;
}

export interface HomeData {
  name?: string;
  [key: string]: unknown;
}

export interface BridgeEvents extends ConnectionEvents {
  deviceStateChange: [deviceId: string, state: DeviceStateUpdate];
  roomStateChange: [roomId: string, state: RoomStateUpdate];
  devicesDiscovered: [devices: XComfortDevice[]];
  roomsDiscovered: [rooms: XComfortRoom[]];
  scenesDiscovered: [scenes: XComfortScene[]];
}

export type UnsubscribeFunction = () => void;
export type StateListener<T> = (id: string, state: T) => void;
export type EventListener<T extends unknown[]> = (...args: T) => void;
