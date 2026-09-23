import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';

// Cloudflare Turnstile (spam protection for the public Connect form). Web only: the app never
// shows the Connect form, so on iOS and Android this renders nothing.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | null | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads the Turnstile script once per page. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile did not initialise'));
      };
      script.onerror = () => {
        script.remove();
        scriptPromise = null; // allow a retry on the next mount
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export type TurnstileHandle = {
  /** Clears the current token and runs a fresh challenge. Tokens are single use, so call after every submit. */
  reset: () => void;
};

export type TurnstileProps = {
  /** Called with a token when the visitor passes, and with null when it expires or fails. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
};

export function Turnstile(props: TurnstileProps) {
  if (Platform.OS !== 'web') return null;
  return <TurnstileWidget {...props} />;
}

function TurnstileWidget({ onToken, ref }: TurnstileProps) {
  const containerRef = useRef<View>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The flexible widget needs at least 300px, so narrower columns get the compact one.
  // Nothing renders until the column has been measured.
  const [size, setSize] = useState<'flexible' | 'compact' | null>(null);

  const emit = useEffectEvent((token: string | null) => onToken(token));

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        onToken(null);
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
      },
    }),
    [onToken],
  );

  useEffect(() => {
    if (!size) return;
    const sitekey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        // react-native-web renders View as a DOM element, which is what Turnstile renders into.
        const el = containerRef.current as unknown as HTMLElement | null;
        if (cancelled || !el) return;
        setFailed(false);
        widgetIdRef.current =
          turnstile.render(el, {
            sitekey,
            size,
            theme: 'auto',
            callback: (token: string) => emit(token),
            'expired-callback': () => emit(null),
            'timeout-callback': () => emit(null),
            // Turnstile retries on its own; the form just waits for a new token.
            'error-callback': () => emit(null),
          }) ?? null;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
      emit(null);
    };
  }, [size]);

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setSize(e.nativeEvent.layout.width >= 300 ? 'flexible' : 'compact')}>
      <View ref={containerRef} style={size === 'compact' ? styles.compact : styles.flexible} />
      {failed ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          The spam check couldn't load. Check your connection, turn off content blockers for this page and reload.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  // Reserve the widget's height so the form doesn't jump when it appears.
  flexible: { minHeight: 65, width: '100%' },
  compact: { minHeight: 140 },
});
