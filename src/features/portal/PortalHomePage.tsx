import { useSession } from "@/features/auth/useSession";
import { StudentPortalPage } from "./StudentPortalPage";
import { ParentPortalPage } from "./ParentPortalPage";

// Student and parent self-service used to register two sibling routes at
// the identical "portal" path, gated to different single roles. React
// Router breaks that tie by declaration order rather than by which guard
// actually passes, so a parent hitting /portal matched the student-only
// route, failed RequireRole, and got redirected to "/" -- which renders
// the ungated admin DashboardPage. One shared route with the branch inside
// React (not the router) removes the ambiguity entirely.
export function PortalHomePage() {
  const { profile } = useSession();
  return profile?.role === "parent" ? <ParentPortalPage /> : <StudentPortalPage />;
}
