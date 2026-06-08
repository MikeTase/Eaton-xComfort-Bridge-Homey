/**
 * Connection Manager for xComfort Bridge
 *
 * Handles WebSocket lifecycle:
 * - Connection establishment
 * - Reconnection with backoff
 * - Heartbeat management
 * - Message sending/receiving
 *
 * Extracted from XComfortConnection for single responsibility.
 */

import WebSocket from 'ws';
import { PROTOCOL_CONFIG } from '../XComfortProtocol';
import { Semaphore } from '../utils/Semaphore';
import { Encryption } from '../crypto/Encryption';
import type { EncryptionContext, LoggerFunction } from '../types';

// ============================================================================
// Retry Configuration
// ============================================================================

interface RetryConfig {
  maxRetries: number;
  ackTimeout: number; // ms to wait for ACK before retry
  retryDelay: number; // ms between retries
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 0,
  ackTimeout: 10000,
  retryDelay: 600,
};

// ============================================================================
// Module-specific Types (callbacks)
// ============================================================================

/** Callback for raw message received */
type OnRawMessageFn = (data: Buffer, timestamp: number) => void;

/** Callback for connection close */
type OnCloseFn = (code: number, reason: string, shouldReconnect: boolean) => void;

// ============================================================================
// ConnectionManager Class
// ============================================================================

export class ConnectionManager {
  private bridgeIp: string;
  private ws: WebSocket | null = null;
  private logger: LoggerFunction;
  private encryptionContext: EncryptionContext | null = null;
  private connectionEstablished: boolean = false;
  private reconnecting: boolean = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatSend?: () => void;
  private lastMessageAt: number = Date.now();
  private mc: number = 0;
  private connectResolve?: () => void;

  private onRawMessage?: OnRawMessageFn;
  private onClose?: OnCloseFn;

  private base64regex: RegExp = /^[A-Za-z0-9+/=]+$/;

  // Retry mechanism: Map of mc -> resolve function for pending ACKs
  private pendingAcks: Map<number, (acked: boolean, aborted?: boolean) => void> = new Map();
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;
  private txSemaphore = new Semaphore(1);

  // Outbound command pacing. The xComfort bridge NACKs and abnormally drops
  // (1006) the connection when hit with a burst of commands (e.g. an "all
  // lights off" scene). We keep commands ACK-serialized and do not add a fixed
  // clean-path delay; the next command is sent as soon as the previous one ACKs.
  // A NACK or timeout applies a separate cooldown before the next command.
  private lastSendAt: number = 0;
  private bridgeBackoffUntil: number = 0;
  private readonly MIN_SEND_GAP_MS = 0;
  private readonly NACK_BACKOFF_MS = 2500;
  private readonly SLOW_ACK_LOG_MS = 1000;

  constructor(bridgeIp: string, logger?: LoggerFunction) {
    this.bridgeIp = bridgeIp;
    this.logger = logger || console.log;
  }

  /**
   * Set callback for raw messages
   */
  setOnRawMessage(callback: OnRawMessageFn): void {
    this.onRawMessage = callback;
  }

  /**
   * Set callback for connection close
   */
  setOnClose(callback: OnCloseFn): void {
    this.onClose = callback;
  }

  /**
   * Set encryption context after key exchange
   */
  setEncryptionContext(context: EncryptionContext): void {
    this.encryptionContext = context;
  }

  /**
   * Check if connected and ready
   */
  isConnected(): boolean {
    return !!(
      this.encryptionContext &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Reconnecting status
   */
  isReconnecting(): boolean {
      return this.reconnecting;
  }

  setReconnecting(value: boolean): void {
      this.reconnecting = value;
  }

  /**
   * Mark connection as established (for reconnection logic)
   */
  markEstablished(): void {
    this.connectionEstablished = true;
    this.resolveConnection();
  }

  /**
   * Start 30s heartbeat loop to keep connection alive
   */
  public startHeartbeat(sendHeartbeat: () => void): void {
    this.stopHeartbeat();
    this.heartbeatSend = sendHeartbeat;
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        sendHeartbeat();
      }
    }, PROTOCOL_CONFIG.TIMEOUTS.HEARTBEAT);
  }

  /**
   * Stop heartbeat loop
   */
  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }
  }

  public isHeartbeatRunning(): boolean {
    return this.heartbeatInterval !== null;
  }

  public restartHeartbeat(): void {
    if (this.heartbeatSend) {
      this.startHeartbeat(this.heartbeatSend);
    }
  }

  public markMessageReceived(ts: number = Date.now()): void {
    this.lastMessageAt = ts;
  }

  public getLastMessageAt(): number {
    return this.lastMessageAt;
  }

  /**
   * Get next message counter value
   */
  nextMc(): number {
    return ++this.mc;
  }

  /**
   * Clear all pending ACKs with failure
   */
  private clearPendingAcks(): void {
    if (this.pendingAcks.size > 0) {
      this.logger(`[ConnectionManager] Clearing ${this.pendingAcks.size} pending ACKs due to disconnect`);
      for (const [_mc, resolve] of this.pendingAcks) {
        resolve(false, true);
      }
      this.pendingAcks.clear();
    }
  }

  /**
   * Reset message counter
   */
  resetMc(): void {
    this.mc = 0;
  }

  /**
   * Connect to the bridge
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Guard against double-settling: 'open' may be followed by 'error',
      // or 'error' by 'close', and the auth flow may resolve concurrently.
      let settled = false;
      const safeResolve = () => {
        if (settled) return;
        settled = true;
        this.connectResolve = undefined;
        resolve();
      };
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        this.connectResolve = undefined;
        reject(err);
      };

      try {
        this.connectionEstablished = false;

        this.ws = new WebSocket(`ws://${this.bridgeIp}`, {
          perMessageDeflate: false,
        });

        this.ws.on('open', () => {
          this.logger('[ConnectionManager] WebSocket connected, awaiting handshake...');

          // Set TCP_NODELAY
          // Type assertion to access private socket property safely
          const socket = (this.ws as unknown as { _socket?: { setNoDelay: (v: boolean) => void } })._socket;
          if (socket) {
            socket.setNoDelay(true);
          }
        });

      this.ws.on('message', (data: Buffer) => {
        const rawRecvTime = Date.now();
        this.markMessageReceived(rawRecvTime);
        this.onRawMessage?.(data, rawRecvTime);
      });

        this.ws.on('error', (err: Error) => {
          this.logger(`[ConnectionManager] WebSocket error: ${err.message}`);
          safeReject(err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          const reasonStr = reason.toString() || 'No reason';
          this.logger(
            `[ConnectionManager] Connection closed. Code: ${code}, Reason: ${reasonStr}`
          );

          // Mark connection as lost so retries can detect it
          this.encryptionContext = null;

          // Clear any pending ACKs immediately as they will never arrive
          this.clearPendingAcks();

          const wasEstablished = this.connectionEstablished;
          const shouldReconnect = wasEstablished && !this.reconnecting;

          // If the connection promise hasn't been settled yet, reject it now —
          // the caller is still waiting for the handshake.
          safeReject(new Error(`WebSocket closed before handshake (${code})`));

          this.onClose?.(code, reasonStr, shouldReconnect);
        });

        // Resolve is called externally when auth completes
        this.connectResolve = safeResolve;

      } catch (error) {
        safeReject(error as Error);
      }
    });
  }

  /**
   * Resolve the connection promise (called when auth completes)
   */
  resolveConnection(): void {
    if (this.connectResolve) {
      this.connectResolve();
      this.connectResolve = undefined;
    }
  }

  /**
   * Send raw (unencrypted) message
   */
  sendRaw(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger('[ConnectionManager] Cannot send - WebSocket not open');
      return;
    }
    this.ws.send(data);
  }

  /**
   * Send encrypted message
   */
  async sendEncrypted(msg: Record<string, unknown>): Promise<boolean> {
    if (!this.encryptionContext) {
      this.logger('[ConnectionManager] Cannot send encrypted - no context');
      return false;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger('[ConnectionManager] Cannot send encrypted - socket closed');
      return false;
    }

    try {
      const payloadStr = JSON.stringify(msg);

      const encrypted = Encryption.encryptMessage(
        payloadStr,
        this.encryptionContext.key,
        this.encryptionContext.iv
      );

      this.ws.send(encrypted);
      return true;
    } catch (error) {
      this.logger(`[ConnectionManager] Encryption error: ${error}`);
      return false;
    }
  }

  /**
   * Decrypt message
   */
  decryptMessage(encryptedBase64: string): string {
    if (!this.encryptionContext) {
      throw new Error('No encryption context available');
    }

    try {
      return Encryption.decryptMessage(
        encryptedBase64,
        this.encryptionContext.key,
        this.encryptionContext.iv
      );
    } catch (error) {
      throw new Error(`Decryption failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if message looks encrypted (Base64)
   * Requires minimum length to avoid false positives on short alphanumeric strings
   */
  isEncrypted(data: string): boolean {
    const trimmed = data.trim();
    return trimmed.length >= 24 && this.base64regex.test(trimmed);
  }

  private describeMessageTarget(msg: { [key: string]: unknown }): string {
    const payload = msg.payload;
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const record = payload as Record<string, unknown>;
    for (const key of ['deviceId', 'roomId', 'sceneId']) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return ` ${key}=${String(value)}`;
      }
    }

    return '';
  }

  /**
   * Send message with retry and ACK wait.
   *
   * The bridge accepts command bursts poorly: many in-flight DEVICE_SWITCH
   * commands lead to NACKs and abnormal 1006 disconnects. Keep only one
   * ACK-waiting command active at a time; after a NACK or timeout, apply a
   * short shared cooldown before the next queued command.
   */
  async sendWithRetry(msg: { mc: number; [key: string]: unknown }): Promise<boolean> {
    const mc = msg.mc;
    const typeStr = typeof msg.type_int === 'number' ? ` type=${msg.type_int}` : '';
    const targetStr = this.describeMessageTarget(msg);

    return new Promise((resolve, reject) => {
      let retries = 0;
      let ackTimeoutTimer: NodeJS.Timeout | null = null;
      let retryTimer: NodeJS.Timeout | null = null;
      let releaseSemaphore: (() => void) | null = null;
      let settled = false;
      let lastAttemptSentAt = 0;

      const cleanup = () => {
        if (ackTimeoutTimer) clearTimeout(ackTimeoutTimer);
        if (retryTimer) clearTimeout(retryTimer);
        this.pendingAcks.delete(mc);
        if (releaseSemaphore) {
          releaseSemaphore();
          releaseSemaphore = null;
        }
      };

      const finishResolve = (value: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const sendAttempt = async () => {
        if (settled) {
          return;
        }

        // Honor the bridge cooldown under the semaphore so queued commands do
        // not stampede immediately after a NACK/timeout.
        const sinceLast = Date.now() - this.lastSendAt;
        const gapWait = sinceLast < this.MIN_SEND_GAP_MS ? this.MIN_SEND_GAP_MS - sinceLast : 0;
        const backoffWait = Math.max(0, this.bridgeBackoffUntil - Date.now());
        const waitMs = Math.max(gapWait, backoffWait);
        if (waitMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }

        if (settled) {
          return;
        }

        if (!this.isConnected()) {
          finishReject(new Error('Connection lost'));
          return;
        }

        lastAttemptSentAt = Date.now();
        const success = await this.sendEncrypted(msg);
        this.lastSendAt = Date.now();

        if (settled) {
          return;
        }
        if (!success) {
          handleFailure();
          return;
        }

        // Wait for ACK (concurrent across commands, keyed by mc)
        this.pendingAcks.set(mc, (acked, aborted) => {
          if (settled) {
            return;
          }
          if (aborted) {
            finishReject(new Error('Connection lost'));
            return;
          }
          if (acked) {
            const ackMs = Date.now() - lastAttemptSentAt;
            if (ackMs >= this.SLOW_ACK_LOG_MS) {
              this.logger(`[ConnectionManager] Slow ACK for mc=${mc}${typeStr}${targetStr} after ${ackMs}ms`);
            }
            finishResolve(true);
          } else {
            if (ackTimeoutTimer) {
              clearTimeout(ackTimeoutTimer);
              ackTimeoutTimer = null;
            }
            this.pendingAcks.delete(mc);
            this.bridgeBackoffUntil = Date.now() + this.NACK_BACKOFF_MS;
            this.logger(`[ConnectionManager] NACK for mc=${mc}${typeStr}${targetStr}; cooling down ${this.NACK_BACKOFF_MS}ms without retry`);
            finishReject(new Error('Bridge rejected command'));
          }
        });

        if (ackTimeoutTimer) clearTimeout(ackTimeoutTimer);
        ackTimeoutTimer = setTimeout(() => {
          handleFailure();
        }, this.retryConfig.ackTimeout);
      };

      const handleFailure = () => {
         if (settled) {
            return;
         }
         // Guard: prevent double invocation from both NACK callback and ack timeout
         if (ackTimeoutTimer) {
            clearTimeout(ackTimeoutTimer);
            ackTimeoutTimer = null;
         }
         this.pendingAcks.delete(mc);

         if (retries < this.retryConfig.maxRetries) {
            retries++;
            this.logger(`[ConnectionManager] Retry ${retries}/${this.retryConfig.maxRetries} for mc=${mc}${typeStr}`);

            retryTimer = setTimeout(() => {
               if (!settled) {
                  void sendAttempt();
               }
            }, this.retryConfig.retryDelay);
         } else {
            const reason = retries === 0 ? 'No ACK before timeout' : 'Max retries reached';
            this.logger(`[ConnectionManager] ${reason} for mc=${mc}${typeStr}${targetStr} after ${retries} retries`);
            this.bridgeBackoffUntil = Date.now() + this.NACK_BACKOFF_MS;
            finishReject(new Error(reason));
         }
      };

      this.txSemaphore.acquire().then(() => {
        releaseSemaphore = () => this.txSemaphore.release();
        void sendAttempt();
      }).catch((error) => {
        finishReject(error instanceof Error ? error : new Error('Connection lost'));
      });
    });
  }

  /**
   * Handle incoming ACK for a specific MC
   */
  handleAck(mc: number): void {
    const resolver = this.pendingAcks.get(mc);
    if (resolver) {
      resolver(true);
      this.pendingAcks.delete(mc);
    }
  }

  /**
   * Handle incoming NACK.
   *
   * A NACK means the bridge received the frame but rejected it, usually because
   * it is busy or rate-limited. Retrying immediately amplifies that backpressure
   * and can force the bridge into a 1006 disconnect, so fail this command and
   * let the queue move on.
   */
  handleNack(mc: number): void {
    const resolver = this.pendingAcks.get(mc);
    if (resolver) {
      resolver(false);
    }
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.encryptionContext = null;
    this.clearPendingAcks();
    this.txSemaphore.drain(new Error('Connection lost'));
    this.connectionEstablished = false;
    this.reconnecting = false;
    this.connectResolve = undefined;
    if (this.ws) {
      this.ws.removeAllListeners();
      // Add no-op error handler to prevent unhandled 'error' crash.
      // When close() is called on a CONNECTING socket, the ws library
      // emits 'error' asynchronously via process.nextTick (abortHandshake).
      // Without a listener, Node.js treats it as an uncaught exception.
      this.ws.on('error', () => {});
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
