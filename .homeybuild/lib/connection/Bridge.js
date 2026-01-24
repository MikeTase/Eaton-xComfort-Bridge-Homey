"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XComfortBridge = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const crypto = __importStar(require("crypto"));
const Encryption_1 = require("../crypto/Encryption");
var BridgeState;
(function (BridgeState) {
    BridgeState["DISCONNECTED"] = "DISCONNECTED";
    BridgeState["CONNECTING"] = "CONNECTING";
    BridgeState["WAITING_FOR_HELLO"] = "WAITING_FOR_HELLO";
    BridgeState["CONNECTED_UNSECURE"] = "CONNECTED_UNSECURE";
    BridgeState["SECURE_INIT_SENT"] = "SECURE_INIT_SENT";
    BridgeState["KEY_EXCHANGE_SENT"] = "KEY_EXCHANGE_SENT";
    BridgeState["SECURE_SESSION"] = "SECURE_SESSION";
    BridgeState["AUTHENTICATING"] = "AUTHENTICATING";
    BridgeState["AUTHENTICATED"] = "AUTHENTICATED";
})(BridgeState || (BridgeState = {}));
var MessageType;
(function (MessageType) {
    MessageType[MessageType["ACK"] = 1] = "ACK";
    MessageType[MessageType["HEARTBEAT"] = 2] = "HEARTBEAT";
    MessageType[MessageType["HELLO"] = 10] = "HELLO";
    MessageType[MessageType["HELLO_CONFIRM"] = 11] = "HELLO_CONFIRM";
    MessageType[MessageType["CONNECTION_ESTABLISHED"] = 12] = "CONNECTION_ESTABLISHED";
    MessageType[MessageType["CONNECTION_DECLINED"] = 13] = "CONNECTION_DECLINED";
    MessageType[MessageType["SC_INIT"] = 14] = "SC_INIT";
    MessageType[MessageType["SC_PUBLIC_KEY"] = 15] = "SC_PUBLIC_KEY";
    MessageType[MessageType["SC_CLIENT_KEY"] = 16] = "SC_CLIENT_KEY";
    MessageType[MessageType["SC_ACK"] = 17] = "SC_ACK";
    MessageType[MessageType["LOGIN"] = 30] = "LOGIN";
    MessageType[MessageType["LOGIN_OK"] = 31] = "LOGIN_OK";
    MessageType[MessageType["LOGIN_RESPONSE"] = 32] = "LOGIN_RESPONSE";
    MessageType[MessageType["TOKEN_APPLY"] = 33] = "TOKEN_APPLY";
    MessageType[MessageType["TOKEN_APPLY_ACK"] = 34] = "TOKEN_APPLY_ACK";
    MessageType[MessageType["TOKEN_RENEW"] = 37] = "TOKEN_RENEW";
    MessageType[MessageType["TOKEN_RENEW_RESPONSE"] = 38] = "TOKEN_RENEW_RESPONSE";
    MessageType[MessageType["ERROR_INFO"] = 295] = "ERROR_INFO";
    MessageType[MessageType["ITEM_UPDATE"] = 20] = "ITEM_UPDATE";
    MessageType[MessageType["REQUEST_DEVICES"] = 240] = "REQUEST_DEVICES";
    MessageType[MessageType["REQUEST_ROOMS"] = 242] = "REQUEST_ROOMS";
    MessageType[MessageType["ACTION_SLIDE_DEVICE"] = 280] = "ACTION_SLIDE_DEVICE";
    MessageType[MessageType["ACTION_SWITCH_DEVICE"] = 281] = "ACTION_SWITCH_DEVICE";
    MessageType[MessageType["SET_ALL_DATA"] = 300] = "SET_ALL_DATA";
    MessageType[MessageType["SET_HOME_DATA"] = 303] = "SET_HOME_DATA";
    MessageType[MessageType["SET_STATE_INFO"] = 310] = "SET_STATE_INFO";
    MessageType[MessageType["SET_BRIDGE_STATE"] = 364] = "SET_BRIDGE_STATE";
})(MessageType || (MessageType = {}));
class XComfortBridge extends events_1.EventEmitter {
    constructor(ip, authKey, deviceId) {
        super();
        this.socket = null;
        this.state = BridgeState.DISCONNECTED;
        this.heartbeatInterval = null;
        this.devices = [];
        this.bridgeDeviceId = '';
        // Manual deviceId mapping for ambiguous SET_STATE_INFO
        this.manualDeviceIdMap = {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.serverSalt = '';
        this.mcCounter = 1;
        this.secureChannelId = null;
        this.token = null;
        this.isRenewing = false;
        this.deviceMap = new Map();
        this.roomMap = new Map();
        this.loginAttempts = 0;
        this.lastActivityAt = Date.now();
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.reconnectDelayMs = 5000;
        this.manualDisconnect = false;
        this.lastProtocolHeartbeatAt = 0;
        this.lastSwitchAt = new Map();
        this.debugTraffic = false;
        this.connectionId = '';
        this.ip = ip;
        this.authKey = authKey.trim();
        this.deviceId = deviceId;
        // Generate fresh session keys for this connection
        this.aesKey = crypto.randomBytes(32); // 256 bits
        this.aesIv = crypto.randomBytes(16); // 128 bits
        this.mcCounter = 1; // Start mc at 1 for deterministic handshake
    }
    nextMc() {
        const val = this.mcCounter++;
        if (this.mcCounter > 65535)
            this.mcCounter = 1;
        return val;
    }
    connect() {
        // Reset message counter for each new connection
        this.mcCounter = 1;
        this.deviceMap.clear();
        this.devices = [];
        this.loginAttempts = 0;
        this.manualDisconnect = false;
        this.isRenewing = false;
        this.token = null;
        this.secureChannelId = null;
        this.connectionId = '';
        this.bridgeDeviceId = '';
        // Regenerate session keys for each connection
        this.aesKey = crypto.randomBytes(32);
        this.aesIv = crypto.randomBytes(16);
        if (this.state !== BridgeState.DISCONNECTED && this.socket) {
            this.socket.terminate();
        }
        this.state = BridgeState.CONNECTING;
        this.socket = new ws_1.default(`ws://${this.ip}`, {
            handshakeTimeout: 5000,
            protocolVersion: 13,
            origin: 'http://localhost',
        });
        this.socket.on('open', () => {
            console.log('Socket Open. Waiting for Bridge Hello (Type 10)...');
            this.state = BridgeState.WAITING_FOR_HELLO;
            this.startHeartbeat();
            this.emit('connected');
        });
        this.socket.on('message', (data) => {
            this.handleRawMessage(data);
        });
        this.socket.on('pong', () => {
            this.lastActivityAt = Date.now();
        });
        this.socket.on('close', (code, reason) => {
            console.log(`[Bridge] Disconnected (Code: ${code}, Reason: ${reason})`);
            this.state = BridgeState.DISCONNECTED;
            this.stopHeartbeat();
            this.socket = null;
            this.emit('disconnected');
            this.scheduleReconnect();
        });
        this.socket.on('error', (err) => {
            console.error('[Bridge] Error:', err.message);
        });
    }
    handleRawMessage(buffer) {
        try {
            const rawString = buffer.toString('utf8');
            // 1. Split by End-of-Transmission (\u0004) and Null (\x00) characters
            // eslint-disable-next-line no-control-regex
            const parts = rawString.split(/[\u0004\x00]/);
            for (let msgString of parts) {
                msgString = msgString.trim();
                if (!msgString)
                    continue;
                if (this.debugTraffic) {
                    // Debug raw (truncated)
                    if (msgString.length < 500) {
                        console.log(`RX Raw: ${msgString}`);
                    }
                    else {
                        console.log(`RX Raw: ${msgString.substring(0, 100)}...`);
                    }
                }
                try {
                    const msg = JSON.parse(msgString);
                    this.handleProtocolMessage(msg);
                }
                catch (parseError) {
                    // Check if it is a Base64 string (Encrypted Message)
                    // Removing whitespace just in case
                    const cleanStr = msgString.replace(/\s/g, '');
                    // Simple regex for Base64
                    if (/^[A-Za-z0-9+/]*={0,2}$/.test(cleanStr)) {
                        if (this.debugTraffic) {
                            console.log('Message is not JSON. Treating as Encrypted Base64.');
                        }
                        this.handleEncryptedMessage(cleanStr);
                        continue;
                    }
                    // Robustness: If strictly parsing fails, look for the last closing brace
                    // This handles cases where garbage is appended that isn't stripped above
                    const lastBrace = msgString.lastIndexOf('}');
                    if (lastBrace !== -1 && lastBrace < msgString.length - 1) {
                        const fixedString = msgString.substring(0, lastBrace + 1);
                        try {
                            const msg = JSON.parse(fixedString);
                            console.log('Fixed JSON by trimming extra characters.');
                            this.handleProtocolMessage(msg);
                            continue;
                        }
                        catch (e) {
                            // Double fail
                        }
                    }
                    console.error('Error parsing message part:', parseError);
                }
            }
        }
        catch (err) {
            console.error('Error parsing inbound message:', err);
        }
    }
    handleEncryptedMessage(base64) {
        if (!this.aesKey || !this.aesIv) {
            console.error('Cannot decrypt message: No session keys available.');
            return;
        }
        try {
            const decrypted = Encryption_1.Encryption.decryptMessage(base64, this.aesKey, this.aesIv);
            if (this.debugTraffic) {
                console.log(`Decrypted: ${decrypted}`);
            }
            try {
                const msg = JSON.parse(decrypted);
                this.handleProtocolMessage(msg);
            }
            catch (e) {
                console.error('Decrypted message is not valid JSON:', decrypted);
            }
        }
        catch (err) {
            console.error('Failed to decrypt message. Keys correct?', err);
        }
    }
    handleProtocolMessage(msg) {
        var _a, _b, _c, _d, _e;
        if (!msg || typeof msg.type_int === 'undefined')
            return;
        this.lastActivityAt = Date.now();
        const type = msg.type_int;
        const payload = msg.payload || {};
        // Send ACK for messages with 'mc' field (except our own messages)
        if (msg.mc !== undefined && msg.mc >= 0 && type !== MessageType.ACK) {
            setImmediate(() => {
                this.sendMessage(MessageType.ACK, {}, msg.mc);
            });
        }
        switch (type) {
            case MessageType.HELLO: // 10
                console.log('Got Hello (10). Payload:', JSON.stringify(payload));
                // Store connection_id if provided (Critical for Confirm)
                if (payload.connection_id) {
                    this.connectionId = payload.connection_id;
                }
                // Store Bridge Device ID (Critical for Login hashing)
                if (!payload.device_id) {
                    console.error('HELLO missing device_id; cannot continue handshake.');
                    return;
                }
                this.bridgeDeviceId = String(payload.device_id);
                console.log(`Sending Confirm (11) with connection_id: ${this.connectionId}...`);
                // Use a FIXED client_id like reference implementation (not bridge device_id)
                this.sendMessage(MessageType.HELLO_CONFIRM, {
                    client_type: 'shl-app',
                    client_id: 'c956e43f999f8004', // Fixed client ID from reference
                    client_version: '3.0.0',
                    connection_id: this.connectionId
                });
                this.state = BridgeState.CONNECTED_UNSECURE;
                // Wait for CONNECTION_ESTABLISHED (12) before starting secure handshake
                break;
            case MessageType.HELLO_CONFIRM: // 11
                console.log('Got Hello Confirm (11).');
                break;
            case MessageType.CONNECTION_ESTABLISHED: // 12
                console.log('Got Connection Established (12). Starting secure handshake...');
                // Now that connection is confirmed, start the secure channel
                setTimeout(() => {
                    if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
                        this.startSecureHandshake();
                    }
                }, 100);
                break;
            case MessageType.CONNECTION_DECLINED: // 13
                console.error('Got Connection Declined (13). Closing connection.');
                console.error('Payload:', JSON.stringify(payload, null, 2));
                (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close();
                break;
            case MessageType.SC_PUBLIC_KEY: // 15
                console.log('Got Public Key (15). Generating and sending Session Keys...');
                this.handlePublicKey(payload);
                break;
            case MessageType.SC_ACK: // 17
                console.log('Got Secure Ack (17). Handshake Complete!');
                if (payload && typeof payload.sc_id !== 'undefined') {
                    this.secureChannelId = payload.sc_id;
                    console.log(`Stored secure channel id: ${this.secureChannelId}`);
                }
                this.state = BridgeState.SECURE_SESSION;
                this.emit('secure');
                // Now login after a brief delay to ensure the secure session is fully established
                setTimeout(() => this.login(), 100);
                break;
            case MessageType.LOGIN_OK: // 31 (simple ack, no token)
                console.warn(`Got Login OK (${type}) without token. Retrying login with new salt...`);
                this.retryLoginOrFail();
                break;
            case MessageType.LOGIN_RESPONSE: // 32 (with token)
                console.log(`Got Login Response (${type})! Received token.`);
                if (payload && payload.token) {
                    this.token = payload.token;
                    console.log('[Auth] Applying token...');
                    this.sendMessage(MessageType.TOKEN_APPLY, { token: this.token });
                }
                else {
                    console.warn('LOGIN_RESPONSE without token. Retrying login with new salt...');
                    this.retryLoginOrFail();
                }
                break;
            case MessageType.TOKEN_APPLY_ACK: // 34
                console.log(`Got Token Apply ACK (${type})`);
                if (!this.isRenewing) {
                    console.log('[Auth] Token applied, renewing token...');
                    this.isRenewing = true;
                    this.sendMessage(MessageType.TOKEN_RENEW, { token: this.token });
                }
                else {
                    console.log('[Auth] Fully authenticated with renewed token!');
                    this.state = BridgeState.AUTHENTICATED;
                    this.isRenewing = false;
                    this.emit('authenticated');
                    this.requestDevicesAfterAuth();
                }
                break;
            case MessageType.TOKEN_RENEW_RESPONSE: // 38
                console.log(`Got Token Renew Response (${type})`);
                if (payload && payload.token) {
                    this.token = payload.token;
                    console.log('[Auth] Token renewed, applying new token...');
                    this.sendMessage(MessageType.TOKEN_APPLY, { token: this.token });
                }
                break;
            case MessageType.SET_HOME_DATA: // 303
            case MessageType.SET_ALL_DATA: // 300
                // Intentionally silent to avoid log spam
                // Rooms may be included in payload
                if (payload && payload.rooms) {
                    const rooms = Array.isArray(payload.rooms)
                        ? payload.rooms
                        : Object.values(payload.rooms);
                    rooms.forEach((room) => {
                        var _a, _b, _c, _d, _e;
                        if (!room)
                            return;
                        const roomId = (_c = (_b = (_a = room.roomId) !== null && _a !== void 0 ? _a : room.id) !== null && _b !== void 0 ? _b : room.room_id) !== null && _c !== void 0 ? _c : room.identifier;
                        const roomName = (_e = (_d = room.name) !== null && _d !== void 0 ? _d : room.label) !== null && _e !== void 0 ? _e : room.title;
                        if (typeof roomId !== 'undefined' && roomName) {
                            this.roomMap.set(String(roomId), String(roomName));
                        }
                    });
                }
                // Type 300 payload has: { name, comps, devices, ... }
                if (payload && payload.devices) {
                    const list = Array.isArray(payload.devices)
                        ? payload.devices
                        : Object.values(payload.devices);
                    list.forEach((device) => {
                        if (device && typeof device.deviceId !== 'undefined') {
                            this.applyRoomName(device);
                            this.deviceMap.set(String(device.deviceId), device);
                        }
                    });
                    this.devices = Array.from(this.deviceMap.values());
                    this.emit('devices_loaded', this.devices);
                }
                else if (payload && payload.items) {
                    // Fallback for other formats
                    if (Array.isArray(payload.items)) {
                        this.devices = payload.items.map((device) => {
                            this.applyRoomName(device);
                            return device;
                        });
                    }
                    else {
                        this.devices = Object.values(payload.items).map((device) => {
                            this.applyRoomName(device);
                            return device;
                        });
                    }
                    console.log(`Loaded ${this.devices.length} devices from payload.items.`);
                    console.log(`[Bridge] Emitting devices_loaded (${this.devices.length})`);
                    this.emit('devices_loaded', this.devices);
                }
                // If lastItem arrives without devices, emit the accumulated list
                if (payload && payload.lastItem === true && this.deviceMap.size > 0) {
                    this.devices = Array.from(this.deviceMap.values());
                    console.log(`[Bridge] Emitting devices_loaded on lastItem (${this.devices.length})`);
                    this.emit('devices_loaded', this.devices);
                }
                break;
            case MessageType.ERROR_INFO: // 295
                // APP_INFO per HA reference; treat as informational, not an error.
                console.log('Bridge App Info (295):', payload);
                this.emit('app_info', payload);
                break;
            case MessageType.SET_STATE_INFO: // 310
                if (payload && (payload.items || payload.item)) {
                    const rawList = payload.items || payload.item;
                    const updates = Array.isArray(rawList) ? rawList : Object.values(rawList);
                    for (const update of updates) {
                        // Try to extract deviceId from multiple possible keys
                        let deviceId = (_e = (_d = (_c = (_b = update.deviceId) !== null && _b !== void 0 ? _b : update.id) !== null && _c !== void 0 ? _c : update.identifier) !== null && _d !== void 0 ? _d : update.device_id) !== null && _e !== void 0 ? _e : update.deviceID;
                        // Manual deviceId mapping support (from settings/config)
                        if (typeof deviceId === 'undefined' && this.manualDeviceIdMap) {
                            const manualKey = `${update.compId || ''}_${update.roomId || ''}_${JSON.stringify(update.info)}`;
                            if (this.manualDeviceIdMap[manualKey]) {
                                deviceId = this.manualDeviceIdMap[manualKey];
                                update.deviceId = deviceId;
                                console.warn('[Bridge] Used manual deviceId mapping for SET_STATE_INFO:', deviceId);
                            }
                        }
                        if (typeof deviceId === 'undefined') {
                            // Try to infer deviceId from known devices by matching roomId, compId, info (composite key)
                            let possibleDevices = this.devices.filter((dev) => {
                                let match = true;
                                if (typeof update.compId !== 'undefined' && typeof dev.compId !== 'undefined') {
                                    match = match && (update.compId === dev.compId);
                                }
                                if (typeof update.roomId !== 'undefined' && typeof dev.roomId !== 'undefined') {
                                    match = match && (update.roomId === dev.roomId);
                                }
                                if (Array.isArray(update.info) && Array.isArray(dev.info)) {
                                    let infoMatch = false;
                                    for (const uInfo of update.info) {
                                        for (const dInfo of dev.info) {
                                            if (uInfo.text && dInfo.text && uInfo.text === dInfo.text)
                                                infoMatch = true;
                                            if (uInfo.value && dInfo.value && uInfo.value === dInfo.value)
                                                infoMatch = true;
                                        }
                                    }
                                    match = match && infoMatch;
                                }
                                return match;
                            });
                            // Detailed logging for ambiguous matches
                            if (possibleDevices.length > 1) {
                                console.warn('[Bridge] Ambiguous deviceId inference for SET_STATE_INFO; multiple devices match. Skipping update.', {
                                    update,
                                    matches: possibleDevices.map(d => ({
                                        deviceId: d.deviceId,
                                        compId: d.compId,
                                        roomId: d.roomId,
                                        info: d.info
                                    }))
                                });
                                continue; // Skip ambiguous update
                            }
                            // Fallback logic: best-effort matching
                            if (possibleDevices.length === 1 && possibleDevices[0].deviceId) {
                                deviceId = possibleDevices[0].deviceId;
                                update.deviceId = deviceId;
                                console.warn('[Bridge] Inferred deviceId from composite key for SET_STATE_INFO:', deviceId);
                            }
                            else if (possibleDevices.length === 0) {
                                // Try fallback: match by compId only
                                let fallbackDevice = this.devices.find((dev) => typeof update.compId !== 'undefined' && typeof dev.compId !== 'undefined' && update.compId === dev.compId);
                                if (fallbackDevice && fallbackDevice.deviceId) {
                                    deviceId = fallbackDevice.deviceId;
                                    update.deviceId = deviceId;
                                    console.warn('[Bridge] Fallback: matched deviceId by compId only for SET_STATE_INFO:', deviceId);
                                }
                            }
                        }
                        if (typeof deviceId !== 'undefined') {
                            this.emit('deviceUpdate', { deviceId, state: update });
                            this.emit('state_update', [update]);
                            console.log(`[Bridge] Emitted deviceUpdate and state_update for deviceId=${deviceId}`);
                        }
                        else {
                            console.warn('[Bridge] SET_STATE_INFO update missing deviceId and could not infer. Full update:', update);
                        }
                    }
                }
                break;
            case MessageType.SET_BRIDGE_STATE: // 364
                // Intentionally silent to avoid log spam
                this.emit('bridge_state', payload);
                break;
            case MessageType.ACK: // 1
                // Bridge ACK for our messages
                break;
            case MessageType.HEARTBEAT: // 2
                // ACK is already handled via the generic mc handler above.
                break;
            default:
                console.log(`Unhandled Message Type: ${type}`);
                break;
        }
    }
    getDevices() {
        console.log(`[Bridge] getDevices returning ${this.devices.length} devices`);
        return this.devices;
    }
    getRooms() {
        return this.roomMap;
    }
    isAuthenticated() {
        return this.state === BridgeState.AUTHENTICATED;
    }
    requestDevicesAfterAuth() {
        // Request devices/rooms after full authentication (token flow complete)
        console.log('Authenticated! Requesting device and room data...');
        setTimeout(() => {
            this.sendMessage(MessageType.REQUEST_DEVICES, {});
            this.sendMessage(MessageType.REQUEST_ROOMS, {});
        }, 300);
    }
    fetchDevices() {
        console.log('Fetching devices (Type 240)...');
        console.log(`Current state: ${this.state}`);
        console.log(`Connection ID: ${this.connectionId}`);
        console.log(`Bridge Device ID: ${this.bridgeDeviceId}`);
        if (this.secureChannelId !== null) {
            console.log(`Secure Channel ID: ${this.secureChannelId}`);
        }
        // Send Type 240 with empty payload per reference implementation
        const pkg = {
            type_int: MessageType.REQUEST_DEVICES,
            mc: this.nextMc(),
            payload: {},
        };
        const jsonStr = JSON.stringify(pkg);
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            console.error('Cannot send Type 240: socket not open');
            return;
        }
        if (this.state === BridgeState.SECURE_SESSION || this.state === BridgeState.AUTHENTICATING || this.state === BridgeState.AUTHENTICATED) {
            try {
                const encrypted = Encryption_1.Encryption.encryptMessage(jsonStr, this.aesKey, this.aesIv);
                this.socket.send(encrypted);
                console.log('Sent Type 240 (encrypted)');
            }
            catch (err) {
            }
        }
        else {
            console.log(`TX 240 (plain): ${jsonStr}`);
            this.socket.send(jsonStr);
        }
    }
    startSecureHandshake() {
        console.log('Sending SC_INIT (14)...');
        this.sendMessage(MessageType.SC_INIT, {});
        this.state = BridgeState.SECURE_INIT_SENT;
    }
    handlePublicKey(payload) {
        if (!payload.public_key || !payload.device_id) {
            console.error('Invalid Type 15 payload:', payload);
            return;
        }
        const bridgePublicKey = payload.public_key;
        // Ensure it is a String to prevent "Instance of Object" error in crypto
        // Also trim any whitespace
        const publicKeyPem = String(bridgePublicKey).trim();
        console.log(`Encrypting keys with Bridge Public Key...`);
        try {
            const encryptedKeys = Encryption_1.Encryption.encryptSessionKeys(this.aesKey, this.aesIv, publicKeyPem);
            console.log('Sending SC_CLIENT_KEY (16)...');
            // FIX: Payload must be an OBJECT with 'secret' property containing Base64 string.
            // Reference implementations use "secret" key.
            this.sendMessage(MessageType.SC_CLIENT_KEY, { secret: encryptedKeys.toString('base64') });
            this.state = BridgeState.KEY_EXCHANGE_SENT;
        }
        catch (error) {
            console.error('Encryption failed:', error);
            console.error('Error Stack:', error.stack);
            this.disconnect();
        }
    }
    login() {
        console.log('Sending Login (30)...');
        if (!this.bridgeDeviceId) {
            console.error('Cannot login: Bridge Device ID not received in HELLO packet.');
            // Optionally try using user's deviceId if that was intended, but 'ehsky' uses bridge's ID
            // this.bridgeDeviceId = this.deviceId;
            return;
        }
        const salt = Encryption_1.Encryption.generateSalt();
        const hashedPassword = Encryption_1.Encryption.calculateAuthHash(this.bridgeDeviceId, this.authKey, salt);
        this.sendMessage(MessageType.LOGIN, {
            username: 'default',
            password: hashedPassword,
            salt: salt
        });
        this.state = BridgeState.AUTHENTICATING;
    }
    retryLoginOrFail() {
        this.loginAttempts += 1;
        if (this.loginAttempts > 2) {
            console.error('[Auth] Login failed: bridge did not provide a token. Check auth key.');
            this.state = BridgeState.DISCONNECTED;
            this.emit('auth_failed');
            this.disconnect();
            return;
        }
        setTimeout(() => this.login(), 300);
    }
    sendMessage(type, payload, refMc) {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            console.error(`Cannot send message: Socket not open (state: ${this.state})`);
            return;
        }
        const pkg = {
            type_int: type,
            mc: this.nextMc(),
            payload: payload
        };
        // For ACK messages, use 'ref' instead of 'mc' to reference the original message
        if (type === MessageType.ACK && refMc !== undefined) {
            pkg.ref = refMc;
            delete pkg.mc;
            delete pkg.payload;
        }
        const jsonStr = JSON.stringify(pkg);
        this.lastActivityAt = Date.now();
        // Encrypt if we are in a Secure Session
        if (this.state === BridgeState.SECURE_SESSION ||
            this.state === BridgeState.AUTHENTICATING ||
            this.state === BridgeState.AUTHENTICATED) {
            try {
                const encrypted = Encryption_1.Encryption.encryptMessage(jsonStr, this.aesKey, this.aesIv);
                this.socket.send(encrypted);
                if (type !== MessageType.ACK && type !== MessageType.HEARTBEAT) {
                    console.log(`Sent Type ${type} (encrypted) in state ${this.state}`);
                }
            }
            catch (err) {
                console.error('Failed to encrypt message:', err);
            }
        }
        else {
            console.log(`TX (${type}): ${jsonStr}`);
            this.socket.send(jsonStr);
        }
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
                // Transport-level ping
                this.socket.ping();
                // Protocol-level heartbeat when authenticated
                if (this.state === BridgeState.AUTHENTICATED) {
                    const now = Date.now();
                    const sinceLast = now - this.lastProtocolHeartbeatAt;
                    if (sinceLast > 20000) {
                        this.sendMessage(MessageType.HEARTBEAT, {});
                        this.lastProtocolHeartbeatAt = now;
                    }
                }
            }
        }, 10000);
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    disconnect() {
        this.state = BridgeState.DISCONNECTED;
        this.manualDisconnect = true;
        this.clearReconnectTimer();
        if (this.socket) {
            this.socket.terminate();
            this.socket = null;
        }
        this.emit('error', new Error('Bridge disconnected'));
    }
    scheduleReconnect() {
        if (this.manualDisconnect)
            return;
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts += 1;
        const delay = this.reconnectDelayMs;
        console.log(`[Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.emit('reconnecting');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    // Driver Interface Methods
    async switchDevice(deviceId, value, onSend) {
        try {
            const numericSwitch = value ? 1 : 0;
            const sendTime = Date.now();
            console.log(`[Bridge] Switching device ${deviceId} to ${numericSwitch} at ${sendTime}`);
            this.sendMessage(MessageType.ACTION_SWITCH_DEVICE, {
                deviceId: deviceId, // xComfort accepts ID as is
                switch: numericSwitch
            });
            if (onSend)
                onSend(sendTime);
        }
        catch (err) {
            console.error(`[Bridge] Error in switchDevice:`, err);
        }
    }
    async dimDevice(deviceId, value, onSend) {
        // Value coming from Homey is 0-100? Or 0-1?
        // User requested pattern for dimDevice.
        if (value <= 0) {
            await this.switchDevice(deviceId, false, onSend);
            return;
        }
        // Accept 0-1 or 0-99 input
        const scaled = value <= 1 ? Math.round(value * 99) : Math.round(value);
        const dimVal = Math.max(1, Math.min(99, scaled));
        const sendTime = Date.now();
        console.log(`[Bridge] Dimming device ${deviceId} to ${dimVal} at ${sendTime}`);
        this.sendMessage(MessageType.ACTION_SLIDE_DEVICE, {
            deviceId: deviceId,
            dimmvalue: dimVal
        });
        if (onSend)
            onSend(sendTime);
    }
    applyRoomName(device) {
        var _a, _b, _c;
        if (!device || device.roomName)
            return;
        const roomId = (_c = (_b = (_a = device.roomId) !== null && _a !== void 0 ? _a : device.room_id) !== null && _b !== void 0 ? _b : device.room) !== null && _c !== void 0 ? _c : device.roomID;
        if (typeof roomId === 'undefined')
            return;
        const roomName = this.roomMap.get(String(roomId));
        if (roomName) {
            device.roomName = roomName;
        }
    }
}
exports.XComfortBridge = XComfortBridge;
