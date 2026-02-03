/**
 * Device State Manager for xComfort Bridge
 *
 * Manages device state tracking and listener notifications.
 * Extracted from XComfortConnection for single responsibility.
 */

import { INFO_TEXT_CODES } from '../XComfortProtocol';
import type {
  XComfortDevice,
  InfoEntry,
  DeviceMetadata,
  DeviceStateUpdate,
  DeviceStateCallback,
} from '../types';

// Re-export types for module consumers
export type { XComfortDevice, InfoEntry, DeviceMetadata, DeviceStateUpdate, DeviceStateCallback };

// ============================================================================
// DeviceStateManager Class
// ============================================================================

export class DeviceStateManager {
  private devices: Map<string, XComfortDevice> = new Map();
  private listeners: Map<string, DeviceStateCallback[]> = new Map();

  /**
   * Add a device to the state manager
   */
  setDevice(device: XComfortDevice): void {
    this.devices.set(String(device.deviceId), device);
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
   * Clear all devices
   */
  clearDevices(): void {
    this.devices.clear();
  }

  /**
   * Get the number of devices
   */
  get deviceCount(): number {
    return this.devices.size;
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
    // console.log(`[DeviceStateManager] Added state listener for device ${id}`);
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
   * Remove all listeners for a specific device
   */
  removeAllListeners(deviceId: string | number): void {
    this.listeners.delete(String(deviceId));
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
   * Parse known info metadata types from device info array
   */
  parseInfoMetadata(infoArray: InfoEntry[]): DeviceMetadata {
    const metadata: DeviceMetadata = {};

    infoArray.forEach((info) => {
      if (info.text && info.value !== undefined) {
        switch (info.text) {
          case INFO_TEXT_CODES.TEMPERATURE_STANDARD:
            metadata.temperature = parseFloat(String(info.value));
            break;
          case INFO_TEXT_CODES.HUMIDITY_STANDARD:
            metadata.humidity = parseFloat(String(info.value));
            break;
          case INFO_TEXT_CODES.TEMPERATURE_DIMMER:
            metadata.temperature = parseFloat(String(info.value));
            break;
        }
      }
    });

    return metadata;
  }
}
