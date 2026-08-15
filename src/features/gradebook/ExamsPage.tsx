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
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { tField } from "@/lib/i18n";
import { toIsoDate, formatEth } from "@/lib/ethiopian-date";
import { buildSeatingChartPdf } from "./seating-chart-pdf";
import { fetchDocumentTemplate } from "@/lib/documentTemplate";

interface SeatAssignmentRow { id: string; student_id: string; seat_label: string }
interface RosterStudent { id: string; first_name: string; last_name: string }

function SeatingChartModal({ examId, examLabel, classId, onClose }: {
  examId: string; examLabel: string; classId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const qc = useQueryClient();
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);

  const { data: roster } = useQuery({
    queryKey: ["exam-seating-roster", classId],
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("id, first_name, last_name").eq("class_id", classId).order("last_name");
      if (error) throw error;
      return (data ?? []) as RosterStudent[];
    },
  });
  const { data: seats } = useQuery({
    queryKey: ["exam-seat-assignments", examId],
    queryFn: async () => {
      const { data, error } = await supabase.from("exam_seat_assignments").select("id, student_id, seat_label").eq("exam_id", examId);
      if (error) throw error;
      return (data ?? []) as SeatAssignmentRow[];
    },
  });

  const autoAssign = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("auto_assign_exam_seats", { p_exam_id: examId, p_rows: rows, p_cols: cols });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-seat-assignments", examId] }),
  });
  const reassign = useMutation({
    mutationFn: async ({ seatRowId, studentId }: { seatRowId: string; studentId: string }) => {
      const { error } = await supabase.from("exam_seat_assignments").update({ student_id: studentId }).eq("id", seatRowId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-seat-assignments", examId] }),
  });

  const studentById = new Map((roster ?? []).map((s) => [s.id, s]));
  const seatedStudentIds = new Set((seats ?? []).map((s) => s.student_id));

  const grid: { row: number; col: number; seat: SeatAssignmentRow | null }[] = [];
  for (const s of seats ?? []) {
    const m = /^R(\d+)C(\d+)$/.exec(s.seat_label);
    if (m) grid.push({ row: Number(m[1]), col: Number(m[2]), seat: s });
  }

  const exportPdf = async () => {
    const template = await fetchDocumentTemplate("seating_chart");
    const blob = await buildSeatingChartPdf({
      schoolName: t("app.name"), title: examLabel, rows, cols, template,
      seats: grid.map((g) => ({
        row: g.row, col: g.col, label: g.seat!.seat_label,
        studentName: g.seat ? `${studentById.get(g.seat.student_id)?.first_name ?? ""} ${studentById.get(g.seat.student_id)?.last_name ?? ""}`.trim() : null,
      })),
      issuedOn: formatEth(new Date(), { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") }),
      issuedLabel: t("idCards.issued"),
    });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <Modal open onClose={onClose} title={t("gradebook.seatingChart")} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("gradebook.rows")}>
            <input type="number" min={1} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
          <Field label={t("gradebook.cols")}>
            <input type="number" min={1} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
          <Button onClick={() => autoAssign.mutate()} disabled={autoAssign.isPending}>{t("gradebook.autoAssign")}</Button>
          <Button variant="tertiary" onClick={exportPdf} disabled={!seats?.length}>{t("gradebook.exportPdf")}</Button>
        </div>
        {autoAssign.isSuccess && roster && autoAssign.data < roster.length && (
          <p className="text-sm text-late">{t("gradebook.seatsOverflow", { assigned: autoAssign.data, total: roster.length })}</p>
        )}
        {!seats?.length ? (
          <p className="text-sm text-ink-faint">{t("gradebook.noSeatsYet")}</p>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: rows * cols }, (_, i) => {
              const r = Math.floor(i / cols) + 1;
              const c = (i % cols) + 1;
              const cell = grid.find((g) => g.row === r && g.col === c);
              if (!cell) return <div key={i} className="rounded-control border border-dashed border-line p-2 text-center text-xs text-ink-faint">—</div>;
              const eligible = (roster ?? []).filter((s) => s.id === cell.seat!.student_id || !seatedStudentIds.has(s.id));
              return (
                <div key={i} className="rounded-control border border-line bg-card p-2 text-xs">
                  <p className="mb-1 font-semibold text-ink-faint">{cell.seat!.seat_label}</p>
                  <select
                    value={cell.seat!.student_id}
                    onChange={(e) => reassign.mutate({ seatRowId: cell.seat!.id, studentId: e.target.value })}
                    className="w-full rounded-control border border-line bg-card px-1.5 py-1 text-xs text-ink"
                  >
                    {eligible.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

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
  const [seatingExam, setSeatingExam] = useState<{ id: string; label: string; classId: string } | null>(null);

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
          const label = `${tField(e.name_i18n, i18n.resolvedLanguage!)}${cls ? ` — ${cls.name} ${cls.section}` : ""}`;
          return (
            <Card key={e.id} className="flex items-center justify-between text-sm text-ink">
              <span>{label}</span>
              <span className="flex items-center gap-2 text-ink-faint">
                {schedule.map((part, i) => <span key={i}>{part}</span>)}
                <span>/{e.max_score}</span>
                {e.class_id && (
                  <button type="button" className="text-xs text-navy hover:underline"
                    onClick={() => setSeatingExam({ id: e.id, label, classId: e.class_id! })}>
                    {t("gradebook.seatingChart")}
                  </button>
                )}
              </span>
            </Card>
          );
        })}
      </div>
      <Pagination page={page} totalCount={exams?.count ?? 0} onPageChange={setPage} />
      {seatingExam && (
        <SeatingChartModal examId={seatingExam.id} examLabel={seatingExam.label} classId={seatingExam.classId}
          onClose={() => setSeatingExam(null)} />
      )}
    </div>
  );
}
