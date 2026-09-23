import { WEB_ORIGIN } from '@chatsoon/shared';
import { Link } from 'expo-router';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Avatar, Button, Chip, Icon, Text, type IconName } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Container, useBreakpoint } from './layout';
import { PageHead } from './page-head';
import { WebPage } from './web-page';

// Marketing home page at chatsoon.app for signed-out web visitors. Copy follows the store listing.

const INTRO = 'Meet hundreds of people at a conference and remember every one of them.';
const PITCH =
  'Chatsoon is a networking CRM built for events. Share your profile with a QR code, capture the people you meet in seconds, and keep every conversation going long after the event ends.';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'qr-code-outline',
    title: 'Share your profile',
    body: "Show your QR code. Anyone can scan it and connect with you, even if they don't have the app. Their details land straight in your contacts.",
  },
  {
    icon: 'scan-outline',
    title: 'Capture in seconds',
    body: 'Snap a business card or event badge and Chatsoon fills in the details for you. Scan QR codes from Telegram, LinkedIn, X or a digital business card. Or type a name and move on.',
  },
  {
    icon: 'pricetags-outline',
    title: 'Organise everyone',
    body: 'Tag people as sponsors, investors, advisors, collaborators or anything you like. Add notes, set priority, and group contacts by the event where you met.',
  },
  {
    icon: 'search-outline',
    title: 'Find anyone fast',
    body: 'Search by name, company, tag or notes. Tap to message on Telegram, email, LinkedIn or X.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Private by design',
    body: 'Your notes and tags are yours alone. Connections only see your public profile. Export your data or delete your account anytime.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Show your QR', body: "Open My QR at the event. It's your profile, ready to scan." },
  { title: 'They scan it', body: 'With Chatsoon, or just their phone camera. No app needed.' },
  { title: 'Follow up', body: 'Their details land in your contacts, ready for a note and a tag.' },
];

export function Landing() {
  return (
    <WebPage>
      <PageHead description={`${INTRO} ${PITCH}`} />
      <Hero />
      <Features />
      <Steps />
      <ClosingCta />
    </WebPage>
  );
}

function ComingSoon() {
  return (
    <View style={styles.comingSoon}>
      <Icon name="phone-portrait-outline" size={16} color="textSecondary" />
      <Text variant="callout" color="textSecondary">
        Coming soon to the App Store and Google Play
      </Text>
    </View>
  );
}

function Hero() {
  const theme = useTheme();
  const { isWide, isMedium } = useBreakpoint();
  const titleSize = isWide ? 68 : isMedium ? 56 : 42;
  const title = { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.05) };

  return (
    <Container style={[styles.hero, isWide && styles.heroWide]}>
      <View style={[styles.heroCopy, isWide && styles.heroCopyWide]}>
        <View style={[styles.eyebrow, { backgroundColor: theme.primarySoft }]}>
          <Icon name="sparkles" size={14} color="primary" />
          <Text variant="captionStrong" color="primary">
            The networking CRM built for events
          </Text>
        </View>
        <Text role="heading" style={[styles.heroTitle, title]}>
          Meet people.{'\n'}
          <Text color="primary" style={[styles.heroTitle, title]}>
            Follow up.
          </Text>
        </Text>
        <Text style={[styles.lead, !isMedium && styles.leadSmall]}>{INTRO}</Text>
        <Text variant="body" color="textSecondary" style={styles.pitch}>
          {PITCH}
        </Text>
        <View style={isMedium ? styles.ctaRow : styles.ctaColumn}>
          <Link href="/sign-in" asChild>
            <Button title="Get started" fullWidth={!isMedium} style={isMedium ? styles.cta : undefined} />
          </Link>
          <Text variant="callout" color="textSecondary" align={isMedium ? 'left' : 'center'}>
            Free, and ready on the web today.
          </Text>
        </View>
        <ComingSoon />
      </View>
      <HeroVisual />
    </Container>
  );
}

/** Decorative app preview: a My QR screen and a freshly captured contact. */
function HeroVisual() {
  const theme = useTheme();
  const { isWide, isMedium } = useBreakpoint();
  // The QR sits on a light tile in both themes so it always scans.
  const qr = Colors.light;
  const shadow = { boxShadow: `0 28px 60px -28px ${theme.overlay}` };

  return (
    <View aria-hidden style={[styles.visual, isWide && styles.visualWide]}>
      <View style={[styles.halo, { backgroundColor: theme.primarySoft }]} />
      <View style={[styles.phone, shadow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.notch, { backgroundColor: theme.surfaceAlt }]} />
        <Text variant="captionStrong" color="textSecondary">
          My QR
        </Text>
        <Avatar name="Alex Rivera" size={60} />
        <View style={styles.phoneName}>
          <Text variant="subheading">Alex Rivera</Text>
          <Text variant="caption" color="textSecondary">
            Partnerships at Northwind
          </Text>
        </View>
        <View style={[styles.qrTile, { backgroundColor: qr.surface, borderColor: theme.border }]}>
          <QRCode value={WEB_ORIGIN} size={148} color={qr.text} backgroundColor={qr.surface} />
        </View>
        <Text variant="small" color="textTertiary">
          chatsoon.app/id/alex-rivera
        </Text>
      </View>

      <View
        style={[
          styles.contactCard,
          shadow,
          isMedium ? styles.contactCardFloating : styles.contactCardStacked,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}>
        <View style={styles.contactHead}>
          <Avatar name="Priya Shah" size={40} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">Priya Shah</Text>
            <Text variant="caption" color="textSecondary">
              Founder at Loop
            </Text>
          </View>
          <View style={[styles.newBadge, { backgroundColor: theme.successSoft }]}>
            <Text variant="small" color="success">
              New
            </Text>
          </View>
        </View>
        <View style={styles.chips}>
          <Chip label="Investor" />
          <Chip label="Token2049" icon="calendar-outline" />
        </View>
        <View style={styles.contactFoot}>
          <Icon name="sparkles" size={14} color="accent" />
          <Text variant="small" color="textSecondary">
            Filled in from a card photo
          </Text>
        </View>
      </View>
    </View>
  );
}

function SectionHead({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  const { isMedium } = useBreakpoint();
  return (
    <View style={styles.sectionHead}>
      <Text variant="captionStrong" color="primary" align="center" style={styles.kicker}>
        {kicker.toUpperCase()}
      </Text>
      <Text align="center" style={[styles.sectionTitle, !isMedium && styles.sectionTitleSmall]}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" color="textSecondary" align="center" style={styles.sectionSubtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function Features() {
  const theme = useTheme();
  const { isWide, isMedium } = useBreakpoint();
  const cols = isWide ? 3 : isMedium ? 2 : 1;
  // Percentage cells (with half-gap padding) so the grid never depends on measured widths.
  const cellWidth = (i: number): DimensionValue => {
    if (cols === 3) return i < 3 ? '33.333%' : '50%';
    if (cols === 2) return i === FEATURES.length - 1 && FEATURES.length % 2 === 1 ? '100%' : '50%';
    return '100%';
  };

  return (
    <View style={[styles.band, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Container style={styles.bandInner}>
        <SectionHead
          kicker="Why Chatsoon"
          title="Every hello, ready to follow up"
          subtitle="Built for the busiest week of your year: conferences, meetups and trade shows."
        />
        <View style={styles.grid}>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={[styles.cell, { width: cellWidth(i) }]}>
              <View style={[styles.feature, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <View style={[styles.featureIcon, { backgroundColor: theme.primarySoft }]}>
                  <Icon name={f.icon} size={24} color="primary" />
                </View>
                <Text variant="heading">{f.title}</Text>
                <Text variant="callout" color="textSecondary" style={styles.featureBody}>
                  {f.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Container>
    </View>
  );
}

function Steps() {
  const theme = useTheme();
  const { isMedium } = useBreakpoint();
  return (
    <Container style={styles.bandInner}>
      <SectionHead kicker="How connecting works" title="Swap details in one scan" />
      <View style={[styles.steps, isMedium && styles.stepsRow]}>
        {STEPS.map((s, i) => (
          <View key={s.title} style={[styles.step, isMedium && styles.flex]}>
            <View style={[styles.stepNumber, { backgroundColor: theme.primary }]}>
              <Text variant="bodyStrong" color="onPrimary">
                {i + 1}
              </Text>
            </View>
            <View style={styles.stepText}>
              <Text variant="subheading">{s.title}</Text>
              <Text variant="callout" color="textSecondary">
                {s.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Container>
  );
}

function ClosingCta() {
  const theme = useTheme();
  const { isMedium } = useBreakpoint();
  return (
    <Container style={styles.closingWrap}>
      <View style={[styles.closing, { backgroundColor: theme.primary }]}>
        <Text color="onPrimary" align="center" style={[styles.sectionTitle, !isMedium && styles.sectionTitleSmall]}>
          Meet people. Follow up.
        </Text>
        <Text variant="body" color="onPrimary" align="center" style={styles.closingText}>
          Chatsoon is coming soon to the App Store and Google Play. Start on the web today and take it to your next
          event.
        </Text>
        <Link href="/sign-in" asChild>
          <Button title="Get started" variant="secondary" fullWidth={false} style={styles.ctaCentre} />
        </Link>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  hero: { paddingTop: Spacing.seven, paddingBottom: Spacing.seven, gap: Spacing.seven },
  heroWide: { flexDirection: 'row', alignItems: 'center', paddingTop: 72, paddingBottom: 96 },
  heroCopy: { gap: Spacing.five },
  heroCopyWide: { flex: 1.1 },
  eyebrow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  heroTitle: { fontWeight: '800', letterSpacing: -1.5 },
  lead: { fontSize: 22, lineHeight: 30, fontWeight: '600' },
  leadSmall: { fontSize: 19, lineHeight: 26 },
  pitch: { fontSize: 17, lineHeight: 26, maxWidth: 560 },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.four },
  ctaColumn: { gap: Spacing.three },
  cta: { paddingHorizontal: Spacing.six, alignSelf: 'center' },
  ctaCentre: { paddingHorizontal: Spacing.six, alignSelf: 'center' },
  comingSoon: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  visual: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'center', paddingVertical: Spacing.four },
  visualWide: { flex: 1 },
  halo: { position: 'absolute', top: '8%', width: '86%', aspectRatio: 1, borderRadius: Radius.pill },
  phone: {
    width: 280,
    borderRadius: 36,
    borderWidth: 1,
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    alignItems: 'center',
    gap: Spacing.three,
  },
  notch: { width: 88, height: 6, borderRadius: 3, marginBottom: Spacing.two },
  phoneName: { alignItems: 'center', gap: 2 },
  qrTile: { padding: Spacing.three, borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth },
  contactCard: { width: 260, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.four, gap: Spacing.three },
  contactCardFloating: { position: 'absolute', left: 0, bottom: 0 },
  contactCardStacked: { marginTop: -Spacing.four, marginLeft: -Spacing.six },
  contactHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  newBadge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.pill },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  contactFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  band: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  bandInner: { paddingVertical: 72, gap: Spacing.six },
  sectionHead: { alignItems: 'center', gap: Spacing.three, alignSelf: 'center', maxWidth: 640 },
  kicker: { letterSpacing: 1.2 },
  sectionTitle: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -0.8 },
  sectionTitleSmall: { fontSize: 30, lineHeight: 36 },
  sectionSubtitle: { fontSize: 17, lineHeight: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.three },
  cell: { padding: Spacing.three },
  feature: {
    flex: 1,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.five,
    gap: Spacing.three,
  },
  featureIcon: { width: 48, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  featureBody: { lineHeight: 23 },

  steps: { gap: Spacing.five },
  stepsRow: { flexDirection: 'row', gap: Spacing.six },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  stepNumber: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: Spacing.one },

  closingWrap: { paddingBottom: 72 },
  closing: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing.seven,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    gap: Spacing.four,
  },
  closingText: { maxWidth: 520, opacity: 0.9, fontSize: 17, lineHeight: 26 },
});
