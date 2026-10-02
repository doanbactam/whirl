import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";

import { Composer } from "~/components/composer";
import {
  drivenStreamIds,
  sanitizeAttachments,
  type Attachment,
  type ModelKey,
} from "~/data/messages";
import { showToast } from "~/data/toasts";
import { useAuthGate } from "~/lib/auth-gate";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const forkSharedThreadRef = makeFunctionReference<"mutation">(
  "threads:forkSharedThread",
);
const sendUserMessageRef = makeFunctionReference<"mutation">(
  "messages:sendUserMessage",
);
const generateAttachmentUploadUrlRef = makeFunctionReference<"mutation">(
  "messages:generateAttachmentUploadUrl",
);

/**
 * The composer at the bottom of a shared thread. Sending forks the conversation
 * into a fresh thread the visitor owns (a server-side deep copy of the messages
 * and artifacts), seeds it with their message, and drops them into the live
 * thread to keep chatting. Signed-out visitors are prompted to sign in first.
 * Reuses the real {@link Composer}, so it looks and behaves exactly like the app.
 */
export function ForkComposer({ shareId }: { shareId: string }) {
  const navigate = useNavigate();
  const { requireAuth } = useAuthGate();
  const capture = useCapture();
  const forkSharedThread = useMutation(forkSharedThreadRef);
  const sendUserMessage = useMutation(sendUserMessageRef);
  const generateAttachmentUploadUrl = useMutation(
    generateAttachmentUploadUrlRef,
  );

  const handleSubmit = async (
    value: string,
    attachments: Attachment[],
    options: { thinking: boolean; search: boolean; model: ModelKey },
  ) => {
    // Inference needs an account — prompt sign-in instead of forking.
    if (!requireAuth()) return;

    // Copy the shared conversation into a thread the visitor owns, then send
    // their message into it. Errors bubble to the composer, which toasts them.
    const { threadId } = (await forkSharedThread({ shareId })) as {
      threadId: string;
    };
    const result = (await sendUserMessage({
      threadId,
      content: value,
      attachments: sanitizeAttachments(attachments),
      options: {
        thinking: options.thinking,
        search: options.search,
        model: options.model,
      },
    })) as { streamId: string };

    drivenStreamIds.add(result.streamId);
    capture(ANALYTICS_EVENTS.sharedThreadForked, {
      model: options.model,
      thinking: options.thinking,
      search: options.search,
    });
    showToast({
      tone: "success",
      message: "Copied to your chats — keep going!",
    });
    await navigate({ to: `/thread/${threadId}` });
  };

  return (
    <Composer
      variant="thread"
      onSubmit={handleSubmit}
      getAttachmentUploadUrl={async () =>
        (await generateAttachmentUploadUrl({})) as string
      }
    />
  );
}
