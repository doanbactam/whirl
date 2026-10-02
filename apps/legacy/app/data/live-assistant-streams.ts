import { useSyncExternalStore } from "react";
import type { StreamBody } from "@convex-dev/persistent-text-streaming";

type StreamStatus = StreamBody["status"];

type LiveAssistantStreamState = StreamBody & {
  error?: string;
  started: boolean;
};

type LiveAssistantStreamRecord = {
  controller?: AbortController;
  listeners: Set<() => void>;
  state: LiveAssistantStreamState;
};

type StartLiveAssistantStreamArgs = {
  streamId: string;
  streamUrl: URL;
  authTokenPromise?: Promise<string | null>;
  getAuthToken?: () => Promise<string | null>;
};

const EMPTY_STREAM: LiveAssistantStreamState = {
  text: "",
  status: "pending",
  started: false,
};

const liveStreams = new Map<string, LiveAssistantStreamRecord>();

function getOrCreateRecord(streamId: string): LiveAssistantStreamRecord {
  let record = liveStreams.get(streamId);
  if (!record) {
    record = {
      listeners: new Set(),
      state: EMPTY_STREAM,
    };
    liveStreams.set(streamId, record);
  }
  return record;
}

function updateRecord(
  record: LiveAssistantStreamRecord,
  patch: Partial<LiveAssistantStreamState>,
) {
  record.state = {
    ...record.state,
    ...patch,
    started: true,
  };
  for (const listener of record.listeners) {
    listener();
  }
}

async function readAuthToken({
  authTokenPromise,
  getAuthToken,
}: Pick<
  StartLiveAssistantStreamArgs,
  "authTokenPromise" | "getAuthToken"
>) {
  if (authTokenPromise) {
    return await authTokenPromise;
  }
  if (getAuthToken) {
    return await getAuthToken();
  }
  return null;
}

function failStream(
  record: LiveAssistantStreamRecord,
  status: StreamStatus,
  error: string,
) {
  updateRecord(record, {
    status,
    error,
  });
}

export function startLiveAssistantStream({
  streamId,
  streamUrl,
  authTokenPromise,
  getAuthToken,
}: StartLiveAssistantStreamArgs) {
  const record = getOrCreateRecord(streamId);
  if (record.controller) return;
  if (record.state.started && record.state.status === "done") return;

  const controller = new AbortController();
  record.controller = controller;
  updateRecord(record, { status: "pending", error: undefined });

  void (async () => {
    try {
      const authToken = await readAuthToken({ authTokenPromise, getAuthToken });
      if (controller.signal.aborted) return;

      const response = await fetch(streamUrl, {
        method: "POST",
        body: JSON.stringify({ streamId }),
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 205) {
        failStream(record, "error", "Stream was already started.");
        return;
      }
      if (!response.ok) {
        failStream(
          record,
          "error",
          `Streaming endpoint returned ${response.status}.`,
        );
        return;
      }
      if (!response.body) {
        failStream(record, "error", "Streaming endpoint returned no body.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        const chunk = value
          ? decoder.decode(value, { stream: !done })
          : decoder.decode();
        if (chunk) {
          updateRecord(record, {
            text: record.state.text + chunk,
            status: "streaming",
          });
        }
        if (done) {
          updateRecord(record, { status: "done" });
          return;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      failStream(
        record,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (record.controller === controller) {
        record.controller = undefined;
      }
    }
  })();
}

export function clearLiveAssistantStream(streamId: string) {
  const record = liveStreams.get(streamId);
  record?.controller?.abort();
  liveStreams.delete(streamId);
}

export function useLiveAssistantStream(
  streamId: string | undefined,
  active: boolean,
): LiveAssistantStreamState {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!streamId || !active) return () => {};
      const record = getOrCreateRecord(streamId);
      record.listeners.add(onStoreChange);
      return () => {
        record.listeners.delete(onStoreChange);
      };
    },
    () => {
      if (!streamId || !active) return EMPTY_STREAM;
      return liveStreams.get(streamId)?.state ?? EMPTY_STREAM;
    },
    () => EMPTY_STREAM,
  );
}
