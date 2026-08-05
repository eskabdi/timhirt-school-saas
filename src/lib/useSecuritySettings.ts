// Live read of the platform-wide security policy set at /platform/security
// (super_admin only writes it -- see get_security_settings(), migration
// 20260806000001). Used wherever the app needs to know the *current* policy:
// useIdleLogout (session length), the password-policy hint + validation on
// AcceptInvitePage/ChangePasswordModal. A short refetchInterval, on top of
// the query client's default refetchOnWindowFocus, is what makes an admin's
// change "effective immediately" for sessions that are already open rather
// than only for the next login.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "@/lib/passwordPolicy";

export interface SecuritySettings {
  loginMaxAttempts: number;
  loginAttemptWindowMinutes: number;
  loginIpMaxAttempts: number;
  loginIpWindowMinutes: number;
  sessionTimeoutMinutes: number;
  passwordPolicy: PasswordPolicy;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  loginMaxAttempts: 5, loginAttemptWindowMinutes: 15,
  loginIpMaxAttempts: 20, loginIpWindowMinutes: 15,
  sessionTimeoutMinutes: 60,
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
};

function toNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function useSecuritySettings(): SecuritySettings {
  const { data } = useQuery({
    queryKey: ["security-settings"],
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data, error } = await supabase.rpc("get_security_settings");
      if (error) throw error;
      return (data ?? {}) as Record<string, unknown>;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!data) return DEFAULT_SECURITY_SETTINGS;
  return {
    loginMaxAttempts: toNumber(data.login_max_attempts, DEFAULT_SECURITY_SETTINGS.loginMaxAttempts),
    loginAttemptWindowMinutes: toNumber(data.login_attempt_window_minutes, DEFAULT_SECURITY_SETTINGS.loginAttemptWindowMinutes),
    loginIpMaxAttempts: toNumber(data.login_ip_max_attempts, DEFAULT_SECURITY_SETTINGS.loginIpMaxAttempts),
    loginIpWindowMinutes: toNumber(data.login_ip_window_minutes, DEFAULT_SECURITY_SETTINGS.loginIpWindowMinutes),
    sessionTimeoutMinutes: toNumber(data.session_timeout_minutes, DEFAULT_SECURITY_SETTINGS.sessionTimeoutMinutes),
    passwordPolicy: {
      minLength: toNumber(data.password_min_length, DEFAULT_PASSWORD_POLICY.minLength),
      requireUppercase: Boolean(data.password_require_uppercase),
      requireNumbers: Boolean(data.password_require_numbers),
      requireSpecial: Boolean(data.password_require_special),
    },
  };
}
