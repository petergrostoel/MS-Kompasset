// Web Push (RFC 8030/8291/8292) med kun WebCrypto – virker i Supabase Edge Functions (Deno) og i Node 20+.
// Sender en krypteret besked til en browser-abonnement (iPhone-appen fra hjemmeskærmen).

const enc = new TextEncoder();

export function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** Lav et nyt VAPID-nøglepar. Offentlig nøgle: 65 byte (ukomprimeret punkt). Privat: 32 byte. */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64uEncode(pub), privateKey: jwk.d };
}

async function importVapidPrivate(publicKeyB64u, privateKeyB64u) {
  const pub = b64uDecode(publicKeyB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY har forkert format");
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: privateKeyB64u,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** VAPID-header (RFC 8292) for en push-tjeneste. */
export async function vapidAuthorization(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject,
  })));
  const key = await importVapidPrivate(vapid.publicKey, vapid.privateKey);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

/** Krypter en besked til et abonnement (RFC 8291, aes128gcm). */
export async function encryptPayload(sub, payload) {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Send en notifikation. sub = { endpoint, p256dh, auth }.
 * Returnerer { ok, status, gone } – gone = abonnementet findes ikke længere og bør slettes.
 */
export async function sendPush(sub, payload, vapid, { ttl = 3600, urgency = "high", fetchImpl = fetch } = {}) {
  const body = await encryptPayload(sub, JSON.stringify(payload));
  const res = await fetchImpl(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
