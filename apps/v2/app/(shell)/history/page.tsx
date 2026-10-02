import type { Metadata } from "next";

/* The history face is rendered by the shell layout (always mounted, so the
   page slide can animate); this route just claims /history and sets the tab
   title. It's the phone's chat list — the tab bar goes here instead of the
   rail nobody has room for — so it stays out of search results. */

export const metadata: Metadata = {
  title: { absolute: "Chats · Whirl" },
  robots: { index: false, follow: false },
};

export default function HistoryPage() {
  return null;
}
