import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { config } from "./config";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export function encrypt(v: string, aad: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", config().vaultKey, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    data: data.toString("base64url"),
    tag: c.getAuthTag().toString("base64url"),
  });
}
export function decrypt(v: string, aad: string) {
  const e = JSON.parse(v);
  if (e.v !== 1) throw Error("Unsupported key envelope");
  const iv = Buffer.from(e.iv, "base64url"),
    tag = Buffer.from(e.tag, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw Error("Invalid envelope");
  const d = createDecipheriv("aes-256-gcm", config().vaultKey, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([
    d.update(Buffer.from(e.data, "base64url")),
    d.final(),
  ]).toString("utf8");
}
export function hashPassword(v: string) {
  return hash(v, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  });
}
export async function verifyPassword(h: string, v: string) {
  try {
    return await verify(h, v);
  } catch {
    return false;
  }
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function generateTotpSecret() {
  const b = randomBytes(20);
  let acc = 0,
    bits = 0,
    out = "";
  for (const x of b) {
    acc = (acc << 8) | x;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(acc >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(acc << (5 - bits)) & 31];
  return out;
}
export function base32Decode(v: string) {
  let acc = 0,
    bits = 0,
    out: number[] = [];
  for (const x of v.toUpperCase().replace(/=+$/, "")) {
    const n = alphabet.indexOf(x);
    if (n < 0) throw Error("Invalid TOTP secret");
    acc = (acc << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 255);
    }
  }
  return Buffer.from(out);
}
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[19] & 15;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function totpMatchingStep(
  secret: string,
  code: string,
  now = Date.now()
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const delta of [0, -1, 1]) {
    if (
      timingSafeEqual(
        Buffer.from(totpCode(secret, step + delta)),
        Buffer.from(code)
      )
    )
      return step + delta;
  }
  return null;
}
export const totpUri = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent("Win11Desk:" + email)}?secret=${secret}&issuer=Win11Desk&algorithm=SHA1&digits=6&period=30`;

export function base32Encode(b:Uint8Array){let acc=0,bits=0,out="";for(const x of b){acc=(acc<<8)|x;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(acc>>>bits)&31];}}if(bits)out+=alphabet[(acc<<(5-bits))&31];return out;}
export function verifyTotpCode(secret:string,code:string,now=Date.now(),window=1){if(!/^\d{6}$/.test(code))return false;const step=Math.floor(now/30000);for(let i=-window;i<=window;i++)if(totpCode(secret,step+i)===code)return true;return false;}
