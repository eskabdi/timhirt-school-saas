// §6.4 strict allow-list validation — mirrored by DB constraints (§7.2)
import { z } from "zod";

// Error messages are short stable codes, not English sentences — this schema
// is built once at module load and can't react to a later language switch,
// so callers translate the code at display time (students.errors.<code>).
export const studentSchema = z.object({
  first_name: z.string().trim().min(1, "required").max(80).regex(/^[\p{L}\p{M}'\- ]+$/u, "letters_only"),
  last_name: z.string().trim().min(1, "required").max(80).regex(/^[\p{L}\p{M}'\- ]+$/u, "letters_only"),
  admission_no: z.string().regex(/^[A-Z0-9\-/]{3,20}$/, "admission_no_format"),
  date_of_birth: z.date({ errorMap: () => ({ message: "required" }) }).max(new Date(), "must_be_past"),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "required" }) }),
  class_id: z.string().uuid("select_class"),
});
export type StudentInput = z.infer<typeof studentSchema>;
