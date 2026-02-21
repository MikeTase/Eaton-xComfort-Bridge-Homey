/**
 * Message Handler for xComfort Bridge
 *
 * Handles message routing, ACK management, and state update processing.
 * Extracted from XComfortConnection for single responsibility.
 */

import { MESSAGE_TYPES } from '../XComfortProtocol';
import { DeviceStateManager } from '../state/DeviceStateManager';
import type {
  ProtocolMessage,
  StateUpdateItem,
  DeviceStateUpdate,
  BridgeStatus,
  LoggerFunction
} from '../types';

// ============================================================================
// Module-specific Types (internal callbacks)
// ============================================================================

/** Callback when device list is complete */
type OnDeviceListCompleteFn = () => void;

/** Callback when ACK received */
type OnAckReceivedFn = (ref: number) => void;

/** Callback when NACK received */
type OnNackReceivedFn = (ref: number) => void;

/** Callback when Bridge Status is received */
type OnBridgeStatusUpdateFn = (status: BridgeStatus) => void;

// ============================================================================
// MessageHandler Class
// ============================================================================

export class MessageHandler {
  private deviceStateManager: DeviceStateManager;
  private logger: LoggerFunction;
  private debugStateItems: boolean = false;
  private pendingDeviceUpdates: Map<string, DeviceStateUpdate> = new Map();
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly UPDATE_COALESCE_MS = 150;
  private onDeviceListComplete?: OnDeviceListCompleteFn;
  private onAckReceived?: OnAckReceivedFn;
  private onNackReceived?: OnNackReceivedFn;
  private onBridgeStatusUpdate?: OnBridgeStatusUpdateFn;

  constructor(
    deviceStateManager: DeviceStateManager,
    logger?: LoggerFunction
  ) {
    this.deviceStateManager = deviceStateManager;
    this.logger = logger || console.log;
    this.debugStateItems = process.env.XCOMFORT_DEBUG === '1';
  }

  /**
   * Set callback for when device list is complete
   */
  setOnDeviceListComplete(callback: OnDeviceListCompleteFn): void {
    this.onDeviceListComplete = callback;
  }

  /**
   * Set callback for when ACK is received (for retry mechanism)
   */
  setOnAckReceived(callback: OnAckReceivedFn): void {
    this.onAckReceived = callback;
  }

  /**
   * Set callback for when NACK is received (for retry mechanism)
   */
  setOnNackReceived(callback: OnNackReceivedFn): void {
    this.onNackReceived = callback;
  }

  /**
   * Set callback for Bridge Status updates
   */
  setOnBridgeStatusUpdate(callback: OnBridgeStatusUpdateFn): void {
    this.onBridgeStatusUpdate = callback;
  }

  /**
   * Process an encrypted message (after decryption)
   * Returns true if the message was handled
   */
  async processMessage(msg: ProtocolMessage): Promise<boolean> {
    // Handle incoming ACK messages
    if (msg.type_int === MESSAGE_TYPES.ACK) {
      if (msg.ref !== undefined) {
        this.onAckReceived?.(msg.ref);
      }
      return true;
    }

    // Handle NACK
    if (msg.type_int === MESSAGE_TYPES.NACK) {
      if (JSON.stringify(msg.payload || '').includes('no client-connection available')) {
         this.logger('[MessageHandler-CRITICAL] Bridge reports NO CLIENT CONNECTIONS AVAILABLE. Please restart the Bridge or disconnect other apps.');
      } else {
         this.logger(`[MessageHandler-ERROR] Received NACK for message ref: ${msg.ref}`);
         if (msg.payload) {
           this.logger(`[MessageHandler-ERROR] NACK details: ${JSON.stringify(msg.payload)}`);
         }
      }
      
      if (msg.ref !== undefined) {
        this.onNackReceived?.(msg.ref);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.PING) {
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_HOME_DATA) {
      if (msg.payload) {
        this.processHomeData(msg.payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_BRIDGE_STATE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload && this.onBridgeStatusUpdate) {
        this.onBridgeStatusUpdate(payload as BridgeStatus);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_ALL_DATA) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processDeviceData(payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.STATE_UPDATE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processStateUpdate(payload as { item?: StateUpdateItem[] });
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.ERROR_INFO) {
      const payload = this.getPayloadObject(msg.payload);
      const info = payload?.info;
      this.logger(`[MessageHandler] Error/Info response: ${typeof info === 'string' ? info : 'n/a'}`);
      return true;
    }

    return false;
  }

  /**
   * Process SET_HOME_DATA (303) messages
   */
  private processHomeData(payload: Record<string, unknown>): void {
    if (payload.home && typeof payload.home === 'object' && !Array.isArray(payload.home)) {
      const home = payload.home as { name?: string };
      this.logger(
        `[MessageHandler] Home data received: ${home.name || 'unnamed'}`
      );
    }

    if (payload.devices) {
      this.processDeviceData({ devices: payload.devices });
    }
    if (payload.scenes) {
      this.processDeviceData({ scenes: payload.scenes });
    }
  }

  /**
   * Process device/room/scene data
   */
  private processDeviceData(payload: Record<string, unknown>): void {
    if (payload.devices) {
      const devices = payload.devices as Array<{
        deviceId: string;
        name: string;
        [key: string]: unknown;
      }>;

      devices.forEach((device) => {
        this.deviceStateManager.setDevice(device);
        
        // Trigger listeners with current state from discovery/sync
        const update: DeviceStateUpdate = {};
        let hasUpdate = false;

        if (device.switch !== undefined) {
          update.switch = device.switch === true || device.switch === 1;
          hasUpdate = true;
        }
        if (typeof device.dimmvalue === 'number') {
          update.dimmvalue = device.dimmvalue;
          hasUpdate = true;
        }
        if (typeof device.power === 'number') {
          update.power = device.power;
          hasUpdate = true;
        }
        if (typeof device.setpoint === 'number') {
          update.setpoint = device.setpoint;
          hasUpdate = true;
        }
        if (typeof device.shadsClosed === 'number') {
          update.shadsClosed = device.shadsClosed;
          hasUpdate = true;
        }

        if (hasUpdate) {
          // Use setImmediate to ensure the device is fully registered before firing
          setImmediate(() => {
             this.deviceStateManager.triggerListeners(device.deviceId, update);
          });
        }
      });
    }

    if (payload.lastItem) {
      // this.logger('[MessageHandler] Device discovery complete!');
      this.onDeviceListComplete?.();
    }
  }

  /**
   * Process state update messages
   */
  private processStateUpdate(payload: { item?: StateUpdateItem[] }): void {
    try {
      if (payload?.item) {
        const deviceUpdates = new Map<string, DeviceStateUpdate>();

        payload.item.forEach((item) => {
          if (item.deviceId !== undefined && item.deviceId !== null) {
            const deviceId = String(item.deviceId);

            if (!deviceUpdates.has(deviceId)) {
              deviceUpdates.set(deviceId, {});
            }
            const deviceUpdate = deviceUpdates.get(deviceId)!;

            if (this.debugStateItems) {
              this.logger(`[MessageHandler] Raw item for device ${deviceId}: ${JSON.stringify(item)}`);
            }

            if (
              item.switch !== undefined ||
              item.dimmvalue !== undefined ||
              item.setpoint !== undefined ||
              item.shadsClosed !== undefined ||
              item.shSafety !== undefined ||
              item.curstate !== undefined ||
              item.power !== undefined
            ) {
              if (item.switch !== undefined) {
                  deviceUpdate.switch = (item.switch === true || item.switch === 1);
              } else if (item.curstate !== undefined && (item.curstate === 0 || item.curstate === 1)) {
                  deviceUpdate.switch = (item.curstate === 1);
              }

              if (item.dimmvalue !== undefined) deviceUpdate.dimmvalue = item.dimmvalue;
              if (item.power !== undefined) deviceUpdate.power = item.power;
              if (item.curstate !== undefined) deviceUpdate.curstate = item.curstate;
              if (item.shadsClosed !== undefined) deviceUpdate.shadsClosed = item.shadsClosed;
              if (item.shSafety !== undefined) deviceUpdate.shSafety = item.shSafety;
              if (item.setpoint !== undefined) deviceUpdate.setpoint = item.setpoint;
              if (item.operationMode !== undefined) deviceUpdate.operationMode = item.operationMode;
              if (item.tempState !== undefined) deviceUpdate.tempState = item.tempState;

            } else if (item.info && Array.isArray(item.info)) {
              const metadata = this.deviceStateManager.parseInfoMetadata(item.info);
              if (Object.keys(metadata).length > 0) {
                deviceUpdate.metadata = metadata;
              }
            }
          }
        });

        deviceUpdates.forEach((updateData, deviceId) => {
          this.enqueueDeviceUpdate(deviceId, updateData);
        });
      }
    } catch (error) {
      console.error(`[MessageHandler] Error processing state update:`, error);
    }
  }

  private enqueueDeviceUpdate(deviceId: string, updateData: DeviceStateUpdate): void {
    if (!Object.keys(updateData).length) return;

    const pending = this.pendingDeviceUpdates.get(deviceId) || {};
    const merged: DeviceStateUpdate = {
      ...pending,
      ...updateData,
      metadata: {
        ...(pending.metadata || {}),
        ...(updateData.metadata || {}),
      },
    };

    // Remove empty metadata to keep payload clean
    if (!Object.keys(merged.metadata || {}).length) {
      delete merged.metadata;
    }

    this.pendingDeviceUpdates.set(deviceId, merged);

    if (!this.flushTimers.has(deviceId)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(deviceId);
        const latest = this.pendingDeviceUpdates.get(deviceId);
        if (latest) {
          this.pendingDeviceUpdates.delete(deviceId);
          this.deviceStateManager.triggerListeners(deviceId, latest);
        }
      }, this.UPDATE_COALESCE_MS);

      this.flushTimers.set(deviceId, timer);
    }
  }

  private getPayloadObject(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  }
}
