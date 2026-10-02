import { AppShell } from "@/components/app-shell";

/* The persistent app frame for / and /settings. Living in a shared layout
   means navigation between the two never remounts the shell — both faces
   stay in the DOM and the page slide animates between them. */
export default function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
