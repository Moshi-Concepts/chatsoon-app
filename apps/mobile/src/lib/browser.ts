import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type { ThemeColors } from '@/constants/theme';

import { showError } from './dialogs';

// Referrals (issue #11, docs/referrals.md "Referral hub"): "the claim flow opens the system browser,
// not a webview" - the same pattern the Me tab's "View my public page" already uses, pulled out here
// so the referral hub, invite picker and Connected accounts screens don't each reinvent it.

/** Opens an https URL in a new tab (web) or the system browser sheet (native), never a webview. */
export async function openExternalUrl(url: string, theme: ThemeColors, errorTitle = "Couldn't open that link"): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url, { controlsColor: theme.primary, toolbarColor: theme.background });
  } catch (err) {
    showError(err, errorTitle);
  }
}
