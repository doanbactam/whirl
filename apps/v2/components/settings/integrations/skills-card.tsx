"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  IconNotes,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import { api } from "@whirl/backend/convex/_generated/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useCustomSkills, type CustomSkill } from "@/lib/custom-skills";
import { errorText } from "@/lib/integrations-data";
import { useInstalledSkills, type InstalledSkill } from "@/lib/skills-data";
import { showToast } from "@/lib/toasts";
import { SettingsCard, SettingsGroupHeader } from "../settings-rows";
import { CustomSkillForm } from "./custom-skill-form";
import {
  InstalledRow,
  InstalledRowsList,
  RowSkeletons,
  enabledStatus,
} from "./installed-row";

/* Every skill the user has — store installs and hand-written ones — in one
   card. Store skills carry their listing's branding; custom skills get a
   quiet notes glyph, an edit pencil, and the form unfolds in place. */

type Confirming =
  | { kind: "install"; item: InstalledSkill }
  | { kind: "custom"; item: CustomSkill };

/** A custom skill's face: no branding, just the notes glyph in a well. */
function CustomSkillGlyph() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-well text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      <IconNotes size={19} stroke={1.75} />
    </span>
  );
}

export function SkillsCard() {
  const installed = useInstalledSkills();
  const {
    skills: customSkills,
    addSkill,
    updateSkill,
    setSkillEnabled,
    removeSkill,
  } = useCustomSkills();

  const setInstallEnabled = useMutation(api.skillStore.setInstallEnabled);
  const uninstallSkill = useMutation(api.skillStore.uninstall);

  // null = no editor; "new" = add form; otherwise the custom skill id open.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const toggleInstall = (item: InstalledSkill, enabled: boolean) => {
    setInstallEnabled({ installId: item.installId, enabled }).catch(
      (error: unknown) =>
        showToast(errorText(error, "Couldn't update that skill. Try again.")),
    );
  };

  const toggleCustom = (item: CustomSkill, enabled: boolean) => {
    setSkillEnabled({ id: item.id, enabled }).catch((error: unknown) =>
      showToast(errorText(error, "Couldn't update that skill. Try again.")),
    );
  };

  const remove = (target: Confirming) => {
    const done =
      target.kind === "install"
        ? uninstallSkill({ installId: target.item.installId })
        : removeSkill({ id: target.item.id });
    done
      .then(() => showToast(`${target.item.name} removed.`))
      .catch((error: unknown) =>
        showToast(errorText(error, "Couldn't remove that skill. Try again.")),
      );
  };

  const loading = installed === null || customSkills === undefined;
  const empty = !loading && installed.length === 0 && customSkills.length === 0;

  return (
    <>
      <section>
        <SettingsGroupHeader
          title="Skills"
          description="Instruction packs Whirl pulls in mid-chat — installed from the store or written by you."
          control={
            editing === "new" ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing("new")}
              >
                <IconPlus size={14} stroke={2} />
                New skill
              </Button>
            )
          }
        />
        <SettingsCard>
          {editing === "new" && (
            <div className="p-4">
              <CustomSkillForm
                onSave={async (args) => {
                  await addSkill(args);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
          {loading ? (
            <RowSkeletons rows={2} />
          ) : empty ? (
            editing !== "new" && (
              <p className="p-4 text-sm text-muted-foreground">
                No skills yet — install one from the store or write your own.
              </p>
            )
          ) : (
            <InstalledRowsList>
              {installed.map((item) => (
                <InstalledRow
                  key={item.installId}
                  name={item.name}
                  verified={item.verified}
                  logoUrl={item.logoUrl}
                  iconSvg={item.iconSvg}
                  status={enabledStatus(item.enabled)}
                  enabled={item.enabled}
                  onToggle={(enabled) => toggleInstall(item, enabled)}
                  action={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Uninstall ${item.name}`}
                      onClick={() => setConfirming({ kind: "install", item })}
                      className="text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                    >
                      <IconTrash size={14} stroke={2} />
                    </Button>
                  }
                />
              ))}
              {customSkills.map((item) => {
                const open = editing === item.id;
                return (
                  <InstalledRow
                    key={item.id}
                    name={item.name}
                    logo={<CustomSkillGlyph />}
                    status={enabledStatus(item.enabled)}
                    enabled={item.enabled}
                    onToggle={(enabled) => toggleCustom(item, enabled)}
                    action={
                      open ? undefined : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${item.name}`}
                            className="text-muted-foreground"
                            onClick={() => setEditing(item.id)}
                          >
                            <IconPencil size={15} stroke={2} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${item.name}`}
                            onClick={() =>
                              setConfirming({ kind: "custom", item })
                            }
                            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                          >
                            <IconTrash size={14} stroke={2} />
                          </Button>
                        </>
                      )
                    }
                  >
                    {open && (
                      <CustomSkillForm
                        skill={item}
                        onSave={async (args) => {
                          await updateSkill({
                            id: item.id,
                            name: args.name,
                            // An empty string (not undefined) so clearing the
                            // description actually clears it server-side.
                            description: args.description ?? "",
                            instructions: args.instructions,
                          });
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    )}
                  </InstalledRow>
                );
              })}
            </InstalledRowsList>
          )}
        </SettingsCard>
      </section>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Remove ${confirming?.item.name ?? "this skill"}?`}
        message={
          confirming?.kind === "custom"
            ? "Whirl forgets how to do this, and the instructions are gone for good."
            : "Whirl forgets how to do this. You can always reinstall it from the store."
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirming) remove(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}
