// Overview tab — personal information, headline metrics, assigned classes,
// and upcoming schedule items. Every number here is a real aggregate; there
// is no seeded or placeholder data.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";
import { todayEthiopian, toEthiopian } from "@/lib/ethiopian-date";

export function OverviewTab({ employeeId, tenantId }: { employeeId: string; tenantId: string }) {
  const { t } = useTranslation();
  const ecYear = todayEthiopian().year;

  const { data: personal } = useQuery({
    queryKey: ["staff-personal", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("date_of_birth, gender, nationality, phone, woreda, kebele, house_number, national_id, hire_date")
        .eq("id", employeeId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: leaveBalance } = useQuery({
    queryKey: ["staff-leave-balance", employeeId, ecYear],
    queryFn: async () => {
      const { data } = await supabase.from("leave_balances")
        .select("entitled, taken, carried_from_prior").eq("employee_id", employeeId).eq("ec_year", ecYear);
      if (!data?.length) return null;
      return data.reduce((sum, r) => sum + Number(r.entitled) + Number(r.carried_from_prior) - Number(r.taken), 0);
    },
  });

  const { data: rating } = useQuery({
    queryKey: ["staff-latest-review", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("staff_performance_reviews")
        .select("rating, ec_year").eq("employee_id", employeeId).order("ec_year", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  // A teacher's classes are reached through teachers.employee_id, not
  // employees directly — teachers is the bridge table class_subject_teachers
  // actually joins on. An employee with no linked teachers row (not yet
  // invited, or invited before that link existed) simply has none, which
  // renders as the empty state below rather than an error.
  const { data: classes } = useQuery({
    queryKey: ["staff-classes", employeeId],
    queryFn: async () => {
      const { data: teacher } = await supabase.from("teachers").select("id").eq("employee_id", employeeId).maybeSingle();
      if (!teacher) return [];
      const { data } = await supabase.from("class_subject_teachers")
        .select("id, class_id, subject_id, class:classes(name, section), subject:subjects(name_i18n, code)")
        .eq("teacher_id", teacher.id);
      const rows = (data ?? []) as unknown as {
        id: string; class_id: string; subject_id: string;
        class: { name: string; section: string | null } | null;
        subject: { name_i18n: Record<string, string>; code: string } | null;
      }[];
      const withCounts = await Promise.all(rows.map(async (r) => {
        const { count } = await supabase.from("students")
          .select("id", { count: "exact", head: true }).eq("class_id", r.class_id).eq("status", "active");
        const { data: slots } = await supabase.from("timetable_slots")
          .select("day_of_week, starts_at, ends_at").eq("class_id", r.class_id).eq("subject_id", r.subject_id).limit(1);
        return { ...r, studentCount: count ?? 0, slot: slots?.[0] ?? null };
      }));
      return withCounts;
    },
  });

  const { data: notices } = useQuery({
    queryKey: ["staff-notices", tenantId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("notices")
        .select("id, title_i18n").lte("visible_from", today).gte("visible_to", today)
        .order("sort_order").limit(4);
      return data ?? [];
    },
  });

  const weekdayName = (dow: number) => {
    const names = t("weekdays", { returnObjects: true }) as string[];
    return names[dow] ?? "";
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader title={t("staffProfile.personalInformation")} />
          <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-ink-faint">{t("staffReg.dob")}</dt><dd className="font-medium text-ink">{personal?.date_of_birth ? <EthDate value={personal.date_of_birth} /> : "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.gender")}</dt><dd className="font-medium text-ink">{personal?.gender ? t(`gender.${personal.gender}`) : "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.nationality")}</dt><dd className="font-medium text-ink">{personal?.nationality || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.phone")}</dt><dd className="font-medium text-ink">{personal?.phone || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.woreda")}</dt><dd className="font-medium text-ink">{personal?.woreda || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.kebele")}</dt><dd className="font-medium text-ink">{personal?.kebele || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.houseNumber")}</dt><dd className="font-medium text-ink">{personal?.house_number || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.nationalId")}</dt><dd className="font-medium text-ink">{personal?.national_id || "—"}</dd></div>
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title={t("staffProfile.assignedClasses")} subtitle={t("staffProfile.academicYear", { year: ecYear })} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-4 py-2">{t("staffProfile.gradeSection")}</th>
                  <th className="px-4 py-2">{t("staffProfile.subjectCol")}</th>
                  <th className="px-4 py-2">{t("staffProfile.scheduleCol")}</th>
                  <th className="px-4 py-2">{t("staffProfile.studentsCol")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!classes?.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-faint">{t("staffProfile.noClassesAssigned")}</td></tr>
                ) : classes.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-ink">{c.class?.name} {c.class?.section}</td>
                    <td className="px-4 py-2 text-ink-faint">{c.subject?.code}</td>
                    <td className="px-4 py-2 text-ink-faint">
                      {c.slot ? `${weekdayName(c.slot.day_of_week)} ${c.slot.starts_at.slice(0, 5)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-ink-faint">{c.studentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-panel bg-navy p-4 text-white">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">{t("staffProfile.employeeMetrics")}</h2>
          <div className="rounded-control border border-white/20 px-3 py-2">
            <p className="text-xs text-white/70">{t("staffProfile.yearOfService")}</p>
            <p className="font-display text-lg font-bold">
              {personal?.hire_date ? Math.max(0, ecYear - toEthiopian(new Date(personal.hire_date)).year) : "—"}
            </p>
          </div>
          <div className="rounded-control border border-white/20 px-3 py-2">
            <p className="text-xs text-white/70">{t("staffProfile.leaveBalance")}</p>
            <p className="font-display text-lg font-bold">{leaveBalance ?? "—"}</p>
          </div>
          <div className="rounded-control border border-white/20 px-3 py-2">
            <p className="text-xs text-white/70">{t("staffProfile.prefRating")}</p>
            <p className="font-display text-lg font-bold">{rating ? `${rating.rating} / 5` : t("staffProfile.notRated")}</p>
          </div>
        </div>

        <div className="space-y-2 rounded-panel bg-navy p-4 text-white">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">{t("staffProfile.scheduleEventsNotices")}</h2>
          <div className="rounded-control border border-white/20 p-3">
            {!notices?.length ? (
              <p className="text-sm text-white/70">{t("staffProfile.noUpcoming")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {notices.map((n) => (
                  <li key={n.id}>
                    <Link to="/communication/notices" className="hover:underline">
                      · {(n.title_i18n as Record<string, string>)?.en ?? "—"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
