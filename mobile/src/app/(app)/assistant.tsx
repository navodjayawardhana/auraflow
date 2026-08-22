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

import { ConfirmSheet } from '@/components/confirm-sheet';
import { ConversationsSheet } from '@/components/conversations-sheet';
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
import {
  clearThread,
  fetchConversations,
  fetchThread,
  sendMessage,
  startConversation,
  type ChatMessage,
  type Conversation,
} from '@/services/chat-service';

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
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // One at a time: the confirmation replaces the switcher rather than stacking on it,
  // because two Modals over each other misbehave on Android.
  const [sheet, setSheet] = useState<'none' | 'chats' | 'confirm'>('none');
  const [isClearing, setIsClearing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const thread = await fetchThread();
      setConversation(thread.conversation);
      setMessages(thread.messages);
    } catch {
      // An unreachable thread is an empty one for now; the composer still works and the
      // send path reports its own failure.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openChats() {
    setSheet('chats');

    try {
      setConversations(await fetchConversations());
    } catch {
      // The sheet still offers a new chat and a way out; a failed list is not worth an
      // error banner over the conversation the user is reading.
    }
  }

  async function openConversation(id: number) {
    setSheet('none');
    if (id === conversation?.id) return;

    setError(null);

    try {
      const thread = await fetchThread(id);
      setConversation(thread.conversation);
      setMessages(thread.messages);
    } catch {
      setError("That chat couldn't be opened.");
    }
  }

  async function newChat() {
    setSheet('none');
    setError(null);

    try {
      setConversation(await startConversation());
      setMessages([]);
    } catch {
      setError("A new chat couldn't be started.");
    }
  }

  async function clearCurrentChat() {
    if (conversation === null) return;

    const doomed = conversation.id;
    setIsClearing(true);

    try {
      await clearThread(doomed);
    } catch {
      setError("That chat couldn't be deleted.");
      setIsClearing(false);
      setSheet('none');
      return;
    }

    setConversations((current) => current.filter((c) => c.id !== doomed));
    setMessages([]);
    setError(null);

    // Land in a fresh chat rather than nowhere. Left with no conversation, the next
    // message would be resolved server-side onto whichever chat happened to be most
    // recent, and the user would watch an old thread reappear under what they typed.
    try {
      setConversation(await startConversation());
    } catch {
      setConversation(null);
    }

    setIsClearing(false);
    setSheet('none');
  }

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
      const result = await sendMessage(body, conversation?.id);
      setConversation(result.conversation);
      setMessages((current) => [
        ...current.filter((m) => m.id !== optimistic.id),
        result.question,
        result.answer,
      ]);
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
          <Text style={styles.headerTitle} numberOfLines={1}>
            {conversation?.title ?? 'Assistant'}
          </Text>
          <Text style={Type.caption}>Answers from your own figures</Text>
        </View>

        {/* Both header actions are safe ones. Nothing here deletes anything -- that lives
            behind the switcher, in red, behind a confirmation. */}
        <Pressable
          onPress={newChat}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          hitSlop={6}
          style={styles.headerAction}>
          <Feather name="edit-3" size={16} color={IconTones.brand.color} />
        </Pressable>

        <Pressable
          onPress={openChats}
          accessibilityRole="button"
          accessibilityLabel="Your chats"
          hitSlop={6}
          style={styles.headerAction}>
          <Feather name="list" size={17} color={IconTones.brand.color} />
        </Pressable>
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

      <ConversationsSheet
        visible={sheet === 'chats'}
        conversations={conversations}
        currentId={conversation?.id ?? null}
        clearableTitle={
          conversation !== null && messages.length > 0
            ? (conversation.title ?? 'this chat')
            : null
        }
        onSelect={openConversation}
        onNew={newChat}
        onClear={() => setSheet('confirm')}
        onClose={() => setSheet('none')}
      />

      <ConfirmSheet
        visible={sheet === 'confirm'}
        title="Clear this chat?"
        body={`Everything in “${conversation?.title ?? 'this chat'}” is deleted from your account. Your other chats are untouched. This cannot be undone.`}
        confirmLabel="Delete this chat"
        busy={isClearing}
        onConfirm={clearCurrentChat}
        onCancel={() => setSheet('chats')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  headerAction: {
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
