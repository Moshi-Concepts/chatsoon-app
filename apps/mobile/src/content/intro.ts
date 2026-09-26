import type { IconName } from '@/components/ui';

export type IntroCard = {
  /** Ionicons name for the large icon in the tinted circle. */
  icon: IconName;
  /** Label for the "where" chip, e.g. "Add tab". */
  where: string;
  /** Icon for the "where" chip - matches that tab's icon in (app)/(tabs)/_layout.tsx. */
  whereIcon: IconName;
  title: string;
  body: string;
};

/**
 * Copy for the first-run "How Chatsoon works" intro (issue #32). Shown once, right after a new
 * account finishes onboarding, and replayable any time from Me > How Chatsoon works. Kept separate
 * from the screen (apps/mobile/src/app/(app)/intro.tsx) so it's easy to edit without touching layout.
 */
export const INTRO_CARDS: IntroCard[] = [
  {
    icon: 'scan-outline',
    where: 'Add tab',
    whereIcon: 'add-circle-outline',
    title: 'Capture anyone in seconds',
    body: "Scan someone's QR code, or snap a business card or event lanyard, and Chatsoon fills in their details for you.",
  },
  {
    icon: 'qr-code-outline',
    where: 'My QR tab',
    whereIcon: 'qr-code-outline',
    title: 'Share your card',
    body: 'Show your QR code or share your link. People can save your details straight to their phone, even without the app.',
  },
  {
    icon: 'people-outline',
    where: 'Contacts tab',
    whereIcon: 'people-outline',
    title: 'Everyone, in context',
    body: 'Keep notes, tags, priority and the event where you met with every contact, and find anyone fast with search.',
  },
  {
    icon: 'chatbubbles-outline',
    where: 'Contacts tab',
    whereIcon: 'people-outline',
    title: 'Follow up in a tap',
    body: 'Message people on Telegram, email, LinkedIn or X straight from their contact, and use priorities and tags so no lead slips through.',
  },
];
