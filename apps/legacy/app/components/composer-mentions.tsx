import { useMemo } from "react";

import { IntegrationLogo } from "~/components/integrations/integration-logo";
import { useInstalledIntegrations } from "~/data/integrationStore";
import { useInstalledSkills } from "~/data/skillStore";

/**
 * Something the user can @mention in the composer. The mention lives inline
 * in the message text as "@Name" (highlighted Slack-style) and tells the
 * backend to preload that thing for the turn. `serverId` is the mention's
 * stable key — an mcpServers id for integrations, a skillInstalls id for
 * skills, a pseudo-id for attached-image tags; the composer keeps the lists
 * separate, so the key never needs to say which kind it is.
 */
export type IntegrationMention = {
  serverId: string;
  name: string;
  logoUrl: string | null;
  iconSvg?: string;
};

/** One run of composer text: either plain, or an "@Name" mention token. */
export type MentionSegment = {
  text: string;
  mention?: IntegrationMention;
};

/**
 * Split composer text into plain runs and "@Name" mention tokens. A token
 * counts only when the "@" sits at a word boundary and what follows matches an
 * installed integration's name (case-insensitive, longest name first, and not
 * bleeding into a longer word — "@Notion" in "@Notions" doesn't match). The
 * typed text is preserved verbatim; editing half a name simply demotes the
 * token back to plain text.
 */
export function splitMentionSegments(
  text: string,
  mentionables: IntegrationMention[],
): MentionSegment[] {
  if (!text || mentionables.length === 0) return text ? [{ text }] : [];
  const byLength = [...mentionables].sort(
    (a, b) => b.name.length - a.name.length,
  );
  const segments: MentionSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const boundary = i === 0 || /\s/.test(text[i - 1]);
    if (text[i] === "@" && boundary) {
      const rest = text.slice(i + 1);
      const restLower = rest.toLowerCase();
      const match = byLength.find((m) => {
        if (!restLower.startsWith(m.name.toLowerCase())) return false;
        const next = rest[m.name.length];
        return next === undefined || !/[\p{L}\p{N}]/u.test(next);
      });
      if (match) {
        if (plain) {
          segments.push({ text: plain });
          plain = "";
        }
        segments.push({
          text: text.slice(i, i + 1 + match.name.length),
          mention: match,
        });
        i += 1 + match.name.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

/** The integrations mentioned in the text, deduped, in order of appearance. */
export function findMentionedIntegrations(
  text: string,
  mentionables: IntegrationMention[],
): IntegrationMention[] {
  const seen = new Set<string>();
  const out: IntegrationMention[] = [];
  for (const segment of splitMentionSegments(text, mentionables)) {
    if (!segment.mention || seen.has(segment.mention.serverId)) continue;
    seen.add(segment.mention.serverId);
    out.push(segment.mention);
  }
  return out;
}

/**
 * The user's mentionable integrations: installed, enabled, and (for OAuth
 * ones) actually signed in. Having installs is the whole gate — plan limits
 * are the backend's job, and someone who installed an integration should
 * always be able to point at it.
 */
export function useMentionableIntegrations(): IntegrationMention[] {
  const { installed } = useInstalledIntegrations();
  return useMemo(() => {
    if (!installed) return [];
    return installed
      .filter((i) => i.enabled && (i.authMode !== "oauth" || i.oauthConnected))
      .map((i) => ({
        serverId: i.serverId,
        name: i.name,
        logoUrl: i.logoUrl,
        iconSvg: i.iconSvg,
      }));
  }, [installed]);
}

/**
 * The user's mentionable skills: installed and enabled. Same mention shape
 * as integrations (the install id rides in `serverId`), so every mention
 * surface — highlight pills, the command menu, the plus menu — handles both
 * without caring which is which.
 */
export function useMentionableSkills(): IntegrationMention[] {
  const { installed } = useInstalledSkills();
  return useMemo(() => {
    if (!installed) return [];
    return installed
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        serverId: skill.installId,
        name: skill.name,
        logoUrl: skill.logoUrl,
        iconSvg: skill.iconSvg,
      }));
  }, [installed]);
}

/**
 * A mention as it reads INSIDE sent message text: the same construction as
 * the composer's highlight pill — plain inline text with a tinted background
 * (padding faked with a zero-blur shadow spread, so no metric change) and the
 * logo/thumbnail drawn inside the "@" glyph's cell. Because it IS ordinary
 * inline text, it sits on the surrounding prose's baseline exactly; a flex
 * pill never quite does.
 */
export function InlineMentionPill({
  mention,
}: {
  mention: Pick<IntegrationMention, "name" | "logoUrl" | "iconSvg">;
}) {
  return (
    <span className="rounded-[6px] box-decoration-clone bg-[#0c82f2]/[0.1] font-medium text-[#0c82f2] shadow-[0_0_0_3px_rgba(12,130,242,0.1)] dark:bg-[#0c82f2]/[0.22] dark:text-[#6db4f8] dark:shadow-[0_0_0_3px_rgba(12,130,242,0.22)]">
      <span className="relative text-transparent">
        @
        {/* The wrapper owns the absolute placement: IntegrationLogo's image
            branch is position:relative under the hood, and if that sat in
            flow it would fragment the inline pill's line box. */}
        <span className="absolute left-[44%] top-[53%] -translate-x-1/2 -translate-y-1/2">
          <IntegrationLogo
            name={mention.name}
            logoUrl={mention.logoUrl}
            iconSvg={mention.iconSvg}
            size={13}
          />
        </span>
      </span>
      {mention.name}
    </span>
  );
}
