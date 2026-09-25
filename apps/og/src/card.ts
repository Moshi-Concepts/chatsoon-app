// Builds the dynamic layer of the personalised card (docs/og-plan.md §2.2): a satori element tree
// drawn over the static plate. Everything the plate itself draws — the background gradient and glows,
// the right-hand header art, the brand row and the "Connect on Chatsoon" call to action — is already
// baked into `plate.jpg` (scripts/gen-plate.ts); this module only lays out the photo/initials and the
// name, role and headline text at x < 750.
//
// satori accepts a plain `{ type, props }` tree (the same shape a JSX transform would produce) — no
// React import needed. `Node`'s `props` always carries `style` plus, for anything with content,
// `children`.
//
// `card: OgCard` is destructured by name everywhere below and never spread, so an object cast to
// `OgCard` that actually carries extra fields (`contact`, `links`, ids, ...) can't leak into the tree
// even if a caller skips `toOgCard` first (og.test.ts's own leak test covers `toOgCard`; card.test.ts
// covers this file the same way).

import type { OgCard } from '@chatsoon/shared/src/og';
import { roleLine } from '@chatsoon/shared/src/profile-page';

import { avatarDataUri, type OgAvatar } from './avatar-types';
import { fieldForImage, initialsFor, sanitiseField } from './text';

export interface Node {
  type: string;
  props: Record<string, unknown>;
}

function h(type: string, style: Record<string, unknown>, children?: Node | Node[] | string): Node {
  return { type, props: children === undefined ? { style } : { style, children } };
}

// Same speech-bubble artwork as the app icon (apps/mobile/src/components/brand/logo.tsx's `BUBBLE`,
// apps/mobile/assets/brand/icon.svg), path-only so it can be drawn in a single flat colour on top of
// the disc's gradient — this is the last-resort avatar fallback, so it can't depend on the brand's
// two-tone icon rendering correctly through satori's <img>-of-an-<img> path.
const BUBBLE_MARK_PATH =
  'M362 250H662A150 150 0 0 1 812 400V560A150 150 0 0 1 662 710H470L318 826' +
  'C304 836 286 824 291 807L318 710A150 150 0 0 1 212 560V400A150 150 0 0 1 362 250Z';

function bubbleMarkDataUri(): string {
  // Same 1024-unit coordinate space the path was authored in (logo.tsx's own viewBox, minus its
  // dots-inclusive `translate(0 -28)`, which this path-only mark doesn't need); the viewBox scales it
  // down to the 96x96 output size, so the call site needs no extra transform math.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="96" height="96">' +
    `<path d="${BUBBLE_MARK_PATH}" fill="#FFFFFF"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const BUBBLE_MARK_DATA_URI = bubbleMarkDataUri();

const RING_SIZE = 174;
const DISC_SIZE = 164;
const DISC_RADIUS = DISC_SIZE / 2;

const discStyle: Record<string, unknown> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: DISC_SIZE,
  height: DISC_SIZE,
  borderRadius: DISC_RADIUS,
  overflow: 'hidden',
};

/** The 174px ring plus whatever fills its 164px disc: the photo, initials, or the bubble mark. */
function buildAvatar(card: OgCard, avatar: OgAvatar | null): Node {
  const inner = buildAvatarDisc(card, avatar);
  return h(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      backgroundColor: 'rgba(255,255,255,0.92)',
      flexShrink: 0,
    },
    inner,
  );
}

/** `<img>` needs `width`/`height`/`src` as top-level props, not nested in `style` — hence its own
 * builder instead of `h()`, which always puts its third argument under `style` or `children`. */
function img(props: { width: number; height: number; src: string; style?: Record<string, unknown> }): Node {
  return { type: 'img', props: { ...props, style: props.style ?? {} } };
}

function buildAvatarDisc(card: OgCard, avatar: OgAvatar | null): Node {
  if (avatar) {
    return h('div', discStyle, [
      img({ width: DISC_SIZE, height: DISC_SIZE, src: avatarDataUri(avatar), style: { objectFit: 'cover' } }),
    ]);
  }

  const cleanedName = sanitiseField(card.displayName);
  const initials = initialsFor(cleanedName);
  const gradientStyle: Record<string, unknown> = {
    ...discStyle,
    backgroundImage: 'linear-gradient(135deg, #6B61FF, #C04BF2)',
  };
  if (initials) {
    return h(
      'div',
      gradientStyle,
      h(
        'span',
        { display: 'block', fontFamily: FONT_FAMILY, fontWeight: 800, fontSize: 64, color: '#FFFFFF' },
        initials,
      ),
    );
  }
  return h('div', gradientStyle, img({ width: 96, height: 96, src: BUBBLE_MARK_DATA_URI }));
}

const FONT_FAMILY = 'PJS, PJSX, PJSV, NSC, NSG';

const textNodeBase: Record<string, unknown> = {
  display: 'block',
  wordBreak: 'break-word',
  fontFamily: FONT_FAMILY,
};

function buildTextColumn(card: OgCard): Node[] {
  const name = fieldForImage(card.displayName);
  const role = fieldForImage(card.role);
  const company = fieldForImage(card.company);
  const line = roleLine(role, company);
  const roleLineText = line ? fieldForImage(line) : null;

  const children: Node[] = [];
  if (name) {
    children.push(
      h(
        'span',
        {
          ...textNodeBase,
          fontWeight: 800,
          fontSize: 54,
          lineHeight: 1.08,
          letterSpacing: -1,
          color: '#FFFFFF',
          lineClamp: 2,
        },
        name,
      ),
    );
  }
  if (roleLineText) {
    children.push(
      h(
        'span',
        {
          ...textNodeBase,
          fontWeight: 600,
          fontSize: 28,
          lineHeight: 1.25,
          color: '#D4CEFF',
          marginTop: 12,
          lineClamp: 2,
        },
        roleLineText,
      ),
    );
  }
  return children;
}

/** Builds the whole 1200x630 tree: the plate as a full-bleed background, then the dynamic content. */
export function buildCardTree(card: OgCard, avatar: OgAvatar | null, plateDataUri: string): Node {
  const headline = fieldForImage(card.headline);
  const textColumn = buildTextColumn(card);

  const row = h(
    'div',
    { display: 'flex', flexDirection: 'row', alignItems: 'center' },
    [buildAvatar(card, avatar), h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: 34, width: 460 }, textColumn)],
  );

  const contentChildren: Node[] = [row];
  if (headline) {
    contentChildren.push(
      h(
        'span',
        {
          ...textNodeBase,
          fontWeight: 400,
          fontSize: 26,
          lineHeight: 1.3,
          color: 'rgba(255,255,255,0.82)',
          marginTop: 30,
          width: 668,
          lineClamp: 2,
        },
        headline,
      ),
    );
  }

  const content = h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      position: 'absolute',
      left: 72,
      top: 132,
      width: 668,
      height: 374,
    },
    contentChildren,
  );

  return h('div', { display: 'flex', width: 1200, height: 630, position: 'relative' }, [
    img({ width: 1200, height: 630, src: plateDataUri, style: { position: 'absolute', left: 0, top: 0 } }),
    content,
  ]);
}
