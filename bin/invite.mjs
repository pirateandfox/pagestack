#!/usr/bin/env node
// Create the first invite link without a running editor (later invites can be made from /edit).
//
//   EDITOR_SECRET=… node packages/astro-section-editor/bin/invite.mjs --name "Jane Doe" --email jane@example.com --origin https://example.com [--days 3]
//
// Same token format as src/core/auth.ts (HMAC-SHA256, base64url(json).base64url(mac)) so the
// running site can verify it. Plain JS so it runs on any Node without a TypeScript step.
import { createHmac, randomBytes } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : []).filter((p) => p.length));
const secret = process.env[args.secretEnv || 'EDITOR_SECRET'] || '';
const { name, email, origin, days = '3' } = args;
if (!name || !email || !origin || args.help) {
  console.error('usage: EDITOR_SECRET=… invite.mjs --name "Jane Doe" --email jane@example.com --origin https://example.com [--days 3]');
  process.exit(args.help ? 0 : 2);
}
if (secret.length < 16) { console.error('EDITOR_SECRET must be set in the environment (>= 16 characters)'); process.exit(2); }

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const ttl = Math.round(Number(days) * 86400);
const payload = { kind: 'invite', id: b64url(randomBytes(12)), name: name.trim(), email: email.trim().toLowerCase() };
const body = b64url(Buffer.from(JSON.stringify({ payload, exp: Math.floor(Date.now() / 1000) + ttl })));
const mac = b64url(createHmac('sha256', secret).update(body).digest());
const token = `${body}.${mac}`;
console.log(`${origin.replace(/\/$/, '')}/edit/enroll?invite=${encodeURIComponent(token)}`);
console.error(`invite for ${payload.name} <${payload.email}>, valid ${days} day(s), single use`);
