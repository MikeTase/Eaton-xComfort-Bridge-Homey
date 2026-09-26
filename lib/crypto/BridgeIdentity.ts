import crypto from 'crypto';

/**
 * Eaton root public key used by the official xComfort Bridge app (2.4.1) to
 * verify that the secure-channel public key really belongs to an Eaton
 * bridge (SC_PUBKEY 15: `{device_id, device_signature, public_key}`).
 */
export const EATON_BRIDGE_ROOT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4fd/7eNKJ2xztHOfTtM
2vWXyjsyP2x2Uuh9QJFR6WQyGKhS3anNKbZgrGfMA8ZGKke8BgADCX3y4zYlwD2q
dlSMG5F1RoZNoWTeqUNDijcr1MwbKs+L7C0L4bjZit2F7ZN3WzBv2Zj9dT4M3Bey
j415JYpWbyRdbMjd5JdHGU+7vxAqBYPkfFM8+60trYpFVGIMFjJncF+38YdyU6D7
P9r8QmiFxu9I/kDfhgpdh7UGDEHg6Ue/SjPCBO98JKzIt90rU+5u+q3mPYESo0Dy
3zy1TEEYEzwHJCPwuPL3LYRW9IfBXhuxoO0eHcnG0reouzFEzI5536v5Pa+6jE2X
ywIDAQAB
-----END PUBLIC KEY-----
`;

/** Normalize a PEM public key that may have lost its line breaks. */
function toPem(key: string): string {
  const body = key
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

export type BridgeIdentityResult = 'verified' | 'mismatch' | 'unavailable';

/**
 * Verify the bridge's secure-channel identity the way the official app does:
 * RSA-SHA256 over `device_id + ":::" + public_key` (line breaks removed),
 * with the hex-encoded `device_signature`, against the Eaton root key.
 *
 * Returns 'unavailable' when the bridge did not send the fields or the
 * input cannot be parsed; callers should treat the result as informational.
 */
export function verifyBridgeIdentity(
  deviceId: unknown,
  publicKey: unknown,
  signatureHex: unknown,
  rootPublicKey: string = EATON_BRIDGE_ROOT_PUBLIC_KEY,
): BridgeIdentityResult {
  if (typeof deviceId !== 'string' || typeof publicKey !== 'string' || typeof signatureHex !== 'string') {
    return 'unavailable';
  }
  if (!deviceId || !publicKey || !/^[0-9a-fA-F]+$/.test(signatureHex)) {
    return 'unavailable';
  }

  try {
    const message = `${deviceId}:::${publicKey}`.replace(/[\n\r]+/g, '');
    const valid = crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      toPem(rootPublicKey),
      Buffer.from(signatureHex, 'hex'),
    );
    return valid ? 'verified' : 'mismatch';
  } catch {
    return 'unavailable';
  }
}
