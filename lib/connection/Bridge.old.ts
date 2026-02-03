import { EventEmitter } from 'events';
import WebSocket from 'ws';
import * as crypto from 'crypto';
import { Encryption } from '../crypto/Encryption';

enum BridgeState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  WAITING_FOR_HELLO = 'WAITING_FOR_HELLO',
  CONNECTED_UNSECURE = 'CONNECTED_UNSECURE',
  SECURE_INIT_SENT = 'SECURE_INIT_SENT',
  KEY_EXCHANGE_SENT = 'KEY_EXCHANGE_SENT',
  SECURE_SESSION = 'SECURE_SESSION',
  AUTHENTICATING = 'AUTHENTICATING',
  AUTHENTICATED = 'AUTHENTICATED'
}

enum MessageType {
  ACK = 1,
  HEARTBEAT = 2,
  HELLO = 10,
  HELLO_CONFIRM = 11,
  CONNECTION_ESTABLISHED = 12,
  CONNECTION_DECLINED = 13,
  SC_INIT = 14,
  SC_PUBLIC_KEY = 15,
  SC_CLIENT_KEY = 16,
  SC_ACK = 17,
  LOGIN = 30, // SC_LOGIN
  LOGIN_OK = 31,
  LOGIN_RESPONSE = 32, // SC_LOGIN_RESPONSE with token
  TOKEN_APPLY = 33,
  TOKEN_APPLY_ACK = 34,
  TOKEN_RENEW = 37,
  TOKEN_RENEW_RESPONSE = 38,
  ERROR_INFO = 295,
  ITEM_UPDATE = 20,
  REQUEST_DEVICES = 240,
  REQUEST_ROOMS = 242,
  ACTION_SLIDE_DEVICE = 280,
  ACTION_SWITCH_DEVICE = 281,
  SET_ALL_DATA = 300,
  SET_HOME_DATA = 303,
  SET_STATE_INFO = 310
  ,SET_BRIDGE_STATE = 364
}

export class XComfortBridge extends EventEmitter {
  private ip: string;
  private authKey: string;
  private deviceId: string;
  private socket: WebSocket | null = null;
  private state: BridgeState = BridgeState.DISCONNECTED;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  private aesKey: Buffer;
  public devices: any[] = [];
  private aesIv: Buffer;
  private bridgeDeviceId: string = '';
    // Manual deviceId mapping for ambiguous SET_STATE_INFO
    public manualDeviceIdMap: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private serverSalt: string = '';
  private mcCounter: number = 1;
  private secureChannelId: number | null = null;
  private token: string | null = null;
  private isRenewing: boolean = false;
  private deviceMap: Map<string, any> = new Map();
  private roomMap: Map<string, string> = new Map();
  private loginAttempts: number = 0;
  private lastActivityAt: number = Date.now();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private reconnectDelayMs: number = 5000;
  private manualDisconnect: boolean = false;
  private lastProtocolHeartbeatAt: number = 0;
  private lastSwitchAt: Map<string, number> = new Map();
  private debugTraffic: boolean = false;

  constructor(ip: string, authKey: string, deviceId: string) {
    super();
    this.ip = ip;
    this.authKey = authKey.trim();
    this.deviceId = deviceId;
    
    // Generate fresh session keys for this connection
    this.aesKey = crypto.randomBytes(32); // 256 bits
    this.aesIv = crypto.randomBytes(16);  // 128 bits
    this.mcCounter = 1; // Start mc at 1 for deterministic handshake
  }

  private nextMc(): number {
      const val = this.mcCounter++;
      if (this.mcCounter > 65535) this.mcCounter = 1;
      return val;
  }

  public connect() {
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
    
    this.socket = new WebSocket(`ws://${this.ip}`, {
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

    this.socket.on('message', (data: Buffer) => {
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

  private handleRawMessage(buffer: Buffer) {
    try {
      const rawString = buffer.toString('utf8');

      // 1. Split by End-of-Transmission (\u0004) and Null (\x00) characters
      // eslint-disable-next-line no-control-regex
      const parts = rawString.split(/[\u0004\x00]/);

      for (let msgString of parts) {
        msgString = msgString.trim();
        
        if (!msgString) continue;

        if (this.debugTraffic) {
          // Debug raw (truncated)
          if (msgString.length < 500) {
            console.log(`RX Raw: ${msgString}`);
          } else {
            console.log(`RX Raw: ${msgString.substring(0, 100)}...`);
          }
        }

        try {
            const msg = JSON.parse(msgString);
            this.handleProtocolMessage(msg);
        } catch (parseError) {
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
               } catch (e) {
                   // Double fail
               }
            }
            console.error('Error parsing message part:', parseError);
        }
      }

    } catch (err) {
      console.error('Error parsing inbound message:', err);
    }
  }

  private handleEncryptedMessage(base64: string) {
      if (!this.aesKey || !this.aesIv) {
          console.error('Cannot decrypt message: No session keys available.');
          return;
      }
      
      try {
          const decrypted = Encryption.decryptMessage(base64, this.aesKey, this.aesIv);
          if (this.debugTraffic) {
            console.log(`Decrypted: ${decrypted}`);
          }
          
          try {
              const msg = JSON.parse(decrypted);
              this.handleProtocolMessage(msg);
          } catch (e) {
              console.error('Decrypted message is not valid JSON:', decrypted);
          }
      } catch (err) {
          console.error('Failed to decrypt message. Keys correct?', err);
      }
  }

  private connectionId: string = '';

  private handleProtocolMessage(msg: any) {
    if (!msg || typeof msg.type_int === 'undefined') return;

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
            client_id: 'c956e43f999f8004',  // Fixed client ID from reference
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
             if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                 this.startSecureHandshake();
             }
        }, 100);
        break;

      case MessageType.CONNECTION_DECLINED: // 13
        console.error('Got Connection Declined (13). Closing connection.');
        console.error('Payload:', JSON.stringify(payload, null, 2));
        this.socket?.close();
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
        } else {
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
        } else {
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

             rooms.forEach((room: any) => {
               if (!room) return;
               const roomId = room.roomId ?? room.id ?? room.room_id ?? room.identifier;
               const roomName = room.name ?? room.label ?? room.title;
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

             list.forEach((device: any) => {
               if (device && typeof device.deviceId !== 'undefined') {
                 this.applyRoomName(device);
                 this.deviceMap.set(String(device.deviceId), device);
               }
             });

             this.devices = Array.from(this.deviceMap.values());
             this.emit('devices_loaded', this.devices);
         } else if (payload && payload.items) {
             // Fallback for other formats
             if (Array.isArray(payload.items)) {
                 this.devices = payload.items.map((device: any) => {
                   this.applyRoomName(device);
                   return device;
                 });
             } else {
                 this.devices = Object.values(payload.items).map((device: any) => {
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
                 let deviceId = update.deviceId ?? update.id ?? update.identifier ?? update.device_id ?? update.deviceID;

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
                   let possibleDevices = this.devices.filter((dev: any) => {
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
                           if (uInfo.text && dInfo.text && uInfo.text === dInfo.text) infoMatch = true;
                           if (uInfo.value && dInfo.value && uInfo.value === dInfo.value) infoMatch = true;
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
                   } else if (possibleDevices.length === 0) {
                     // Try fallback: match by compId only
                     let fallbackDevice = this.devices.find((dev: any) => typeof update.compId !== 'undefined' && typeof dev.compId !== 'undefined' && update.compId === dev.compId);
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
                 } else {
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

  public getDevices() {
      console.log(`[Bridge] getDevices returning ${this.devices.length} devices`);
      return this.devices;
  }

    public getRooms() {
      return this.roomMap;
    }

  public isAuthenticated() {
      return this.state === BridgeState.AUTHENTICATED;
  }

  private requestDevicesAfterAuth() {
      // Request devices/rooms after full authentication (token flow complete)
      console.log('Authenticated! Requesting device and room data...');
      setTimeout(() => {
        this.sendMessage(MessageType.REQUEST_DEVICES, {});
        this.sendMessage(MessageType.REQUEST_ROOMS, {});
      }, 300);
  }

  private fetchDevices() {
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

      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.error('Cannot send Type 240: socket not open');
        return;
      }

      if (this.state === BridgeState.SECURE_SESSION || this.state === BridgeState.AUTHENTICATING || this.state === BridgeState.AUTHENTICATED) {
        try {
          const encrypted = Encryption.encryptMessage(jsonStr, this.aesKey, this.aesIv);
          this.socket.send(encrypted);
          console.log('Sent Type 240 (encrypted)');
        } catch (err) {
        }
      } else {
        console.log(`TX 240 (plain): ${jsonStr}`);
        this.socket.send(jsonStr);
      }
  }

  private startSecureHandshake() {
    console.log('Sending SC_INIT (14)...');
    this.sendMessage(MessageType.SC_INIT, {}); 
    this.state = BridgeState.SECURE_INIT_SENT;
  }

  private handlePublicKey(payload: any) {
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
      const encryptedKeys = Encryption.encryptSessionKeys(
        this.aesKey,
        this.aesIv,
        publicKeyPem
      );
      
      console.log('Sending SC_CLIENT_KEY (16)...');
      
      // FIX: Payload must be an OBJECT with 'secret' property containing Base64 string.
      // Reference implementations use "secret" key.
      this.sendMessage(MessageType.SC_CLIENT_KEY, { secret: encryptedKeys.toString('base64') });
      this.state = BridgeState.KEY_EXCHANGE_SENT;

    } catch (error: any) {
      console.error('Encryption failed:', error);
      console.error('Error Stack:', error.stack);
      this.disconnect();
    }
  }

  private login() {
    console.log('Sending Login (30)...');
    
    if (!this.bridgeDeviceId) {
        console.error('Cannot login: Bridge Device ID not received in HELLO packet.');
        // Optionally try using user's deviceId if that was intended, but 'ehsky' uses bridge's ID
        // this.bridgeDeviceId = this.deviceId;
        return;
    }

    const salt = Encryption.generateSalt();
    const hashedPassword = Encryption.calculateAuthHash(
        this.bridgeDeviceId,
        this.authKey,
        salt
    );

    this.sendMessage(MessageType.LOGIN, {
      username: 'default',
      password: hashedPassword,
      salt: salt
    });
    this.state = BridgeState.AUTHENTICATING;
  }

  private retryLoginOrFail() {
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

  public sendMessage(type: number, payload: any, refMc?: number) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error(`Cannot send message: Socket not open (state: ${this.state})`);
      return;
    }
    
    const pkg: any = {
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
            const encrypted = Encryption.encryptMessage(jsonStr, this.aesKey, this.aesIv);
            this.socket.send(encrypted);
            if (type !== MessageType.ACK && type !== MessageType.HEARTBEAT) {
              console.log(`Sent Type ${type} (encrypted) in state ${this.state}`);
            }
        } catch (err) {
            console.error('Failed to encrypt message:', err);
        }
    } else {
        console.log(`TX (${type}): ${jsonStr}`);
        this.socket.send(jsonStr);
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
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

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public disconnect() {
    this.state = BridgeState.DISCONNECTED;
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.terminate();
      this.socket = null;
    }
    this.emit('error', new Error('Bridge disconnected'));
  }

  private scheduleReconnect() {
    if (this.manualDisconnect) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = this.reconnectDelayMs;
    console.log(`[Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Driver Interface Methods
  public async switchDevice(deviceId: string | number, value: boolean, onSend?: (sendTime?: number) => void) {
    try {
      const numericSwitch = value ? 1 : 0;
      const sendTime = Date.now();
      console.log(`[Bridge] Switching device ${deviceId} to ${numericSwitch} at ${sendTime}`);
      this.sendMessage(MessageType.ACTION_SWITCH_DEVICE, {
          deviceId: deviceId, // xComfort accepts ID as is
          switch: numericSwitch
      });
      if (onSend) onSend(sendTime);
    } catch (err) {
      console.error(`[Bridge] Error in switchDevice:`, err);
    }
  }

  public async dimDevice(deviceId: string | number, value: number, onSend?: (sendTime?: number) => void) {
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
    this.sendMessage(MessageType.ACTION_SLIDE_DEVICE, { // 280
        deviceId: deviceId,
        dimmvalue: dimVal
    });
    if (onSend) onSend(sendTime);
  }

  private applyRoomName(device: any) {
    if (!device || device.roomName) return;
    const roomId = device.roomId ?? device.room_id ?? device.room ?? device.roomID;
    if (typeof roomId === 'undefined') return;
    const roomName = this.roomMap.get(String(roomId));
    if (roomName) {
      device.roomName = roomName;
    }
  }
}
