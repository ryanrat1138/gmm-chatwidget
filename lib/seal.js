// Seals a customer's CloseBot API key, with the sites and sources it may be
// used for, into a string that can sit in the page's embed tag. Only this
// service can open it (AES-256-GCM with SEAL_SECRET), so the key itself never
// appears in the page and nothing has to be stored.

const crypto = require('crypto');

const PREFIX = 'v1.';

function secretKey() {
  const secret = process.env.SEAL_SECRET || '';
  if (secret.length < 32) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function b64(buf) { return buf.toString('base64url'); }

function seal(data) {
  const key = secretKey();
  if (!key) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return PREFIX + b64(iv) + '.' + b64(Buffer.concat([body, cipher.getAuthTag()]));
}

function unseal(text) {
  const key = secretKey();
  if (!key || typeof text !== 'string' || !text.startsWith(PREFIX) || text.length > 4000) return null;
  const [ivPart, bodyPart] = text.slice(PREFIX.length).split('.');
  try {
    const iv = Buffer.from(ivPart || '', 'base64url');
    const all = Buffer.from(bodyPart || '', 'base64url');
    if (iv.length !== 12 || all.length < 17) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(all.subarray(all.length - 16));
    const out = Buffer.concat([decipher.update(all.subarray(0, all.length - 16)), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { seal, unseal };
