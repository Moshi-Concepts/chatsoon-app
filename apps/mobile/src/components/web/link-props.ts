import { Linking, Platform } from 'react-native';

import { showError } from '@/lib/dialogs';

type ExternalLinkProps = {
  accessibilityRole: 'link';
  onPress?: () => void;
};

/**
 * Props that turn a Pressable, Button or Text into a link to an external URL.
 * Web: react-native-web renders a real <a href> (so long-press, middle-click and crawlers work).
 * Native: opens the URL with the system handler (browser, Telegram, Mail and so on).
 */
export function externalLinkProps(url: string, opts: { newTab?: boolean } = {}): ExternalLinkProps {
  if (Platform.OS === 'web') {
    // href and hrefAttrs are react-native-web props that the React Native types don't declare.
    const web = {
      accessibilityRole: 'link' as const,
      href: url,
      hrefAttrs: opts.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : undefined,
    };
    return web as ExternalLinkProps;
  }
  return {
    accessibilityRole: 'link',
    onPress: () => {
      Linking.openURL(url).catch((err: unknown) => showError(err, "Couldn't open the link"));
    },
  };
}
