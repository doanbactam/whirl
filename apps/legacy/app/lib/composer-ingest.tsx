import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** An edited document handed back to the composer to ride along on the next send. */
export type EditedDocument = {
  /**
   * Stable key for the source attachment. Repeated edits to the same document
   * update one composer draft instead of piling up a new chip per keystroke.
   */
  sourceKey: string;
  name: string;
  type: string;
  text: string;
};

/** Returns true if a brand-new draft was created (vs. updating an existing one). */
type IngestFn = (doc: EditedDocument) => boolean;

/** Returns true if a composer was mounted and accepted the quoted text. */
type QuoteInsertFn = (quote: string) => boolean;

type ComposerIngestContextValue = {
  /**
   * Drop an edited document into the composer's attachment tray so whirl sees
   * the new edits on the next message. Returns true the first time a given
   * document is added (so callers can announce it once). No-op — returns false —
   * when no composer is mounted to receive it.
   */
  addEditedDocument: IngestFn;
  /**
   * Drop a text selection from a whirl-authored document into the composer, so
   * the user can tell whirl what to change about exactly that passage. Rides in
   * as a small text attachment that names the source document (and its id) and
   * quotes the selection, so whirl can target it with editDocument. Returns true
   * the first time a given document's selection is added.
   */
  addDocumentSelection: (selection: {
    documentId: string;
    title: string;
    selectedText: string;
  }) => boolean;
  /**
   * Drop an already-formatted markdown blockquote into the composer's text
   * (used by the quote-selection popover over chat messages), so the user can
   * reply right under the quoted passage. Returns false when no composer is
   * mounted to receive it.
   */
  insertQuote: QuoteInsertFn;
  /** The composer registers (and tears down) its ingest handler here. */
  registerIngest: (fn: IngestFn | null) => void;
  /** The composer registers (and tears down) its quote-insert handler here. */
  registerQuoteInsert: (fn: QuoteInsertFn | null) => void;
};

const ComposerIngestContext = createContext<ComposerIngestContextValue | null>(
  null,
);

/**
 * Bridges document edits made anywhere (e.g. the document sidebar, opened from a
 * sent message) into the composer. The composer registers an ingest handler;
 * everyone else just calls {@link useComposerIngest}().addEditedDocument. Lives
 * high in the tree so the root-mounted sidebar and the composer can meet here
 * without prop-drilling.
 */
export function ComposerIngestProvider({ children }: { children: ReactNode }) {
  const ingestRef = useRef<IngestFn | null>(null);
  const quoteRef = useRef<QuoteInsertFn | null>(null);

  const value = useMemo<ComposerIngestContextValue>(
    () => ({
      addEditedDocument: (doc) => ingestRef.current?.(doc) ?? false,
      addDocumentSelection: ({ documentId, title, selectedText }) => {
        const trimmed = selectedText.trim();
        const text = [
          `Selection from the document "${title}" (document id: ${documentId}).`,
          `Tell whirl what to change about this passage:`,
          "",
          trimmed,
        ].join("\n");
        // One pill per document selection: re-selecting within the same doc
        // replaces the prior quote rather than stacking chips.
        return (
          ingestRef.current?.({
            sourceKey: `selection:${documentId}`,
            name: `selection from ${title}`,
            type: "text/plain",
            text,
          }) ?? false
        );
      },
      insertQuote: (quote) => quoteRef.current?.(quote) ?? false,
      registerIngest: (fn) => {
        ingestRef.current = fn;
      },
      registerQuoteInsert: (fn) => {
        quoteRef.current = fn;
      },
    }),
    [],
  );

  return (
    <ComposerIngestContext.Provider value={value}>
      {children}
    </ComposerIngestContext.Provider>
  );
}

export function useComposerIngest() {
  const ctx = useContext(ComposerIngestContext);
  if (!ctx) {
    throw new Error(
      "useComposerIngest must be used within a ComposerIngestProvider",
    );
  }
  return ctx;
}
