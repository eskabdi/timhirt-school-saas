// Shared by EnrollStudentModal and AdmissionReviewModal -- both run
// enrollApplication() and need to show the exact same "what happened"
// summary (ID card + portal accounts). Kept as one component so the two
// call sites can't drift into different definitions of what enrolling shows.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import type { EnrollResult } from "./enrollApi";

export function EnrollResultPanel({ result, onClose }: { result: EnrollResult; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ok">{t("admissions.enroll.success")}</p>

      <div className="rounded-control border border-line p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("admissions.enroll.idCardReady")}</p>
        {result.idCardUrl ? (
          <a href={result.idCardUrl} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-navy hover:underline">
            {t("admissions.enroll.downloadIdCard")}
          </a>
        ) : (
          <p className="mt-1 text-sm text-danger">{t("admissions.enroll.idCardFailed")}</p>
        )}
      </div>

      <div className="rounded-control border border-line p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("admissions.enroll.portalAccounts")}</p>
        {result.accountsError ? (
          <p className="mt-1 text-sm text-danger">{t("admissions.enroll.accountsFailed")}</p>
        ) : result.accounts.length === 0 ? (
          <p className="mt-1 text-sm text-ink-faint">{t("admissions.enroll.alreadyLinked")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {result.accounts.map((a, i) => (
              <div key={i} className="rounded-control bg-page p-2 text-sm">
                <p className="font-medium text-ink">{t(`admissions.enroll.${a.kind}`)}</p>
                {a.method === "email_invite" ? (
                  <p className="text-ink-faint">{t("admissions.enroll.inviteSent")}: {a.email}</p>
                ) : a.method === "existing_account" ? (
                  <p className="text-ink-faint">{t("admissions.enroll.alreadyLinked")}: {a.email}</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-ink-faint">{t("admissions.enroll.loginEmail")}: <span className="font-mono">{a.email}</span></p>
                      <CopyButton value={a.email} label={t("admissions.enroll.copyLoginEmail")} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-ink-faint">{t("admissions.enroll.tempPassword")}: <span className="font-mono">{a.temp_password}</span></p>
                      {a.temp_password && <CopyButton value={a.temp_password} label={t("admissions.enroll.copyTempPassword")} />}
                    </div>
                  </>
                )}
              </div>
            ))}
            <p className="text-xs text-danger">{t("admissions.enroll.copyWarning")}</p>
          </div>
        )}
      </div>

      <Button onClick={onClose} className="w-full">{t("admissions.enroll.done")}</Button>
    </div>
  );
}
