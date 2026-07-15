// UX-only gate (§6.2) — a tampered client rendering a forbidden page still
// receives zero rows from RLS. Keeps navigation honest, not security.
// super_admin bypasses every role gate here, matching the explicit bypass
// clause every backend RLS policy already has (§5.2) — previously this
// component had no such bypass, so a super_admin could reach the bare "/"
// dashboard but was bounced back to it from every other route, since
// "super_admin" never appears in any per-route roles list by design (those
// lists describe tenant-facing roles; super_admin's real surface is
// /platform/*). Found via a live deployment where a super_admin account
// couldn't navigate anywhere.
import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./useSession";

export function RequireRole({ roles }: { roles: string[] }) {
  const { profile, isLoading } = useSession();
  if (isLoading) return null;
  if (!profile) return <Navigate to="/" replace />;
  if (profile.role !== "super_admin" && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
