// UX-only gate, same spirit as RequireRole (§6.2 — RLS/DB enforcement of
// module gating is a deliberate follow-up, not done here; see the migration
// comment on tenant_module_overrides). super_admin bypasses, same as
// RequireRole: the platform console isn't a tenant subscription feature.
import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./useSession";
import { useEnabledModules } from "./useEnabledModules";

export function RequireModule({ module }: { module: string }) {
  const { profile, isLoading } = useSession();
  const modules = useEnabledModules();
  if (isLoading) return null;
  if (!profile) return <Navigate to="/" replace />;
  if (profile.role === "super_admin") return <Outlet />;
  if (modules === null) return null; // still loading the tenant's module set
  if (!modules.has(module)) return <Navigate to="/" replace />;
  return <Outlet />;
}
