// The platform event-type catalogue (owner's list, in order). Seeded into
// `calendar_day_types` by the engine migration; this copy feeds the grid
// engine before data loads and the tests. `catalog parity` in
// grid.test.ts keeps the two in step with the SQL seed.
import type { DayCategory, GridDayType } from "./grid";

export interface DayTypeDef extends GridDayType {
  blocksStudentAttendance: boolean;
  blocksStaffAttendance: boolean;
  /** Locked when an authority (MoE or region) publishes it. */
  lockable: boolean;
  /** Only an authority (MoE or region) may create it. */
  authorityOnly: boolean;
  /** Derived by the engine, never entered (instructional, weekend). */
  derived: boolean;
}

const t = (
  code: string, category: DayCategory, color: string, countsAsInstructional: boolean,
  blocksStudentAttendance: boolean, blocksStaffAttendance: boolean, lockable: boolean, authorityOnly: boolean,
  derived = false,
): DayTypeDef => ({ code, category, color, countsAsInstructional, blocksStudentAttendance, blocksStaffAttendance, lockable, authorityOnly, derived });

export const DAY_TYPES: readonly DayTypeDef[] = [
  t("instructional",          "teaching",  "#ffffff", true,  false, false, false, false, true),
  t("weekend",                "rest",      "#f4b183", false, true,  true,  false, false, true),
  t("national_holiday",       "holiday",   "#2e75b6", false, true,  true,  true,  true),
  t("religious_holiday",      "holiday",   "#2e75b6", false, true,  true,  true,  true),
  t("regional_holiday",       "holiday",   "#5b9bd5", false, true,  true,  true,  true),
  t("school_holiday",         "holiday",   "#9dc3e6", false, true,  true,  false, false),
  t("mid_term_break",         "break",     "#a9d18e", false, true,  false, false, false),
  t("semester_break",         "break",     "#70ad47", false, true,  false, true,  true),
  t("examination",            "exam",      "#e88a8e", true,  false, false, true,  false),
  t("registration",           "admin",     "#ffd966", false, true,  false, false, false),
  t("teacher_training",       "staff",     "#c9b3e6", false, true,  false, false, false),
  t("staff_development",      "staff",     "#b4a7d6", false, true,  false, false, false),
  t("parent_meeting",         "event",     "#f8cbad", true,  false, false, false, false),
  t("result_publication",     "milestone", "#a9dcd5", true,  false, false, false, false),
  t("academic_year_opening",  "milestone", "#fff2cc", true,  false, false, true,  true),
  t("academic_year_closing",  "milestone", "#fff2cc", true,  false, false, true,  true),
  t("special_closure",        "closure",   "#7f7f7f", false, true,  true,  false, false),
  t("other",                  "event",     "#e7e6e6", true,  false, false, false, false),
];

export const DAY_TYPE_BY_CODE: ReadonlyMap<string, DayTypeDef> = new Map(DAY_TYPES.map((d) => [d.code, d]));
