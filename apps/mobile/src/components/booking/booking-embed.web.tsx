import { bookingEmbedUrl, bookingOpenUrl, type BookingLink } from '@chatsoon/shared';
import { createElement } from 'react';

// Web booking embed: a plain iframe. BookingLinksCard only opens the sheet for links that embed,
// so bookingEmbedUrl is non-null here; bookingOpenUrl is just a defensive fallback.
// No sandbox: providers need scripts, forms and popups to run their booking flow.
export function BookingEmbed({ link, embedDomain }: { link: BookingLink; embedDomain: string }) {
  const src = bookingEmbedUrl(link, embedDomain) ?? bookingOpenUrl(link);
  return createElement('iframe', {
    title: `Booking calendar: ${link.label}`,
    src,
    style: { border: 0, width: '100%', height: '100%' },
  });
}
