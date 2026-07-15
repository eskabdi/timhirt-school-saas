import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./useSession";

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useSession();
  if (isLoading) return <div className="flex h-screen items-center justify-center text-ink-faint">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
