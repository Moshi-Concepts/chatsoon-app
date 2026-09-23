import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Logo } from '@/components/brand';
import { Colors, Radius } from '@/constants/theme';

// Dark modules on a white card in both themes: light-on-dark QR codes fail on many scanners.
const QR_INK = Colors.light.text;
const QR_PAPER = Colors.light.surface;

/** The mark covers well under the 30% of modules that error correction level H can recover. */
const LOGO_RATIO = 0.2;

export type ProfileQrCardProps = {
  /** What the code opens, usually profileUrl(slug). */
  value: string;
  /** Size of the code itself; the card adds a quiet zone around it. */
  size: number;
  accessibilityLabel?: string;
};

/** A scannable QR code on a white card with the Chatsoon mark in the middle. */
export function ProfileQrCard({ value, size, accessibilityLabel = 'QR code' }: ProfileQrCardProps) {
  const padding = Math.round(size * 0.09);
  const logoSize = Math.round(size * LOGO_RATIO);
  return (
    <View
      style={[styles.card, { padding, backgroundColor: QR_PAPER }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      <QRCode value={value} size={size} color={QR_INK} backgroundColor={QR_PAPER} ecl="H" quietZone={0} />
      <View style={styles.center} pointerEvents="none">
        <View style={[styles.logoPlate, { backgroundColor: QR_PAPER, borderRadius: Math.round(logoSize * 0.3) }]}>
          <Logo size={logoSize} accessibilityLabel={null} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    borderRadius: Radius.xl,
    boxShadow: '0px 8px 24px rgba(18, 19, 26, 0.08)',
    elevation: 3,
  },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  logoPlate: { padding: 5 },
});
