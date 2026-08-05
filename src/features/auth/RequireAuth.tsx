import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./useSession";
import { useIdleLogout } from "./useIdleLogout";

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useSession();
  useIdleLogout(isAuthenticated);
  if (isLoading) return <div className="flex h-screen items-center justify-center text-ink-faint">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
