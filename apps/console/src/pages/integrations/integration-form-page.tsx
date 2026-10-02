import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { Spinner } from "~/components/spinner";
import { VerifiedBadge } from "~/components/verified-badge";
import { CONSOLE_EVENTS, useCapture } from "~/lib/analytics";
import { api, type AuthMode, type Integration } from "~/lib/backend";
import { useIsAdmin } from "~/lib/use-admin";
import {
  AuthConfigFields,
  inputClass,
  textareaClass,
  type AuthFieldDraft,
} from "~/pages/integrations/auth-config-fields";
import {
  FieldLabel,
  ImageUploadField,
  SvgIconField,
  type UploadedImage,
} from "~/pages/integrations/branding-fields";
import {
  ToolScanSection,
  type ToolDraft,
} from "~/pages/integrations/tool-scan-section";

/** Create mode: a blank form that submits into the approvals queue. */
export function NewIntegrationPage() {
  return <IntegrationFormPage />;
}

/**
 * Edit mode: the same form, prefilled from the saved row. Everything is
 * editable — and saving sends the integration back through review.
 */
export function EditIntegrationPage() {
  const { id } = useParams();
  const integrations = useQuery(api.integrations.listMine);
  const navigate = useNavigate();

  if (integrations === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  const initial = integrations.find((i) => i.id === id);
  if (!initial) {
    void navigate("/integrations", { replace: true });
    return null;
  }
  return <IntegrationFormPage initial={initial} />;
}

/**
 * Registration form for a store integration: branding, the MCP server, its
 * auth recipe, and a chat action phrase for every tool. Submits (or
 * resubmits) into the admin approvals queue.
 */
function IntegrationFormPage({ initial }: { initial?: Integration }) {
  const createIntegration = useMutation(api.integrations.create);
  const updateIntegration = useMutation(api.integrations.update);
  const capture = useCapture();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const editing = initial !== undefined;

  const [name, setName] = useState(initial?.name ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [logo, setLogo] = useState<UploadedImage | null>(
    initial?.logoUrl ? { previewUrl: initial.logoUrl } : null,
  );
  const [banner, setBanner] = useState<UploadedImage | null>(
    initial?.bannerUrl ? { previewUrl: initial.bannerUrl } : null,
  );
  const [iconSvg, setIconSvg] = useState<string | null>(
    initial?.iconSvg ?? null,
  );
  const [mcpUrl, setMcpUrl] = useState(initial?.mcpUrl ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(
    initial?.authMode ?? "none",
  );
  const [authFields, setAuthFields] = useState<AuthFieldDraft[]>(
    initial && initial.authFields.length > 0
      ? initial.authFields.map((f) => ({ ...f, testValue: "" }))
      : [{ key: "", label: "", testValue: "" }],
  );
  const [authInstructions, setAuthInstructions] = useState(
    initial?.authInstructions ?? "",
  );
  const [tools, setTools] = useState<ToolDraft[] | null>(
    initial && initial.tools.length > 0
      ? initial.tools.map((t) => ({
          name: t.name,
          description: t.description,
          completed: t.completed ?? "",
        }))
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimsWhirl = author.trim().toLowerCase() === "whirl";

  const validate = (): string | null => {
    if (!name.trim()) return "Give the integration a name.";
    if (!author.trim()) return "Who made this integration?";
    if (!logo) return "Upload a logo for the store listing.";
    if (!mcpUrl.trim()) return "Enter the MCP server URL.";
    if (authMode === "apiKey") {
      if (!authFields.some((f) => f.key.trim() && f.label.trim())) {
        return "Define at least one field users fill in (label + header).";
      }
      if (!authInstructions.trim()) {
        return "Write instructions for how users get their key.";
      }
    }
    const validTools = (tools ?? []).filter((t) => t.name.trim());
    if (validTools.length === 0) {
      return "Scan the server and describe its tools before submitting.";
    }
    const missing = validTools.find((t) => !t.description.trim());
    if (missing) {
      return `Write a description for the "${missing.name}" tool.`;
    }
    const missingCompleted = validTools.find((t) => !t.completed.trim());
    if (missingCompleted) {
      return `Write a completed state for the "${missingCompleted.name}" tool.`;
    }
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const shared = {
      name,
      description: description.trim() || undefined,
      author,
      iconSvg: iconSvg ?? undefined,
      mcpUrl,
      authMode,
      authFields:
        authMode === "apiKey"
          ? authFields
              .filter((f) => f.key.trim() && f.label.trim())
              .map((f) => ({ key: f.key, label: f.label }))
          : undefined,
      authInstructions: authMode === "apiKey" ? authInstructions : undefined,
      tools: (tools ?? [])
        .filter((t) => t.name.trim())
        .map((t) => ({
          name: t.name,
          description: t.description,
          completed: t.completed,
        })),
    };
    try {
      if (editing) {
        await updateIntegration({
          ...shared,
          id: initial.id,
          // Branding ids ride along only when replaced; clear flags drop the
          // optional ones entirely.
          logoId: logo?.storageId,
          bannerId: banner?.storageId,
          clearBanner: banner === null,
          clearIcon: iconSvg === null,
        });
        capture(CONSOLE_EVENTS.integrationUpdated, {
          authMode,
          toolCount: shared.tools.length,
        });
      } else {
        await createIntegration({
          ...shared,
          logoId: logo!.storageId!,
          bannerId: banner?.storageId,
        });
        capture(CONSOLE_EVENTS.integrationCreated, {
          authMode,
          toolCount: shared.tools.length,
          hasIcon: iconSvg !== null,
          hasBanner: banner !== null,
        });
      }
      void navigate("/integrations");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <>
      <Link
        to="/integrations"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <IconArrowLeft size={14} stroke={2} />
        Back to My Integrations
      </Link>

      <div className="mt-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {editing ? `Edit ${initial.name}` : "New integration"}
        </h1>
        <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
          {editing
            ? "Change anything you like — saving sends it back through review."
            : "Register an MCP server for the Whirl integration store. It goes live once an admin approves it."}
        </p>
      </div>

      {editing && initial.status === "approved" && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/[0.08] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800 dark:bg-amber-500/[0.12] dark:text-amber-200">
          <IconAlertTriangle size={15} stroke={2} className="mt-0.5 shrink-0" />
          This integration is live. Saving edits returns it to pending review,
          so it leaves the store until an admin approves it again.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <FormSection
          title="Details"
          subtitle="What users see in the store listing."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Name" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Linear"
                maxLength={60}
                autoFocus={!editing}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel label="Author" />
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Acme Inc."
                maxLength={60}
                className={inputClass}
              />
              {claimsWhirl &&
                (isAdmin ? (
                  <span className="flex items-center gap-1 text-[11.5px] text-[#0c82f2]">
                    <VerifiedBadge size={13} />
                    This will publish as verified.
                  </span>
                ) : (
                  <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                    Heads up: only Whirl team accounts get the verified badge.
                  </span>
                ))}
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <FieldLabel label="Description" optional />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One or two lines on what this integration does."
              maxLength={240}
              rows={2}
              className={textareaClass}
            />
          </label>
        </FormSection>

        <FormSection
          title="Branding"
          subtitle="The logo is front and center in the store; the icon and banner are nice-to-haves."
        >
          <div className="flex flex-wrap gap-8">
            <ImageUploadField
              label="Logo"
              hint="Square works best. Shown on the store card and listing."
              shape="square"
              value={logo}
              onChange={setLogo}
            />
            <SvgIconField value={iconSvg} onChange={setIconSvg} />
          </div>
          <ImageUploadField
            label="Banner"
            hint="A wide header image for the store listing page."
            optional
            shape="banner"
            value={banner}
            onChange={setBanner}
          />
        </FormSection>

        <FormSection
          title="Server & authentication"
          subtitle="Where the MCP server lives and how users connect to it."
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel label="MCP server URL" />
            <input
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
              maxLength={2048}
              className={`${inputClass} font-mono text-[12px]`}
            />
          </label>
          <AuthConfigFields
            mode={authMode}
            onModeChange={setAuthMode}
            fields={authFields}
            onFieldsChange={setAuthFields}
            instructions={authInstructions}
            onInstructionsChange={setAuthInstructions}
          />
        </FormSection>

        <FormSection
          title="Tools"
          subtitle={
            'Scan the server, then give every tool an action phrase — it shows up in the chat while Whirl runs the tool, like "Searching your Linear issues".'
          }
        >
          <ToolScanSection
            url={mcpUrl}
            authMode={authMode}
            scanHeaders={
              authMode === "apiKey"
                ? authFields
                    .filter((f) => f.key.trim() && f.testValue)
                    .map((f) => ({ key: f.key, value: f.testValue }))
                : []
            }
            tools={tools}
            onToolsChange={setTools}
          />
        </FormSection>

        {error && (
          <p className="rounded-lg bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-700 dark:bg-red-500/[0.12] dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pb-4">
          <Link
            to="/integrations"
            className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-3.5 text-[13px] font-medium text-neutral-900 transition hover:border-black/[0.16] hover:bg-neutral-100 dark:border-white/[0.1] dark:bg-[#222] dark:text-neutral-100 dark:hover:border-white/[0.2] dark:hover:bg-[#2e2e2e]"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {busy && <Spinner size={13} />}
            {editing ? "Save & resubmit for review" : "Submit for review"}
          </button>
        </div>
      </div>
    </>
  );
}

function FormSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  );
}
