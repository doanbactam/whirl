/* Who is signed in, for the support widget.
 *
 * medianIdentity does the rest: it signs the id with MEDIAN_KEY, sends the
 * median_pk_ half down with it, and sets `cache-control: private, no-store`.
 * The signature is what makes account tools possible. Without it,
 * `context.visitor.externalId` never arrives and every tool in
 * median.config.ts that reads an account has to refuse.
 *
 * Nothing here is cacheable and nothing here is ours to sign by hand. */

import { currentUser } from "@clerk/nextjs/server";
import { medianIdentity } from "@mediansh/agent-tools";

export const runtime = "nodejs";

export const { GET } = medianIdentity(async () => {
  /* Signed out is a normal answer. The panel still opens and asks for an
     email before the first message. */
  const user = await currentUser().catch(() => null);
  if (!user) return null;

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return {
    id: user.id,
    name: name || (user.username ?? undefined),
    email: user.primaryEmailAddress?.emailAddress,
    avatarUrl: user.imageUrl,
  };
});
