import { Platform } from 'react-native';

/** Domain sent to providers that need one (Calendly's embed_domain). The page's own host on web. */
export function embedDomain(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.host : 'chatsoon.app';
}
