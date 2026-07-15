// §6.4 strict allow-list validation — mirrored by DB constraints (§7.2)
import { z } from "zod";

export const studentSchema = z.object({
  first_name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{M}'\- ]+$/u, "Letters only"),
  last_name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{M}'\- ]+$/u, "Letters only"),
  admission_no: z.string().regex(/^[A-Z0-9\-/]{3,20}$/, "e.g. ADM-2018-001"),
  date_of_birth: z.date().max(new Date(), "Must be in the past"),
  gender: z.enum(["male", "female", "other"]),
  class_id: z.string().uuid("Select a class"),
});
export type StudentInput = z.infer<typeof studentSchema>;
