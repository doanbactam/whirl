import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";
import { spacing } from "@/lib/theme";

const CODE_LENGTH = 6;

type VerifyEmailFormProps = {
  onSubmit: (code: string) => void;
  onResend: () => void;
  onUseDifferentEmail: () => void;
  error?: string;
  submitting: boolean;
  resending: boolean;
};

/**
 * The second half of sign up: the six-digit code Clerk emailed. Owns only the
 * input — the parent keeps hold of the Clerk resource and the feedback.
 */
export function VerifyEmailForm({
  onSubmit,
  onResend,
  onUseDifferentEmail,
  error,
  submitting,
  resending,
}: VerifyEmailFormProps) {
  const [code, setCode] = useState("");

  return (
    <>
      <TextField
        label="Verification code"
        value={code}
        // Autofill hands over the whole SMS/email body on some keyboards.
        onChangeText={(next) =>
          setCode(next.replace(/\D/g, "").slice(0, CODE_LENGTH))
        }
        error={error}
        placeholder="123456"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={() => onSubmit(code)}
        style={styles.code}
      />

      <Button
        label="Verify email"
        loading={submitting}
        disabled={code.length < CODE_LENGTH}
        onPress={() => onSubmit(code)}
      />

      <View style={styles.actions}>
        <TextLink
          prompt="Didn't get it?"
          label={resending ? "Sending…" : "Resend code"}
          onPress={onResend}
        />
        <TextLink label="Use a different email" onPress={onUseDifferentEmail} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  code: {
    // A code is read in chunks, so give the digits room to breathe.
    fontSize: 20,
    letterSpacing: 6,
    /* Centred because six digits never fill the capsule, and left-aligned they
       sit off to one side of a field that exists only to hold them. */
    textAlign: "center",
    // Offsets the trailing letter-space, which would otherwise pull it left.
    paddingLeft: 6,
  },
  actions: {
    gap: spacing.md,
  },
});
