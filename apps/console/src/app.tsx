import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { Authenticated, AuthLoading } from "convex/react";

import { ConsoleShell } from "~/components/console-shell";
import { LoadingScreen } from "~/components/loading-screen";
import { Spinner } from "~/components/spinner";
import { useIdentifyUser } from "~/lib/analytics";
import { readThemePref, resolveDark } from "~/lib/theme";
import { useIsAdmin } from "~/lib/use-admin";
import { AdminPage } from "~/pages/admin/admin-page";
import { ApprovalDetailPage } from "~/pages/approvals/approval-detail-page";
import { ApprovalsPage } from "~/pages/approvals/approvals-page";
import { SkillApprovalDetailPage } from "~/pages/approvals/skill-approval-detail-page";
import { ExtensionsPage } from "~/pages/extensions/extensions-page";
import {
  EditIntegrationPage,
  NewIntegrationPage,
} from "~/pages/integrations/integration-form-page";
import {
  CustomizeTierPage,
  EditModelPage,
  NewModelPage,
} from "~/pages/models/model-form-page";
import { ModelsPage } from "~/pages/models/models-page";
import { IntegrationsPage } from "~/pages/integrations/integrations-page";
import { PlatinumPage } from "~/pages/platinum/platinum-page";
import {
  EditSkillPage,
  NewSkillPage,
} from "~/pages/skills/skill-form-page";
import { SkillsPage } from "~/pages/skills/skills-page";
import { SignInPage } from "~/pages/sign-in";

export function App() {
  useIdentifyUser();

  // Keep the dark class in sync with the OS while the pref is "system" —
  // same behavior as the main app's shell.
  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      resolveDark(readThemePref()),
    );
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePref() === "system") {
        document.documentElement.classList.toggle("dark", mq.matches);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <SignedOut>
        <SignInPage />
      </SignedOut>
      <SignedIn>
        {/* Wait for the Clerk token to reach Convex before rendering pages,
            so queries never fire unauthenticated and flash empty states. */}
        <AuthLoading>
          <LoadingScreen />
        </AuthLoading>
        <Authenticated>
          <Routes>
            <Route element={<ConsoleShell />}>
              <Route
                index
                element={<Navigate to="/integrations" replace />}
              />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route
                path="/integrations/new"
                element={<NewIntegrationPage />}
              />
              <Route
                path="/integrations/:id/edit"
                element={<EditIntegrationPage />}
              />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/skills/new" element={<NewSkillPage />} />
              <Route path="/skills/:id/edit" element={<EditSkillPage />} />
              <Route
                path="/approvals"
                element={
                  <RequireAdmin>
                    <ApprovalsPage />
                  </RequireAdmin>
                }
              />
              {/* Skills before the :id catch-all, or "skills" would parse as
                  an integration id. */}
              <Route
                path="/approvals/skills/:id"
                element={
                  <RequireAdmin>
                    <SkillApprovalDetailPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/approvals/:id"
                element={
                  <RequireAdmin>
                    <ApprovalDetailPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/extensions"
                element={
                  <RequireAdmin>
                    <ExtensionsPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/models"
                element={
                  <RequireAdmin>
                    <ModelsPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/models/new"
                element={
                  <RequireAdmin>
                    <NewModelPage />
                  </RequireAdmin>
                }
              />
              {/* Tiers before the :id catch-all, or "tiers" would parse as
                  a model id. */}
              <Route
                path="/models/tiers/:tier"
                element={
                  <RequireAdmin>
                    <CustomizeTierPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/models/:id/edit"
                element={
                  <RequireAdmin>
                    <EditModelPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/platinum"
                element={
                  <RequireAdmin>
                    <PlatinumPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <AdminPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="*"
                element={<Navigate to="/integrations" replace />}
              />
            </Route>
          </Routes>
        </Authenticated>
      </SignedIn>
    </>
  );
}

/**
 * Route gate backed by Convex's server-side identity check. The functions
 * behind each page independently repeat the same assertion.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin();
  if (isAdmin === undefined) {
    return (
      <div className="flex min-h-72 items-center justify-center text-neutral-400">
        <Spinner size={18} />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/integrations" replace />;
  return <>{children}</>;
}
