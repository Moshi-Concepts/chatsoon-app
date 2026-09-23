import { CARD_PLACEHOLDER_NAME, type ExtractCardResponse } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { contacts } from '../src/db/schema';
import { getDb } from '../src/lib/db';
import { call, signIn } from './helpers';

// Minimal JPEG: SOI, APP0 (JFIF), SOF0 (200x100), EOI.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01, 0xff, 0xd9,
]);
/** PNG header claiming 9000x100 px, wider than Claude accepts. */
const WIDE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x23,
  0x28, 0x00, 0x00, 0x00, 0x64, 0x08, 0x02, 0x00, 0x00, 0x00,
]);
const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]);

type ErrorBody = { error: { code: string; message: string } };
type User = { token: string; userId: string };

const db = getDb(env);
const realFetch = globalThis.fetch.bind(globalThis);
const EMPTY_CARD = {
  name: null,
  company: null,
  role: null,
  email: null,
  phone: null,
  telegram: null,
  xHandle: null,
  linkedinUrl: null,
  website: null,
};

async function uploadCard(user: User, bytes: Uint8Array = JPEG): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'card.jpg');
  const res = await call('/files?purpose=card', { method: 'POST', token: user.token, body: form });
  if (res.status !== 201) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { key: string }).key;
}

async function createContact(userId: string, fields: Partial<typeof contacts.$inferInsert> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(contacts).values({
    id,
    userId,
    name: CARD_PLACEHOLDER_NAME,
    source: 'card_photo',
    extractionStatus: 'pending',
    updatedAt: new Date(Date.now() - 60_000),
    ...fields,
  });
  return id;
}

async function contactRow(id: string) {
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new Error('contact missing');
  return row;
}

const extract = (user: User, contactId: string, imageKey: string) =>
  call('/extract/card', { method: 'POST', token: user.token, json: { contactId, imageKey } });

type AnthropicRequest = { headers: Headers; body: any };

/** Answers Anthropic API calls with `reply`, and passes every other request through. */
function mockAnthropic(...replies: (() => Response)[]): AnthropicRequest[] {
  const requests: AnthropicRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (!req.url.startsWith('https://api.anthropic.com/')) return realFetch(input, init);
    requests.push({ headers: req.headers, body: await req.json() });
    const reply = replies[Math.min(requests.length, replies.length) - 1];
    if (!reply) throw new Error('no mocked reply');
    return reply();
  });
  return requests;
}

const claudeReply = (card: Record<string, unknown>, stopReason = 'end_turn') => () =>
  Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify(card) }],
    stop_reason: stopReason,
    usage: { input_tokens: 1200, output_tokens: 80 },
  });

const apiError = (status: number, type: string) => () =>
  Response.json({ type: 'error', error: { type, message: 'mocked' } }, { status });

let alice: User;
let bob: User;
let savedKey: string | undefined;

beforeAll(async () => {
  alice = await signIn('extract-alice@example.com');
  bob = await signIn('extract-bob@example.com');
});

beforeEach(() => {
  savedKey = env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

afterEach(() => {
  env.ANTHROPIC_API_KEY = savedKey;
  vi.restoreAllMocks();
});

describe('POST /extract/card', () => {
  it('sends the photo to Claude and fills only the empty fields', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId, { company: 'Existing Co', phone: '' });
    const before = await contactRow(contactId);
    const requests = mockAnthropic(
      claudeReply({
        name: 'Peter Bui',
        company: 'Other Co',
        role: 'Founder',
        email: ' Peter@Example.COM ',
        phone: '+61 400 123 456',
        telegram: '@peterbui',
        xHandle: '@peter_b',
        linkedinUrl: 'linkedin.com/in/peterbui',
        website: 'example.com',
      }),
    );

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(200);
    const { contact, extracted } = (await res.json()) as ExtractCardResponse;

    expect(extracted).toEqual({
      name: 'Peter Bui',
      company: 'Other Co',
      role: 'Founder',
      email: 'peter@example.com',
      phone: '+61 400 123 456',
      telegram: 'peterbui',
      xHandle: 'peter_b',
      linkedinUrl: 'https://linkedin.com/in/peterbui',
      website: 'https://example.com',
    });
    expect(contact).toMatchObject({
      id: contactId,
      name: 'Peter Bui',
      company: 'Existing Co',
      role: 'Founder',
      email: 'peter@example.com',
      phone: '+61 400 123 456',
      telegram: 'peterbui',
      xHandle: 'peter_b',
      linkedinUrl: 'https://linkedin.com/in/peterbui',
      website: 'https://example.com',
      cardImageKey: imageKey,
      extractionStatus: 'needs_review',
      source: 'card_photo',
    });
    expect(contact.cardImageUrl).toContain('/files/');
    expect(new Date(contact.updatedAt).getTime()).toBeGreaterThan(before.updatedAt.getTime());

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.headers.get('x-api-key')).toBe('test-anthropic-key');
    expect(request!.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(request!.body.model).toBe(env.EXTRACT_MODEL || 'claude-haiku-4-5');
    expect(request!.body.output_config.format.type).toBe('json_schema');
    expect(request!.body.output_config.format.schema.required).toEqual(Object.keys(EMPTY_CARD));
    const [image, text] = request!.body.messages[0].content;
    expect(image).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: btoa(String.fromCharCode(...JPEG)) },
    });
    expect(text.type).toBe('text');
  });

  it('deletes the photo it replaces, unless another contact still uses it', async () => {
    const oldKey = await uploadCard(alice);
    const sharedKey = await uploadCard(alice);
    const replaced = await createContact(alice.userId, { cardImageKey: oldKey });
    const sharing = await createContact(alice.userId, { cardImageKey: sharedKey });
    await createContact(alice.userId, { cardImageKey: sharedKey, name: 'Other contact' });
    mockAnthropic(claudeReply(EMPTY_CARD));

    // The shared photo goes first, so its cleanup has run by the time the other one is gone.
    expect((await extract(alice, sharing, await uploadCard(alice))).status).toBe(200);
    expect((await extract(alice, replaced, await uploadCard(alice))).status).toBe(200);

    await vi.waitFor(async () => expect(await env.FILES.head(oldKey)).toBeNull());
    expect(await env.FILES.head(sharedKey)).not.toBeNull();
    expect((await contactRow(replaced)).cardImageKey).not.toBe(oldKey);
  });

  it('keeps a name the user already entered', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId, { name: 'Jane Smith' });
    mockAnthropic(claudeReply({ ...EMPTY_CARD, name: 'Peter Bui', role: 'CTO' }));

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(200);
    const { contact, extracted } = (await res.json()) as ExtractCardResponse;
    expect(extracted.name).toBe('Peter Bui');
    expect(contact.name).toBe('Jane Smith');
    expect(contact.role).toBe('CTO');
  });

  it('drops values that fail validation', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId);
    mockAnthropic(
      claudeReply({
        name: '   ',
        company: 'x'.repeat(200),
        role: 42,
        email: 'not an email',
        phone: 'call me maybe',
        telegram: 'bad handle!',
        xHandle: '@this_handle_is_far_too_long',
        linkedinUrl: 'https://evil.example/in/peter',
        website: 'javascript:alert(1)',
      }),
    );

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(200);
    const { contact, extracted } = (await res.json()) as ExtractCardResponse;
    expect(extracted).toEqual({ ...EMPTY_CARD, company: 'x'.repeat(120) });
    expect(contact.name).toBe(CARD_PLACEHOLDER_NAME);
    expect(contact.email).toBeNull();
    expect(contact.extractionStatus).toBe('needs_review');
  });

  it('retries once when the API is overloaded', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId);
    const requests = mockAnthropic(apiError(529, 'overloaded_error'), claudeReply({ ...EMPTY_CARD, name: 'Ada' }));

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ExtractCardResponse).contact.name).toBe('Ada');
    expect(requests).toHaveLength(2);
  });

  it('marks the contact failed and returns 502 when the API call fails', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId);
    const requests = mockAnthropic(apiError(500, 'api_error'));

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorBody).error.code).toBe('extraction_failed');
    expect(requests).toHaveLength(2);

    const row = await contactRow(contactId);
    expect(row.extractionStatus).toBe('failed');
    expect(row.cardImageKey).toBe(imageKey);
    expect(row.name).toBe(CARD_PLACEHOLDER_NAME);
  });

  it('treats a refusal as a failed extraction', async () => {
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId);
    mockAnthropic(claudeReply({}, 'refusal'));

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(502);
    expect((await contactRow(contactId)).extractionStatus).toBe('failed');
  });

  it('returns 502 and marks the contact failed when no API key is configured', async () => {
    env.ANTHROPIC_API_KEY = '';
    const imageKey = await uploadCard(alice);
    const contactId = await createContact(alice.userId);
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const res = await extract(alice, contactId, imageKey);
    expect(res.status).toBe(502);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('extraction_failed');
    expect(body.error.message).toBeTruthy();
    expect(requests).toHaveLength(0);

    const row = await contactRow(contactId);
    expect(row.extractionStatus).toBe('failed');
    expect(row.cardImageKey).toBe(imageKey);
  });

  it('fails clearly for photos Claude cannot read, without calling the API', async () => {
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const heicKey = await uploadCard(alice, HEIC);
    const heicContact = await createContact(alice.userId);
    const heic = await extract(alice, heicContact, heicKey);
    expect(heic.status).toBe(502);
    expect(((await heic.json()) as ErrorBody).error.message).toMatch(/format/);

    const wideKey = await uploadCard(alice, WIDE_PNG);
    const wideContact = await createContact(alice.userId);
    const wide = await extract(alice, wideContact, wideKey);
    expect(wide.status).toBe(502);
    expect(((await wide.json()) as ErrorBody).error.message).toMatch(/too large/);

    expect(requests).toHaveLength(0);
    expect((await contactRow(wideContact)).extractionStatus).toBe('failed');
  });

  it("returns 404 for another user's contact and leaves it untouched", async () => {
    const aliceContact = await createContact(alice.userId);
    const bobKey = await uploadCard(bob);
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const res = await extract(bob, aliceContact, bobKey);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('not_found');
    expect(requests).toHaveLength(0);

    const row = await contactRow(aliceContact);
    expect(row.extractionStatus).toBe('pending');
    expect(row.cardImageKey).toBeNull();
  });

  it("returns 400 for another user's image key", async () => {
    const aliceContact = await createContact(alice.userId);
    const bobKey = await uploadCard(bob);
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const res = await extract(alice, aliceContact, bobKey);
    expect(res.status).toBe(400);
    expect(requests).toHaveLength(0);
    expect((await contactRow(aliceContact)).cardImageKey).toBeNull();
  });

  it('only accepts card photo keys, and leaves the contact alone otherwise', async () => {
    const contactId = await createContact(alice.userId);
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const avatarForm = new FormData();
    avatarForm.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'me.jpg');
    const avatar = await call('/files?purpose=avatar', { method: 'POST', token: alice.token, body: avatarForm });
    const { key: avatarKey } = (await avatar.json()) as { key: string };
    expect((await extract(alice, contactId, avatarKey)).status).toBe(400);

    expect((await extract(alice, contactId, `u/${alice.userId}/card/../../${bob.userId}/card/x.jpg`)).status).toBe(
      400,
    );
    expect(requests).toHaveLength(0);
    const row = await contactRow(contactId);
    expect(row.extractionStatus).toBe('pending');
    expect(row.cardImageKey).toBeNull();
  });

  it('marks the contact failed when the card photo is missing, so the app asks for the details', async () => {
    const contactId = await createContact(alice.userId);
    const requests = mockAnthropic(claudeReply(EMPTY_CARD));

    const missingKey = `u/${alice.userId}/card/00000000-0000-0000-0000-000000000000.jpg`;
    const res = await extract(alice, contactId, missingKey);
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorBody).error.code).toBe('extraction_failed');
    expect(requests).toHaveLength(0);

    const row = await contactRow(contactId);
    expect(row.extractionStatus).toBe('failed');
    expect(row.cardImageKey).toBeNull();
  });

  it('normalises links, handles and phone labels, and never invents a LinkedIn URL', async () => {
    const run = async (card: Record<string, unknown>) => {
      const imageKey = await uploadCard(alice);
      const contactId = await createContact(alice.userId);
      mockAnthropic(claudeReply({ ...EMPTY_CARD, ...card }));
      const res = await extract(alice, contactId, imageKey);
      expect(res.status).toBe(200);
      vi.restoreAllMocks();
      return ((await res.json()) as ExtractCardResponse).extracted;
    };

    expect(
      await run({
        phone: 'Mobile: +61 400 123 456',
        telegram: 'https://t.me/peter_bui',
        xHandle: 'https://x.com/peter_b?s=21',
        linkedinUrl: 'peterbui',
        website: 'http://www.example.com/',
      }),
    ).toMatchObject({
      phone: '+61 400 123 456',
      telegram: 'peter_bui',
      xHandle: 'peter_b',
      linkedinUrl: 'https://www.linkedin.com/in/peterbui',
      website: 'https://www.example.com',
    });

    // A printed name or a bare linkedin.com is not a profile.
    expect((await run({ linkedinUrl: 'Peter Bui' })).linkedinUrl).toBeNull();
    expect((await run({ linkedinUrl: 'https://www.linkedin.com/' })).linkedinUrl).toBeNull();
    expect((await run({ linkedinUrl: 'HTTP://LinkedIn.com/in/Peter-Bui' })).linkedinUrl).toBe(
      'https://linkedin.com/in/Peter-Bui',
    );
  });

  it('validates the body and requires a session', async () => {
    const contactId = await createContact(alice.userId);
    const missing = await call('/extract/card', { method: 'POST', token: alice.token, json: { contactId } });
    expect(missing.status).toBe(400);

    const notJson = await call('/extract/card', { method: 'POST', token: alice.token, body: 'nope' });
    expect(notJson.status).toBe(400);

    const anon = await call('/extract/card', { method: 'POST', json: { contactId, imageKey: 'u/x/card/y.jpg' } });
    expect(anon.status).toBe(401);
  });
});
