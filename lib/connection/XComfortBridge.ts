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
import { MESSAGE_TYPES, PROTOCOL_CONFIG, WS_CLOSE_CODES } from '../XComfortProtocol';
import { ConnectionManager } from './ConnectionManager';
import { Authenticator } from './Authenticator';
import { DeviceStateManager } from '../state/DeviceStateManager';
import { MessageHandler } from '../messaging/MessageHandler';
import { CommandDebouncer } from '../utils/CommandDebouncer';
import type {
  ConnectionState,
  ProtocolMessage,
  XComfortDevice,
  XComfortRoom,
  DeviceStateCallback,
  RoomStateCallback,
  LoggerFunction,
  BridgeStatus,
  ClimateMode,
  ClimateState
} from '../types';

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
  private messageHandler: MessageHandler;

  // State
  private connectionState: ConnectionState = 'disconnected';
  private deviceListReceived: boolean = false;
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
    this.setMaxListeners(50); // Each device adds connected+disconnected listeners
    this.bridgeIp = bridgeIp;
    this.authKey = authKey;
    this.logger = logger || console.log;

    // Initialize modules
    this.connectionManager = new ConnectionManager(bridgeIp, this.logger);
    this.deviceStateManager = new DeviceStateManager(this.logger);
    this.messageHandler = new MessageHandler(
      this.deviceStateManager,
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
      this.emit('devices_loaded', this.getDevices());
    });

    this.messageHandler.setOnBridgeStatusUpdate((status) => {
      this.lastBridgeStatus = status;
      this.emit('bridge_status', status);
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
      let settled = false;
      const safeResolve = () => {
        if (settled) return;
        settled = true;
        this.clearConnectionTimers();
        resolve();
      };
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        this.clearConnectionTimers();
        reject(err);
      };

      this.connectionState = 'connecting';
      this.deviceListReceived = false;
      this.authenticator.reset();
      this.connectionManager.resetMc();

      this.connectionManager.connect().catch((err) => {
        this.stopWatchdog();
        this.connectionManager.cleanup();
        if (this.allowReconnect) {
          this.scheduleReconnect();
        }
        safeReject(err);
      });

      // Check for device list received
      this.connectionCheckInterval = setInterval(() => {
        if (this.deviceListReceived) {
          this.connectionManager.markEstablished();
          safeResolve();
        }
      }, 1000);

      // Use longer timeout for reconnection attempts to give the bridge more time
      const timeout = this.reconnectAttempt > 0
        ? PROTOCOL_CONFIG.TIMEOUTS.RECONNECT_CONNECTION
        : PROTOCOL_CONFIG.TIMEOUTS.CONNECTION;

      this.connectionTimeout = setTimeout(() => {
        const authState = this.authenticator.getStateDescription();
        this.logger(`[XComfortBridge] Connection timeout (auth state: ${authState})`);
        this.stopWatchdog();
        this.connectionManager.cleanup();
        if (this.allowReconnect) {
          this.scheduleReconnect();
        }
        safeReject(new Error(`Connection timeout - ${authState}`));
      }, timeout);
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
        this.stopWatchdog();
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

    // Stop reconnecting after too many consecutive failures
    const MAX_RECONNECT_ATTEMPTS = 30;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.logger(`[XComfortBridge-ERROR] Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up. Please check bridge power/network and restart the app.`);
      this.emit('max_reconnect_reached');
      this.connectionManager.setReconnecting(false);
      return;
    }

    this.connectionManager.setReconnecting(true);
    this.reconnectAttempt++;

    // Calculate delay with escalating backoff:
    // - First few attempts: quick retry (500ms base for 1006)
    // - After 5 failures: cap at 60 seconds
    // - After 10 failures: extend to 120 seconds (give bridge time to clean up sessions)
    // - After 20 failures: extend to 300 seconds
    let maxDelay: number;
    if (this.reconnectAttempt > 20) {
      maxDelay = 300000; // 5 minutes
    } else if (this.reconnectAttempt > 10) {
      maxDelay = 120000; // 2 minutes
    } else {
      maxDelay = 60000;  // 1 minute
    }
    const baseDelay = this.lastCloseCode === WS_CLOSE_CODES.ABNORMAL_CLOSURE ? 500 : PROTOCOL_CONFIG.TIMEOUTS.RECONNECT_DELAY;
    const delay = Math.min(
      baseDelay * Math.pow(2, Math.max(0, this.reconnectAttempt - 1)),
      maxDelay
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
      // JSON message not handled by authenticator - log for diagnostics
      this.logger(`[XComfortBridge] Unhandled JSON message type: ${msg.type_int}`);
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
    // Send ACK synchronously BEFORE processing to ensure the bridge receives
    // our ACK before any response messages (e.g. LOGIN_REQUEST after SECRET_EXCHANGE_ACK).
    // Previously used setImmediate which caused LOGIN to arrive before ACK,
    // potentially causing the bridge to ignore the login.
    if (msg.mc !== undefined && msg.mc >= 0) {
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.ACK,
        ref: msg.mc
      });
    } else if (msg.type_int === MESSAGE_TYPES.PING) {
      // Always ACK PING to prevent 1006 disconnects
      const ackMsg: { type_int: number; ref?: number } = { type_int: MESSAGE_TYPES.ACK };
      if (msg.ref !== undefined) ackMsg.ref = msg.ref;
      this.connectionManager.sendEncrypted(ackMsg as Record<string, unknown>);
    } else if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
      // Only ACK if the HEARTBEAT has a valid mc
      if (msg.mc !== undefined && msg.mc >= 0) {
        this.connectionManager.sendEncrypted({
          type_int: MESSAGE_TYPES.ACK,
          ref: msg.mc
        });
      }
    }

    // Try authenticator first (for auth flow messages)
    if (this.authenticator.handleEncryptedMessage(msg)) return;

    // Then message handler (for data/state messages) — deferred to allow ACK I/O to flush
    setImmediate(() => {
      this.messageHandler.processMessage(msg).then((handled) => {
        if (!handled) {
          this.logger(`[XComfortBridge] Unhandled encrypted message type: ${msg.type_int}`);
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
    this.deviceStateManager.addRoomListener(roomId, callback);
  }

  removeRoomStateListener(roomId: string, callback: RoomStateCallback): void {
    this.deviceStateManager.removeRoomListener(roomId, callback);
  }

  // ===========================================================================
  // Public API - Device/Room Access
  // ===========================================================================

  getDevices(): XComfortDevice[] {
    return this.deviceStateManager.getAllDevices();
  }

  getDevice(deviceId: string): XComfortDevice | undefined {
    return this.deviceStateManager.getDevice(deviceId);
  }

  getRooms(): XComfortRoom[] {
    return this.deviceStateManager.getAllRooms();
  }

  getRoom(roomId: string): XComfortRoom | undefined {
    return this.deviceStateManager.getRoom(roomId);
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

    const ts = Date.now();
    if (onSend) onSend(ts);

    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.DEVICE_SWITCH,
      mc: this.connectionManager.nextMc(),
      payload,
    });
  }

  async dimDevice(deviceId: string | number, dimmValue: number, onSend?: (timestamp: number) => void): Promise<boolean | undefined> {
    const deviceIdStr = String(deviceId);
    
    // Get or create debouncer for this device
    let debouncer = this.dimDebouncers.get(deviceIdStr);
    if (!debouncer) {
        debouncer = new CommandDebouncer();
        this.dimDebouncers.set(deviceIdStr, debouncer);
    }

    return debouncer.run(async () => {
        let targetVal = dimmValue;
        
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

  /**
   * Control a shading device (open/close/stop/position)
   */
  async controlShading(deviceId: string | number, action: number, value?: number): Promise<boolean> {
    const numericId = this.parseId(String(deviceId));
    const payload: Record<string, unknown> = {
      deviceId: numericId,
      action: action,
    };
    if (value !== undefined) {
      payload.value = value;
    }

    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.SET_DEVICE_SHADING_STATE,
      mc: this.connectionManager.nextMc(),
      payload,
    });
  }

  /**
   * Set thermostat setpoint
   */
  async setThermostatSetpoint(deviceId: string | number, setpoint: number): Promise<boolean> {
    const numericId = this.parseId(String(deviceId));
    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.SET_HEATING_STATE,
      mc: this.connectionManager.nextMc(),
      payload: {
        deviceId: numericId,
        setpoint: setpoint,
      },
    });
  }

  /**
   * Set room heating state using the room-based thermostat model used by xComfort.
   */
  async setRoomHeatingState(
    roomId: string | number,
    mode: ClimateMode | number,
    state: ClimateState | number,
    setpoint: number,
    confirmed: boolean = false,
  ): Promise<boolean> {
    const numericId = this.parseId(String(roomId));
    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.SET_HEATING_STATE,
      mc: this.connectionManager.nextMc(),
      payload: {
        roomId: numericId,
        mode,
        state,
        setpoint,
        confirmed,
      },
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
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Public API - Utilities
  // ===========================================================================

  get isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  cleanup(): void {
    this.clearConnectionTimers();
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.messageHandler.cleanup();
    this.connectionManager.cleanup();
    this.connectionManager.setReconnecting(false);
    this.connectionState = 'disconnected';
    this.reconnectAttempt = 0;
    this.dimDebouncers.clear();
    this.removeAllListeners();
  }

  private parseId(id: string): string | number {
    const num = parseInt(id, 10);
    return isNaN(num) ? id : num;
  }
}
