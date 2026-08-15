// Landing page for the SAML redirect back from the IdP. supabase-js auto-parses
// the session out of the URL (detectSessionInUrl, default true) before this
// page needs it -- but a fresh SSO login has no public.users row yet, so this
// page's whole job is calling complete-sso-login once to JIT-provision it
// (role='pending', see that function's own comments for why), then routing
// home. Public route, outside RequireAuth -- it runs in the gap between
// "session exists" and "profile exists".
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Outcome = "finishing" | "no_matching_tenant" | "email_conflict" | "error";

export function SsoCallbackPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome>("finishing");

  useEffect(() => {
    let cancelled = false;
    let started = false; // guards against running twice if both the initial
                          // getSession() check and a subsequent auth event
                          // both observe a session

    const complete = async (accessToken: string) => {
      if (started || cancelled) return;
      started = true;
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/complete-sso-login`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.ok && (body?.status === "provisioned" || body?.status === "already_provisioned")) {
          await qc.invalidateQueries({ queryKey: qk.profile() });
          nav("/", { replace: true });
          return;
        }
        if (res.ok && body?.status === "no_matching_tenant") { setOutcome("no_matching_tenant"); return; }
        if (res.status === 409 && body?.status === "email_conflict") { setOutcome("email_conflict"); return; }
        setOutcome("error");
      } catch {
        if (!cancelled) setOutcome("error");
      }
    };

    // The redirect can land here either with the session already parsed out
    // of the URL fragment (checked directly below) or a beat before that
    // finishes (caught by the listener) -- covering both avoids a race
    // against exactly when supabase-js's detectSessionInUrl resolves.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) complete(data.session.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) complete(session.access_token);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [nav, qc]);

  const errorCopy: Record<Exclude<Outcome, "finishing" | "done">, string> = {
    no_matching_tenant: t("auth.sso.noMatchingTenant"),
    email_conflict: t("auth.sso.emailConflict"),
    error: t("auth.sso.genericError"),
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-sm rounded-panel border border-line bg-card p-8 text-center shadow-lg">
        {outcome === "finishing" ? (
          <p className="text-sm text-ink-soft">{t("auth.sso.finishing")}</p>
        ) : (
          <>
            <p role="alert" className="mb-4 text-sm text-danger">{errorCopy[outcome]}</p>
            <Link to="/login" className="text-sm font-medium text-navy hover:underline">
              {t("auth.sso.usePasswordInstead")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
