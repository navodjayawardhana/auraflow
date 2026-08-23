import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Font, Radius } from '@/constants/design';

/**
 * A destructive action that takes two taps.
 *
 * It exists for the one control on the movement screens that throws work away — restart,
 * which puts the reps and the clock back to zero. Mid-set, phone in one hand, that is
 * exactly the tap you do not want to make by accident, and there is nothing to undo it
 * with afterwards. So the first tap only arms the control and says so; the second one
 * does it.
 *
 * A dialog would have been the other answer, and was rejected: a modal over a session
 * hides the figure you are meant to be following, and dismissing it is one more thing to
 * do while standing up from a squat.
 */

/** Long enough to read the confirmation and act on it, short enough to stay disarmed. */
const ARMED_MS = 4000;

interface ConfirmActionProps {
  label: string;
  /** Shown after the first tap. Say what the second tap will do, not "are you sure".  */
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmAction({ label, confirmLabel, onConfirm }: ConfirmActionProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;

    const timer = setTimeout(() => setArmed(false), ARMED_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Pressable
      onPress={() => {
        if (!armed) {
          setArmed(true);
          return;
        }

        setArmed(false);
        onConfirm();
      }}
      accessibilityRole="button"
      // Screen readers get the whole two-step in one label, because the visual cue that
      // the control changed meaning is one they do not get.
      accessibilityLabel={armed ? confirmLabel : `${label}. Takes two taps.`}
      hitSlop={8}
      style={[styles.button, armed && styles.armed]}>
      <Text style={[styles.label, armed && styles.armedLabel]}>{armed ? confirmLabel : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  armed: { borderColor: 'rgba(251,191,36,0.55)', backgroundColor: 'rgba(251,191,36,0.12)' },
  label: {
    fontFamily: Font.semibold,
    fontSize: 12,
    letterSpacing: 0.2,
    color: 'rgba(255,255,255,0.7)',
  },
  armedLabel: { color: '#fbbf24' },
});
