/**
 * Authenticator for xComfort Bridge
 *
 * Handles the multi-step authentication flow:
 * 1. Connection start/confirm
 * 2. Public key exchange
 * 3. Secret (AES keys) exchange
 * 4. Login with hashed credentials
 * 5. Token apply and renewal
 *
 * Extracted from XComfortConnection for single responsibility.
 */

import crypto from 'crypto';
import { MESSAGE_TYPES, CLIENT_CONFIG, PROTOCOL_CONFIG } from '../XComfortProtocol';
import { Encryption } from '../crypto/Encryption';
import type { ProtocolMessage, AuthState, EncryptionContext, LoggerFunction } from '../types';

// ============================================================================
// Module-specific Types (callbacks)
// ============================================================================

/** Callback for sending raw (unencrypted) messages */
type SendRawFn = (msg: string) => void;

/** Callback for sending encrypted messages */
type SendEncryptedFn = (msg: Record<string, unknown>) => boolean | Promise<boolean>;

/** Callback when authentication completes */
type OnAuthenticatedFn = () => void;

/** Message counter getter */
type GetMcFn = () => number;

// ============================================================================
// Authenticator Class
// ============================================================================

export class Authenticator {
  private authKey: string;
  private logger: LoggerFunction;
  private deviceId: string | null = null;
  private connectionId: string | null = null;
  private publicKey: string | null = null;
  private encryptionContext: EncryptionContext | null = null;
  private token: string | null = null;
  private state: AuthState = 'idle';
  private isRenewing: boolean = false;

  private sendRaw: SendRawFn;
  private sendEncrypted: SendEncryptedFn;
  private getMc: GetMcFn;
  private onAuthenticated?: OnAuthenticatedFn;

  constructor(
    authKey: string,
    sendRaw: SendRawFn,
    sendEncrypted: SendEncryptedFn,
    getMc: GetMcFn,
    logger?: LoggerFunction
  ) {
    this.authKey = authKey;
    this.sendRaw = sendRaw;
    this.sendEncrypted = sendEncrypted;
    this.getMc = getMc;
    this.logger = logger || console.log;
  }

  /**
   * Set callback for when authentication completes
   */
  setOnAuthenticated(callback: OnAuthenticatedFn): void {
    this.onAuthenticated = callback;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.state === 'authenticated';
  }

  /**
   * Get the encryption context (key and IV)
   */
  getEncryptionContext(): EncryptionContext | null {
    return this.encryptionContext;
  }

  /**
   * Reset authentication state
   */
  reset(): void {
    this.deviceId = null;
    this.connectionId = null;
    this.publicKey = null;
    this.encryptionContext = null;
    this.token = null;
    this.state = 'idle';
    this.isRenewing = false;
  }

  /**
   * Handle unencrypted handshake messages
   * Returns true if the message was handled
   */
  handleUnencryptedMessage(msg: ProtocolMessage): boolean {
    if (msg.type_int === MESSAGE_TYPES.CONNECTION_START) {
      const payload = this.getPayloadObject(msg);
      const deviceId = this.getStringField(payload, 'device_id');
      const connectionId = this.getStringField(payload, 'connection_id');
      if (!deviceId || !connectionId) {
        this.logger('[Authenticator] Ignoring malformed CONNECTION_START payload');
        return true;
      }

      this.deviceId = deviceId;
      this.connectionId = connectionId;
      this.state = 'awaiting_public_key';
      this.logger(
        `[Authenticator] CONNECTION_START received. deviceId=${this.deviceId}`
      );

      const confirmMsg = {
        type_int: MESSAGE_TYPES.CONNECTION_CONFIRM,
        mc: this.getMc(),
        payload: {
          client_type: CLIENT_CONFIG.TYPE,
          client_id: CLIENT_CONFIG.ID,
          client_version: CLIENT_CONFIG.VERSION,
          connection_id: this.connectionId,
        },
      };
      this.sendRaw(JSON.stringify(confirmMsg));
      this.logger('[Authenticator] Sent CONNECTION_CONFIRM');
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SC_INIT_RESPONSE) {
      const initMsg = { type_int: MESSAGE_TYPES.SC_INIT_REQUEST, mc: this.getMc() };
      this.sendRaw(JSON.stringify(initMsg));
      this.logger('[Authenticator] Sent SC_INIT');
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SC_INIT_REQUEST) {
      const initMsg = { type_int: MESSAGE_TYPES.SC_INIT_REQUEST, mc: this.getMc() };
      this.sendRaw(JSON.stringify(initMsg));
      this.logger('[Authenticator] Requested public key');
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.PUBLIC_KEY_RESPONSE) {
      const payload = this.getPayloadObject(msg);
      const publicKey = this.getStringField(payload, 'public_key');
      if (!publicKey) {
        this.logger('[Authenticator] Ignoring malformed PUBLIC_KEY_RESPONSE payload');
        return true;
      }

      this.publicKey = publicKey;
      this.logger('[Authenticator] Received public key');

      // Generate AES key and IV
      this.encryptionContext = {
        key: crypto.randomBytes(PROTOCOL_CONFIG.ENCRYPTION.KEY_SIZE),
        iv: crypto.randomBytes(PROTOCOL_CONFIG.ENCRYPTION.IV_SIZE),
      };

      const encrypted = Encryption.encryptSessionKeys(
        this.encryptionContext.key,
        this.encryptionContext.iv,
        this.publicKey
      );
      const secret = encrypted.toString('base64');

      const secretMsg = {
        type_int: MESSAGE_TYPES.SECRET_EXCHANGE,
        mc: this.getMc(),
        payload: { secret },
      };
      this.sendRaw(JSON.stringify(secretMsg));
      this.state = 'awaiting_secret_ack';
      this.logger('[Authenticator] Sent encrypted AES keys');
      return true;
    }

    return false;
  }

  /**
   * Handle encrypted authentication messages
   * Returns true if the message was handled
   */
  handleEncryptedMessage(msg: ProtocolMessage): boolean {
    if (msg.type_int === MESSAGE_TYPES.SECRET_EXCHANGE_ACK) {
      if (!this.deviceId) {
        this.logger('[Authenticator] SECRET_EXCHANGE_ACK received before device_id was set');
        return true;
      }

      const salt = Encryption.generateSalt(PROTOCOL_CONFIG.LIMITS.SALT_LENGTH);
      const password = Encryption.calculateAuthHash(this.deviceId, this.authKey, salt);

      const loginMsg = {
        type_int: MESSAGE_TYPES.LOGIN_REQUEST,
        mc: this.getMc(),
        payload: {
          username: 'default',
          password: password,
          salt: salt,
        },
      };
      this.sendEncrypted(loginMsg);
      this.state = 'awaiting_login_response';
      this.logger('[Authenticator] Sent login');
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.LOGIN_RESPONSE) {
      const payload = this.getPayloadObject(msg);
      const token = this.getStringField(payload, 'token');
      if (!token) {
        this.logger('[Authenticator] Ignoring malformed LOGIN_RESPONSE payload');
        return true;
      }

      this.token = token;
      this.logger('[Authenticator] Login successful, received token');

      const applyTokenMsg = {
        type_int: MESSAGE_TYPES.TOKEN_APPLY,
        mc: this.getMc(),
        payload: { token: this.token },
      };
      this.sendEncrypted(applyTokenMsg);
      this.state = 'awaiting_token_apply';
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.TOKEN_APPLY_ACK) {
      if (!this.isRenewing) {
        if (!this.token) {
          this.logger('[Authenticator] TOKEN_APPLY_ACK received without token');
          return true;
        }

        this.logger('[Authenticator] Token applied, renewing token...');
        this.isRenewing = true;

        const renewTokenMsg = {
          type_int: MESSAGE_TYPES.TOKEN_RENEW,
          mc: this.getMc(),
          payload: { token: this.token },
        };
        this.sendEncrypted(renewTokenMsg);
        this.state = 'awaiting_token_renew';
      } else {
        this.logger('[Authenticator] Fully authenticated with renewed token!');
        this.state = 'authenticated';
        this.isRenewing = false;
        this.onAuthenticated?.();
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.TOKEN_RENEW_RESPONSE) {
      const payload = this.getPayloadObject(msg);
      const token = this.getStringField(payload, 'token');
      if (!token) {
        this.logger('[Authenticator] Ignoring malformed TOKEN_RENEW_RESPONSE payload');
        return true;
      }

      this.token = token;
      this.logger('[Authenticator] Token renewed, applying new token...');

      const applyNewTokenMsg = {
        type_int: MESSAGE_TYPES.TOKEN_APPLY,
        mc: this.getMc(),
        payload: { token: this.token },
      };
      this.sendEncrypted(applyNewTokenMsg);
      return true;
    }

    return false;
  }

  private getPayloadObject(msg: ProtocolMessage): Record<string, unknown> | null {
    if (!msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload)) {
      return null;
    }
    return msg.payload;
  }

  private getStringField(payload: Record<string, unknown> | null, key: string): string | null {
    const value = payload?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
