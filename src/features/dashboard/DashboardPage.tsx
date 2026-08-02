// The school's main dashboard.
//
// Built to the supplied screenshot, top to bottom: notice board and academic
// calendar, an academic-year filter, headline counts, gender/ethnicity splits,
// the two at-risk tables, weekly attendance, billing, alerts and quick actions.
//
// No placeholder data anywhere. Every card reads the tenant's real rows and
// renders its own empty state, because a school opening this on day one has no
// students, no grades and no invoices — and that is the state it has to look
// correct in, not just the populated one.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { RichText } from "@/components/ui/RichText";
import { EthDate } from "@/components/EthDate";
import { PieChart, type Slice } from "@/components/charts/Pie";
import { BarChart, GroupedBarChart } from "@/components/charts/Bars";
import { formatETB, tField } from "@/lib/i18n";
import { toIsoDate } from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";
import { MiniCalendar } from "./MiniCalendar";
import {
  useAlerts, useAtRisk, useAttendanceWeek, useAcademicYears, useBilling,
  useCalendarEvents, useNotices, useOverview, useTenantName, weekStart,
} from "./useDashboardData";
import { MessagesCard } from "./MessagesCard";
import { LinkedHeader } from "./LinkedHeader";
import {
  IconAddAbsence, IconAddEvent, IconAddFees, IconAddGuardian, IconApplication,
  IconCalendar, IconChevronLeft, IconChevronRight, IconCourseRequest,
  IconExternal, IconFilter, IconGradCap, IconInfo, IconInvoice, IconMessage,
  IconMissingAttendance, IconNotice, IconParents, IconSend, IconStaff,
  IconWarning,
} from "./icons";

// Chart palette. Held here rather than in the Tailwind tokens because these
// are data-series colours — they must stay distinguishable from each other,
// which is a different job from the brand palette a tenant can re-theme.
const GENDER_COLORS: Record<string, string> = {
  male: "#4C8DF6", female: "#EC3F8F", other: "#8B5CF6",
};
const ETHNICITY_COLORS = [
  "#8B5CF6", "#A3CE28", "#EC4B4B", "#22B8A0", "#F5972B",
  "#4C8DF6", "#9B6B4A", "#EC3F8F", "#6366F1", "#14B8A6",
  "#EAB308", "#64748B",
];
const PRESENT = "#2FBF4E";
const ABSENT = "#EC4B4B";
const HALF_DAY = "#F1C40F";

// ---------------------------------------------------------------------------

function StatTile({ icon, value, label, tint, tone }: {
  icon: React.ReactNode; value: number | string; label: string;
  tint: string; tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-panel border border-line bg-card px-4 py-3">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", tint, tone)}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold tabular-nums text-ok">{value}</p>
        <p className="truncate text-sm text-ink-soft">{label}</p>
      </div>
    </div>
  );
}

/**
 * The two at-risk tables share a shape: four columns, five rows, and a header
 * that links to the full screen.
 *
 * The screenshot shows the empty table as five blank rows rather than a
 * message. Blank rows read as "loading, or broken" — so the columns stay (they
 * tell you what the card is for) and the body carries one honest line.
 */
function AtRiskTable<T>({ title, to, columns, rows, render, empty, loading }: {
  title: string; to: string; columns: string[]; rows: T[];
  render: (row: T) => React.ReactNode[]; empty: string; loading: boolean;
}) {
  return (
    <Panel>
      <LinkedHeader title={title} to={to} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="bg-sidebar text-left text-xs font-medium text-ink-soft">
              {columns.map((c) => <th key={c} scope="col" className="px-4 py-2">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading || !rows.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-ink-faint">
                  {loading ? "…" : empty}
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={i} className="border-t border-line">
                {render(row).map((cell, j) => (
                  <td key={j} className="px-4 py-2.5 text-ink">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AlertTile({ icon, label, count, to }: {
  icon: React.ReactNode; label: string; count: number; to: string;
}) {
  return (
    <Link to={to}
          className="relative flex items-center gap-3 rounded-control border border-danger/20 bg-danger-tint/50 px-3 py-3 transition-colors hover:bg-danger-tint">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-white text-danger">
        {icon}
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-ink">{label}</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-pill bg-danger px-1.5 py-0.5 text-center text-[11px] font-bold leading-tight text-white">
          {count > 999 ? "999+" : count}
        </span>
      )}
    </Link>
  );
}

function QuickAdd({ icon, label, to }: { icon: React.ReactNode; label: string; to: string }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-2 rounded-control px-2 py-3 text-center transition-colors hover:bg-sidebar">
      <span className="flex h-10 w-10 items-center justify-center rounded-control bg-navy-wash text-navy">
        {icon}
      </span>
      <span className="text-xs font-medium text-ink-soft">{label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const locale = i18n.resolvedLanguage ?? "en";
  const tenantId = profile?.tenant_id ?? "";

  // super_admin has no tenant — every card below would sit empty forever and
  // their real surface is the platform console.
  const isSuperAdmin = profile?.role === "super_admin";

  const [yearId, setYearId] = useState<string | null>(null);
  const [week, setWeek] = useState(() => weekStart(new Date()));

  // Year-to-date is the billing card's own range, independent of the filter.
  const { ytdFrom, today } = useMemo(() => {
    const now = new Date();
    return {
      ytdFrom: toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))),
      today: toIsoDate(now),
    };
  }, []);

  const tenantName = useTenantName(tenantId);
  const years = useAcademicYears(tenantId);
  const notices = useNotices(tenantId);
  const events = useCalendarEvents(tenantId);
  const overview = useOverview(tenantId, yearId);
  const attendance = useAttendanceWeek(tenantId, week);
  const atRisk = useAtRisk(tenantId, ytdFrom, today);
  const billing = useBilling(tenantId, ytdFrom, today);
  const alerts = useAlerts(tenantId, ytdFrom, today);

  const weekdays = t("weekdays", { returnObjects: true }) as string[];

  const genderSlices = useMemo<Slice[]>(() =>
    (overview.data?.by_gender ?? []).map((g) => ({
      key: g.key,
      label: t(`gender.${g.key}`, { defaultValue: g.key }),
      value: g.count,
      color: GENDER_COLORS[g.key] ?? "#94A3B8",
    })), [overview.data, t]);

  const ethnicitySlices = useMemo<Slice[]>(() =>
    (overview.data?.by_ethnicity ?? []).map((e, i) => ({
      key: e.key,
      label: t(`ethnicity.${e.key}`, { defaultValue: e.key }),
      value: e.count,
      color: ETHNICITY_COLORS[i % ETHNICITY_COLORS.length]!,
    })), [overview.data, t]);

  // Seven columns always. The RPC generates a row per day, but it returns
  // nothing at all when the caller fails its role gate — and a chart with no
  // x-axis reads as broken rather than as empty, so the week is rebuilt here
  // and the RPC's counts merged onto it.
  const attendanceGroups = useMemo(() => {
    const byDay = new Map((attendance.data?.days ?? []).map((d) => [d.day, d]));
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(week.getTime() + i * 86_400_000);
      const iso = toIsoDate(date);
      const row = byDay.get(iso);
      return {
        key: iso,
        // "20 Mon" — the Gregorian day is what an attendance register is
        // keyed on, with the EC date one panel up.
        label: `${date.getUTCDate()} ${weekdays[date.getUTCDay() + 1]?.slice(0, 3) ?? ""}`,
        values: {
          present: row?.present ?? 0,
          absent: row?.absent ?? 0,
          half_day: row?.half_day ?? 0,
        },
      };
    });
  }, [attendance.data, week, weekdays]);

  const weekTotals = useMemo(() => {
    const days = attendance.data?.days ?? [];
    const present = days.reduce((s, d) => s + d.present + d.half_day, 0);
    const total = days.reduce((s, d) => s + d.present + d.absent + d.half_day, 0);
    return total ? Math.round((present / total) * 1000) / 10 : null;
  }, [attendance.data]);

  if (isSuperAdmin) return <Navigate to="/platform" replace />;

  const money = (n: number) => formatETB(n, locale);
  // Axis ticks get the compact form: five stacked "ETB 200,000.00" labels are
  // wider than the plot they annotate.
  const moneyAxis = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-ET" : locale, {
    style: "currency", currency: "ETB", currencyDisplay: "narrowSymbol",
    notation: "compact", maximumFractionDigits: 0,
  }).format(n);

  return (
    <div className="space-y-5">
      <header className="border-b-2 border-line pb-3">
        <h1 className="font-display text-lg font-extrabold uppercase tracking-wide text-ink md:text-2xl">
          {t("dashboard.pageTitle", { school: tenantName.data ?? t("dashboard.yourSchool") })}
        </h1>
      </header>

      {/* ---------- Notice board + academic calendar ---------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <LinkedHeader title={t("dashboard.noticeBoard")} to="/communication/notices" />
          <div className="p-4">
            <div className="min-h-[170px] rounded-control border border-late/40 bg-late-tint/60 p-3">
              {notices.data?.length ? (
                <ul className="space-y-2.5">
                  {notices.data.map((n) => (
                    <li key={n.id}>
                      <p className="text-sm font-semibold text-ink">
                        {tField(n.title_i18n as Record<string, string>, locale)}
                      </p>
                      {n.body_html && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-ink-soft">
                          <RichText html={n.body_html} />
                        </div>
                      )}
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        <EthDate value={n.visible_from} /> — <EthDate value={n.visible_to} />
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex h-full min-h-[9rem] flex-col items-center justify-center gap-2 text-center">
                  <IconNotice className="h-6 w-6 text-ink-faint" />
                  <p className="text-sm text-ink-faint">{t("dashboard.noNotices")}</p>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <LinkedHeader title={t("dashboard.academicCalendar")} to="/events" />
          <div className="p-4">
            <MiniCalendar events={events.data ?? []} />
          </div>
        </Panel>
      </div>

      {/* ---------- Messages: separate from the Notice Board above -- a
          notice is a scheduled broadcast, a message is a private thread. ---------- */}
      {!isSuperAdmin && <MessagesCard />}

      {/* ---------- Filter ---------- */}
      <div className="flex justify-end">
        <label className="inline-flex items-center gap-2 rounded-control border border-line bg-card px-3 py-2 text-sm">
          <IconFilter className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="sr-only">{t("dashboard.filterLabel")}</span>
          <select
            value={yearId ?? ""}
            onChange={(e) => setYearId(e.target.value || null)}
            className="bg-transparent text-sm text-ink-soft outline-none"
          >
            <option value="">{t("dashboard.filterAll")}</option>
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                {tField(y.label_i18n as Record<string, string>, locale) || t("common.ecYear")} {y.ec_year}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---------- Headline counts + demographic splits ---------- */}
      <Panel className="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={<IconGradCap className="h-5 w-5" />} tint="bg-late-tint" tone="text-late"
                    value={overview.data?.students ?? 0} label={t("dashboard.students")} />
          <StatTile icon={<IconStaff className="h-5 w-5" />} tint="bg-ok-tint" tone="text-ok"
                    value={overview.data?.staff ?? 0} label={t("dashboard.staff")} />
          <StatTile icon={<IconParents className="h-5 w-5" />} tint="bg-danger-tint" tone="text-danger"
                    value={overview.data?.parents ?? 0} label={t("dashboard.parents")} />
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-3 font-display text-base font-bold text-ink">{t("dashboard.byGender")}</h3>
            <PieChart data={genderSlices} legend="labels" emptyLabel={t("dashboard.noStudentData")} />
          </div>
          <div>
            <h3 className="mb-3 font-display text-base font-bold text-ink">{t("dashboard.byEthnicity")}</h3>
            <PieChart data={ethnicitySlices} legend="dots" emptyLabel={t("dashboard.noStudentData")} />
          </div>
        </div>
      </Panel>

      {/* ---------- At-risk tables ---------- */}
      <AtRiskTable
        title={t("dashboard.highAbsence")}
        to="/attendance/overview"
        loading={atRisk.isLoading}
        columns={[t("students.admissionNo"), t("dashboard.fullName"), t("common.class"), t("dashboard.absences")]}
        rows={atRisk.data?.absence ?? []}
        empty={t("dashboard.noHighAbsence")}
        render={(r) => [
          r.admission_no,
          <Link key="n" to={`/students/${r.student_id}`} className="text-navy hover:underline">{r.full_name}</Link>,
          r.grade,
          <span key="a" className="tabular-nums">{r.absences} ({r.absence_pct}%)</span>,
        ]}
      />

      <AtRiskTable
        title={t("dashboard.lowestGpa")}
        to="/gradebook"
        loading={atRisk.isLoading}
        columns={[t("students.admissionNo"), t("dashboard.fullName"), t("common.class"), t("academicRecord.cumulativeGpa")]}
        rows={atRisk.data?.gpa ?? []}
        empty={t("dashboard.noGpaData")}
        render={(r) => [
          r.admission_no,
          <Link key="n" to={`/students/${r.student_id}`} className="text-navy hover:underline">{r.full_name}</Link>,
          r.grade,
          <span key="g" className="tabular-nums">{r.cgpa}</span>,
        ]}
      />

      {/* ---------- Weekly attendance ---------- */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t("eventsCalendar.previous")}
                    className="rounded p-1 text-ink-soft hover:bg-sidebar"
                    onClick={() => setWeek((w) => new Date(w.getTime() - 7 * 86_400_000))}>
              <IconChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold text-navy">{t("dashboard.attendanceThisWeek")}</h2>
            <button type="button" aria-label={t("eventsCalendar.next")}
                    className="rounded p-1 text-ink-soft hover:bg-sidebar"
                    onClick={() => setWeek((w) => new Date(w.getTime() + 7 * 86_400_000))}>
              <IconChevronRight className="h-4 w-4" />
            </button>
          </div>
          {(attendance.data?.missing ?? 0) > 0 && (
            <Link to="/attendance" className="flex items-center gap-1.5 text-xs font-medium text-danger hover:underline">
              <IconWarning className="h-4 w-4" />
              {t("dashboard.missingAttendanceFound", { count: attendance.data!.missing })}
            </Link>
          )}
        </div>
        <div className="p-4">
          <p className="mx-auto mb-4 w-fit rounded-control border border-ok px-4 py-1.5 text-center text-sm font-semibold text-ok">
            {weekTotals === null
              ? t("dashboard.noAttendanceThisWeek")
              : t("dashboard.percentPresentThisWeek", { percent: weekTotals })}
          </p>
          <GroupedBarChart
            groups={attendanceGroups}
            series={[
              { key: "present", label: t("attendance.present"), color: PRESENT },
              { key: "absent", label: t("attendance.absent"), color: ABSENT },
              { key: "half_day", label: t("attendance.halfDay"), color: HALF_DAY },
            ]}
          />
        </div>
      </Panel>

      {/* ---------- Billing ---------- */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-navy">{t("dashboard.billingInsight")}</h2>
          <span className="flex items-center gap-1.5 text-xs text-ink-soft">
            <IconCalendar className="h-4 w-4" />
            <EthDate value={ytdFrom} /> — {t("dashboard.toDate")}
          </span>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-control border border-line p-4">
            <LinkedHeaderInline title={t("dashboard.totalCollectionYtd")} to="/fees/invoices" />
            <BarChart
              className="mt-3"
              formatValue={money}
              formatAxis={moneyAxis}
              data={[
                { key: "collected", label: t("dashboard.collected"), value: Number(billing.data?.collected ?? 0), color: PRESENT },
                { key: "overdue", label: t("dashboard.overdue"), value: Number(billing.data?.overdue ?? 0), color: ABSENT },
                { key: "toCollect", label: t("dashboard.toBeCollected"), value: Number(billing.data?.to_be_collected ?? 0), color: HALF_DAY },
              ]}
            />
          </div>

          <div className="rounded-control border border-line p-4">
            <LinkedHeaderInline title={t("dashboard.collectionByFeeType")} to="/fees/structures" />
            {billing.data?.by_fee_type?.length ? (
              <BarChart
                className="mt-3"
                formatValue={money}
                formatAxis={moneyAxis}
                data={billing.data.by_fee_type.slice(0, 6).map((f, i) => ({
                  key: String(i),
                  label: tField(f.name_i18n, locale),
                  value: Number(f.total),
                  color: ETHNICITY_COLORS[i % ETHNICITY_COLORS.length]!,
                }))}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <IconInfo className="h-5 w-5 text-ink-faint" />
                <p className="text-sm text-ink-faint">{t("dashboard.noDataFound")}</p>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* ---------- Alerts ---------- */}
      <Panel>
        <LinkedHeader title={t("dashboard.alerts")} />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <AlertTile icon={<IconMessage className="h-5 w-5" />} label={t("dashboard.alertMessages")}
                     count={alerts.data?.messages ?? 0} to="/communication" />
          <AlertTile icon={<IconApplication className="h-5 w-5" />} label={t("dashboard.alertApplications")}
                     count={alerts.data?.applications ?? 0} to="/admissions" />
          <AlertTile icon={<IconCourseRequest className="h-5 w-5" />} label={t("dashboard.alertCourseRequests")}
                     count={alerts.data?.course_requests ?? 0} to="/admissions" />
          <AlertTile icon={<IconMissingAttendance className="h-5 w-5" />} label={t("dashboard.alertMissingAttendance")}
                     count={alerts.data?.missing_attendance ?? 0} to="/attendance" />
        </div>
      </Panel>

      {/* ---------- Quick add ---------- */}
      <Panel>
        <LinkedHeader title={t("dashboard.quickAdd")} />
        <div className="grid grid-cols-3 gap-2 p-4">
          <QuickAdd icon={<IconSend className="h-5 w-5" />} label={t("dashboard.quickSendMessage")} to="/communication" />
          <QuickAdd icon={<IconAddGuardian className="h-5 w-5" />} label={t("dashboard.quickAddGuardian")} to="/students" />
          <QuickAdd icon={<IconAddFees className="h-5 w-5" />} label={t("dashboard.quickAddFees")} to="/fees/structures" />
          <QuickAdd icon={<IconAddEvent className="h-5 w-5" />} label={t("dashboard.quickAddEvent")} to="/events" />
          <QuickAdd icon={<IconAddAbsence className="h-5 w-5" />} label={t("dashboard.quickAddAbsence")} to="/attendance" />
          <QuickAdd icon={<IconInvoice className="h-5 w-5" />} label={t("dashboard.quickGenerateInvoice")} to="/fees/invoices" />
        </div>
      </Panel>
    </div>
  );
}

/** Sub-panel title inside the billing card — centred, with its own link out. */
function LinkedHeaderInline({ title, to }: { title: string; to: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <Link to={to} className="text-navy hover:text-navy-deep" aria-label={title}>
        <IconExternal className="h-4 w-4" />
      </Link>
    </div>
  );
}
