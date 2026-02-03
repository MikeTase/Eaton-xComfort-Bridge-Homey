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
import crypto from 'crypto';
import { PROTOCOL_CONFIG } from '../XComfortProtocol';
import { Semaphore } from '../utils/Semaphore';
import type { ConnectionState, EncryptionContext } from '../types';

// Re-export types for module consumers
export type { ConnectionState, EncryptionContext };

// ============================================================================
// Retry Configuration
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  ackTimeout: number; // ms to wait for ACK before retry
  retryDelay: number; // ms between retries
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,    // Updated to match reference implementation
  ackTimeout: 5000, // 5 seconds
  retryDelay: 500,  // Reduced to 500ms for faster recovery
};

// ============================================================================
// Module-specific Types (callbacks)
// ============================================================================

/** Callback for raw message received */
export type OnRawMessageFn = (data: Buffer, timestamp: number) => void;

/** Callback for connection state change */
export type OnStateChangeFn = (state: ConnectionState) => void;

/** Callback for connection close */
export type OnCloseFn = (code: number, reason: string, shouldReconnect: boolean) => void;

// ============================================================================
// ConnectionManager Class
// ============================================================================

export class ConnectionManager {
  private bridgeIp: string;
  private ws: WebSocket | null = null;
  private encryptionContext: EncryptionContext | null = null;
  private state: ConnectionState = 'disconnected';
  private connectionEstablished: boolean = false;
  private reconnecting: boolean = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private mc: number = 0;

  private onRawMessage?: OnRawMessageFn;
  private onStateChange?: OnStateChangeFn;
  private onClose?: OnCloseFn;

  private base64regex: RegExp = /^[A-Za-z0-9+/=]+$/;

  // Retry mechanism: Map of mc -> resolve function for pending ACKs
  private pendingAcks: Map<number, (acked: boolean) => void> = new Map();
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;
  private txSemaphore = new Semaphore(1); // Concurrency 1 to prevent bridge flooding (optimization)

  constructor(bridgeIp: string) {
    this.bridgeIp = bridgeIp;
  }

  /**
   * Configure retry behavior
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * Set callback for raw messages
   */
  setOnRawMessage(callback: OnRawMessageFn): void {
    this.onRawMessage = callback;
  }

  /**
   * Set callback for state changes
   */
  setOnStateChange(callback: OnStateChangeFn): void {
    this.onStateChange = callback;
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
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
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
    this.state = 'connected';
    // Reference implementation does NOT start a periodic heartbeat here
    // this.startHeartbeat(); 
    this.resolveConnection();
  }

  /**
   * Start 30s heartbeat loop to keep connection alive
   */
  public startHeartbeat(sendHeartbeat: () => void): void {
    this.stopHeartbeat();
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
      console.log(`[ConnectionManager] Clearing ${this.pendingAcks.size} pending ACKs due to disconnect`);
      for (const [_mc, resolve] of this.pendingAcks) {
        resolve(false);
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
      try {
        this.state = 'connecting';
        this.onStateChange?.(this.state);

        this.ws = new WebSocket(`ws://${this.bridgeIp}`, {
          perMessageDeflate: false,
        });

        this.ws.on('open', () => {
          console.log('[ConnectionManager] WebSocket connected, awaiting handshake...');

          // Set TCP_NODELAY
          // Type assertion to access private socket property safely
          const socket = (this.ws as unknown as { _socket?: { setNoDelay: (v: boolean) => void } })._socket;
          if (socket) {
            socket.setNoDelay(true);
          }
        });

        this.ws.on('message', (data: Buffer) => {
          const rawRecvTime = Date.now();
          console.log(
            `[ConnectionManager] RAW MSG at ${rawRecvTime}, size=${data.length}`
          );
          this.onRawMessage?.(data, rawRecvTime);
        });

        this.ws.on('error', (err: Error) => {
          console.error('[ConnectionManager] WebSocket error:', err);
          reject(err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          const reasonStr = reason.toString() || 'No reason';
          console.log(
            `[ConnectionManager] Connection closed. Code: ${code}, Reason: ${reasonStr}`
          );

          // Clear any pending ACKs immediately as they will never arrive
          this.clearPendingAcks();

          const wasEstablished = this.connectionEstablished;
          const shouldReconnect = wasEstablished && !this.reconnecting;

          this.state = 'disconnected';
          this.onStateChange?.(this.state);
          // Mark connection as lost so retries can detect it
          this.encryptionContext = null;
          
          this.onClose?.(code, reasonStr, shouldReconnect);
        });

        // Resolve is called externally when auth completes
        // Store resolve/reject for external completion
        (this as any)._connectResolve = resolve;
        (this as any)._connectReject = reject;

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Resolve the connection promise (called when auth completes)
   */
  resolveConnection(): void {
    const resolve = (this as any)._connectResolve;
    if (resolve) {
      this.state = 'connected';
      this.onStateChange?.(this.state);
      resolve();
      delete (this as any)._connectResolve;
    }
  }

  /**
   * Reject the connection promise
   */
  rejectConnection(error: Error): void {
    const reject = (this as any)._connectReject;
    if (reject) {
      reject(error);
      delete (this as any)._connectReject;
    }
  }

  /**
   * Send raw (unencrypted) message
   */
  sendRaw(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[ConnectionManager] Cannot send - WebSocket not open');
      return;
    }
    this.ws.send(data);
  }

  /**
   * Send encrypted message
   */
  async sendEncrypted(msg: Record<string, unknown>): Promise<boolean> {
    if (!this.encryptionContext) {
      console.error('[ConnectionManager] Cannot send encrypted - no context');
      return false;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[ConnectionManager] Cannot send encrypted - socket closed');
      return false;
    }

    try {
      const payloadStr = JSON.stringify(msg);

      // Null Byte Padding (Zero Padding) per reference implementation
      // Convert to Buffer first to handle UTF-8 length correctly
      const payloadBuf = Buffer.from(payloadStr, 'utf8');
      const blockSize = PROTOCOL_CONFIG.ENCRYPTION.BLOCK_SIZE;
      
      // Calculate start of next block
      // Reference: const pad = blockSize - (buf.length % blockSize);
      const remainder = payloadBuf.length % blockSize;
      const padLength = blockSize - remainder;
      
      // Alloc buffer with extra space for padding (filled with 0s)
      const dataToEncrypt = Buffer.alloc(payloadBuf.length + padLength, 0);
      payloadBuf.copy(dataToEncrypt);

      const cipher = crypto.createCipheriv(
        PROTOCOL_CONFIG.ENCRYPTION.ALGORITHM,
        this.encryptionContext.key,
        this.encryptionContext.iv
      );
      cipher.setAutoPadding(false);

      // Update with buffer -> output base64
      let encrypted = Buffer.concat([
          cipher.update(dataToEncrypt),
          cipher.final()
      ]).toString('base64');
      
      // Append EOT delimiter per protocol reference
      encrypted += '\u0004';

      this.ws.send(encrypted);
      return true;
    } catch (error) {
      console.error('[ConnectionManager] Encryption error:', error);
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
      const decipher = crypto.createDecipheriv(
        PROTOCOL_CONFIG.ENCRYPTION.ALGORITHM,
        this.encryptionContext.key,
        this.encryptionContext.iv
      );
      decipher.setAutoPadding(false);

      // Pad input if necessary (should be multiple of 16)
      let encryptedBuf = Buffer.from(encryptedBase64, 'base64');
      const blockSize = PROTOCOL_CONFIG.ENCRYPTION.BLOCK_SIZE;
      if (encryptedBuf.length % blockSize !== 0) {
           const newLen = Math.ceil(encryptedBuf.length / blockSize) * blockSize;
           const newBuf = Buffer.alloc(newLen, 0);
           encryptedBuf.copy(newBuf);
           encryptedBuf = newBuf;
      }

      let decryptedBuf = Buffer.concat([
          decipher.update(encryptedBuf),
          decipher.final()
      ]);

      // Strip Null Byte padding from end (and any other potential garbage if we are generous)
      // Reference uses: .replace(/\x00+$/, '')
      const clean = decryptedBuf.toString('utf8').replace(/\x00+$/, '');
      return clean;
    } catch (error) {
      throw new Error(`Decryption failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if message looks encrypted (Base64)
   */
  isEncrypted(data: string): boolean {
    return this.base64regex.test(data.trim());
  }

  /**
   * Send message with retry and ACKwait
   */
  async sendWithRetry(msg: { mc: number; [key: string]: unknown }): Promise<boolean> {
    const mc = msg.mc;
    // const typeStr = msg.type_int ? ` (${msg.type_int})` : '';

    return new Promise((resolve, reject) => {
      let retries = 0;
      let ackTimeoutTimer: NodeJS.Timeout | null = null;
      let releaseSemaphore: (() => void) | null = null;

      const cleanup = () => {
        if (ackTimeoutTimer) clearTimeout(ackTimeoutTimer);
        this.pendingAcks.delete(mc);
        if (releaseSemaphore) releaseSemaphore();
      };

      const sendAttempt = async () => {
        if (!this.isConnected()) {
           cleanup();
           reject(new Error('Connection lost'));
           return;
        }

        // Send
        const success = await this.sendEncrypted(msg);
        if (!success) {
           handleFailure();
           return;
        }

        // Wait for ACK
        this.pendingAcks.set(mc, (acked) => {
           if (acked) {
             cleanup();
             resolve(true);
           } else {
             handleFailure();
           }
        });

        // Set timeout
        if (ackTimeoutTimer) clearTimeout(ackTimeoutTimer);
        ackTimeoutTimer = setTimeout(() => {
           handleFailure();
        }, this.retryConfig.ackTimeout);
      };

      const handleFailure = () => {
         if (retries < this.retryConfig.maxRetries) {
            retries++;
            console.log(`[ConnectionManager] Retry ${retries}/${this.retryConfig.maxRetries} for mc=${mc}`);
            if (ackTimeoutTimer) clearTimeout(ackTimeoutTimer);
            setTimeout(() => {
               sendAttempt();
            }, this.retryConfig.retryDelay);
         } else {
            console.error(`[ConnectionManager] Max retries reached for mc=${mc}`);
            cleanup();
            reject(new Error(`Max retries reached`));
         }
      };

      // Acquire semaphore before starting first attempt
      this.txSemaphore.acquire().then(() => {
         releaseSemaphore = () => this.txSemaphore.release();
         sendAttempt();
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
   * Handle incoming NACK (treat as failure -> retry)
   */
  handleNack(mc: number): void {
    const resolver = this.pendingAcks.get(mc);
    if (resolver) {
      resolver(false); // Signal failure to trigger retry
      // Don't delete yet, failure handler will do it or retry
    }
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.clearPendingAcks();
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }
  }
}
