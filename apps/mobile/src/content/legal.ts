import data from './legal.json';

// Privacy policy, terms and support live once in legal.json. The app renders them with
// components/web/legal-page.tsx and apps/web (src/render/legal.ts) turns them into static HTML.

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDoc = {
  title: string;
  /** Human readable date, e.g. "24 September 2026". */
  updated: string;
  intro: string;
  sections: LegalSection[];
};

export type LegalDocKey = 'privacy' | 'terms' | 'support' | 'accessibility';

export const legal: Record<LegalDocKey, LegalDoc> = data;

/** Route and label for each document, in footer order. */
export const LEGAL_LINKS: { key: LegalDocKey; href: `/${LegalDocKey}`; label: string }[] = [
  { key: 'privacy', href: '/privacy', label: 'Privacy' },
  { key: 'terms', href: '/terms', label: 'Terms' },
  { key: 'support', href: '/support', label: 'Support' },
  { key: 'accessibility', href: '/accessibility', label: 'Accessibility' },
];
