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
  DeviceStateCallback,
  LoggerFunction,
  BridgeStatus
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
      this.connectionState = 'connecting';
      this.deviceListReceived = false;
      this.authenticator.reset();
      this.connectionManager.resetMc();

      this.connectionManager.connect().catch((err) => {
        this.clearConnectionTimers();
        this.stopWatchdog();
        this.connectionManager.cleanup();
        if (this.allowReconnect) {
          this.scheduleReconnect();
        }
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
        if (this.allowReconnect) {
          this.scheduleReconnect();
        }
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
    const MAX_RECONNECT_DELAY = 60000;
    const baseDelay = this.lastCloseCode === WS_CLOSE_CODES.ABNORMAL_CLOSURE ? 500 : PROTOCOL_CONFIG.TIMEOUTS.RECONNECT_DELAY;
    const delay = Math.min(
      baseDelay * Math.pow(2, Math.max(0, this.reconnectAttempt - 1)),
      MAX_RECONNECT_DELAY
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
    if (msg.mc !== undefined && msg.mc >= 0) {
      setImmediate(() => {
        this.connectionManager.sendEncrypted({
          type_int: MESSAGE_TYPES.ACK,
          ref: msg.mc
        });
      });
    } else if (msg.type_int === MESSAGE_TYPES.PING) {
      // Always ACK PING to prevent 1006 disconnects
      const ackMsg: { type_int: number; ref?: number } = { type_int: MESSAGE_TYPES.ACK };
      if (msg.ref !== undefined) ackMsg.ref = msg.ref;
      this.connectionManager.sendEncrypted(ackMsg as Record<string, unknown>);
    } else if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.ACK,
        ref: msg.mc ?? -1
      });
    }

    // Try authenticator first (for auth flow messages)
    if (this.authenticator.handleEncryptedMessage(msg)) return;

    // Then message handler (for data/state messages) — deferred to allow ACK I/O to flush
    setImmediate(() => {
      this.messageHandler.processMessage(msg).catch((err) => {
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

  // ===========================================================================
  // Public API - Device/Room Access
  // ===========================================================================

  getDevices(): XComfortDevice[] {
    return this.deviceStateManager.getAllDevices();
  }

  getDevice(deviceId: string): XComfortDevice | undefined {
    return this.deviceStateManager.getDevice(deviceId);
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
    this.connectionManager.cleanup();
    this.connectionManager.setReconnecting(false);
    this.connectionState = 'disconnected';
    this.reconnectAttempt = 0;
    this.dimDebouncers.clear();
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
}
