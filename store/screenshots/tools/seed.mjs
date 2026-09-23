// Seeds a store-screenshot account against the local API (wrangler dev on :8787, EMAIL_PROVIDER=log).
import fs from 'node:fs';

const API = 'http://localhost:8787';
const LOG = 'D:/Claude/chatsoon-app/.wrangler-dev.log';
const EMAIL = process.argv[2] ?? 'maya.shots@example.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8081', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return { res, data: text ? JSON.parse(text) : null };
}

await j('POST', '/auth/email-otp/send-verification-otp', null, { email: EMAIL, type: 'sign-in' });
await sleep(800);
const log = fs.readFileSync(LOG, 'utf8');
const re = new RegExp(`to=${EMAIL.replace(/[.+]/g, '\\$&')} subject=(\\d{6})`, 'g');
const code = [...log.matchAll(re)].pop()?.[1];
if (!code) throw new Error('no code in log');
const signed = await j('POST', '/auth/sign-in/email-otp', null, { email: EMAIL, otp: code });
const token = signed.res.headers.get('set-auth-token') ?? signed.data.token;

await j('PUT', '/me/profile', token, {
  displayName: 'Jess Morgan',
  headline: 'Partnerships at Orbit Labs',
  company: 'Orbit Labs',
  role: 'Head of Partnerships',
  links: { x: 'jessmorgan', telegram: 'jessmorgan', linkedin: 'https://www.linkedin.com/in/jessmorgan', website: 'https://orbitlabs.xyz' },
});

const { data: tagData } = await j('GET', '/tags', token);
const tag = (name) => tagData.tags.find((t) => t.name === name)?.id;
const EVENT = 'evt_token2049';

const people = [
  { name: 'Daniel Okafor', company: 'Northstar Capital', role: 'General Partner', email: 'daniel@northstar.vc', telegram: 'danokafor', tags: ['Investor', 'VC'], priority: 5, notes: 'Leads seed rounds in infra. Wants the deck after the event. Follow up Friday.' },
  { name: 'Priya Raman', company: 'Lattice Pay', role: 'Founder & CEO', email: 'priya@latticepay.io', xHandle: 'priyabuilds', tags: ['Founder', 'Collab'], priority: 4, notes: 'Exploring a co-marketing launch in Q4.' },
  { name: 'Tom Becker', company: 'Blockframe Media', role: 'Host, Onchain Weekly', telegram: 'tombecker', tags: ['Media', 'YouTube guest'], priority: 4, notes: 'Invited us on the podcast. Book a date in October.' },
  { name: 'Aiko Tanaka', company: 'Midnight Foundation', role: 'Ecosystem Lead', linkedinUrl: 'https://www.linkedin.com/in/aikotanaka', tags: ['Midnight', 'Advisor'], priority: 3, notes: 'Happy to intro the grants team.' },
  { name: 'Lucas Ferreira', company: 'Cardano Hub', role: 'Community Manager', telegram: 'lucasf', tags: ['Cardano', 'Sponsor'], priority: 3, source: 'card_photo' },
  { name: 'Sofia Rossi', company: 'Helix Ventures', role: 'Associate', email: 'sofia@helix.vc', tags: ['Investor'], priority: 2, source: 'qr_scan' },
  { name: 'Ben Carter', company: 'Stackwise', role: 'CTO', website: 'https://stackwise.dev', tags: ['Founder'], priority: 2 },
];
for (const p of people.reverse()) {
  const { tags, ...fields } = p;
  await j('POST', '/contacts', token, {
    ...fields,
    source: fields.source ?? 'manual',
    extractionStatus: fields.source === 'card_photo' ? 'confirmed' : undefined,
    eventId: EVENT,
    tagIds: tags.map(tag).filter(Boolean),
  });
}
// A real Chatsoon connection and a web-connect lead.
await j('POST', '/connections/scan', token, { slug: 'alex-rivera-demo', eventId: EVENT });
const me = await j('GET', '/me', token);
console.log(JSON.stringify({ token, slug: me.data.profile.slug }));
