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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Encryption = void 0;
const crypto = __importStar(require("crypto"));
class Encryption {
    /**
     * Encrypts the AES session key and IV using the Bridge's RSA Public Key.
     * Format: AES_KEY_HEX:::AES_IV_HEX (Lowercase)
     */
    static encryptSessionKeys(aesKey, aesIv, publicKeyPem) {
        // 1. Format the payload: HEX_KEY:::HEX_IV
        // Reference implementations use standard lowercase hex.
        const payload = `${aesKey.toString('hex')}:::${aesIv.toString('hex')}`;
        console.log(`[Encryption] Encrypting session keys. Payload: ${payload}`);
        console.log(`[Encryption] Public Key Type: ${typeof publicKeyPem}`);
        // console.log(`[Encryption] Public Key Preview: ${publicKeyPem.substring(0, 50)}...`);
        // Ensure strict type for crypto
        if (typeof publicKeyPem !== 'string') {
            throw new Error(`Public Key must be a string. Received: ${typeof publicKeyPem}`);
        }
        // 2. Encrypt using RSA (PKCS1_v1_5)
        // The Bridge expects RSA PKCS#1 v1.5 padding.
        const encrypted = crypto.publicEncrypt({
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_PADDING,
        }, Buffer.from(payload, 'utf8'));
        return encrypted;
    }
    /**
     * Decrypts a message from the Bridge using AES-256-CBC with Zero Padding.
     */
    static decryptMessage(encryptedBase64, key, iv) {
        const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(false); // We will strip padding manually
        let decrypted = decipher.update(encryptedBuffer);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        // Strip trailing null bytes (Zero Padding)
        let end = decrypted.length;
        while (end > 0 && decrypted[end - 1] === 0) {
            end--;
        }
        return decrypted.subarray(0, end).toString('utf8');
    }
    /**
     * Encrypts a message for the Bridge using AES-256-CBC with Zero Padding.
     */
    static encryptMessage(payload, key, iv) {
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        cipher.setAutoPadding(false); // Use manual Zero Padding
        // Create buffer from string
        const payloadBuffer = Buffer.from(payload, 'utf8');
        // Calculate padding needed to reach multiple of 16
        // Always add padding, even if already aligned (matches Python behavior and xComfort spec)
        const blockSize = 16;
        const paddingLength = blockSize - (payloadBuffer.length % blockSize);
        const padding = Buffer.alloc(paddingLength, 0); // Zero bytes
        const paddedPayload = Buffer.concat([payloadBuffer, padding]);
        let encrypted = cipher.update(paddedPayload);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        // Append EOT character \u0004 to the base64 string
        return encrypted.toString('base64') + '\u0004';
    }
    /**
     * Generates a random salt string for authentication.
     */
    static generateSalt(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const bytes = crypto.randomBytes(length);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[bytes[i] % chars.length];
        }
        return result;
    }
    /**
     * Calculates the Double-SHA256 hash for authentication.
     * Format: SHA256(salt + SHA256(deviceId + authKey))
     */
    static calculateAuthHash(deviceId, authKey, salt) {
        // Inner hash: SHA256(deviceId + authKey)
        const innerInput = deviceId + authKey;
        const innerHash = crypto.createHash('sha256').update(innerInput).digest('hex');
        // Outer hash: SHA256(salt + innerHash)
        const outerInput = salt + innerHash;
        return crypto.createHash('sha256').update(outerInput).digest('hex');
    }
}
exports.Encryption = Encryption;
