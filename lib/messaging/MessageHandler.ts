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
  RoomStateUpdate,
  BridgeStatus,
  LoggerFunction,
  XComfortRoom,
  RoomModeSetpoint,
  InfoEntry,
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

/** Callback when Home/Bridge info is received */
type OnHomeDataUpdateFn = (payload: Record<string, unknown>) => void;

// ============================================================================
// MessageHandler Class
// ============================================================================

export class MessageHandler {
  private deviceStateManager: DeviceStateManager;
  private logger: LoggerFunction;
  private debugStateItems: boolean = false;
  private pendingDeviceUpdates: Map<string, DeviceStateUpdate> = new Map();
  private pendingRoomUpdates: Map<string, RoomStateUpdate> = new Map();
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private roomFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly UPDATE_COALESCE_MS = 150;
  private onDeviceListComplete?: OnDeviceListCompleteFn;
  private onAckReceived?: OnAckReceivedFn;
  private onNackReceived?: OnNackReceivedFn;
  private onBridgeStatusUpdate?: OnBridgeStatusUpdateFn;
  private onHomeDataUpdate?: OnHomeDataUpdateFn;

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
   * Set callback for Home/Bridge info updates
   */
  setOnHomeDataUpdate(callback: OnHomeDataUpdateFn): void {
    this.onHomeDataUpdate = callback;
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

    if (msg.type_int === MESSAGE_TYPES.PUBLISH_MAIN_ELECTRICAL_ENERGY_USAGE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload && this.onBridgeStatusUpdate) {
        // Extract power from energy usage message: { meterId, connectionState, power }
        const status: BridgeStatus = {};
        if (typeof payload.power === 'number') {
          status.power = payload.power;
        }
        if (Object.keys(status).length > 0) {
          this.onBridgeStatusUpdate(status);
        }
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
    const homePayload = payload.home && typeof payload.home === 'object' && !Array.isArray(payload.home)
      ? payload.home as Record<string, unknown>
      : payload;

    const homeName = typeof homePayload.name === 'string' ? homePayload.name : 'unnamed';
    this.logger(`[MessageHandler] Home data received: ${homeName}`);
    this.onHomeDataUpdate?.(homePayload);

    if (payload.devices) {
      this.processDeviceData({ devices: payload.devices });
    }
    if (payload.comps) {
      this.processDeviceData({ comps: payload.comps });
    }
    if (payload.scenes) {
      this.processDeviceData({ scenes: payload.scenes });
    }
  }

  /**
   * Process device/room/scene data
   */
  private processDeviceData(payload: Record<string, unknown>): void {
    if (payload.comps && Array.isArray(payload.comps)) {
      payload.comps.forEach((compPayload) => {
        if (!compPayload || typeof compPayload !== 'object' || Array.isArray(compPayload)) {
          return;
        }

        const component = this.normalizeComponentPayload(compPayload as Record<string, unknown>);
        if (!component.compId) {
          return;
        }

        this.deviceStateManager.setComponent(component);
      });
    }

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
        if (typeof device.shPos === 'number') {
          update.shPos = device.shPos;
          hasUpdate = true;
        }
        if (typeof device.shSafety === 'number') {
          update.shSafety = device.shSafety;
          hasUpdate = true;
        }
        if (device.operationMode !== undefined) {
          update.operationMode = device.operationMode as number;
          hasUpdate = true;
        }
        if (device.tempState !== undefined) {
          update.tempState = device.tempState as number;
          hasUpdate = true;
        }
        if (device.curstate !== undefined) {
          update.curstate = device.curstate;
          hasUpdate = true;
        }
        if (Array.isArray(device.info)) {
          const metadata = this.deviceStateManager.parseInfoMetadata(device.info as InfoEntry[]);
          if (Object.keys(metadata).length > 0) {
            update.metadata = metadata;
            hasUpdate = true;
          }
        }

        if (hasUpdate) {
          // Use setImmediate to ensure the device is fully registered before firing
          setImmediate(() => {
             this.deviceStateManager.triggerListeners(device.deviceId, update);
          });
        }
      });
    }

    if (payload.rooms && Array.isArray(payload.rooms)) {
      payload.rooms.forEach((roomPayload) => {
        if (!roomPayload || typeof roomPayload !== 'object' || Array.isArray(roomPayload)) {
          return;
        }

        const room = this.normalizeRoomPayload(roomPayload as Record<string, unknown>);
        this.deviceStateManager.setRoom(room);

        const update = this.extractRoomUpdate(room);
        if (Object.keys(update).length > 0) {
          setImmediate(() => {
            this.deviceStateManager.triggerRoomListeners(room.roomId, update);
          });
        }
      });
    }

    if (payload.roomHeating && Array.isArray(payload.roomHeating)) {
      payload.roomHeating.forEach((roomPayload) => {
        if (!roomPayload || typeof roomPayload !== 'object' || Array.isArray(roomPayload)) {
          return;
        }

        const room = this.normalizeRoomPayload(roomPayload as Record<string, unknown>);
        this.deviceStateManager.setRoom(room);

        const update = this.extractRoomUpdate(room);
        if (Object.keys(update).length > 0) {
          setImmediate(() => {
            this.deviceStateManager.triggerRoomListeners(room.roomId, update);
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
        const roomUpdates = new Map<string, RoomStateUpdate>();

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
              item.shPos !== undefined ||
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
              if (item.shPos !== undefined) deviceUpdate.shPos = item.shPos;
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

          if (item.roomId !== undefined && item.roomId !== null) {
            const roomId = String(item.roomId);

            if (!roomUpdates.has(roomId)) {
              roomUpdates.set(roomId, {});
            }
            const roomUpdate = roomUpdates.get(roomId)!;

            if (typeof item.setpoint === 'number') roomUpdate.setpoint = item.setpoint;
            if (typeof item.temp === 'number') roomUpdate.temp = item.temp;
            if (typeof item.humidity === 'number') roomUpdate.humidity = item.humidity;
            if (typeof item.power === 'number') roomUpdate.power = item.power;
            if (typeof item.valve === 'number') roomUpdate.valve = item.valve;
            if (typeof item.lightsOn === 'number') roomUpdate.lightsOn = item.lightsOn;
            if (typeof item.windowsOpen === 'number') roomUpdate.windowsOpen = item.windowsOpen;
            if (typeof item.doorsOpen === 'number') roomUpdate.doorsOpen = item.doorsOpen;
            if (item.currentMode !== undefined) roomUpdate.currentMode = item.currentMode;
            if (item.mode !== undefined) roomUpdate.mode = item.mode;
            if (item.state !== undefined) roomUpdate.state = item.state;
            if (typeof item.temperatureOnly === 'boolean') roomUpdate.temperatureOnly = item.temperatureOnly;
            if (Array.isArray(item.modes)) {
              roomUpdate.modes = item.modes
                .filter((mode): mode is RoomModeSetpoint => {
                  return !!mode
                    && typeof mode === 'object'
                    && !Array.isArray(mode)
                    && (mode as RoomModeSetpoint).mode !== undefined
                    && typeof (mode as RoomModeSetpoint).value === 'number';
                })
                .map((mode) => ({
                  mode: mode.mode,
                  value: mode.value,
                }));
            }
          }
        });

        deviceUpdates.forEach((updateData, deviceId) => {
          // Persist key state fields back to the stored device so that
          // snapshots (used on reconnect) always reflect the latest state.
          const device = this.deviceStateManager.getDevice(deviceId);
          if (device) {
            const patch: Record<string, unknown> = {};
            if (updateData.switch !== undefined) patch.switch = updateData.switch;
            if (updateData.dimmvalue !== undefined) patch.dimmvalue = updateData.dimmvalue;
            if (updateData.power !== undefined) patch.power = updateData.power;
            if (updateData.curstate !== undefined) patch.curstate = updateData.curstate;
            if (updateData.shadsClosed !== undefined) patch.shadsClosed = updateData.shadsClosed;
            if (updateData.shPos !== undefined) patch.shPos = updateData.shPos;
            if (updateData.shSafety !== undefined) patch.shSafety = updateData.shSafety;
            if (updateData.setpoint !== undefined) patch.setpoint = updateData.setpoint;
            if (updateData.operationMode !== undefined) patch.operationMode = updateData.operationMode;
            if (updateData.tempState !== undefined) patch.tempState = updateData.tempState;

            if (Object.keys(patch).length > 0) {
              this.deviceStateManager.setDevice({ ...device, ...patch } as any);
            }
          }

          this.enqueueDeviceUpdate(deviceId, updateData);
        });

        roomUpdates.forEach((updateData, roomId) => {
          this.enqueueRoomUpdate(roomId, updateData);
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

  private enqueueRoomUpdate(roomId: string, updateData: RoomStateUpdate): void {
    if (!Object.keys(updateData).length) return;

    const pending = this.pendingRoomUpdates.get(roomId) || {};
    const merged: RoomStateUpdate = {
      ...pending,
      ...updateData,
      raw: {
        ...(pending.raw || {}),
        ...(updateData.raw || {}),
      },
    };

    if (!Object.keys(merged.raw || {}).length) {
      delete merged.raw;
    }

    this.pendingRoomUpdates.set(roomId, merged);

    if (!this.roomFlushTimers.has(roomId)) {
      const timer = setTimeout(() => {
        this.roomFlushTimers.delete(roomId);
        const latest = this.pendingRoomUpdates.get(roomId);
        if (latest) {
          this.pendingRoomUpdates.delete(roomId);
          this.deviceStateManager.triggerRoomListeners(roomId, latest);
        }
      }, this.UPDATE_COALESCE_MS);

      this.roomFlushTimers.set(roomId, timer);
    }
  }

  private normalizeRoomPayload(payload: Record<string, unknown>): XComfortRoom {
    const roomId = String(payload.roomId ?? '');
    const room: XComfortRoom = {
      ...payload,
      roomId,
      name: typeof payload.name === 'string' ? payload.name : `Room ${roomId}`,
      raw: payload,
    };

    return room;
  }

  private normalizeComponentPayload(payload: Record<string, unknown>): {
    compId: string;
    name?: string;
    compType?: number;
    raw: Record<string, unknown>;
  } {
    const compId = String(payload.compId ?? payload.id ?? '');
    const compType = typeof payload.compType === 'number'
      ? payload.compType
      : typeof payload.type === 'number'
        ? payload.type
        : undefined;

    return {
      compId,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      compType,
      raw: payload,
    };
  }

  private extractRoomUpdate(room: XComfortRoom): RoomStateUpdate {
    const update: RoomStateUpdate = {};

    if (typeof room.setpoint === 'number') update.setpoint = room.setpoint;
    if (typeof room.temp === 'number') update.temp = room.temp;
    if (typeof room.humidity === 'number') update.humidity = room.humidity;
    if (typeof room.power === 'number') update.power = room.power;
    if (typeof room.valve === 'number') update.valve = room.valve;
    if (typeof room.lightsOn === 'number') update.lightsOn = room.lightsOn;
    if (typeof room.windowsOpen === 'number') update.windowsOpen = room.windowsOpen;
    if (typeof room.doorsOpen === 'number') update.doorsOpen = room.doorsOpen;
    if (room.currentMode !== undefined) update.currentMode = room.currentMode;
    if (room.mode !== undefined) update.mode = room.mode;
    if (room.state !== undefined) update.state = room.state;
    if (typeof room.temperatureOnly === 'boolean') update.temperatureOnly = room.temperatureOnly;
    if (Array.isArray(room.modes)) {
      update.modes = room.modes
        .filter((mode): mode is RoomModeSetpoint => {
          return !!mode
            && typeof mode === 'object'
            && !Array.isArray(mode)
            && mode.mode !== undefined
            && typeof mode.value === 'number';
        })
        .map((mode) => ({
          mode: mode.mode,
          value: mode.value,
        }));
    }
    if (room.raw) {
      update.raw = room.raw;
    }

    return update;
  }

  /**
   * Clear all pending coalesce timers and queued updates.
   * Should be called when the connection is being torn down.
   */
  cleanup(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.pendingDeviceUpdates.clear();

    for (const timer of this.roomFlushTimers.values()) {
      clearTimeout(timer);
    }
    this.roomFlushTimers.clear();
    this.pendingRoomUpdates.clear();
  }

  private getPayloadObject(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  }
}
