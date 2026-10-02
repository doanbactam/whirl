"use client";

import { useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { CodeDocumentEditor } from "@/components/editor/code-document-editor";
import { CodeDownloadButton } from "@/components/thread/artifacts/code-download-button";
import { SharedArtifactPage } from "./shared-artifact-page";

/* The public face of a shared document (/doc/{shortId}): read-only through
   the same TipTap surface the in-app panel uses, so it renders
   identically. The backend only ever serves completed documents. */

type SharedDocument = {
  title: string;
  content: string;
  format: "markdown" | "code";
  fileName?: string;
  language?: string;
};

export function SharedDocument({ shortId }: { shortId: string }) {
  const doc = useQuery(api.documents.getSharedDocument, { shortId }) as
    | SharedDocument
    | null
    | undefined;

  const title =
    doc === null || doc === undefined ? null : doc.title.trim() || "Document";

  return (
    <SharedArtifactPage
      title={title}
      loading={doc === undefined}
      notFoundHeadline="This document isn't available"
      headerActions={
        doc?.format === "code" ? (
          <CodeDownloadButton
            fileName={doc.fileName || `${doc.title || "untitled"}.txt`}
            content={doc.content}
          />
        ) : undefined
      }
    >
      {doc ? (
        <div className="body-fade-in h-full">
          {doc.format === "code" ? (
            <CodeDocumentEditor value={doc.content} editable={false} />
          ) : (
            <MarkdownEditor value={doc.content} editable={false} />
          )}
        </div>
      ) : null}
    </SharedArtifactPage>
  );
}
