import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Type } from '@/constants/design';
import { AuraColors } from '@/constants/theme';

/** Coarse on purpose: "2h ago" is the useful precision, "2h 14m ago" is noise. */
function formatRelative(from: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * Shown when the screen is rendering data it could not refresh.
 *
 * A pill rather than a modal or a full-screen error: the data on screen is still the
 * best answer available, so the app should stay usable and simply be honest about how
 * old the figures are.
 */
export function OfflineBanner({ cachedAt }: { cachedAt: Date | null }) {
  const label = cachedAt === null ? 'Offline' : `Offline · updated ${formatRelative(cachedAt)}`;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.pill}>
      <Feather name="cloud-off" size={13} color={AuraColors.content.muted} />
      <Text style={Type.meta}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: AuraColors.surface.raised,
  },
});
