/**
 * Device State Manager for xComfort Bridge
 *
 * Manages device state tracking and listener notifications.
 * Extracted from XComfortConnection for single responsibility.
 */

import type {
  XComfortComponent,
  XComfortDevice,
  XComfortRoom,
  InfoEntry,
  DeviceMetadata,
  DeviceStateUpdate,
  DeviceStateCallback,
  RoomStateUpdate,
  RoomStateCallback,
  LoggerFunction
} from '../types';
import { parseInfoMetadata } from '../utils/parseInfoMetadata';

// ============================================================================
// DeviceStateManager Class
// ============================================================================

export class DeviceStateManager {
  private logger: LoggerFunction;
  private devices: Map<string, XComfortDevice> = new Map();
  private components: Map<string, XComfortComponent> = new Map();
  private listeners: Map<string, DeviceStateCallback[]> = new Map();
  private rooms: Map<string, XComfortRoom> = new Map();
  private roomListeners: Map<string, RoomStateCallback[]> = new Map();

  constructor(logger?: LoggerFunction) {
      this.logger = logger || console.log;
  }

  /**
   * Add a device to the state manager
   */
  setDevice(device: XComfortDevice): void {
    const deviceId = String(device.deviceId);
    const existing = this.devices.get(deviceId);
    const merged: XComfortDevice = {
      ...(existing || {}),
      ...device,
      deviceId,
    };

    const component = this.getComponentForDevice(merged);
    if (component) {
      if (merged.compType === undefined && component.compType !== undefined) {
        merged.compType = component.compType;
      }
      if (!merged.componentName && component.name) {
        merged.componentName = component.name;
      }
    }

    this.devices.set(deviceId, merged);
  }

  /**
   * Add or update a component in the state manager
   */
  setComponent(component: XComfortComponent): void {
    const compId = String(component.compId);
    const existing = this.components.get(compId);
    const merged: XComfortComponent = {
      ...(existing || {}),
      ...component,
      compId,
    };

    if (existing?.raw || component.raw) {
      merged.raw = {
        ...(existing?.raw || {}),
        ...(component.raw || {}),
      };
    }

    this.components.set(compId, merged);

    for (const [deviceId, device] of this.devices.entries()) {
      if (device.compId === undefined || String(device.compId) !== compId) {
        continue;
      }

      this.devices.set(deviceId, {
        ...device,
        compType: device.compType ?? merged.compType,
        componentName: device.componentName || merged.name,
      });
    }
  }

  /**
   * Add or update a room in the state manager
   */
  setRoom(room: XComfortRoom): void {
    const roomId = String(room.roomId);
    const existing = this.rooms.get(roomId);
    const merged: XComfortRoom = {
      ...(existing || {}),
      ...room,
      roomId,
    };

    if (existing?.raw || room.raw) {
      merged.raw = {
        ...(existing?.raw || {}),
        ...(room.raw || {}),
      };
    }

    this.rooms.set(roomId, merged);
  }

  /**
   * Get a device by ID
   */
  getDevice(deviceId: string | number): XComfortDevice | undefined {
    return this.devices.get(String(deviceId));
  }

  /**
   * Get all devices
   */
  getAllDevices(): XComfortDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get a component by ID
   */
  getComponent(compId: string | number): XComfortComponent | undefined {
    return this.components.get(String(compId));
  }

  /**
   * Get all components
   */
  getAllComponents(): XComfortComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Get a room by ID
   */
  getRoom(roomId: string | number): XComfortRoom | undefined {
    return this.rooms.get(String(roomId));
  }

  /**
   * Get all rooms
   */
  getAllRooms(): XComfortRoom[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Add a state listener for a specific device
   */
  addListener(deviceId: string | number, callback: DeviceStateCallback): void {
    const id = String(deviceId);
    if (!this.listeners.has(id)) {
      this.listeners.set(id, []);
    }
    this.listeners.get(id)!.push(callback);
    this.logger(`[DeviceStateManager] Added state listener for device ${id}`);
  }

  /**
   * Add a room-state listener for a specific room
   */
  addRoomListener(roomId: string | number, callback: RoomStateCallback): void {
    const id = String(roomId);
    if (!this.roomListeners.has(id)) {
      this.roomListeners.set(id, []);
    }
    this.roomListeners.get(id)!.push(callback);
    this.logger(`[DeviceStateManager] Added room state listener for room ${id}`);
  }

  /**
   * Remove a state listener for a specific device
   */
  removeListener(deviceId: string | number, callback: DeviceStateCallback): boolean {
    const id = String(deviceId);
    const deviceListeners = this.listeners.get(id);
    if (!deviceListeners) return false;

    const index = deviceListeners.indexOf(callback);
    if (index === -1) return false;

    deviceListeners.splice(index, 1);
    if (deviceListeners.length === 0) {
      this.listeners.delete(id);
    }
    return true;
  }

  /**
   * Remove a room-state listener for a specific room
   */
  removeRoomListener(roomId: string | number, callback: RoomStateCallback): boolean {
    const id = String(roomId);
    const roomListeners = this.roomListeners.get(id);
    if (!roomListeners) return false;

    const index = roomListeners.indexOf(callback);
    if (index === -1) return false;

    roomListeners.splice(index, 1);
    if (roomListeners.length === 0) {
      this.roomListeners.delete(id);
    }
    return true;
  }

  /**
   * Trigger state listeners for a device (non-blocking via setImmediate)
   */
  triggerListeners(deviceId: string | number, stateData: DeviceStateUpdate): void {
    const id = String(deviceId);
    const deviceListeners = this.listeners.get(id);
    if (!deviceListeners) return;

    deviceListeners.forEach((callback) => {
      setImmediate(() => {
        try {
          callback(id, stateData);
        } catch (error) {
          console.error(
            `[DeviceStateManager] Error in state listener for device ${id}:`,
            error
          );
        }
      });
    });
  }

  /**
   * Trigger room-state listeners for a room (non-blocking via setImmediate)
   */
  triggerRoomListeners(roomId: string | number, stateData: RoomStateUpdate): void {
    const id = String(roomId);
    const roomListeners = this.roomListeners.get(id);
    if (!roomListeners) return;

    roomListeners.forEach((callback) => {
      setImmediate(() => {
        try {
          callback(id, stateData);
        } catch (error) {
          console.error(
            `[DeviceStateManager] Error in room state listener for room ${id}:`,
            error
          );
        }
      });
    });
  }

  /**
   * Parse known info metadata types from device info array
   */
  parseInfoMetadata(infoArray: InfoEntry[]): DeviceMetadata {
    return parseInfoMetadata(infoArray);
  }

  private getComponentForDevice(device: XComfortDevice): XComfortComponent | undefined {
    if (device.compId === undefined || device.compId === null) {
      return undefined;
    }

    return this.components.get(String(device.compId));
  }
}
