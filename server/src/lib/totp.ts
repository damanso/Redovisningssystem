// RFC 6238 TOTP (HMAC-SHA1, 6 siffror, 30 s steg) implementerat med node:crypto
// — inget externt beroende. base32 (RFC 4648, utan padding) för secret/otpauth.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Ny slumpad TOTP-hemlighet (base32, 160 bitar). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Genererar TOTP-koden för ett givet tidssteg (default nuvarande). */
export function totpCode(secret: string, forTime: number, step = 30, digits = 6): string {
  const counter = Math.floor(forTime / 1000 / step);
  const buf = Buffer.alloc(8);
  // 64-bitars räknare, big-endian. counter ryms i 32 bitar under överskådlig tid.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Verifierar en TOTP-kod mot hemligheten inom ett fönster (± window steg) för att
 * tillåta liten klockdrift. Konstant-tidsjämförelse. `now` injiceras i test.
 */
export function verifyTotp(secret: string, token: string, opts: { window?: number; now?: number } = {}): boolean {
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const clean = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (let i = -window; i <= window; i += 1) {
    const candidate = totpCode(secret, now + i * 30 * 1000);
    const a = Buffer.from(candidate);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Som verifyTotp men returnerar det MATCHANDE tidssteget (counter) i stället för
 * en boolean — null om ingen match. Callern kan lagra steget och avvisa
 * återanvändning (engångsbruk, skydd mot replay inom fönstret).
 */
export function verifyTotpStep(secret: string, token: string, opts: { window?: number; now?: number; step?: number } = {}): number | null {
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const stepSeconds = opts.step ?? 30;
  const clean = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  for (let i = -window; i <= window; i += 1) {
    const t = now + i * stepSeconds * 1000;
    const candidate = totpCode(secret, t);
    const a = Buffer.from(candidate);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return Math.floor(t / 1000 / stepSeconds);
  }
  return null;
}

/** otpauth://-URI för QR-appar (Google Authenticator, Authy m.fl.). */
export function otpauthUri(secret: string, account: string, issuer = 'Daglig liggare'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
