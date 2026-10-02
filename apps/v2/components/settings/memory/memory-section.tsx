"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { IconBrain, IconLogin2, IconSparkles } from "@tabler/icons-react";

import { AuthModal } from "@/components/auth/auth-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useModelAccess } from "@/lib/model-access";
import { useMemories, useMemorySources } from "@/lib/user-memory";
import { useView } from "@/lib/view";
import { SettingsCard, SettingsHeader, SettingsRow } from "../settings-rows";
import { ForgetEverythingCard } from "./forget-everything-card";
import { MemoriesCard } from "./memories-card";
import { SourcesCard } from "./sources-card";
import { SupermemoryToggle } from "./supermemory-toggle";

/* The Memory tab. The switch up top decides whether Whirl reads or writes
   memory at all; everything under it manages what's already stored, which
   matters just as much when the switch is off.

   Memory is a paid perk, so free and signed-out visitors get the pitch
   instead of the machinery. `isPaid` is null while the plan is genuinely
   unknown — showing the pitch then would flash it at a paying user. */

export function MemorySection() {
  const { user, isLoaded } = useUser();
  const { isPaid } = useModelAccess();
  const { openPricing } = useView();
  const [authOpen, setAuthOpen] = useState(false);

  const paid = isPaid === true;
  const memories = useMemories(paid);
  const sources = useMemorySources(paid);

  const signedOut = isLoaded && !user;

  return (
    <>
      <SettingsHeader
        title="Memory"
        description="What Whirl carries from one chat to the next."
      />
      {/* Roomy gaps: each group is heading + card, and the whitespace is
          what tells them apart — matching the Integrations tab. */}
      <div className="flex flex-col gap-9">
        {signedOut ? (
          <SettingsCard>
            <SettingsRow
              icon={IconLogin2}
              title="You're signed out"
              description="Sign in and Whirl can remember your preferences, projects, and context between chats."
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
              icon={IconBrain}
              title="Memory is a paid perk"
              description="Whirl picks up your preferences, projects, and context as you chat, then brings them to every new one — and you get to edit every last bit of it here."
              control={
                <Button onClick={openPricing}>
                  <IconSparkles size={15} stroke={2} />
                  See plans
                </Button>
              }
            />
          </SettingsCard>
        ) : !paid ? (
          /* Plan still unknown — hold the shape rather than guess. */
          <>
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-44 rounded-lg" />
          </>
        ) : (
          <>
            <SettingsCard>
              <SettingsRow
                title="Use memory"
                description="Let Whirl draw on what it knows about you and keep learning from new chats. Turning it off pauses both — nothing already saved is deleted."
                control={<SupermemoryToggle />}
              />
            </SettingsCard>

            <MemoriesCard store={memories} />
            <SourcesCard store={sources} />
            <ForgetEverythingCard
              onCleared={() => {
                memories.clear();
                sources.clear();
              }}
            />
          </>
        )}
      </div>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
