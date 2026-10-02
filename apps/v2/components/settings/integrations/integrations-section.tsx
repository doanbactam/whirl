"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconLogin2, IconPuzzle, IconSparkles } from "@tabler/icons-react";

import { AuthModal } from "@/components/auth/auth-modal";
import { ReauthNotice } from "@/components/integrations/reauth-notice";
import { Button } from "@/components/ui/button";
import { useOAuthResult } from "@/lib/integrations-data";
import { useModelAccess } from "@/lib/model-access";
import { showToast } from "@/lib/toasts";
import { useView } from "@/lib/view";
import { SettingsCard, SettingsHeader, SettingsRow } from "../settings-rows";
import { ConnectedIntegrationsCard } from "./connected-integrations-card";
import { ServersCard } from "./servers-card";
import { SkillsCard } from "./skills-card";

/* The Integrations tab: everything the user has plugged into Whirl, in one
   place — store installs, skills (installed or hand-written), and custom
   MCP servers. The store itself stays at /integrations; this is the manage
   side. */

export function IntegrationsSection() {
  const { user, isLoaded } = useUser();
  const { isPaid } = useModelAccess();
  const { openPricing } = useView();

  const [authOpen, setAuthOpen] = useState(false);

  /* Sign-in popups (integration connects and OAuth servers alike) report
     back via postMessage; rows flip to "connected" reactively, so only the
     words need saying. */
  useOAuthResult(({ ok, error }) => {
    showToast(
      ok ? "Connected." : (error ?? "The sign-in didn't finish — try again."),
    );
  });

  const signedOut = isLoaded && !user;

  return (
    <>
      <SettingsHeader
        title="Integrations"
        description="Your connected apps, skills, and MCP servers — the store lives at Integrations in the sidebar."
      />
      {/* Roomy gaps: each group is heading + card, and the whitespace is
          what tells them apart — gap-4 read as one continuous list. */}
      <div className="flex flex-col gap-9">
        {signedOut ? (
          <SettingsCard>
            <SettingsRow
              icon={IconLogin2}
              title="You're signed out"
              description="Sign in to manage integrations, skills, and MCP servers."
              control={
                <Button variant="secondary" onClick={() => setAuthOpen(true)}>
                  Sign in
                </Button>
              }
            />
          </SettingsCard>
        ) : isPaid === false ? (
          <SettingsCard>
            <SettingsRow
              icon={IconPuzzle}
              title="Integrations are a paid perk"
              description="Plug in the tools you already use and Whirl can call them mid-chat: search your notes, file a ticket, hit your API."
              control={
                <Button onClick={openPricing}>
                  <IconSparkles size={15} stroke={2} />
                  See plans
                </Button>
              }
            />
          </SettingsCard>
        ) : (
          <>
            {/* Above everything: an expired sign-in is the only thing on this
                page that is actively costing the user something. */}
            <ReauthNotice className="-mb-4" />
            <ConnectedIntegrationsCard />
            <SkillsCard />
            <ServersCard />
          </>
        )}
      </div>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
