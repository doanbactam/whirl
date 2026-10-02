import { MarketingShell } from "@/components/marketing/marketing-shell";

export default function KirkifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MarketingShell>{children}</MarketingShell>;
}
