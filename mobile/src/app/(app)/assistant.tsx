import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Font,
  GradientAxis,
  Layout,
  PlaceholderColor,
  Radius,
  Shadows,
  Surfaces,
  Type,
} from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { ApiError } from '@/services/api-client';
import { fetchThread, sendMessage, type ChatMessage } from '@/services/chat-service';

const SUGGESTIONS = [
  'How did I sleep?',
  'Should I train today?',
  'Why is my recovery low?',
];

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <Animated.View
      entering={FadeInUp.duration(260)}
      style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {isUser ? (
          <LinearGradient
            colors={[AuraColors.brand.default, AuraColors.accent.default]}
            start={GradientAxis.deg120.start}
            end={GradientAxis.deg120.end}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <Text style={isUser ? styles.bubbleTextUser : Type.prose}>{message.body}</Text>
      </View>
    </Animated.View>
  );
}

export default function AssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await fetchThread());
    } catch {
      // An unreachable thread is an empty one for now; the composer still works and the
      // send path reports its own failure.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(text: string) {
    const body = text.trim();
    if (body === '' || isSending) return;

    setDraft('');
    setError(null);
    setIsSending(true);

    // Shown immediately with a negative id so the thread does not sit empty while the
    // model thinks. The server's copy replaces it on success.
    const optimistic: ChatMessage = {
      id: -Date.now(),
      role: 'user',
      body,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const { question, answer } = await sendMessage(body);
      setMessages((current) => [...current.filter((m) => m.id !== optimistic.id), question, answer]);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? "You're offline — the assistant needs a connection."
          : "The assistant isn't available right now.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={styles.back}>
          <Feather name="chevron-left" size={22} color={AuraColors.content.default} />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Assistant</Text>
          <Text style={Type.caption}>Answers from your own figures</Text>
        </View>

        <View style={styles.headerBadge}>
          <Feather name="cpu" size={16} color={IconTones.brand.color} />
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          <View style={styles.grounding}>
            <Feather name="info" size={13} color={AuraColors.content.muted} />
            <Text style={styles.groundingText}>
              The assistant sees today&apos;s recovery, sleep, heart rate, steps and water — nothing
              else about you. It isn&apos;t a clinician and won&apos;t diagnose anything.
            </Text>
          </View>

          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}

          {isSending ? (
            <View style={[styles.bubbleRow]}>
              <View style={[styles.bubble, styles.bubbleAssistant]}>
                <Text style={Type.prose}>Thinking…</Text>
              </View>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {messages.length === 0 && !isSending ? (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => send(suggestion)}
                  accessibilityRole="button"
                  style={styles.suggestion}>
                  <Text style={styles.suggestionLabel}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about your day…"
            placeholderTextColor={PlaceholderColor}
            style={styles.input}
            multiline
            maxLength={2000}
            onSubmitEditing={() => send(draft)}
          />
          <Pressable
            onPress={() => send(draft)}
            disabled={draft.trim() === '' || isSending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.send, (draft.trim() === '' || isSending) && styles.sendDisabled]}>
            <LinearGradient
              colors={[AuraColors.brand.default, AuraColors.accent.default]}
              start={GradientAxis.deg135.start}
              end={GradientAxis.deg135.end}
              style={StyleSheet.absoluteFill}
            />
            <Feather name="arrow-up" size={19} color="#ffffff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Layout.gutter,
    paddingBottom: 14,
    backgroundColor: AuraColors.surface.default,
  },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 1 },
  headerTitle: {
    fontFamily: Font.bold,
    fontSize: 17,
    lineHeight: 20.4,
    color: AuraColors.content.default,
  },
  headerBadge: {
    width: 36,
    height: 36,
    borderRadius: Radius.iconSquare,
    backgroundColor: IconTones.brand.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thread: { padding: Layout.gutter, gap: 12 },
  grounding: { ...Surfaces.panel, flexDirection: 'row', gap: 9 },
  groundingText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', padding: 13, overflow: 'hidden' },
  bubbleAssistant: {
    backgroundColor: AuraColors.surface.default,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    ...Shadows.tile,
  },
  bubbleUser: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  bubbleTextUser: { fontFamily: Font.regular, fontSize: 13, lineHeight: 20, color: '#ffffff' },
  error: { ...Type.caption, color: AuraColors.danger, textAlign: 'center' },
  suggestions: { gap: 8, marginTop: 4 },
  suggestion: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.default,
    ...Shadows.chip,
  },
  suggestionLabel: {
    fontFamily: Font.semibold,
    fontSize: 13,
    color: AuraColors.brand.default,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: Layout.gutter,
    paddingTop: 12,
    backgroundColor: AuraColors.surface.default,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.sunken,
    ...Type.input,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sendDisabled: { opacity: 0.4 },
});
