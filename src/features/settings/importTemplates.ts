// CSV import templates for the Import/Export page. Column headers reuse the
// exact i18n keys the corresponding registration/input form already labels
// each field with (Student Registration, Employee Registration, Fee
// Structures) rather than inventing new copy, so the template always
// describes the same fields those forms actually collect. File-upload
// fields (photo, documents) are intentionally omitted -- a CSV cell can't
// carry a binary attachment, those are uploaded separately after import.
type Translate = (key: string) => string;

export interface ImportTemplate {
  headers: string[];
  example: string[];
}

export function buildImportTemplates(t: Translate): Record<"students" | "teachers" | "fees", ImportTemplate> {
  const en = t("students.labels.english");
  const am = t("students.labels.amharic");
  const ec = t("staffReg.emergencyContact");

  return {
    // Student Registration (src/features/students/StudentFormPage.tsx,
    // schemas.ts) -- Steps 1 (Student Info) + 2 (Guardian Details). Step 3
    // (photo) and Step 4 (fee breakdown, read-only) are not input fields.
    students: {
      headers: [
        `${t("students.firstName")} (${en})`, `${t("students.firstName")} (${am})`,
        `${t("students.middleName")} (${en})`, `${t("students.middleName")} (${am})`,
        `${t("students.lastName")} (${en})`, `${t("students.lastName")} (${am})`,
        `${t("students.dob")} (EC, YYYY-MM-DD)`,
        `${t("students.gender")} (male/female/other)`,
        t("students.ethnicity"),
        t("students.class"),
        t("studentReg.guardianFullName"),
        `${t("admissions.relationship")} (father/mother/guardian/other)`,
        t("admissions.phone"),
        t("admissions.email"),
      ],
      example: [
        "Abebe", "አበበ", "Kebede", "ከበደ", "Tesfaye", "ተስፋዬ",
        "2010-05-14", "male", "amhara", "Grade 3 A",
        "Alemu Tesfaye", "father", "+251911223344", "guardian@example.com",
      ],
    },

    // Employee (Staff) Registration (src/features/hr/StaffRegistrationPage.tsx)
    // -- Steps 1-3 (Personal, Professional, Employment + Portal Access).
    // Step 4 (document uploads) is omitted for the same reason photos are.
    teachers: {
      headers: [
        `${t("staffReg.firstName")} (${en})`, `${t("staffReg.firstName")} (${am})`,
        `${t("staffReg.fatherName")} (${en})`, `${t("staffReg.fatherName")} (${am})`,
        `${t("staffReg.lastName")} (${en})`, `${t("staffReg.lastName")} (${am})`,
        `${t("staffReg.gender")} (male/female/other)`,
        t("staffReg.dob"),
        t("staffReg.nationality"),
        t("staffReg.nationalId"),
        t("staffReg.phone"),
        t("staffReg.personalEmail"),
        t("staffReg.region"), t("staffReg.zone"), t("staffReg.woreda"),
        t("staffReg.city"), t("staffReg.kebele"), t("staffReg.houseNumber"),
        `${ec} — ${t("staffReg.firstName")} / ${t("staffReg.lastName")}`,
        `${ec} — ${t("staffReg.relationship")}`,
        `${ec} — ${t("staffReg.phone")}`,
        `${ec} — ${t("staffReg.personalEmail")}`,
        t("staffReg.highestQualification"),
        t("staffReg.yearOfGraduation"),
        t("staffReg.majorSpecialization"),
        t("staffReg.institutionName"),
        `${t("staffReg.languageProficiency")} (semicolon-separated)`,
        t("staffReg.certifications"),
        `${t("staffReg.teachingSpecializations")} (semicolon-separated subject codes)`,
        `${t("staffReg.designationRole")} (teacher/admin_staff/support)`,
        t("staffReg.department"),
        t("staffReg.dateOfJoining"),
        `${t("staffReg.employmentType")} (permanent/contract/part_time)`,
        t("staffReg.institutionalEmail"),
        t("staffReg.workPhone"),
        t("staffReg.reportingManager"),
        t("staffReg.contractDuration"),
        `${t("staffReg.invitePortal")} (yes/no)`,
        `${t("staffReg.portalRole")} (teacher/registrar/hr_officer/accountant)`,
      ],
      example: [
        "Selamawit", "ሰላማዊት", "Girma", "ግርማ", "Alemu", "አለሙ",
        "female", "1990-03-22", "Ethiopian", "ID-0123456",
        "+251911998877", "selam@example.com",
        "Addis Ababa", "Bole", "Woreda 03", "Addis Ababa", "Kebele 05", "House 12",
        "Girma Bekele", "father", "+251922334455", "girma@example.com",
        "bachelor", "2012", "Mathematics", "Addis Ababa University",
        "amharic;english", "TEFL Certificate 2015", "MATH;PHYS",
        "teacher", "Mathematics Department", "2019-09-01",
        "permanent", "selamawit.work@school.et", "+251115512345",
        "Ahmed Mohammed Abdi", "6",
        "yes", "teacher",
      ],
    },

    // Fee Structures (src/features/fees/FeeStructuresPage.tsx) create form.
    fees: {
      headers: [
        t("common.name"),
        t("crud.amountEtb"),
        `${t("crud.billingCycle")} (monthly/term/annual/once)`,
        t("crud.classOptional"),
      ],
      example: ["Term 1 Tuition", "5000.00", "term", "Grade 3"],
    },
  };
}
