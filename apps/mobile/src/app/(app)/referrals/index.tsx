import { BADGE_LABELS, type GetReferralResponse, type MilestoneBadge, type ReferralAttribution, type ReferralListItem } from '@chatsoon/shared';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Share, StyleSheet, View } from 'react-native';

import { Pill } from '@/components/contacts/pill';
import { ProfileQrCard } from '@/components/profile';
import { ProgressRing } from '@/components/referrals/progress-ring';
import { Avatar, Button, Card, Checkbox, EmptyState, Icon, ListRow, Screen, Text, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { openExternalUrl } from '@/lib/browser';
import { showAlert, showError } from '@/lib/dialogs';
import { formatDate } from '@/lib/format';
import { useAttributeReferral, useClaimReferral, useReferral } from '@/lib/queries';
import { referralAttributeErrorMessage } from '@/lib/referral-errors';
import { referralProgress } from '@/lib/referral-progress';
import { clearPendingReferralCode, getPendingReferralCode } from '@/lib/storage';

// The referral hub (issue #11, docs/referrals.md "Referral hub"). REFERRAL_ENABLED off: a short
// "coming soon" state, since the entry points that lead here (Me tab, QR tab) are hidden while it's
// off, but a stale link or bookmark can still open this screen directly.

const CONSENT_TEXT = 'Share my name and email with Learn Cardano Bounties so they can process the reward';
/** POST /me/referral/claims's token TTL (apps/api/src/lib/referrals.ts's CLAIM_TOKEN_TTL_MS). The wire
 * shape (docs/referrals.md "API") has no separate "issued at" field, so the claim date shown here is
 * derived from the token's expiry - exact for a fresh claim, and still a fair "around when" once a
 * long-expired token has been silently rotated by reopening the reward page. */
async function copyLink(link: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(link);
  } catch (err) {
    showError(err, "Couldn't copy the link");
    return false;
  }
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return true;
}

/** Same shape as the QR tab's own share helper: native share sheet, Web Share API, or copy. */
async function shareLink(link: string): Promise<boolean> {
  if (Platform.OS !== 'web') {
    const content = Platform.OS === 'ios' ? { url: link } : { message: `Join me on Chatsoon: ${link}`, title: 'Invite a friend to Chatsoon' };
    try {
      await Share.share(content, { dialogTitle: 'Share your invite link' });
    } catch (err) {
      showError(err, "Couldn't open the share sheet");
    }
    return false;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Invite a friend to Chatsoon', url: link });
      return false;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return false;
    }
  }
  if (!(await copyLink(link))) return false;
  showAlert('Link copied', 'Paste it anywhere to share your invite link.');
  return true;
}

export default function ReferralsHubScreen() {
  const theme = useTheme();
  const referral = useReferral();
  const [copied, setCopied] = useState(false);

  if (referral.data && !referral.data.enabled) {
    return (
      <Screen edges={['bottom']} contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'Invite friends' }} />
        <EmptyState icon="gift-outline" title="Referrals are coming soon" message="Check back soon to start inviting friends and earning points." />
      </Screen>
    );
  }

  if (!referral.data) {
    if (referral.isError) {
      return (
        <Screen edges={['bottom']} contentStyle={styles.loading}>
          <Stack.Screen options={{ title: 'Invite friends' }} />
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load your referrals"
            message={referral.error.message}
            action={
              <Button title="Try again" icon="refresh" variant="secondary" fullWidth={false} loading={referral.isFetching} onPress={() => void referral.refetch()} />
            }
          />
        </Screen>
      );
    }
    return (
      <Screen edges={['bottom']} contentStyle={styles.loading}>
        <Stack.Screen options={{ title: 'Invite friends' }} />
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  const data = referral.data;
  const progress = referralProgress(data);
  const displayLink = data.link.replace(/^https?:\/\//, '');

  const onCopy = async () => {
    if (await copyLink(data.link)) setCopied(true);
  };
  const onShare = async () => {
    if (await shareLink(data.link)) setCopied(true);
  };

  return (
    <Screen edges={['bottom']} onRefresh={() => void referral.refetch()} refreshing={referral.isRefetching} contentStyle={styles.content}>
      <Stack.Screen options={{ title: 'Invite friends' }} />

      <HeaderCard data={data} progressLabel={progress.line} ring={progress.ratio} centerLabel={progress.centerLabel} />

      <Card style={styles.linkCard}>
        <Text variant="captionStrong" color="textSecondary">
          Your link
        </Text>
        <Text variant="bodyStrong" color="primary" selectable numberOfLines={1}>
          {displayLink}
        </Text>
        <View style={styles.linkActions}>
          <Button title="Share" icon="share-outline" onPress={() => void onShare()} style={styles.flex} />
          <Button
            title={copied ? 'Copied' : 'Copy link'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            variant="secondary"
            onPress={() => void onCopy()}
            style={styles.flex}
          />
        </View>
        <View style={styles.qrWrap}>
          <ProfileQrCard value={data.link} size={140} accessibilityLabel="QR code for your invite link" />
        </View>
        <Button title="Invite contacts" icon="people-outline" variant="secondary" onPress={() => router.push('/referrals/invite')} />
      </Card>

      {data.canEnterCode ? <EnterCodeCard /> : null}

      {data.qualifiedCount >= data.claimThreshold ? <ClaimCard data={data} /> : null}

      {data.attribution ? <AttributionCard attribution={data.attribution} /> : null}

      <View style={styles.listHeader}>
        <Text variant="heading">Your referrals</Text>
      </View>
      {data.referrals.length === 0 ? (
        <EmptyState icon="people-outline" title="No referrals yet" message="Share your link to get started." />
      ) : (
        <View style={styles.list}>
          {data.referrals.map((item) => (
            <ReferralRow key={item.id} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function HeaderCard({ data, progressLabel, ring, centerLabel }: { data: GetReferralResponse; progressLabel: string; ring: number; centerLabel: string }) {
  const founderReached = data.qualifiedCount >= data.founderThreshold;
  const claimReached = data.qualifiedCount >= data.claimThreshold;
  const founderLabel = data.milestoneBadge ? BADGE_LABELS[data.milestoneBadge.badge] : data.founderSpotsLeft > 0 ? 'Founding member' : 'Early adopter';

  return (
    <Card style={styles.headerCard}>
      <View style={styles.ringRow}>
        <ProgressRing progress={ring} centerLabel={centerLabel} />
        <View style={styles.ringText}>
          <Text variant="bodyStrong">{progressLabel}</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text variant="title">{data.pendingCount}</Text>
              <Text variant="caption" color="textSecondary">
                Pending
              </Text>
            </View>
            <View style={styles.stat}>
              <Text variant="title">{data.pointsBalance}</Text>
              <Text variant="caption" color="textSecondary">
                Points
              </Text>
            </View>
          </View>
        </View>
      </View>

      <MilestoneStrip founderLabel={founderLabel} founderReached={founderReached} claimReached={claimReached} />

      {data.milestoneBadge ? (
        <BadgeCard badge={data.milestoneBadge} />
      ) : (
        <Text variant="caption" color="textSecondary">
          {data.founderSpotsLeft > 0
            ? `Refer 10 people to become a Founding member. ${data.founderSpotsLeft} of 100 founder spots left.`
            : 'Refer 10 people to become an Early adopter.'}
        </Text>
      )}
    </Card>
  );
}

function MilestoneStrip({ founderLabel, founderReached, claimReached }: { founderLabel: string; founderReached: boolean; claimReached: boolean }) {
  return (
    <View style={styles.strip}>
      <MilestoneStep label={`10 · ${founderLabel}`} reached={founderReached} />
      <View style={styles.stripSpacer} />
      <MilestoneStep label="20 · Reward" reached={claimReached} />
    </View>
  );
}

function MilestoneStep({ label, reached }: { label: string; reached: boolean }) {
  return (
    <View style={styles.step}>
      <Icon name={reached ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={reached ? 'success' : 'textTertiary'} />
      <Text variant="captionStrong" color={reached ? 'text' : 'textSecondary'}>
        {label}
      </Text>
    </View>
  );
}

function BadgeCard({ badge }: { badge: MilestoneBadge }) {
  const theme = useTheme();
  const founder = badge.badge === 'founder';
  const label = founder && badge.seq ? `${BADGE_LABELS[badge.badge]} #${badge.seq}` : BADGE_LABELS[badge.badge];
  return (
    <View style={[styles.badgeCard, { backgroundColor: founder ? theme.primarySoft : theme.surfaceAlt }]}>
      <Icon name="ribbon" size={22} color={founder ? 'primaryText' : 'textSecondary'} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">
          {label} since {formatDate(badge.awardedAt)}
        </Text>
        <Text variant="caption" color="textSecondary">
          You helped build Chatsoon. This stays on your profile for good.
        </Text>
      </View>
    </View>
  );
}

function EnterCodeCard() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  // 'link' only until the field is prefilled and left untouched; any edit makes it a typed entry.
  const [source, setSource] = useState<'typed' | 'link'>('typed');
  const attribute = useAttributeReferral();

  // A code captured from a link (storage.ts's pendingReferralCode) but not yet attributed - e.g. this
  // user was already signed in and onboarded when they tapped /r/<code> - opens pre-filled and expanded
  // so confirming it is a single tap (docs/referrals.md "How attribution works").
  useEffect(() => {
    void getPendingReferralCode().then((pending) => {
      if (pending) {
        setCode(pending.code);
        setSource('link');
        setOpen(true);
      }
    });
  }, []);

  const submit = () => {
    const trimmed = code.trim();
    if (!trimmed || attribute.isPending) return;
    attribute.mutate(
      { code: trimmed, source },
      {
        onSuccess: () => {
          void clearPendingReferralCode();
          setOpen(false);
          setCode('');
          showAlert('Code applied', "You'll earn a point, and we'll let your friend know.");
        },
        onError: (err) => showError(err, referralAttributeErrorMessage(err)),
      },
    );
  };

  if (!open) {
    return (
      <Card padded={false}>
        <ListRow icon="keypad-outline" title="Enter a code" onPress={() => setOpen(true)} />
      </Card>
    );
  }

  return (
    <Card style={styles.enterCode}>
      <Text variant="bodyStrong">Enter a code</Text>
      <TextField
        placeholder="ABCD2345"
        value={code}
        onChangeText={(v) => {
          setCode(v.toUpperCase());
          setSource('typed');
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      <View style={styles.linkActions}>
        <Button title="Apply" onPress={submit} loading={attribute.isPending} disabled={!code.trim()} style={styles.flex} />
        <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} disabled={attribute.isPending} style={styles.flex} />
      </View>
    </Card>
  );
}

function ClaimCard({ data }: { data: GetReferralResponse }) {
  const theme = useTheme();
  const claim = useClaimReferral();
  const [consent, setConsent] = useState(false);

  const submitClaim = () => {
    if (claim.isPending) return;
    claim.mutate(
      { shareConsent: true, consentText: CONSENT_TEXT },
      {
        onSuccess: ({ url }) => void openExternalUrl(url, theme, "Couldn't open your reward page"),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'referral_claim_open' && err.url) {
            void openExternalUrl(err.url, theme, "Couldn't open your reward page");
            return;
          }
          showError(err, "Couldn't claim your reward");
        },
      },
    );
  };

  const openRewardPage = () => {
    if (data.claim?.url) {
      void openExternalUrl(data.claim.url, theme, "Couldn't open your reward page");
      return;
    }
    if (data.claim?.status === 'redeemed') {
      showAlert('Already claimed', 'This reward has already been processed.');
      return;
    }
    // Expired token: re-issuing rotates it (the checkbox only gates the very first claim).
    submitClaim();
  };

  return (
    <Card style={styles.claimCard}>
      <View style={styles.claimHeader}>
        <Icon name="gift-outline" size={22} color="primary" />
        <Text variant="heading">Your reward</Text>
      </View>

      {!data.hasSocial ? (
        <>
          <Text variant="callout" color="textSecondary">
            Connect Google, Apple, LinkedIn, X or Discord to claim your reward.
          </Text>
          <Button title="Connect an account" icon="link-outline" variant="secondary" onPress={() => router.push('/connected-accounts')} />
        </>
      ) : data.claim ? (
        <>
          <Text variant="callout" color="textSecondary">
            {data.claim.claimedAt ? `Claimed on ${formatDate(data.claim.claimedAt)}` : 'Claimed'}
          </Text>
          <Button title="Open reward page" icon="open-outline" variant="secondary" onPress={openRewardPage} loading={claim.isPending} />
        </>
      ) : (
        <>
          <Text variant="callout" color="textSecondary">
            You've referred {data.claimThreshold} people. Claim your reward on Learn Cardano Bounties.
          </Text>
          <Checkbox checked={consent} onChange={setConsent} label={CONSENT_TEXT} />
          <Button title="Claim reward" icon="gift-outline" onPress={submitClaim} loading={claim.isPending} disabled={!consent} />
        </>
      )}
    </Card>
  );
}

function AttributionCard({ attribution }: { attribution: ReferralAttribution }) {
  const holdUntil = attribution.checklist.holdUntil;
  // `done` here means the hold has actually elapsed, not merely that a hold date is known - a fresh
  // attribution has a holdUntil in the future, and must not show a tick before that date arrives.
  const holdPassed = !!holdUntil && new Date(holdUntil).getTime() <= Date.now();
  return (
    <Card style={styles.attributionCard}>
      <Text variant="bodyStrong">Invited by {attribution.referrerName} · 1 point earned</Text>
      <ChecklistItem done={attribution.checklist.profile} label="Profile published" />
      {attribution.checklist.social ? (
        <ChecklistItem done label="Social account connected" />
      ) : (
        <ChecklistItem
          done={false}
          label="Social account connected"
          action={<Button title="Connect" size="sm" fullWidth={false} variant="secondary" onPress={() => router.push('/connected-accounts')} />}
        />
      )}
      <ChecklistItem done={holdPassed} label={holdUntil ? `7 day wait · qualifies ${formatDate(holdUntil)}` : '7 day wait'} />
    </Card>
  );
}

function ChecklistItem({ done, label, action }: { done: boolean; label: string; action?: ReactNode }) {
  return (
    <View style={styles.checklistRow}>
      <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? 'success' : 'textTertiary'} />
      <Text variant="callout" color="textSecondary" style={styles.flex}>
        {label}
      </Text>
      {action}
    </View>
  );
}

const OUTSTANDING_TEXT: Record<NonNullable<ReferralListItem['outstanding']>, string> = {
  profile: "hasn't published a profile yet",
  social: "hasn't connected a social account yet",
  hold: 'qualifies soon',
};

function ReferralRow({ item }: { item: ReferralListItem }) {
  const label = item.status === 'qualified' ? 'Qualified' : item.status === 'didnt_qualify' ? "Didn't qualify" : 'Pending';
  const tone = item.status === 'qualified' ? 'success' : item.status === 'didnt_qualify' ? 'neutral' : 'warning';
  const name = item.displayName ?? 'New sign-up';
  const outstanding =
    item.outstanding === 'hold' && item.qualifiesAfter ? `qualifies on ${formatDate(item.qualifiesAfter)}` : item.outstanding ? OUTSTANDING_TEXT[item.outstanding] : null;
  const openable = item.status === 'qualified' && !!item.slug;

  return (
    <ListRow
      left={<Avatar name={name} uri={item.avatarUrl} size={40} />}
      title={name}
      subtitle={outstanding}
      onPress={openable ? () => router.push({ pathname: '/id/[slug]', params: { slug: item.slug! } }) : undefined}
      chevron={openable}
      right={<Pill label={label} tone={tone} />}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: Spacing.four, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  headerCard: { gap: Spacing.four },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  ringText: { flex: 1, gap: Spacing.two },
  statsRow: { flexDirection: 'row', gap: Spacing.five },
  stat: { gap: 2 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stripSpacer: { flex: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 12, padding: Spacing.three },
  linkCard: { gap: Spacing.three },
  linkActions: { flexDirection: 'row', gap: Spacing.three },
  qrWrap: { alignItems: 'center', paddingVertical: Spacing.two },
  enterCode: { gap: Spacing.three },
  claimCard: { gap: Spacing.three },
  claimHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  attributionCard: { gap: Spacing.three },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  listHeader: { paddingTop: Spacing.two },
  list: { gap: Spacing.two },
});
