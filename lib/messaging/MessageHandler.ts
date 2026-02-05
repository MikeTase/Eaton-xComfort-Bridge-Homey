/**
 * Message Handler for xComfort Bridge
 *
 * Handles message routing, ACK management, and state update processing.
 * Extracted from XComfortConnection for single responsibility.
 */

import { MESSAGE_TYPES } from '../XComfortProtocol';
import { DeviceStateManager } from '../state/DeviceStateManager';
import { RoomStateManager } from '../state/RoomStateManager';
import type {
  ProtocolMessage,
  StateUpdateItem,
  HomeData,
  XComfortScene,
  DeviceStateUpdate,
  RoomStateUpdate,
  BridgeStatus,
  LoggerFunction
} from '../types';

// Re-export types for module consumers
export type { ProtocolMessage, StateUpdateItem, HomeData, XComfortScene };

// ============================================================================
// Module-specific Types (internal callbacks)
// ============================================================================

/** Callback for sending encrypted messages */
export type SendEncryptedFn = (msg: Record<string, unknown>) => boolean;

/** Callback when device list is complete */
export type OnDeviceListCompleteFn = () => void;

/** Callback to store scenes */
export type OnScenesReceivedFn = (scenes: XComfortScene[]) => void;

/** Callback when ACK received */
export type OnAckReceivedFn = (ref: number) => void;

/** Callback when NACK received */
export type OnNackReceivedFn = (ref: number) => void;

/** Callback when Bridge Status is received */
export type OnBridgeStatusUpdateFn = (status: BridgeStatus) => void;

// ============================================================================
// MessageHandler Class
// ============================================================================

export class MessageHandler {
  private deviceStateManager: DeviceStateManager;
  private roomStateManager: RoomStateManager;
  private logger: LoggerFunction;
  private debugStateItems: boolean = false;
  private pendingAcks: Map<number, boolean> = new Map();
  private homeData: HomeData | null = null;
  private lastDeviceUpdateAt: Map<string, number> = new Map();
  private lastRoomUpdateAt: Map<string, number> = new Map();
  private onDeviceListComplete?: OnDeviceListCompleteFn;
  private onScenesReceived?: OnScenesReceivedFn;
  private onAckReceived?: OnAckReceivedFn;
  private onNackReceived?: OnNackReceivedFn;
  private onBridgeStatusUpdate?: OnBridgeStatusUpdateFn;

  constructor(
    deviceStateManager: DeviceStateManager,
    roomStateManager: RoomStateManager,
    logger?: LoggerFunction
  ) {
    this.deviceStateManager = deviceStateManager;
    this.roomStateManager = roomStateManager;
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
   * Set callback for when scenes are received
   */
  setOnScenesReceived(callback: OnScenesReceivedFn): void {
    this.onScenesReceived = callback;
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
   * Track a pending ACK
   */
  trackAck(mc: number): void {
    this.pendingAcks.set(mc, true);
  }

  /**
   * Clear a pending ACK
   */
  clearAck(ref: number): void {
    this.pendingAcks.delete(ref);
  }

  /**
   * Get home data
   */
  getHomeData(): HomeData | null {
    return this.homeData;
  }

  /**
   * Process an encrypted message (after decryption)
   * Returns true if the message was handled
   */
  async processMessage(msg: ProtocolMessage): Promise<boolean> {
    // Handle incoming ACK messages
    if (msg.type_int === MESSAGE_TYPES.ACK) {
      if (msg.ref !== undefined) {
        // console.log(`[MessageHandler] Received ACK for message ref: ${msg.ref}`);
        this.clearAck(msg.ref);
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

    // Handle HEARTBEAT responses
    if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
      // console.log('[MessageHandler] Heartbeat response received');
      return true;
    }

    // Handle PING messages
    if (msg.type_int === MESSAGE_TYPES.PING) {
      // console.log(
      //   `[MessageHandler] PING received - mc=${msg.mc} ref=${msg.ref} (already ACK'd if has mc)`
      // );
      return true;
    }

    //this.logger_HOME_DATA
    if (msg.type_int === MESSAGE_TYPES.SET_HOME_DATA) {
      // this.logger('[MessageHandler] Received SET_HOME_DATA');
      if (msg.payload) {
        this.processHomeData(msg.payload);
      }
      return true;
    }

    // Handle SET_BRIDGE_STATE
    if (msg.type_int === MESSAGE_TYPES.SET_BRIDGE_STATE) {
      if (msg.payload && this.onBridgeStatusUpdate) {
        this.onBridgeStatusUpdate(msg.payload as BridgeStatus);
      }
      return true;
    }

    // Handle SET_ALL_DATA
    if (msg.type_int === MESSAGE_TYPES.SET_ALL_DATA) {
      // this.logger('[MessageHandler] Received SET_ALL_DATA');
      this.processDeviceData(msg.payload as Record<string, unknown>);
      return true;
    }

    // Handle STATE_UPDATE
    if (msg.type_int === MESSAGE_TYPES.STATE_UPDATE) {
      // console.log('[MessageHandler] Device state update');
      this.processStateUpdate(msg.payload as { item?: StateUpdateItem[] }, {
        typeInt: msg.type_int,
        mc: msg.mc,
        ref: msg.ref,
      });
      return true;
    }

    // Handle ERROR_INFO
    if (msg.type_int === MESSAGE_TYPES.ERROR_INFO) {
      const payload = msg.payload as { info?: string };
      this.logger(`[MessageHandler] Error/Info response: ${payload?.info}`);
      return true;
    }

    // Message not handled by this handler
    return false;
  }

  /**
   * Process SET_HOME_DATA (303) messages
   */
  private processHomeData(payload: Record<string, unknown>): void {
    if (payload.home) {
      this.homeData = payload.home as HomeData;
      this.logger(
        `[MessageHandler] Home data stored: ${this.homeData.name || 'unnamed'}`
      );
    }

    if (payload.devices) {
      this.processDeviceData({ devices: payload.devices });
    }
    if (payload.rooms) {
      this.processDeviceData({ rooms: payload.rooms });
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
      // this.logger(`[MessageHandler] Discovered ${devices.length} devices`);
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
        // Add other state fields as needed based on types.ts

        if (hasUpdate) {
          // Use setImmediate to ensure the device is fully registered before firing
          setImmediate(() => {
             this.deviceStateManager.triggerListeners(device.deviceId, update);
          });
        }
      });
    }

    if (payload.rooms) {
      const rooms = payload.rooms as Array<{
        roomId: string;
        name: string;
        [key: string]: unknown;
      }>;
      // this.logger(`[MessageHandler] Discovered ${rooms.length} rooms`);
      rooms.forEach((room) => {
        this.roomStateManager.setRoom(room);
      });
    }

    if (payload.scenes) {
      const scenes = payload.scenes as XComfortScene[];
      // this.logger(`[MessageHandler] Found ${scenes.length} scenes from bridge data`);
      this.onScenesReceived?.(scenes);
    }

    if (payload.lastItem) {
      // this.logger('[MessageHandler] Device discovery complete!');
      this.onDeviceListComplete?.();
    }
  }

  /**
   * Process state update messages
   */
  private processStateUpdate(
    payload: { item?: StateUpdateItem[] },
    msgMeta?: { typeInt?: number; mc?: number; ref?: number }
  ): void {
    try {
      const now = Date.now();
      const THROTTLE_MS = 150;
      const itemCount = payload?.item?.length ?? 0;
      // console.log(`[MessageHandler] Processing state update with ${itemCount} items`);
      // console.log(`[MessageHandler] STATE PAYLOAD: ${JSON.stringify(payload)}`);

      if (payload?.item) {
        const deviceUpdates = new Map<string, DeviceStateUpdate>();
        const roomUpdates = new Map<string, RoomStateUpdate>();

        payload.item.forEach((item) => {
          if (item.deviceId !== undefined && item.deviceId !== null) {
            const deviceId = String(item.deviceId);
            const lastTs = this.lastDeviceUpdateAt.get(deviceId) ?? 0;
            if (now - lastTs < THROTTLE_MS) {
              return;
            }
            this.lastDeviceUpdateAt.set(deviceId, now);
            const device = this.deviceStateManager.getDevice(deviceId);
            if (device?.devType === 220) {
              // console.log(
              //   `[MessageHandler] Input event raw item: ${JSON.stringify(item)}`
              // );
              // console.log(
              //   `[MessageHandler] Input event meta: deviceId=${item.deviceId}, type=${msgMeta?.typeInt ?? 'n/a'}, mc=${msgMeta?.mc ?? 'n/a'}, ref=${msgMeta?.ref ?? 'n/a'}, ts=${Date.now()}`
              // );
            }

            if (!deviceUpdates.has(deviceId)) {
              deviceUpdates.set(deviceId, {});
            }
            const deviceUpdate = deviceUpdates.get(deviceId)!;
            
            // Log raw item for debugging missing properties
            if (this.debugStateItems) {
              this.logger(
                `[MessageHandler] Raw item for device ${deviceId}: ${JSON.stringify(item)}`
              );
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
                  // Ensure switch is boolean (bridge often sends 1/0)
                  deviceUpdate.switch = (item.switch === true || item.switch === 1);
              } else if (item.curstate !== undefined && (item.curstate === 0 || item.curstate === 1)) {
                  // Fallback: map curstate 0/1 to switch boolean if switch is missing
                  deviceUpdate.switch = (item.curstate === 1);
              }

              if (item.dimmvalue !== undefined) deviceUpdate.dimmvalue = item.dimmvalue;
              if (item.power !== undefined) deviceUpdate.power = item.power;
              if (item.curstate !== undefined) deviceUpdate.curstate = item.curstate;
              
              // New mappings
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
          } else if (item.roomId !== undefined && item.roomId !== null) {
            const roomId = String(item.roomId);
            const lastTs = this.lastRoomUpdateAt.get(roomId) ?? 0;
            if (now - lastTs < THROTTLE_MS) {
              return;
            }
            this.lastRoomUpdateAt.set(roomId, now);
            roomUpdates.set(roomId, {
              switch: item.switch !== undefined ? (item.switch === true || item.switch === 1) : undefined,
              dimmvalue: item.dimmvalue,
              lightsOn: item.lightsOn,
              loadsOn: item.loadsOn,
              windowsOpen: item.windowsOpen,
              doorsOpen: item.doorsOpen,
              presence: item.presence,
              shadsClosed: item.shadsClosed,
              power: item.power,
              errorState: item.errorState,
            });
          }
        });

        deviceUpdates.forEach((updateData, deviceId) => {
          this.deviceStateManager.triggerListeners(deviceId, updateData);
        });

        roomUpdates.forEach((updateData, roomId) => {
          this.roomStateManager.triggerListeners(roomId, updateData);

          // If room switch state changes, propagate to all devices in that room
          // (Bridge often omits individual device updates when controlling a whole room)
          if (updateData.switch !== undefined) {
            const room = this.roomStateManager.getRoom(roomId);
            const switchState = updateData.switch;
            
            if (room && Array.isArray(room.devices)) {
              // console.log(
              //   `[MessageHandler] Room ${roomId} switched ${switchState ? 'ON' : 'OFF'}. Propagating to devices: ${JSON.stringify(
              //     room.devices
              //   )}`
              // );
              room.devices.forEach((devId) => {
                const deviceId = String(devId);
                // Only trigger if we didn't receive a specific device update in this payload
                if (!deviceUpdates.has(deviceId)) {
                  this.deviceStateManager.triggerListeners(deviceId, {
                    switch: switchState,
                  });
                }
              });
            }
          }
        });
      }
    } catch (error) {
      console.error(`[MessageHandler] Error processing state update:`, error);
    }
  }
}
