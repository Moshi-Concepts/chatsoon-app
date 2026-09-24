import { bookingOpenUrl, bookingProviderName, type BookingLink } from '@chatsoon/shared';
import { Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text, type IconName } from '@/components/ui';
import { externalLinkProps } from '@/components/web/link-props';
import { firstName } from '@/components/web/profile-card';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showError } from '@/lib/dialogs';

import { BookingEmbed } from './booking-embed';
import { embedDomain } from './embed-domain';

/** Modal sheet that loads a booking link: react-native-webview on native, an iframe on web. */
export function BookingSheet({
  link,
  ownerName,
  onClose,
}: {
  link: BookingLink | null;
  ownerName: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={!!link}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}>
      {/* Unmounts when hidden, so the webview/iframe doesn't keep loading in the background. */}
      {link ? <SheetBody link={link} ownerName={ownerName} onClose={onClose} /> : null}
    </Modal>
  );
}

function SheetBody({ link, ownerName, onClose }: { link: BookingLink; ownerName: string; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const url = bookingOpenUrl(link);
  // An iOS page sheet starts below the status bar, so only full-screen modals need the top inset.
  const top = Platform.OS === 'ios' ? 0 : insets.top;

  return (
    <View style={[styles.flex, { backgroundColor: theme.surface, paddingTop: top, paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerText}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {link.label}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            with {firstName(ownerName)} · {bookingProviderName(link.provider)}
          </Text>
        </View>
        {Platform.OS === 'web' ? (
          <HeaderButton icon="open-outline" label="Open in browser" url={url} />
        ) : (
          <HeaderButton
            icon="open-outline"
            label="Open in browser"
            onPress={() => void Linking.openURL(url).catch((err: unknown) => showError(err, "Couldn't open the link"))}
          />
        )}
        <HeaderButton icon="close" label="Close" onPress={onClose} />
      </View>
      <View style={styles.body}>
        <BookingEmbed link={link} embedDomain={embedDomain()} />
      </View>
    </View>
  );
}

/** Icon-only header button. Pass `url` for a real web link (new tab); pass `onPress` otherwise. */
function HeaderButton({
  icon,
  label,
  onPress,
  url,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  url?: string;
}) {
  const theme = useTheme();
  const linkProps = url ? externalLinkProps(url, { newTab: true }) : { onPress, accessibilityRole: 'button' as const };
  return (
    <Pressable
      {...linkProps}
      hitSlop={10}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.headerButton, { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size={18} color="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 2 },
  headerButton: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
});
