/**
 * XComfort Bridge - Singleton Facade
 *
 * This is the main entry point for xComfort Bridge communication.
 * It orchestrates all modules and provides a clean public API.
 *
 * IMPORTANT: Only ONE instance should exist per application.
 * Access via `this.homey.app.xcomfort` in drivers.
 */

import { EventEmitter } from 'events';
import { MESSAGE_TYPES, PROTOCOL_CONFIG } from '../XComfortProtocol';
import { ConnectionManager } from './ConnectionManager';
import { Authenticator } from './Authenticator';
import { DeviceStateManager } from '../state/DeviceStateManager';
import { RoomStateManager } from '../state/RoomStateManager';
import { MessageHandler } from '../messaging/MessageHandler';
import { CommandDebouncer } from '../utils/CommandDebouncer';
import type {
  ConnectionState,
  ProtocolMessage,
  XComfortDevice,
  XComfortRoom,
  XComfortScene,
  DeviceStateCallback,
  RoomStateCallback,
  LoggerFunction,
  BridgeStatus
} from '../types';

// Re-export ConnectionState as BridgeConnectionState for external consumers
export type BridgeConnectionState = ConnectionState;

// ============================================================================
// XComfortBridge Class
// ============================================================================

export class XComfortBridge extends EventEmitter {
  private bridgeIp: string;
  private authKey: string;
  private logger: LoggerFunction;

  // Modules
  private connectionManager: ConnectionManager;
  private authenticator: Authenticator;
  private deviceStateManager: DeviceStateManager;
  private roomStateManager: RoomStateManager;
  private messageHandler: MessageHandler;

  // State
  private connectionState: BridgeConnectionState = 'disconnected';
  private deviceListReceived: boolean = false;
  private detailedScenes: XComfortScene[] = [];
  private lastBridgeStatus: BridgeStatus | null = null;

  // Timeouts
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionCheckInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;

  // Reconnection state
  private reconnectAttempt: number = 0;
  private lastCloseCode: number = 0;
  private allowReconnect: boolean = true;

  // Debouncers
  private dimDebouncers = new Map<string, CommandDebouncer>();

  constructor(bridgeIp: string, authKey: string, logger?: LoggerFunction) {
    super(); // Initialize EventEmitter
    this.bridgeIp = bridgeIp;
    this.authKey = authKey;
    this.logger = logger || console.log;

    // Initialize modules
    this.connectionManager = new ConnectionManager(bridgeIp, this.logger);
    this.deviceStateManager = new DeviceStateManager();
    this.roomStateManager = new RoomStateManager(this.logger);
    this.messageHandler = new MessageHandler(
      this.deviceStateManager,
      this.roomStateManager,
      this.logger
    );

    // Authenticator needs send functions - will be set up during connect
    this.authenticator = new Authenticator(
      authKey,
      (msg) => this.connectionManager.sendRaw(msg),
      (msg) => this.connectionManager.sendEncrypted(msg),
      () => this.connectionManager.nextMc(),
      this.logger
    );

    this.setupCallbacks();
  }

  public getConnectionManager(): ConnectionManager {
    return this.connectionManager;
  }

  private setupCallbacks(): void {
    // Connection manager callbacks
    this.connectionManager.setOnRawMessage((data, timestamp) => {
      this.handleRawMessage(data, timestamp);
    });

    this.connectionManager.setOnClose((code, reason, shouldReconnect) => {
      this.connectionState = 'disconnected';
      this.lastCloseCode = code;
      this.logger(`[XComfortBridge] Connection closed: ${code} - ${reason}`);
      this.emit('disconnected');

      if (shouldReconnect && this.allowReconnect) {
        this.emit('reconnecting');
        this.scheduleReconnect();
      }
    });

    // Authenticator callback
    this.authenticator.setOnAuthenticated(() => {
      this.connectionState = 'connected';
      this.logger('[XComfortBridge] Authenticated - requesting device list');
      this.emit('connected');

      // Request initial data
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.REQUEST_DEVICES,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.REQUEST_ROOMS,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });
      // OPTIMIZATION: Send initial HEARTBEAT (2) to signals readiness and "wake" the bridge
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.HEARTBEAT,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });

      // Start periodic heartbeat
      this.connectionManager.startHeartbeat(() => {
        this.connectionManager.sendEncrypted({
          type_int: MESSAGE_TYPES.HEARTBEAT,
          mc: this.connectionManager.nextMc(),
          payload: {},
        });
      });

      this.startWatchdog();
    });

    // Message handler callbacks
    this.messageHandler.setOnDeviceListComplete(() => {
      this.deviceListReceived = true;
      // this.logger('[XComfortBridge] Device discovery complete!');
      this.emit('devices_loaded', this.getDevices());
    });

    this.messageHandler.setOnBridgeStatusUpdate((status) => {
      // console.log('[XComfortBridge] Bridge status update:', status);
      this.lastBridgeStatus = status;
      this.emit('bridge_status', status);
    });

    this.messageHandler.setOnScenesReceived((scenes) => {
      this.detailedScenes = scenes;
      this.logger(`[XComfortBridge] Stored ${scenes.length} scenes`);
      this.emit('scenes_loaded', scenes);
    });

    // Wire up ACK/NACK handling for retry mechanism
    this.messageHandler.setOnAckReceived((ref) => {
      this.connectionManager.handleAck(ref);
    });

    this.messageHandler.setOnNackReceived((ref) => {
      this.connectionManager.handleNack(ref);
    });
  }

  /**
   * Initialize and connect to the bridge
   */
  async init(): Promise<void> {
    if (!this.bridgeIp || !this.authKey) {
      throw new Error('Bridge IP and auth key are required');
    }

    this.allowReconnect = true;
    this.logger(`[XComfortBridge] Connecting to bridge at ${this.bridgeIp}`);
    return this.connect();
  }

  public disconnect(): void {
      this.allowReconnect = false;
      this.cleanup();
  }

  private connect(): Promise<void> {
    this.clearConnectionTimers();

    return new Promise((resolve, reject) => {
      this.connectionState = 'connecting';
      this.deviceListReceived = false;
      this.authenticator.reset();
      this.connectionManager.resetMc();

      this.connectionManager.connect().catch((err) => {
        this.clearConnectionTimers();
        reject(err);
      });

      // Check for device list received
      this.connectionCheckInterval = setInterval(() => {
        if (this.deviceListReceived) {
          this.clearConnectionTimers();
          this.connectionManager.markEstablished();
          resolve();
        }
      }, 1000);

      // Connection timeout
      this.connectionTimeout = setTimeout(() => {
        this.clearConnectionTimers();
        this.logger('[XComfortBridge] Connection timeout');
        this.stopWatchdog();
        this.connectionManager.cleanup();
        reject(new Error('Connection timeout - device list not received'));
      }, PROTOCOL_CONFIG.TIMEOUTS.CONNECTION);
    });
  }

  private clearConnectionTimers(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    const maxSilenceMs = PROTOCOL_CONFIG.TIMEOUTS.HEARTBEAT * 3;
    this.watchdogInterval = setInterval(() => {
      if (!this.connectionManager.isConnected()) return;

      const last = this.connectionManager.getLastMessageAt();
      const now = Date.now();
      if (now - last > maxSilenceMs) {
        this.logger(`[XComfortBridge] Watchdog: no messages for ${now - last}ms, reconnecting`);
        this.connectionManager.cleanup();
        this.scheduleReconnect();
        return;
      }

      if (!this.connectionManager.isHeartbeatRunning()) {
        this.logger('[XComfortBridge] Watchdog: heartbeat stopped, restarting');
        this.connectionManager.restartHeartbeat();
      }
    }, PROTOCOL_CONFIG.TIMEOUTS.HEARTBEAT);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.allowReconnect) return;
    if (this.connectionManager.isReconnecting()) return;

    this.connectionManager.setReconnecting(true);
    this.reconnectAttempt++;

    // Calculate delay: immediate for first 1006, then exponential backoff
    // Base delay: 500ms for 1006, 5000ms for others
    // Max delay: 60 seconds
    const baseDelay = this.lastCloseCode === 1006 ? 500 : PROTOCOL_CONFIG.TIMEOUTS.RECONNECT_DELAY;
    const delay = Math.min(
      baseDelay * Math.pow(2, Math.max(0, this.reconnectAttempt - 1)),
      60000
    );

    this.logger(`[XComfortBridge] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt}, code ${this.lastCloseCode})`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.connectionManager.setReconnecting(false);
      this.connect()
        .then(() => {
          // Reset attempt counter on successful connection
          this.reconnectAttempt = 0;
        })
        .catch((err) => {
          this.logger(`[XComfortBridge-ERROR] Reconnection failed: ${err.message}`);
          // Schedule another attempt
          this.scheduleReconnect();
        });
    }, delay);
  }

  private handleRawMessage(data: Buffer, timestamp: number): void {
    this.connectionManager.markMessageReceived(timestamp);
    let rawStr = data.toString();
    if (rawStr.endsWith('\u0004')) rawStr = rawStr.slice(0, -1);

    // Try JSON first (unencrypted handshake)
    try {
      const msg = JSON.parse(rawStr) as ProtocolMessage;
      
      // Handle generic connection errors
      if (msg.type_int === MESSAGE_TYPES.CONNECTION_DECLINED) {
         this.logger(`[XComfortBridge] Connection Declined: ${JSON.stringify(msg.payload)}`);
         this.disconnect(); // Force disconnect to trigger clean reconnection logic
         return;
      }

      if (this.authenticator.handleUnencryptedMessage(msg)) {
        // Update encryption context after key exchange
        const ctx = this.authenticator.getEncryptionContext();
        if (ctx) {
          this.connectionManager.setEncryptionContext(ctx);
        }
        return;
      }
    } catch {
      // Not JSON, check for encrypted
    }

    // Handle encrypted messages
    const ctx = this.authenticator.getEncryptionContext();
    if (ctx && this.connectionManager.isEncrypted(rawStr)) {
      try {
        const decrypted = this.connectionManager.decryptMessage(rawStr);
        const msg = JSON.parse(decrypted) as ProtocolMessage;
        this.handleEncryptedMessage(msg, timestamp);
      } catch (e) {
        this.logger(`[XComfortBridge-ERROR] Failed to decrypt/parse: ${e}`);
      }
    }
  }

  private handleEncryptedMessage(msg: ProtocolMessage, _rawRecvTime: number): void {
    // Send ACK immediately for messages with 'mc' field (ignore negative mc)
    // CRITICAL: Send ACK synchronously BEFORE processing to prevent timeouts/disconnects
    if (msg.mc !== undefined && msg.mc >= 0) {
      setImmediate(() => {
        const ackMsg = {
          type_int: MESSAGE_TYPES.ACK,
          ref: msg.mc
        };
        this.connectionManager.sendEncrypted(ackMsg);
      });
      // Log explicit confirmation for high-risk messages like SET_ALL_DATA (300)
    } else if (msg.type_int === MESSAGE_TYPES.PING) {
      // Always ACK PING from bridge to prevent 1006 disconnects
      const ackMsg: { type_int: number; ref?: number } = { 
        type_int: MESSAGE_TYPES.ACK
      };
      if (msg.ref !== undefined) {
        ackMsg.ref = msg.ref;
      }
      // console.log(`[XComfortBridge] Replying to PING (ref=${msg.ref}) with ACK`);
      this.connectionManager.sendEncrypted(ackMsg as Record<string, unknown>);
    } else if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
        // Handle HEARTBEAT (2) which some firmwares might expect ACK for
        // console.log(`[XComfortBridge] Received HEARTBEAT`);
        const ackMsg = { 
          type_int: MESSAGE_TYPES.ACK, 
          ref: msg.mc ?? -1
        };
        this.connectionManager.sendEncrypted(ackMsg);
    }

    // console.log(
    //   `[XComfortBridge] << RECV type=${msg.type_int}${msg.mc !== undefined ? ` mc=${msg.mc}` : ''}`
    // );

    // Try authenticator first (for auth flow messages)
    if (this.authenticator.handleEncryptedMessage(msg)) {
      return;
    }

    // Then try message handler (for data/state messages)
    // Use setImmediate to allow I/O (like sending the ACK) to clear first
    setImmediate(() => {
      this.messageHandler.processMessage(msg).then(handled => {
          if (!handled) {
            // maybe emit generic message?
          }
      }).catch((err) => {
        console.error('[XComfortBridge] Message processing error:', err);
      });
    });
  }

  // ===========================================================================
  // Public API - Device State Listeners
  // ===========================================================================

  addDeviceStateListener(deviceId: string, callback: DeviceStateCallback): void {
    this.deviceStateManager.addListener(deviceId, callback);
  }

  removeDeviceStateListener(deviceId: string, callback: DeviceStateCallback): void {
      this.deviceStateManager.removeListener(deviceId, callback);
  }

  addRoomStateListener(roomId: string, callback: RoomStateCallback): void {
    this.roomStateManager.addListener(roomId, callback);
  }

  removeRoomStateListener(roomId: string, callback: RoomStateCallback): void {
    this.roomStateManager.removeListener(roomId, callback);
  }

  // ===========================================================================
  // Public API - Device/Room Access
  // ===========================================================================

  getDevices(): XComfortDevice[] {
    return this.deviceStateManager.getAllDevices();
  }

  getRooms(): XComfortRoom[] {
    return this.roomStateManager.getAllRooms();
  }

  getDevice(deviceId: string): XComfortDevice | undefined {
    return this.deviceStateManager.getDevice(deviceId);
  }

  getRoom(roomId: string): XComfortRoom | undefined {
    return this.roomStateManager.getRoom(roomId);
  }

  getDetailedScenes(): XComfortScene[] {
    return this.detailedScenes;
  }

  getLastBridgeStatus(): BridgeStatus | null {
    return this.lastBridgeStatus;
  }

  // ===========================================================================
  // Public API - Device Control
  // ===========================================================================

  async switchDevice(deviceId: string | number, switchState: boolean, onSend?: (timestamp: number) => void): Promise<boolean> {
    const payload = { 
        deviceId: this.parseId(String(deviceId)), 
        switch: switchState ? 1 : 0 // Use 1/0 instead of boolean to prevent bridge 1006 disconnects
    };

    // this.logger(`[XComfortBridge] Sending DEVICE_SWITCH (281) to ${deviceId} payload=${JSON.stringify(payload)}`);
    
    const ts = Date.now();
    if (onSend) onSend(ts);

    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.DEVICE_SWITCH,
      mc: this.connectionManager.nextMc(),
      payload,
    });
  }

  async dimDevice(deviceId: string | number, dimmValue: number, onSend?: (timestamp: number) => void): Promise<boolean> {
    const deviceIdStr = String(deviceId);
    
    // Get or create debouncer for this device
    let debouncer = this.dimDebouncers.get(deviceIdStr);
    if (!debouncer) {
        debouncer = new CommandDebouncer();
        this.dimDebouncers.set(deviceIdStr, debouncer);
    }

    return debouncer.run(async () => {
        // Adapter for Homey which might send 0-1
        let targetVal = dimmValue;
        if (dimmValue <= 1 && dimmValue > 0) {
            // Assume 0-1 range if low value, scale to 99
            targetVal = Math.round(dimmValue * 99);
        }
        
        // If target is 0, switch off explicitly via switchDevice (which handles 0/1 logic)
        if (targetVal === 0) {
            return this.switchDevice(deviceId, false, onSend);
        }
        
        targetVal = Math.max(
          PROTOCOL_CONFIG.LIMITS.DIM_MIN,
          Math.min(PROTOCOL_CONFIG.LIMITS.DIM_MAX, targetVal)
        );

        const msg = {
          type_int: MESSAGE_TYPES.DEVICE_DIM,
          mc: this.connectionManager.nextMc(),
          // Use dimmvalue (all lowercase) as per protocol
          payload: { deviceId: this.parseId(deviceIdStr), dimmvalue: targetVal },
        };

        const ts = Date.now();
        if (onSend) onSend(ts);

        // Use sendWithRetry regardless of old implementation, to ensure delivery
        return this.connectionManager.sendWithRetry(msg);
    });
  }
  


  async controlShade(deviceId: string, operation: number): Promise<boolean> {
    const msg = {
      type_int: MESSAGE_TYPES.DEVICE_SHADE,
      mc: this.connectionManager.nextMc(),
      payload: { deviceId: this.parseId(deviceId), value: operation },
    };

    // Fire and forget for shades
    await this.connectionManager.sendEncrypted(msg);
    return true;
  }

  async controlRoom(
    roomId: string,
    action: 'switch' | 'dimm',
    value: boolean | number | null = null
  ): Promise<boolean> {
    if (action === 'switch') {
      // Ensure strict 1/0 integer for switch to prevent disconnects
      const switchVal = (value === true || value === 1) ? 1 : 0;
      return this.connectionManager.sendWithRetry({
        type_int: MESSAGE_TYPES.ROOM_SWITCH,
        mc: this.connectionManager.nextMc(),
        payload: { roomId: this.parseId(roomId), switch: switchVal },
      });
    } else if (action === 'dimm' && value !== null) {
      if (!this.isRoomDimmable(roomId)) {
        this.logger(`[XComfortBridge] Room ${roomId} does not support dimming`);
        return false;
      }
      const dimmValue = Math.max(
        PROTOCOL_CONFIG.LIMITS.DIM_MIN,
        Math.min(PROTOCOL_CONFIG.LIMITS.DIM_MAX, value as number)
      );
      return this.connectionManager.sendWithRetry({
        type_int: MESSAGE_TYPES.ROOM_DIM,
        mc: this.connectionManager.nextMc(),
        payload: { roomId: this.parseId(roomId), dimmvalue: dimmValue },
      });
    }

    throw new Error(`Invalid room action: ${action}`);
  }

  async activateScene(sceneId: number): Promise<boolean> {
    this.requireConnection();

    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.ACTIVATE_SCENE,
      mc: this.connectionManager.nextMc(),
      payload: { sceneId },
    });
  }

  // ===========================================================================
  // Public API - State Refresh
  // ===========================================================================

  async requestDeviceStates(): Promise<boolean> {
    if (!this.connectionManager.isConnected()) {
      // this.logger('[XComfortBridge] Cannot request states - not connected');
      return false;
    }

    try {
      await this.connectionManager.sendWithRetry({
        type_int: MESSAGE_TYPES.REQUEST_DEVICES,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });
      await this.connectionManager.sendWithRetry({
        type_int: MESSAGE_TYPES.REQUEST_ROOMS,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });
      return true;
    } catch {
      return false;
    }
  }

  async refreshAllDeviceInfo(): Promise<boolean> {
    return this.requestDeviceStates();
  }

  // ===========================================================================
  // Public API - Utilities
  // ===========================================================================

  parseInfoMetadata(infoArray: Array<{ text: string; value: string | number }>) {
    return this.deviceStateManager.parseInfoMetadata(infoArray);
  }

  get isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  get state(): BridgeConnectionState {
    return this.connectionState;
  }
  


  cleanup(): void {
    this.clearConnectionTimers();
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionManager.cleanup();
    this.connectionManager.setReconnecting(false);
    this.connectionState = 'disconnected';
    this.reconnectAttempt = 0;
    this.removeAllListeners();
  }

  private requireConnection(): void {
    if (!this.connectionManager.isConnected()) {
      throw new Error('xComfort Bridge not connected');
    }
  }

  private parseId(id: string): string | number {
    const num = parseInt(id, 10);
    return isNaN(num) ? id : num;
  }

  private isRoomDimmable(roomId: string): boolean {
    const room = this.roomStateManager.getRoom(roomId);
    if (!room || !Array.isArray(room.devices) || room.devices.length === 0) {
      return false;
    }

    for (const devId of room.devices) {
      const device = this.deviceStateManager.getDevice(String(devId));
      if (device?.dimmable === true || device?.devType === 101) {
        return true;
      }
    }

    return false;
  }
}
