import { z } from 'zod';

import {
  BOOKING_LABEL_MAX,
  BOOKING_URL_HINT,
  BOOKING_URL_MAX,
  MAX_BOOKING_LINKS,
  parseBookingUrl,
  suggestBookingLabel,
} from './booking';
import { REPORT_REASONS } from './constants';
import { hasObjectionableText } from './moderation';
import { CONTACT_HINTS, CONTACT_MAX, contactUrl } from './profile-contact';
import type { ProfileContactKey } from './types';

/** Optional free text: trims, turns '' into null, caps length. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const clean = (v: string) => !hasObjectionableText(v);
const OFFENSIVE = 'Please remove offensive language';

/** optionalText for text other people see: also rejects slurs and severe profanity. */
const publicText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(clean, OFFENSIVE)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const otpSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6 digit code');

export const linksSchema = z
  .object({
    x: publicText(200),
    telegram: publicText(200),
    linkedin: publicText(300),
    website: publicText(300),
    youtube: publicText(300),
  })
  .partial();

/** One booking link as submitted: url must be a supported booking link; an empty label is filled in. */
export const bookingLinkInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, BOOKING_URL_HINT)
      .max(BOOKING_URL_MAX, BOOKING_URL_HINT)
      .refine(clean, OFFENSIVE)
      .refine((v) => parseBookingUrl(v) !== null, BOOKING_URL_HINT),
    label: z.string().trim().max(BOOKING_LABEL_MAX).refine(clean, OFFENSIVE).nullable().optional(),
  })
  .transform((v) => {
    const url = parseBookingUrl(v.url)!.url;
    return { url, label: v.label || suggestBookingLabel(url) };
  });

/** Up to MAX_BOOKING_LINKS links, in display order. Duplicate canonical URLs are rejected. */
export const bookingLinksSchema = z
  .array(bookingLinkInputSchema)
  .max(MAX_BOOKING_LINKS, 'Add up to 5 booking links')
  .superRefine((links, ctx) => {
    const seen = new Set<string>();
    links.forEach((link, i) => {
      if (seen.has(link.url)) {
        ctx.addIssue({ code: 'custom', message: "You've added this booking link already", path: [i, 'url'] });
      }
      seen.add(link.url);
    });
  });

/** One contact value: '' removes it, empty string and null both clear the field. Must parse with contactUrl. */
const contactValue = (key: ProfileContactKey) =>
  z
    .string()
    .trim()
    .max(CONTACT_MAX[key], CONTACT_HINTS[key])
    .refine(clean, OFFENSIVE)
    .refine((v) => v === '' || contactUrl(key, v) !== null, CONTACT_HINTS[key])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Phone, WhatsApp and Signal, each independently optional. Unknown keys (e.g. a future 'wechat') are stripped. */
export const contactInputSchema = z
  .object({ phone: contactValue('phone'), whatsapp: contactValue('whatsapp'), signal: contactValue('signal') })
  .partial();

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(80).refine(clean, OFFENSIVE),
  headline: publicText(120),
  company: publicText(80),
  role: publicText(80),
  links: linksSchema.optional(),
  /** R2 key returned by POST /files?purpose=avatar. Must belong to the caller. null removes the avatar. */
  avatarKey: z.string().max(300).nullable().optional(),
  /** undefined keeps the current links; an array (including []) replaces them. */
  bookingLinks: bookingLinksSchema.optional(),
  /** undefined keeps the current values; each key is merged independently, like links. */
  contact: contactInputSchema.optional(),
  contactVisibility: z.enum(['connections', 'public']).optional(),
  /** "Show my profile in search engines". undefined keeps the current value (1.0 clients never send it). */
  searchVisible: z.boolean().optional(),
});
export type ProfileInput = z.input<typeof profileInputSchema>;

/** Sources a client may set. app_connect and web_connect are server-only. */
export const clientContactSourceSchema = z.enum(['manual', 'qr_scan', 'card_photo']);

const contactFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  company: optionalText(120),
  role: optionalText(120),
  email: optionalText(254),
  phone: optionalText(40),
  telegram: optionalText(100),
  xHandle: optionalText(100),
  linkedinUrl: optionalText(300),
  website: optionalText(300),
  cardImageKey: z.string().max(300).nullable().optional(),
  notes: optionalText(5000),
  priority: z.number().int().min(1).max(5).nullable().optional(),
  eventId: z.string().max(100).nullable().optional(),
  tagIds: z.array(z.string().max(100)).max(50).optional(),
};

export const contactCreateSchema = z.object({
  /** Client-generated UUID so offline retries are idempotent. */
  id: z.uuid().optional(),
  ...contactFields,
  source: clientContactSourceSchema.default('manual'),
  extractionStatus: z.enum(['none', 'pending', 'needs_review', 'confirmed']).optional(),
});
export type ContactCreateInput = z.input<typeof contactCreateSchema>;

export const contactUpdateSchema = z
  .object({
    ...contactFields,
    extractionStatus: z.enum(['needs_review', 'confirmed']).optional(),
  })
  .partial();
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

/** Lands in the owner's contacts and notification email, so name and note are filtered too. */
export const connectFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).refine(clean, OFFENSIVE),
  /** Email address only (issue #10): still named `contact` on the wire so older clients' payload shape still parses. */
  contact: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(200)),
  note: publicText(1000),
  turnstileToken: z.string().min(1).max(4096),
});
export type ConnectFormInput = z.input<typeof connectFormSchema>;

export const scanConnectSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  eventId: z.string().max(100).nullable().optional(),
});

export const tagInputSchema = z.object({ name: z.string().trim().min(1).max(40) });
export const eventInputSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const extractCardSchema = z.object({
  contactId: z.string().min(1).max(100),
  imageKey: z.string().min(1).max(300),
});

const target = {
  targetSlug: z.string().trim().max(100).optional(),
  targetUserId: z.string().max(100).optional(),
};

export const reportSchema = z
  .object({
    ...target,
    /** A Connect form message in my contacts (a web_connect contact), instead of a user. Signed in only. */
    contactId: z.string().trim().max(100).optional(),
    reason: z.enum(REPORT_REASONS),
    details: optionalText(1000),
  })
  .refine((v) => v.targetSlug || v.targetUserId || v.contactId, {
    message: 'targetSlug, targetUserId or contactId is required',
  });
export type ReportInput = z.input<typeof reportSchema>;

export const blockSchema = z
  .object(target)
  .refine((v) => v.targetSlug || v.targetUserId, { message: 'targetSlug or targetUserId is required' });
export type BlockInput = z.input<typeof blockSchema>;
