import type { Metadata } from "next";

import { PlatinumPage } from "@/components/platinum/platinum-page";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Platinum · Whirl",
  description:
    "Whirl Platinum is our highest tier: a substantially larger allowance, the Fast model entirely unmetered, and preferential rates across the model catalog. Membership is limited.",
  path: "/platinum",
});

export default function Page() {
  return <PlatinumPage />;
}
