import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { IconPlus } from "@tabler/icons-react";

import { ConfirmModal } from "~/components/confirm-modal";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type Skill } from "~/lib/backend";
import {
  SkillTable,
  SkillTableSkeleton,
  SkillsEmptyState,
} from "~/pages/skills/skill-table";

/**
 * Every skill the signed-in developer has registered for the store, with its
 * review status and lifecycle actions. Same bones as My Integrations.
 */
export function SkillsPage() {
  const skills = useQuery(api.skills.listMine);
  const setEnabled = useMutation(api.skills.setEnabled);
  const removeSkill = useMutation(api.skills.remove);
  const capture = useCapture();
  const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);

  const openCreate = () => void navigate("/skills/new");

  const actions = {
    // Edits are full resubmissions — the form page handles them.
    onEdit: (skill: Skill) => void navigate(`/skills/${skill.id}/edit`),
    onToggle: (skill: Skill, enabled: boolean) => {
      capture(CONSOLE_EVENTS.skillToggled, { enabled });
      // Fire and forget — the reactive query snaps the row back on failure.
      void setEnabled({ id: skill.id, enabled });
    },
    onDelete: setDeleteTarget,
  };

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            My Skills
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            Instruction packs you've written for the Whirl store — Whirl learns
            them mid-chat, right when the task calls for them.
          </p>
        </div>
        {skills !== undefined && skills.length > 0 && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500"
          >
            <IconPlus size={15} stroke={2.5} />
            New skill
          </button>
        )}
      </div>

      <div className="mt-6">
        {skills === undefined ? (
          <SkillTableSkeleton />
        ) : skills.length === 0 ? (
          <SkillsEmptyState onCreate={openCreate} />
        ) : (
          <SkillTable skills={skills} actions={actions} />
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete skill?"
        body={`"${deleteTarget?.name ?? ""}" will be removed from the store pipeline and deleted for good. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removeSkill({ id: deleteTarget.id });
          capture(CONSOLE_EVENTS.skillDeleted);
        }}
      />
    </>
  );
}
