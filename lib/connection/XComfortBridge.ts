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
  BridgeInfo,
  XComfortComponent,
  XComfortDevice,
  XComfortRoom,
  XComfortScene,
  DeviceStateCallback,
  RoomStateCallback,
  LoggerFunction,
  BridgeStatus,
  ClimateMode,
  ClimateState,
  XComfortAuthOptions,
  XComfortAuthMode
} from '../types';

// ============================================================================
// XComfortBridge Class
// ============================================================================

export class XComfortBridge extends EventEmitter {
  private bridgeIp: string;
  private authKey: string;
  private authMode: XComfortAuthMode;
  private username: string;
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
  private lastBridgeInfo: BridgeInfo = {};

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
  private switchDebouncers = new Map<string, CommandDebouncer>();

  // Coalescing of full-state refreshes (REQUEST_DEVICES). Many devices can
  // independently ask for a refresh (e.g. actuator safety timers after a switch
  // burst); without coalescing each fires a heavy SET_ALL_DATA round-trip and
  // can overwhelm the bridge, causing NACKs/timeouts that delay other commands.
  private deviceStatesInFlight: Promise<boolean> | null = null;
  private lastDeviceStatesAt: number = 0;
  private lastControlCommandAt: number = 0;
  private deferredDeviceStatesTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEVICE_STATES_MIN_INTERVAL_MS = 2000;
  private readonly CONTROL_QUIET_PERIOD_MS = 8000;

  constructor(bridgeIp: string, authKey: string, logger?: LoggerFunction, authOptions?: XComfortAuthOptions) {
    super(); // Initialize EventEmitter
    // Each device adds connected/disconnected (and sometimes devices_loaded /
    // bridge_status / bridge_info) listeners — power users with 25+ devices
    // already hit the default cap of 10. 200 gives comfortable headroom while
    // preserving Node's leak warning for genuinely runaway listener growth.
    this.setMaxListeners(200);
    this.bridgeIp = bridgeIp;
    this.authKey = authKey;
    this.authMode = authOptions?.mode === 'user' ? 'user' : 'device';
    this.username = this.authMode === 'user' ? this.normalizeUsername(authOptions?.username) : 'default';
    this.logger = logger || console.log;
    this.lastBridgeInfo = {
      ipAddress: bridgeIp,
    };

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
      this.logger,
      { mode: this.authMode, username: this.username }
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

      // Store firmware version from handshake (matches HA device_version extraction)
      const fwVersion = this.authenticator.getFirmwareVersion();
      if (fwVersion && fwVersion !== this.lastBridgeInfo.firmwareVersion) {
        this.lastBridgeInfo = {
          ...this.lastBridgeInfo,
          firmwareVersion: fwVersion,
        };
        this.emit('bridge_info', this.lastBridgeInfo);
      }

      this.emit('connected');

      // Request initial data
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.REQUEST_DEVICES,
        mc: this.connectionManager.nextMc(),
        payload: {},
      });
      this.connectionManager.sendEncrypted({
        type_int: MESSAGE_TYPES.REQUEST_HOME_DATA,
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
      this.lastBridgeStatus = {
        ...(this.lastBridgeStatus || {}),
        ...status,
      };
      this.emit('bridge_status', this.lastBridgeStatus);
    });

    this.messageHandler.setOnHomeDataUpdate((payload) => {
      this.updateBridgeInfo(payload);
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
      throw new Error('Bridge IP and credentials are required');
    }

    this.allowReconnect = true;
    this.logger(`[XComfortBridge] Connecting to bridge using ${this.authMode} login`);
    return this.connect();
  }

  private normalizeUsername(username: string | undefined): string {
    const normalized = String(username || '').trim();
    return normalized || 'default';
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
        if (this.authenticator.getState() === 'failed') {
          this.allowReconnect = false;
          this.stopWatchdog();
          this.connectionManager.cleanup();
          safeReject(new Error('Bridge login denied for configured credentials'));
          return;
        }
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

    // After many failures, keep retrying slowly instead of requiring an app
    // restart. Bridges can come back hours later after power/network work.
    const MAX_RECONNECT_ATTEMPTS = 30;
    if (this.reconnectAttempt === MAX_RECONNECT_ATTEMPTS) {
      this.logger(`[XComfortBridge] Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Continuing with slow background retries.`);
      this.emit('max_reconnect_reached');
    }

    this.connectionManager.setReconnecting(true);
    this.reconnectAttempt++;

    // Calculate delay with escalating backoff:
    // - First few attempts: quick retry (500ms base for 1006)
    // - After 5 failures: cap at 60 seconds
    // - After 10 failures: extend to 120 seconds (give bridge time to clean up sessions)
    // - After 20 failures: extend to 300 seconds
    let maxDelay: number;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      maxDelay = 600000; // 10 minutes
    } else if (this.reconnectAttempt > 20) {
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
      
      // Handle generic connection errors. The bridge declines a new session
      // while it still holds a stale one (common right after an abnormal
      // drop). Don't tear the bridge down here — disconnect() would disable
      // reconnection and strip all device listeners until an app restart.
      // Instead bias the backoff longer; the socket close (or the connection
      // timeout) that follows drives the actual reconnect.
      if (msg.type_int === MESSAGE_TYPES.CONNECTION_DECLINED) {
         this.logger(`[XComfortBridge] Connection Declined: ${JSON.stringify(msg.payload)} — backing off before reconnecting`);
         this.reconnectAttempt = Math.max(this.reconnectAttempt, 5);
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

    // The bridge declines a new session while it still holds a previous one
    // (common right after it abnormally dropped us under load). Reconnecting
    // immediately just gets declined again, so bias the backoff longer to give
    // the bridge time to release the stale session. The socket close that
    // follows will trigger the (now slower) reconnect.
    if (msg.type_int === MESSAGE_TYPES.CONNECTION_DECLINED) {
      this.logger('[XComfortBridge] Connection declined by bridge (stale session) — backing off before reconnecting');
      this.reconnectAttempt = Math.max(this.reconnectAttempt, 5);
      return;
    }

    // Then message handler (for data/state messages) — deferred to allow ACK I/O to flush
    setImmediate(() => {
      this.messageHandler.processMessage(msg).then((handled) => {
        if (!handled) {
          this.logger(`[XComfortBridge] Unhandled encrypted message type: ${msg.type_int}`);
        }
      }).catch((err) => {
        this.logger('[XComfortBridge] Message processing error:', err);
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

  getComponents(): XComfortComponent[] {
    return this.deviceStateManager.getAllComponents();
  }

  getComponent(compId: string): XComfortComponent | undefined {
    return this.deviceStateManager.getComponent(compId);
  }

  getScenes(): XComfortScene[] {
    return this.deviceStateManager.getAllScenes();
  }

  getScene(sceneId: string): XComfortScene | undefined {
    return this.deviceStateManager.getScene(sceneId);
  }

  getLastBridgeStatus(): BridgeStatus | null {
    return this.lastBridgeStatus;
  }

  getLastBridgeInfo(): BridgeInfo {
    return this.lastBridgeInfo;
  }

  // ===========================================================================
  // Public API - Device Control
  // ===========================================================================

  async switchDevice(deviceId: string | number, switchState: boolean): Promise<boolean> {
    const deviceIdStr = String(deviceId);

    // Per-device coalescing (same pattern as dimDevice). Rapid toggles of one
    // light — from a Flow, a group, a slider crossing zero, or fast taps —
    // otherwise become one bridge command each and flood the bridge, which
    // responds by NACKing and dropping the connection (1006). Leading-edge
    // debounce sends the first toggle instantly and collapses the rest to the
    // final state, so the bridge only ever sees the outcome.
    let debouncer = this.switchDebouncers.get(deviceIdStr);
    if (!debouncer) {
      debouncer = new CommandDebouncer();
      this.switchDebouncers.set(deviceIdStr, debouncer);
    }

    const result = await debouncer.run(async () => {
      return this.sendControlMessage({
        type_int: MESSAGE_TYPES.DEVICE_SWITCH,
        mc: this.connectionManager.nextMc(),
        payload: {
          deviceId: this.parseId(deviceIdStr),
          switch: switchState ? 1 : 0,
        },
      });
    });

    // Superseded by a newer toggle — report success so the UI doesn't revert.
    return result ?? true;
  }

  async switchRoom(roomId: string | number, switchState: boolean): Promise<boolean> {
    const payload = {
      roomId: this.parseId(String(roomId)),
      switch: switchState ? 1 : 0,
    };

    return this.sendControlMessage({
      type_int: MESSAGE_TYPES.ROOM_SWITCH,
      mc: this.connectionManager.nextMc(),
      payload,
    });
  }

  async activateScene(sceneId: string | number): Promise<boolean> {
    return this.sendControlMessage({
      type_int: MESSAGE_TYPES.ACTIVATE_SCENE,
      mc: this.connectionManager.nextMc(),
      payload: { sceneId: this.parseId(String(sceneId)) },
    });
  }

  async setRemoteAccess(allowed: boolean): Promise<boolean> {
    const result = await this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.SET_REMOTE_CONFIG,
      mc: this.connectionManager.nextMc(),
      payload: { remoteAllowed: allowed },
    });

    this.lastBridgeInfo = {
      ...this.lastBridgeInfo,
      remoteAllowed: allowed,
      raw: {
        ...(this.lastBridgeInfo.raw || {}),
        remoteAllowed: allowed,
      },
    };
    this.emit('bridge_info', this.lastBridgeInfo);
    return result;
  }

  async dimDevice(deviceId: string | number, dimmValue: number): Promise<boolean | undefined> {
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
            return this.switchDevice(deviceId, false);
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

        return this.sendControlMessage(msg);
    });
  }

  /**
   * Control a shading device (open/close/stop/position)
   */
  async controlShading(deviceId: string | number, action: number, value?: number): Promise<boolean> {
    const numericId = this.parseId(String(deviceId));
    const payload: Record<string, unknown> = {
      deviceId: numericId,
      state: action, // Match ha-xcomfort-bridge payload
      action: action, // Fallback for backwards compatibility if needed
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

  async setRoomHvacState(roomId: string | number, state: ClimateState | number): Promise<boolean> {
    const numericId = this.parseId(String(roomId));
    return this.connectionManager.sendWithRetry({
      type_int: MESSAGE_TYPES.SET_HEATING_STATE,
      mc: this.connectionManager.nextMc(),
      payload: {
        roomId: numericId,
        state,
        confirmed: true,
      },
    });
  }

  async setEnergyLoadMode(meterId: string | number, mode: string): Promise<boolean> {
    const normalizedMode = this.normalizeEnergyLoadMode(mode);
    const numericMode = this.energyLoadModeToProtocolValue(normalizedMode);
    const parsedMeterId = this.parseId(String(meterId));

    return this.sendControlMessage({
      type_int: MESSAGE_TYPES.SET_ENERGY_CONTROL,
      mc: this.connectionManager.nextMc(),
      payload: {
        meterId: parsedMeterId,
        loadMode: normalizedMode,
        mode: numericMode,
        controlMode: numericMode,
        confirmed: true,
      },
    });
  }

  async requestEnergyData(meterId?: string | number): Promise<void> {
    const payload = meterId !== undefined && meterId !== null
      ? { meterId: this.parseId(String(meterId)) }
      : {};
    const requestTypes = [
      MESSAGE_TYPES.REQUEST_MAIN_ELECTRICAL_ENERGY_USAGE,
      MESSAGE_TYPES.REQUEST_ENERGY_METER,
      MESSAGE_TYPES.REQUEST_TARIFF_INFO,
      MESSAGE_TYPES.REQUEST_ENERGY_CONTROL,
      MESSAGE_TYPES.REQUEST_ENERGY_HISTORY,
    ];

    for (const type_int of requestTypes) {
      await this.sendControlMessage({
        type_int,
        mc: this.connectionManager.nextMc(),
        payload,
      });
    }
  }

  // ===========================================================================
  // Public API - State Refresh
  // ===========================================================================

  private async sendControlMessage(msg: { mc: number; [key: string]: unknown }): Promise<boolean> {
    this.markControlCommand();
    try {
      return await this.connectionManager.sendWithRetry(msg);
    } finally {
      this.markControlCommand();
    }
  }

  private markControlCommand(): void {
    this.lastControlCommandAt = Date.now();
  }

  private scheduleDeferredDeviceStates(waitMs: number): void {
    if (this.deferredDeviceStatesTimer) {
      clearTimeout(this.deferredDeviceStatesTimer);
    }

    this.deferredDeviceStatesTimer = setTimeout(() => {
      this.deferredDeviceStatesTimer = null;
      this.requestDeviceStates().catch((error) => {
        this.logger(`[XComfortBridge] Deferred device state refresh failed: ${(error as Error).message}`);
      });
    }, waitMs);
  }

  async requestDeviceStates(): Promise<boolean> {
    if (!this.connectionManager.isConnected()) {
      // this.logger('[XComfortBridge] Cannot request states - not connected');
      return false;
    }

    // Full state refreshes can take several seconds to ACK. Keep them behind
    // recent user controls so a safety refresh cannot block the next light tap.
    const quietWaitMs = this.CONTROL_QUIET_PERIOD_MS - (Date.now() - this.lastControlCommandAt);
    if (quietWaitMs > 0) {
      this.scheduleDeferredDeviceStates(quietWaitMs);
      return true;
    }

    // Already refreshing — share the in-flight request instead of issuing another.
    if (this.deviceStatesInFlight) {
      return this.deviceStatesInFlight;
    }

    // Recently refreshed — a fresh SET_ALL_DATA is already on its way / just
    // arrived, so skip to avoid hammering the bridge. Reported as success.
    if (Date.now() - this.lastDeviceStatesAt < this.DEVICE_STATES_MIN_INTERVAL_MS) {
      return true;
    }

    this.lastDeviceStatesAt = Date.now();
    this.deviceStatesInFlight = (async () => {
      try {
        await this.connectionManager.sendWithRetry({
          type_int: MESSAGE_TYPES.REQUEST_DEVICES,
          mc: this.connectionManager.nextMc(),
          payload: {},
        });
        return true;
      } catch {
        return false;
      } finally {
        this.deviceStatesInFlight = null;
      }
    })();

    return this.deviceStatesInFlight;
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

  private updateBridgeInfo(payload: Record<string, unknown>): void {
    const bridgeType = typeof payload.bridgeType === 'number' ? payload.bridgeType : this.lastBridgeInfo.bridgeType;
    const directScenes = Array.isArray(payload.homeScenes)
      ? payload.homeScenes.length
      : Array.isArray(payload.scenes)
        ? payload.scenes.length
        : this.lastBridgeInfo.homeScenesCount;
    const remoteAllowed = typeof payload.remoteAllowed === 'boolean'
      ? payload.remoteAllowed
      : this.lastBridgeInfo.remoteAllowed;
    const remoteOnline = typeof payload.remoteOnline === 'boolean'
      ? payload.remoteOnline
      : this.lastBridgeInfo.remoteOnline;

    this.lastBridgeInfo = {
      ...this.lastBridgeInfo,
      id: typeof payload.id === 'string' || typeof payload.id === 'number' ? String(payload.id) : this.lastBridgeInfo.id,
      name: typeof payload.name === 'string' ? payload.name : this.lastBridgeInfo.name,
      bridgeType,
      bridgeModel: this.resolveBridgeModel(bridgeType),
      homeScenesCount: typeof directScenes === 'number' ? directScenes : this.lastBridgeInfo.homeScenesCount,
      remoteAllowed,
      remoteOnline,
      raw: {
        ...(this.lastBridgeInfo.raw || {}),
        ...payload,
      },
    };

    this.emit('bridge_info', this.lastBridgeInfo);
  }

  private resolveBridgeModel(bridgeType?: number): string | undefined {
    if (bridgeType === undefined) {
      return this.lastBridgeInfo.bridgeModel;
    }

    if (bridgeType === 1) {
      return 'xComfort Bridge';
    }

    return `xComfort Bridge (Type ${bridgeType})`;
  }

  cleanup(): void {
    this.clearConnectionTimers();
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.deferredDeviceStatesTimer) {
      clearTimeout(this.deferredDeviceStatesTimer);
      this.deferredDeviceStatesTimer = null;
    }
    this.messageHandler.cleanup();
    this.connectionManager.cleanup();
    this.connectionManager.setReconnecting(false);
    this.connectionState = 'disconnected';
    this.reconnectAttempt = 0;
    this.dimDebouncers.clear();
    this.switchDebouncers.clear();
    this.removeAllListeners();
  }

  private parseId(id: string): string | number {
    const num = parseInt(id, 10);
    return isNaN(num) ? id : num;
  }

  private normalizeEnergyLoadMode(mode: string): string {
    const normalized = mode.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'saving' || normalized === 'energy_saving' || normalized === 'energysaving') {
      return 'energy_saving';
    }
    if (normalized === 'priority' || normalized === 'prio') {
      return 'priority';
    }
    return 'normal';
  }

  private energyLoadModeToProtocolValue(mode: string): number {
    switch (mode) {
      case 'energy_saving':
        return 1;
      case 'priority':
        return 2;
      case 'normal':
      default:
        return 0;
    }
  }
}
