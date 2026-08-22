import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { Font, GradientAxis, Layout, Radius, Shadows, Type } from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import type { Conversation } from '@/services/chat-service';

const UNTITLED = 'Untitled chat';

function whenLabel(conversation: Conversation): string {
  if (conversation.last_activity_at === null) return 'Empty';

  const when = new Date(conversation.last_activity_at);
  const turns = `${conversation.message_count} message${conversation.message_count === 1 ? '' : 's'}`;
  const day = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return `${turns} · ${day}`;
}

interface ConversationsSheetProps {
  visible: boolean;
  conversations: Conversation[];
  currentId: number | null;
  /** Null when the open chat has nothing in it yet — there is then nothing to clear. */
  clearableTitle: string | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * The chat switcher, and the one way into deleting a chat.
 *
 * The two actions sit at opposite ends on purpose. "New chat" is the brand row at the top
 * — nothing is lost, the current chat is still in the list underneath it. Clearing is
 * below the list, past a rule, in red, and names what it will destroy. Neither can be
 * mistaken for the other at a glance, which is the only defence against tapping the wrong
 * one while half-reading.
 */
export function ConversationsSheet({
  visible,
  conversations,
  currentId,
  clearableTitle,
  onSelect,
  onNew,
  onClear,
  onClose,
}: ConversationsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {/* A solid scrim rather than a blur: expo-blur on Android is expensive and
          inconsistent, and the dim is what the design actually asks for. */}
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>

      <Animated.View entering={SlideInDown.duration(260)} style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.titleBlock}>
          <Text style={Type.sheetTitle}>Your chats</Text>
          <Text style={styles.subtitle}>Every conversation stays until you delete it.</Text>
        </View>

        <Pressable
          onPress={onNew}
          accessibilityRole="button"
          accessibilityLabel="New chat. Starts a fresh conversation and keeps this one."
          style={[styles.row, styles.newRow, Shadows.cta]}>
          <LinearGradient
            colors={[AuraColors.brand.default, AuraColors.accent.default]}
            start={GradientAxis.deg120.start}
            end={GradientAxis.deg120.end}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.rowIcon, styles.newRowIcon]}>
            <Feather name="edit-3" size={19} color="#ffffff" />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, styles.onPrimary]}>New chat</Text>
            <Text style={[styles.rowMeta, styles.onPrimarySubtle]}>
              Starts fresh. This one is kept below.
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color="#ffffff" />
        </Pressable>

        {conversations.length > 0 ? (
          <>
            <Text style={Type.eyebrow}>Recent</Text>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {conversations.map((conversation) => {
                const isCurrent = conversation.id === currentId;
                const title = conversation.title ?? UNTITLED;

                return (
                  <Pressable
                    key={conversation.id}
                    onPress={() => onSelect(conversation.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent }}
                    accessibilityLabel={`${title}. ${whenLabel(conversation)}`}
                    style={[styles.row, styles.plainRow, isCurrent && styles.currentRow]}>
                    <View style={styles.rowIcon}>
                      <Feather
                        name="message-circle"
                        size={17}
                        color={IconTones.brand.color}
                      />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {title}
                      </Text>
                      <Text style={styles.rowMeta}>{whenLabel(conversation)}</Text>
                    </View>
                    {isCurrent ? (
                      <Feather name="check" size={17} color={AuraColors.brand.default} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {clearableTitle !== null ? (
          <View style={styles.dangerZone}>
            <Pressable
              onPress={onClear}
              accessibilityRole="button"
              accessibilityLabel={`Clear chat. Permanently deletes ${clearableTitle}.`}
              style={[styles.row, styles.dangerRow]}>
              <View style={[styles.rowIcon, styles.dangerIcon]}>
                <Feather name="trash-2" size={17} color={AuraColors.danger} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, styles.dangerTitle]}>Clear chat</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  Deletes “{clearableTitle}” for good
                </Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
          <Text style={styles.closeLabel}>Close</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,22,54,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: AuraColors.surface.default,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Layout.gutter,
    paddingBottom: 30,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 2,
  },
  titleBlock: { gap: 3 },
  subtitle: { fontFamily: Font.regular, fontSize: 12, color: AuraColors.content.muted },
  list: { flexGrow: 0 },
  listContent: { gap: 8, paddingBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 13,
    minHeight: 44,
    borderRadius: Radius.row,
    overflow: 'hidden',
  },
  newRow: { paddingVertical: 15 },
  plainRow: { backgroundColor: AuraColors.surface.sunken },
  currentRow: { backgroundColor: AuraColors.surface.selected },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.iconMedium,
    backgroundColor: IconTones.brand.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRowIcon: { backgroundColor: 'rgba(255,255,255,0.2)' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.content.default },
  rowMeta: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
  onPrimary: { color: '#ffffff' },
  onPrimarySubtle: { color: 'rgba(255,255,255,0.84)' },
  // A rule and a red border, so the destructive row is never read as one more chat in
  // the list above it.
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.08)',
    paddingTop: 12,
  },
  dangerRow: { borderWidth: 1, borderColor: 'rgba(220,38,38,0.28)' },
  dangerIcon: { backgroundColor: IconTones.vital.bg },
  dangerTitle: { color: AuraColors.danger },
  close: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  closeLabel: { fontFamily: Font.semibold, fontSize: 14, color: AuraColors.content.muted },
});
