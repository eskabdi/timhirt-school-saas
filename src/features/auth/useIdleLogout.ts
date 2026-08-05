// Signs the user out after an hour with no interaction. Wired once, inside
// RequireAuth, so it covers every authenticated route (staff dashboard,
// portal, platform) without each page needing to opt in.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"] as const;
// mousemove/scroll fire dozens of times a second during normal use --
// coalesce them into at most one timer reset per interval instead of
// clearing/rescheduling setTimeout on every event.
const RESET_THROTTLE_MS = 5_000;

export function useIdleLogout(enabled: boolean) {
  const navigate = useNavigate();
  const lastResetRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    const logout = () => {
      supabase.auth.signOut().finally(() => navigate("/login?reason=idle", { replace: true }));
    };
    const scheduleLogout = () => { timer = setTimeout(logout, IDLE_TIMEOUT_MS); };

    const onActivity = () => {
      const nowTs = Date.now();
      if (nowTs - lastResetRef.current < RESET_THROTTLE_MS) return;
      lastResetRef.current = nowTs;
      clearTimeout(timer);
      scheduleLogout();
    };

    scheduleLogout();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
    };
  }, [enabled, navigate]);
}
