import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Attachment } from "~/data/messages";

type OpenDocument = {
  attachment: Attachment;
  /**
   * Called as the markdown is edited, when the document is editable (e.g. a
   * composer draft whose edits ride along on send). Omit for a read-only doc.
   */
  onEdit?: (markdown: string) => void;
};

type DocumentSidebarContextValue = {
  /** The attachment-backed document shown in the panel, or null. */
  doc: OpenDocument | null;
  /**
   * The id of a first-class `documents` row shown in the panel, or null.
   * Distinct from {@link doc}: these are durable artifacts whirl authored, read
   * live from Convex and saved straight back, rather than edits riding along on
   * a message. Only one of `doc` / `liveDocId` is ever set at a time.
   */
  liveDocId: string | null;
  /**
   * The id of a whirl-authored HTML artifact (a full page) shown in the panel,
   * or null. Mutually exclusive with `doc`/`liveDocId`: only one panel shows at
   * a time, so opening any artifact clears the others.
   */
  liveHtmlId: string | null;
  openDocument: (attachment: Attachment, onEdit?: OpenDocument["onEdit"]) => void;
  /** Open a whirl-authored document (live `documents` row) by its id. */
  openDocumentById: (documentId: string) => void;
  /**
   * Open a document that just started streaming, but only the FIRST time it's
   * seen — so a freshly-created doc pops the panel open on its own, yet a doc
   * the user deliberately closed mid-stream (or an old one re-rendering on load)
   * doesn't keep yanking the panel back open.
   */
  autoOpenStreamingDocument: (documentId: string) => void;
  /** Open a whirl-authored full HTML page (live `htmlArtifacts` row) by id. */
  openHtmlById: (htmlId: string) => void;
  /** Auto-open a full HTML artifact the first time it's seen, like documents. */
  autoOpenStreamingHtml: (htmlId: string) => void;
  closeDocument: () => void;
  /**
   * Desktop only: when true the document panel fills the content area and the
   * chat is hidden (the main app sidebar stays). Reset whenever the panel
   * closes. Toggled from the panel header.
   */
  fullscreen: boolean;
  toggleFullscreen: () => void;
  /**
   * Bumps whenever the open document should snap back to its original text.
   * The editor watches this to throw away in-progress edits (e.g. when the user
   * discards the edits from the composer).
   */
  resetNonce: number;
  /** Revert the open document to its original text, if it matches {@link key}. */
  revertOpenDocument: (key: string) => void;
};

const DocumentSidebarContext =
  createContext<DocumentSidebarContextValue | null>(null);

/**
 * Holds which document (if any) is open in the right-hand document panel. Lives
 * high in the tree so any attachment or whirl-authored doc, anywhere, can pop
 * itself open without prop-drilling.
 */
export function DocumentSidebarProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [liveDocId, setLiveDocId] = useState<string | null>(null);
  const [liveHtmlId, setLiveHtmlId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  // Live docs we've already auto-opened (or that the user has dismissed), so
  // auto-open fires at most once per document across its streaming lifetime.
  const autoOpened = useRef<Set<string>>(new Set());

  const value = useMemo<DocumentSidebarContextValue>(
    () => ({
      doc,
      liveDocId,
      liveHtmlId,
      openDocument: (attachment, onEdit) => {
        setLiveDocId(null);
        setLiveHtmlId(null);
        setDoc({ attachment, onEdit });
      },
      openDocumentById: (documentId) => {
        autoOpened.current.add(documentId);
        setDoc(null);
        setLiveHtmlId(null);
        setLiveDocId(documentId);
      },
      autoOpenStreamingDocument: (documentId) => {
        if (autoOpened.current.has(documentId)) return;
        autoOpened.current.add(documentId);
        setDoc(null);
        setLiveHtmlId(null);
        setLiveDocId(documentId);
      },
      openHtmlById: (htmlId) => {
        autoOpened.current.add(htmlId);
        setDoc(null);
        setLiveDocId(null);
        setLiveHtmlId(htmlId);
      },
      autoOpenStreamingHtml: (htmlId) => {
        if (autoOpened.current.has(htmlId)) return;
        autoOpened.current.add(htmlId);
        setDoc(null);
        setLiveDocId(null);
        setLiveHtmlId(htmlId);
      },
      closeDocument: () => {
        setDoc(null);
        setLiveDocId(null);
        setLiveHtmlId(null);
        setFullscreen(false);
      },
      fullscreen,
      toggleFullscreen: () => setFullscreen((f) => !f),
      resetNonce,
      revertOpenDocument: (key) => {
        if (doc?.attachment.id === key) setResetNonce((n) => n + 1);
      },
    }),
    [doc, liveDocId, liveHtmlId, fullscreen, resetNonce],
  );

  return (
    <DocumentSidebarContext.Provider value={value}>
      {children}
    </DocumentSidebarContext.Provider>
  );
}

export function useDocumentSidebar() {
  const ctx = useContext(DocumentSidebarContext);
  if (!ctx) {
    throw new Error(
      "useDocumentSidebar must be used within a DocumentSidebarProvider",
    );
  }
  return ctx;
}
