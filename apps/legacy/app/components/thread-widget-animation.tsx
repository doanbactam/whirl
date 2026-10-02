import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import type { Message } from "~/data/messages";

type ThreadWidgetAnimationContextValue = {
  shouldAnimateWidgets: (messageId: string) => boolean;
};

const ThreadWidgetAnimationContext =
  createContext<ThreadWidgetAnimationContextValue>({
    shouldAnimateWidgets: () => true,
  });

/** Messages that were already complete when a thread first hydrated skip widget entrances. */
export function ThreadWidgetAnimationProvider({
  threadId,
  messages,
  children,
}: {
  threadId?: string;
  messages: Message[];
  children: ReactNode;
}) {
  const baselineCompleteIds = useRef(new Set<string>());
  const capturedThread = useRef<string | undefined>(undefined);

  useEffect(() => {
    baselineCompleteIds.current = new Set();
    capturedThread.current = undefined;
  }, [threadId]);

  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    if (capturedThread.current === threadId) return;
    capturedThread.current = threadId;
    for (const message of messages) {
      if (
        message.status === "complete" ||
        message.status === "stopped" ||
        message.status === "error"
      ) {
        baselineCompleteIds.current.add(message.id);
      }
    }
  }, [threadId, messages]);

  const shouldAnimateWidgets = useCallback((messageId: string) => {
    return !baselineCompleteIds.current.has(messageId);
  }, []);

  return (
    <ThreadWidgetAnimationContext.Provider value={{ shouldAnimateWidgets }}>
      {children}
    </ThreadWidgetAnimationContext.Provider>
  );
}

export function useShouldAnimateWidgets(messageId: string): boolean {
  return useContext(ThreadWidgetAnimationContext).shouldAnimateWidgets(
    messageId,
  );
}
