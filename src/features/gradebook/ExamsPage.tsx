import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthDate } from "@/components/EthDate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { tField } from "@/lib/i18n";
import { toIsoDate } from "@/lib/ethiopian-date";

export function ExamsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [maxScore, setMaxScore] = useState(100);
  const [start, setStart] = useState<Date | null>(null);
  const [classId, setClassId] = useState("");
  const [examTypeName, setExamTypeName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [room, setRoom] = useState("");
  const [page, setPage] = useState(1);

  const { data: terms } = useQuery({ queryKey: ["terms"], queryFn: async () => (await supabase.from("academic_terms").select("id,name_i18n")).data ?? [] });
  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("id, name, section").order("grade_level").order("section")).data ?? [],
  });
  const { data: exams } = useQuery({
    queryKey: ["exams-list", page],
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("exams")
        .select("id,name_i18n,max_score,weight,class_id,exam_type_name,exam_date,start_time,end_time,room", { count: "exact" })
        .range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!terms?.[0] || !classId) return;
      const { error } = await supabase.from("exams").insert({
        tenant_id: profile!.tenant_id, academic_term_id: terms[0].id, name_i18n: { en: name }, max_score: maxScore, class_id: classId,
        exam_type_name: examTypeName || null, exam_date: start ? toIsoDate(start) : null,
        start_time: startTime || null, end_time: endTime || null, room: room || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exams-list"] });
      setName(""); setClassId(""); setExamTypeName(""); setStart(null); setStartTime(""); setEndTime(""); setRoom("");
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("gradebook.exams")}</h1>
      <Card className="max-w-md space-y-3">
        <Field label={t("gradebook.name")}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
        <Field label={t("common.class")}>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="">{t("common.class")}</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
          </select>
        </Field>
        <Field label={t("gradebook.maxScore")}><Input type="number" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} /></Field>
        <Field label={t("gradebook.examType")}><Input value={examTypeName} onChange={(e) => setExamTypeName(e.target.value)} maxLength={100} /></Field>
        <Field label={t("gradebook.windowStart")}><EthDatePicker value={start} onChange={setStart} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("gradebook.startTime")}>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
          <Field label={t("gradebook.endTime")}>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
        </div>
        <Field label={t("gradebook.room")}><Input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={50} /></Field>
        <Button onClick={() => create.mutate()} disabled={!name || !classId}>{t("gradebook.createExam")}</Button>
      </Card>
      <div className="space-y-2">
        {exams?.rows.map((e) => {
          const cls = classes?.find((c) => c.id === e.class_id);
          const schedule = [
            e.exam_type_name,
            e.exam_date ? <EthDate key="date" value={e.exam_date} /> : null,
            e.start_time && e.end_time ? `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}` : null,
            e.room,
          ].filter((v) => v != null && v !== "");
          return (
            <Card key={e.id} className="flex items-center justify-between text-sm text-ink">
              <span>{tField(e.name_i18n, i18n.resolvedLanguage!)}{cls ? ` — ${cls.name} ${cls.section}` : ""}</span>
              <span className="flex items-center gap-2 text-ink-faint">
                {schedule.map((part, i) => <span key={i}>{part}</span>)}
                <span>/{e.max_score}</span>
              </span>
            </Card>
          );
        })}
      </div>
      <Pagination page={page} totalCount={exams?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
