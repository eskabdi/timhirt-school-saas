// "Visible to" role picker, shared by the notice and event editors.
//
// The stored values are public.user_role labels, so what is saved matches what
// RLS compares against. Admin Assistant and Homeroom Teacher appear in the
// designs but have no enum member of their own — they are the registrar and
// teacher roles under the names the school uses, mapped here rather than
// invented in the database.
import { useTranslation } from "react-i18next";

export const VISIBILITY_ROLES = [
  { role: "super_admin", labelKey: "roleVisibility.superAdministrator" },
  { role: "school_admin", labelKey: "roleVisibility.schoolAdministrator" },
  { role: "registrar", labelKey: "roleVisibility.adminAssistant" },
  { role: "teacher", labelKey: "roleVisibility.teacher" },
  { role: "homeroom_teacher", labelKey: "roleVisibility.homeroomTeacher" },
  { role: "parent", labelKey: "roleVisibility.parent" },
  { role: "student", labelKey: "roleVisibility.student" },
] as const;

export function RoleVisibility({ selected, onChange, title }: {
  selected: string[];
  onChange: (roles: string[]) => void;
  title?: string;
}) {
  const { t } = useTranslation();
  const all = VISIBILITY_ROLES.map((r) => r.role);
  const allChecked = all.every((r) => selected.includes(r));

  const toggle = (role: string) =>
    onChange(selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]);

  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-navy">{title ?? t("roleVisibility.visibleTo")}</p>
      <label className="flex items-center gap-2 rounded-control bg-navy-wash px-3 py-2 text-sm font-medium text-navy">
        <input type="checkbox" checked={allChecked} onChange={() => onChange(allChecked ? [] : [...all])} />
        {t("roleVisibility.selectAll")}
      </label>
      {VISIBILITY_ROLES.map((r) => (
        <label key={r.role} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
          <input type="checkbox" checked={selected.includes(r.role)} onChange={() => toggle(r.role)} />
          {t(r.labelKey)}
        </label>
      ))}
    </div>
  );
}
