// The fixture set for scripts/preview.ts's sheet and test/render.test.ts's coverage (docs/og-plan.md
// §2.3). One module so the preview and the tests can't drift apart. `--slug` (a real profile, fetched
// over the network) is preview.ts's own concern and isn't a fixture here.
//
// The two embedded images are tiny synthetic headshots (a circle-and-shoulders shape on a flat
// background) baked in as base64 so this module needs no filesystem access — it has to load in
// workerd for render.test.ts, same as everything else in src/.

import type { OgAvatar, OgCard } from '@chatsoon/shared/src/og';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 120x120, generated with sharp from a plain SVG shape — not a real photo.
const SAMPLE_JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAB4AHgDASIAAhEBAxEB/8QAHAABAAIDAQEBAAAAAAAAAAAAAAUHBAYIAwEC/8QANBAAAQQBAQUGBAUFAQAAAAAAAAECAwQFBhESITFRByJBYYGRQqGxwTJDcYLRFBckNeGy/8QAGQEBAAMBAQAAAAAAAAAAAAAAAAECAwQF/8QAGxEBAQEAAwEBAAAAAAAAAAAAAAERAgMhQTH/2gAMAwEAAhEDEQA/AL7AB4z0AAAAAAAAAAAAAAAAAAAAAAAAA8bVmCpA6a1NHDE3m97kaiepHamztXAY51q0u89e7FEi8ZHdP06qUhqDPXs7bWa9KqtRe5E3gxieSffmRbi/DheSz8l2kYes5WVWT23J8TG7rfdePyIr+6bN7/UO3ev9Rx/8lYArtbTr4rlxvaRh7LkZaZPUcvxPbvN904/I3CrZgtwNmqzRzRO5PY5HIvqhzUSun87ewVtJqMqo1V78TuLHp5p9+ZOq8uqfHQwIjTOdrZ/GttVu65O7JEq8Y3dP06KS5ZhZgAAAAAAAAfOXM+kNrG2tLS+SnYuxyQq1F6K7uovzCZNuKc1tnH5zOzTNcq1YlWOBvhup4+vP26EAAUdcmeAAISAACf0RnHYPOwzOcqVZVSOdPDdXx9Ofv1L758jmU6C0dbdd0vjZ3rtcsKNcvVW91V+RaMO2fUyACzEAAAAADW+0RiyaMyTW80ax3oj2qv0NkMbJVGXsfZqSfgnjdGq9NqbNoTLl1zaD2t15KlqavO3dlierHJ0VF2HiZusAASAAAXx2dxrHozGtdzVr3eivcqfUo2nXlt2oa8Dd6WV6ManVVXYdGY2oyjj61SP8EEbY0XrsTZtLRj23zGSACzAAAAAAAABWvahpd8yuzNCPecif5LGpxVE5PT7+/Uq46RyV+rjaj7N6ZkMDebnePkieK+RRWrLmJvZJ02GqS1mOXa/eVEa5eqN+H39EK2N+vlbMQYAKtgAnNJXMTRyTZs1Ulssaqbm6qK1q9Vb8Xv6KSi+N17LtLvhVuZvxq1ypsrMcnFEXm9ft79CyjFxt+rkqjLNGZk0DuTm+HkqeC+RlFo5eVtvoACVQAAAAAPy97Y2Oe9Ua1qbVVeSIfo1/X1h1XSGTkYuxyxpH6OcjV+oTJtxUestQzagyr5N5yU41VsEfgidV81/4QABR1yZ4AAhIAAJ/RuoZtP5Vkm85acio2ePwVOqeaf8AC+mPbIxr2KjmuTaipyVDmYvvQNh1rSGMkeu1UjWP0a5Wp9C0Yds+tgABZiAAAAABrPaQ1XaLySIm1dka+0jVNmMTK0mZHG2qcvBk8bo1XptTn6BMuXXN4Pe/UmoXZqtlismicrHJ5oeBm6wABIAABevZu1W6LxqLwXZIvvI5SkaFSa/dhq1mK+aVyManmp0ViqbMdjatOLiyCNsaL12JzLRj23zGUACzAAAAAAAABqetdHwagYliBzYMgxNiPVO69Ojv5KlyunsripHNu0pmtT8xrd5i/uTgARY16+d/EUACjoCVxWnsrlZGtp0pnNX8xzd1ifuXgATFeVyatrRWj4NPsWxO5s+QemxXondYnRv8m2AF3LbbdoAAgAAH/9k=';

// 120x120 PNG, same synthetic shape, same generator.
const SAMPLE_PNG_BASE64 =
  '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';

export const SAMPLE_JPEG_AVATAR: OgAvatar = { type: 'image/jpeg', bytes: decodeBase64(SAMPLE_JPEG_BASE64) };
export const SAMPLE_PNG_AVATAR: OgAvatar = { type: 'image/png', bytes: decodeBase64(SAMPLE_PNG_BASE64) };

export interface OgFixture {
  /** File-name-safe id: scripts/preview.ts writes `preview/<id>.jpg`. */
  id: string;
  /** One line under the thumbnail on the contact sheet. */
  label: string;
  card: OgCard;
  avatar: OgAvatar | null;
}

function repeat(base: string, length: number, fill = '·'): string {
  return base.length >= length ? base.slice(0, length) : `${base} ${fill.repeat(length - base.length - 1)}`;
}

export const FIXTURES: OgFixture[] = [
  {
    id: 'photo',
    label: 'Photo, role, company and headline',
    card: {
      displayName: 'Priya Natarajan',
      role: 'Founder',
      company: 'Analytical Engines',
      headline: 'Building the future of computing, one card at a time',
    },
    avatar: SAMPLE_JPEG_AVATAR,
  },
  {
    id: 'initials-no-headline',
    label: 'Initials fallback, no headline',
    card: { displayName: 'Marcus Chen', role: 'Product Designer', company: 'Northwind Labs', headline: null },
    avatar: null,
  },
  {
    id: 'max-length',
    // Full explanation: every field at its schema maximum, 80/80/80/120 (name/role/company/headline).
    label: 'All fields at max length',
    card: {
      displayName: repeat('Alexandra Featherington-Worthington-Van Der Berg', 80),
      role: repeat('Senior Vice President of Global Partnerships and Strategic Alliances', 80),
      company: repeat('International Consolidated Ventures and Holdings Group Limited', 80),
      headline: repeat(
        'Helping ambitious founders build category-defining companies across every market we touch and beyond',
        120,
      ),
    },
    avatar: null,
  },
  {
    id: 'name-only',
    label: 'No role, company or headline',
    card: { displayName: 'Sam Rivera', role: null, company: null, headline: null },
    avatar: null,
  },
  {
    id: 'vietnamese',
    label: 'Vietnamese diacritics',
    card: {
      displayName: 'Nguyễn Thị Phương',
      role: 'Giám đốc',
      company: 'Công ty Ánh Dương',
      headline: 'Kết nối những người sáng tạo tại sự kiện',
    },
    avatar: null,
  },
  {
    id: 'cyrillic',
    label: 'Cyrillic',
    card: {
      displayName: 'Екатерина Смирнова',
      role: 'Директор',
      company: 'Северный Свет',
      headline: 'Помогаем командам расти быстрее',
    },
    avatar: null,
  },
  {
    id: 'greek',
    label: 'Greek',
    card: {
      displayName: 'Ελένη Παπαδοπούλου',
      role: 'Ιδρύτρια',
      company: 'Ελληνικές Λύσεις',
      headline: 'Συνδέουμε ανθρώπους σε εκδηλώσεις',
    },
    avatar: null,
  },
  {
    id: 'cjk-name',
    // Full explanation: dropped from the image for lack of coverage; profileOgTitle still uses it.
    label: 'CJK name (dropped from image)',
    card: { displayName: '田中太郎', role: 'Founder', company: 'Acme', headline: 'Building things people love' },
    avatar: null,
  },
  {
    id: 'emoji-name',
    label: 'Emoji in name (stripped)',
    card: { displayName: '🚀 Jamie Fox 🔥', role: 'Growth', company: 'Rocketeer', headline: null },
    avatar: null,
  },
  {
    id: 'png-avatar',
    label: 'PNG avatar',
    card: { displayName: 'Riley Okafor', role: 'CTO', company: 'Fintual', headline: 'Scaling payments infra' },
    avatar: SAMPLE_PNG_AVATAR,
  },
  {
    id: 'webp-avatar-fallback',
    label: 'WebP avatar (falls back to initials)',
    card: { displayName: 'Owen Bright', role: 'Sales Lead', company: 'Bright Co', headline: null },
    // Not a real fixture of a WebP file: `OgAvatar.type` only ever admits jpeg/png (packages/shared/src/og.ts),
    // because the API's avatar guard (docs/og-plan.md §2.2) rejects WebP before this Worker ever sees it.
    // `null` here is exactly what chatsoon-og receives in that case.
    avatar: null,
  },
];
