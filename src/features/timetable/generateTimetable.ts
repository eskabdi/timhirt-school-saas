// Pure timetable-generation engine -- no React, no Supabase, so it's testable
// in isolation (see generateTimetable.test.ts) and reusable from a modal or a
// future bulk/all-classes run alike.
//
// Algorithm: expand each requirement's periodsPerWeek into individual
// placement "tickets", process the teachers with the heaviest existing load
// first (they have the fewest free slots, so give them first pick), and for
// each ticket prefer a day this class+subject hasn't already landed on this
// week (spreads a subject across the week instead of clustering it) before
// falling back to any free day. A ticket that still can't find a free
// (day, period) is reported in `unplaced` rather than thrown -- the caller
// shows the admin exactly which class/subject/teacher combination didn't
// fit, instead of the whole run failing opaquely.
//
// Deliberately NOT full backtracking (never un-places an earlier ticket to
// make room for a later one): that trades a predictable, fast, always-
// partial-success run for a solver that can only ever return "fully placed"
// or "fully undone," which is a worse failure mode for a "best effort, tell
// me what's left" tool an admin runs interactively.
export interface GenRequirement {
  classId: string;
  subjectId: string;
  teacherId: string;
  periodsPerWeek: number;
}

export interface GenPeriod {
  id: string;
}

export interface GenExistingSlot {
  classId: string;
  subjectId: string;
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}

export interface GenPlacement {
  classId: string;
  subjectId: string;
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}

export interface GenUnplaced {
  classId: string;
  subjectId: string;
  teacherId: string;
  missing: number;
}

export interface GenerateTimetableInput {
  requirements: GenRequirement[];
  periods: GenPeriod[]; // teaching periods only -- caller filters out breaks
  days: number[]; // e.g. [2,3,4,5,6] for Mon-Fri
  existingSlots: GenExistingSlot[];
}

export interface GenerateTimetableResult {
  placements: GenPlacement[];
  unplaced: GenUnplaced[];
}

const reqKey = (classId: string, subjectId: string) => `${classId}|${subjectId}`;
const cellKey = (id: string, day: number, periodId: string) => `${id}|${day}|${periodId}`;

export function generateTimetable(input: GenerateTimetableInput): GenerateTimetableResult {
  const { requirements, periods, days, existingSlots } = input;

  // periodsPerWeek is the TARGET total for a class+subject, not "how many
  // more to add" -- net out slots already placed for that combination so a
  // re-run after partial manual placement tops up to the target instead of
  // piling periodsPerWeek additional ones on top of what's already there.
  const alreadyPlacedCount = new Map<string, number>();
  for (const s of existingSlots) {
    const key = reqKey(s.classId, s.subjectId);
    alreadyPlacedCount.set(key, (alreadyPlacedCount.get(key) ?? 0) + 1);
  }

  interface Ticket { reqIndex: number; classId: string; subjectId: string; teacherId: string }
  const tickets: Ticket[] = [];
  requirements.forEach((r, reqIndex) => {
    const already = alreadyPlacedCount.get(reqKey(r.classId, r.subjectId)) ?? 0;
    const need = Math.max(0, r.periodsPerWeek - already);
    for (let i = 0; i < need; i++) tickets.push({ reqIndex, classId: r.classId, subjectId: r.subjectId, teacherId: r.teacherId });
  });

  const teacherLoad = new Map<string, number>();
  for (const s of existingSlots) teacherLoad.set(s.teacherId, (teacherLoad.get(s.teacherId) ?? 0) + 1);
  // Stable sort: ties (equal load) keep their original expansion order, so
  // a class's own subjects don't get shuffled relative to each other.
  const orderedTickets = tickets
    .map((ticket, i) => ({ ticket, i }))
    .sort((a, b) => (teacherLoad.get(b.ticket.teacherId) ?? 0) - (teacherLoad.get(a.ticket.teacherId) ?? 0) || a.i - b.i)
    .map((x) => x.ticket);

  const classBusy = new Set<string>();
  const teacherBusy = new Set<string>();
  for (const s of existingSlots) {
    classBusy.add(cellKey(s.classId, s.dayOfWeek, s.periodId));
    teacherBusy.add(cellKey(s.teacherId, s.dayOfWeek, s.periodId));
  }

  const subjectDaysUsed = new Map<string, Set<number>>();
  const candidates = days.flatMap((day) => periods.map((p) => ({ day, periodId: p.id })));

  const placements: GenPlacement[] = [];
  const missingByReq = new Map<number, number>();

  for (const ticket of orderedTickets) {
    const daysUsed = subjectDaysUsed.get(reqKey(ticket.classId, ticket.subjectId)) ?? new Set<number>();
    const free = (c: { day: number; periodId: string }) =>
      !classBusy.has(cellKey(ticket.classId, c.day, c.periodId)) && !teacherBusy.has(cellKey(ticket.teacherId, c.day, c.periodId));

    const preferred = candidates.find((c) => !daysUsed.has(c.day) && free(c));
    const fallback = preferred ? undefined : candidates.find(free);
    const chosen = preferred ?? fallback;

    if (!chosen) {
      missingByReq.set(ticket.reqIndex, (missingByReq.get(ticket.reqIndex) ?? 0) + 1);
      continue;
    }

    classBusy.add(cellKey(ticket.classId, chosen.day, chosen.periodId));
    teacherBusy.add(cellKey(ticket.teacherId, chosen.day, chosen.periodId));
    daysUsed.add(chosen.day);
    subjectDaysUsed.set(reqKey(ticket.classId, ticket.subjectId), daysUsed);
    placements.push({ classId: ticket.classId, subjectId: ticket.subjectId, teacherId: ticket.teacherId, dayOfWeek: chosen.day, periodId: chosen.periodId });
  }

  const unplaced: GenUnplaced[] = [...missingByReq.entries()].map(([reqIndex, missing]) => {
    const r = requirements[reqIndex]!;
    return { classId: r.classId, subjectId: r.subjectId, teacherId: r.teacherId, missing };
  });

  return { placements, unplaced };
}
