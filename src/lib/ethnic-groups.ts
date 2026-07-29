/**
 * Ethnic groups offered when recording a student.
 *
 * In the Ethiopian context this records language and region of origin, and MoE
 * census reporting is built on it. The reason the list runs well past the
 * handful of largest groups is that the whole point of collecting it is to see
 * which groups are under-served — a short list would bucket the smallest
 * communities into "other" and make exactly the students the data exists to
 * find the ones it cannot see.
 *
 * `students.ethnicity` constrains shape only, not membership (see
 * 20260729000002_dashboard.sql), so this list can grow without a migration.
 * Labels live under the `ethnicity.*` i18n keys in all three locales; the
 * dashboard renders an unrecognised key verbatim rather than dropping it, so a
 * value written before its label exists still appears in the chart.
 */
export const ETHNIC_GROUPS = [
  "oromo", "amhara", "somali", "tigrayan", "sidama", "gurage", "welayta",
  "afar", "hadiya", "gamo", "gedeo", "kafficho", "silte", "kembata",
  "agew", "harari", "gumuz", "berta", "nuer", "anuak", "argobba", "alaba",
  "dawro", "konso", "bench", "shekacho", "yem", "burji", "shinasha",
  "kunama", "saho", "qemant", "goffa", "male", "hamer", "mursi", "suri",
  "other", "undisclosed",
] as const;

export type EthnicGroup = (typeof ETHNIC_GROUPS)[number];

/**
 * The bucket the dashboard uses for students whose ethnicity was never
 * recorded. Deliberately distinct from `undisclosed`: one is a family that
 * declined to answer, the other is a question nobody asked, and a school
 * chasing incomplete records needs to tell those apart.
 */
export const ETHNICITY_UNRECORDED = "unrecorded";
