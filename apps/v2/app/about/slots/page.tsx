import type { Metadata } from "next";
import { TokenArcade } from "@/components/slots/token-arcade";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Token Arcade · Whirl",
  description:
    "100 tokens. Three reels. A little luck. Spin for tokens and limited-edition Whirl perks in the Token Arcade.",
  path: "/about/slots",
});

export default function SlotsPage() {
  return <TokenArcade />;
}
