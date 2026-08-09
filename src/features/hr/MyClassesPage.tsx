import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { tField } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Link } from "react-router-dom";

interface ClassSlot {
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  class_id: string;
  subject_id: string;
  room: string | null;
  class: { name: string; section: string | null } | null;
  subject: { name_i18n: Record<string, string>; code: string } | null;
}

interface ClassAssignment {
  id: string;
  class_id: string;
  subject_id: string;
  class: { name: string; section: string | null } | null;
  subject: { name_i18n: Record<string, string>; code: string } | null;
}

interface HomeroomStudent {
  id: string;
  users: { full_name: string } | null;
}

export function MyClassesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const today = new Date().getDay();

  const { data: teacher } = useQuery({
    queryKey: ["my-teacher", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from("teachers").select("id").eq("user_id", profile!.id).maybeSingle();
      return data;
    },
  });

  const { data: assignments } = useQuery({
    queryKey: ["my-class-assignments", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data } = await supabase.from("class_subject_teachers")
        .select("id, class_id, subject_id, class:classes(name, section), subject:subjects(name_i18n, code)")
        .eq("teacher_id", teacher!.id);
      return (data as unknown as ClassAssignment[]) ?? [];
    },
  });

  const { data: todaySlots } = useQuery({
    queryKey: ["my-today-timetable", teacher?.id, today],
    enabled: !!teacher,
    queryFn: async () => {
      const { data } = await supabase.from("timetable_slots")
        .select("day_of_week, starts_at, ends_at, room, class_id, subject_id, classes(name, section), subjects(name_i18n, code)")
        .eq("teacher_id", teacher!.id)
        .eq("day_of_week", today)
        .order("starts_at");
      return (data as unknown as ClassSlot[]) ?? [];
    },
  });

  const { data: homeroom } = useQuery({
    queryKey: ["my-homeroom", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data } = await supabase.from("classes")
        .select("id, name, section, homeroom_teacher_id")
        .eq("homeroom_teacher_id", teacher!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: homeroomStudents } = useQuery({
    queryKey: ["homeroom-roster", homeroom?.id],
    enabled: !!homeroom?.id,
    queryFn: async () => {
      const { data } = await supabase.from("students")
        .select("id, users(full_name)")
        .eq("class_id", homeroom!.id)
        .order("users.full_name")
        .limit(10);
      return (data as unknown as HomeroomStudent[]) ?? [];
    },
  });

  const classesMap = new Map<string, { slot: ClassSlot | null; assignment: ClassAssignment | null }>();
  assignments?.forEach((a) => {
    const key = a.class_id + ":" + a.subject_id;
    classesMap.set(key, { slot: null, assignment: a });
  });
  todaySlots?.forEach((s) => {
    const key = s.class_id + ":" + s.subject_id;
    const entry = classesMap.get(key);
    if (entry) entry.slot = s;
    else classesMap.set(key, { slot: s, assignment: null });
  });

  const classCards = Array.from(classesMap.values())
    .filter((c): c is { slot: ClassSlot | null; assignment: ClassAssignment } => !!c.assignment);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("my.classesTitle")}</h1>

      {todaySlots && todaySlots.length > 0 && (
        <Card className="space-y-3 bg-navy-wash p-4">
          <h2 className="font-semibold text-ink">{t("my.todaySchedule")}</h2>
          <div className="space-y-2">
            {todaySlots.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-control bg-white px-3 py-2 text-sm">
                <span className="font-medium text-ink">
                  {s.starts_at?.slice(0, 5)}–{s.ends_at?.slice(0, 5)}
                </span>
                <span className="text-ink-soft">
                  {s.class?.name} {s.class?.section}
                  {s.room && ` · ${t("timetable.room", { room: s.room })}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {classCards.map((c) => {
          const cls = c.assignment.class;
          const subj = c.assignment.subject;
          const slot = c.slot;
          return (
            <Card key={c.assignment.id} className="space-y-3 p-4">
              <div>
                <h3 className="font-semibold text-ink">
                  {cls?.name} {cls?.section}
                </h3>
                <p className="text-sm text-ink-soft">
                  {tField(subj?.name_i18n, i18n.resolvedLanguage!)} {subj?.code && `(${subj.code})`}
                </p>
              </div>
              {slot && (
                <div className="text-xs text-ink-faint">
                  {t("my.todayPeriod")}: {slot.starts_at?.slice(0, 5)}–{slot.ends_at?.slice(0, 5)}
                  {slot.room && ` · ${t("timetable.room", { room: slot.room })}`}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Link to="/attendance">
                  <Button variant="ghost" className="text-xs">
                    {t("my.attendance")}
                  </Button>
                </Link>
                <Link to="/gradebook">
                  <Button variant="ghost" className="text-xs">
                    {t("my.gradebook")}
                  </Button>
                </Link>
                <Link to="/assignments">
                  <Button variant="ghost" className="text-xs">
                    {t("my.assignments")}
                  </Button>
                </Link>
              </div>
            </Card>
          );
        })}
      </div>

      {homeroom && (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-ink">
            {t("my.homeroom")}: {homeroom.name} {homeroom.section}
          </h2>
          {homeroomStudents && homeroomStudents.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {homeroomStudents.map((s) => (
                <li key={s.id} className="flex items-center text-ink-soft">
                  {s.users?.full_name || "—"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">{t("my.noStudents")}</p>
          )}
        </Card>
      )}

      {(!classCards || classCards.length === 0) && !homeroom && (
        <Card className="py-12 text-center text-ink-faint">{t("my.noClasses")}</Card>
      )}
    </div>
  );
}
