export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8, requireUppercase: false, requireNumbers: false, requireSpecial: false,
};

export function passwordMeetsPolicy(password: string, policy: PasswordPolicy): boolean {
  if (password.length < policy.minLength) return false;
  if (policy.requireUppercase && !/[A-Z]/.test(password)) return false;
  if (policy.requireNumbers && !/[0-9]/.test(password)) return false;
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
