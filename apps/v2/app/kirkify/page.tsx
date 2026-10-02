import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KirkifyNotes } from "@/components/kirkify/kirkify-notes";
import { KirkifyStudio } from "@/components/kirkify/kirkify-studio";
import { Lede, PageTitle } from "@/components/marketing/page-blocks";
import { kirkifyEnabled } from "@/lib/kirkify/enabled";
import { publicPageMetadata, SITE_NAME, SITE_URL } from "@/lib/seo";

const TITLE = "Kirkify · Whirl";
const DESCRIPTION =
  "Happy Kirkiversary. Drop in a photo and get it back with a very familiar face. Three a day, free.";

export const metadata: Metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/kirkify",
  image: {
    url: "/kirkify/og.png",
    width: 1200,
    height: 630,
    alt: "Kirkify. Drop in a photo, get it back with a very familiar face.",
  },
});

/* What a crawler that reads structured data gets: a free web app, by Whirl. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Kirkify",
  url: `${SITE_URL}/kirkify`,
  description: DESCRIPTION,
  applicationCategory: "EntertainmentApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

export default function KirkifyPage() {
  if (!kirkifyEnabled()) notFound();

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <PageTitle quiet>Happy Kirkiversary.</PageTitle>
      <Lede>Drop in a photo and get it back Kirkified.</Lede>
      <KirkifyStudio />
      <KirkifyNotes />
    </article>
  );
}
