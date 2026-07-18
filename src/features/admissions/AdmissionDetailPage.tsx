import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";

const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
} as const;

const DOC_KEYS: Record<string, string> = {
  birth_certificate_path: "birthCertificate",
  transcript_path: "transcript",
  photo_path: "photo",
  payment_receipt_path: "receipt",
};

async function signedUrlsFor(paths: Record<string, string | null>) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      if (!path) return [key, null] as const;
      const { data } = await supabase.storage.from("admission-documents").createSignedUrl(path, 60);
      return [key, data?.signedUrl ?? null] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, string | null>;
}

export function AdmissionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ["admission", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_applications").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: docUrls } = useQuery({
    queryKey: ["admission-doc-urls", id, data?.birth_certificate_path, data?.transcript_path, data?.photo_path, data?.payment_receipt_path],
    enabled: !!data,
    queryFn: () => signedUrlsFor({
      birth_certificate_path: data!.birth_certificate_path,
      transcript_path: data!.transcript_path,
      photo_path: data!.photo_path,
      payment_receipt_path: data!.payment_receipt_path,
    }),
  });

  if (!data) return null;

  const hasBilingualName = data.applicant_first_name || data.applicant_first_name_am;

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-ink">{data.applicant_name}</h1>
          <Badge tone={STAGE_TONE[data.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{t(`admissions.stage.${data.stage}`)}</Badge>
        </div>

        {hasBilingualName && (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-ink-faint">{t("admissions.firstName")}</dt><dd className="text-ink">{data.applicant_first_name} / {data.applicant_first_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.middleName")}</dt><dd className="text-ink">{data.applicant_middle_name} / {data.applicant_middle_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.lastName")}</dt><dd className="text-ink">{data.applicant_last_name} / {data.applicant_last_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.gender")}</dt><dd className="text-ink">{t(`students.${data.gender}`)}</dd></div>
          </dl>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">{t("admissions.dob")}</dt><dd className="text-ink"><EthDate value={data.date_of_birth} /></dd></div>
        </dl>
      </Card>

      <Panel>
        <PanelHeader title={t("admissions.guardian")} />
        <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div><dt className="text-ink-faint">{t("admissions.name")}</dt><dd className="text-ink">{data.guardian_name}{data.guardian_name_am ? ` / ${data.guardian_name_am}` : ""}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.relationship")}</dt><dd className="text-ink">{data.guardian_relationship ? t(`admissions.relationshipType.${data.guardian_relationship}`) : "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.occupation")}</dt><dd className="text-ink">{data.guardian_occupation ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.phone")}</dt><dd className="text-ink">{data.guardian_phone}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.email")}</dt><dd className="text-ink">{data.guardian_email ?? "—"}</dd></div>
          <div>
            <dt className="text-ink-faint">{t("admissions.address")}</dt>
            <dd className="text-ink">
              {[data.guardian_house_number, data.guardian_woreda_kebele, data.guardian_subcity, data.guardian_region]
                .filter(Boolean).join(", ") || "—"}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <PanelHeader title={t("admissions.documents")} />
        <ul className="divide-y divide-line px-5">
          {Object.entries(DOC_KEYS).map(([key, labelKey]) => {
            const path = data[key as keyof typeof data] as string | null;
            const url = docUrls?.[key];
            return (
              <li key={key} className="flex items-center justify-between py-3 text-sm">
                <span className="text-ink">{t(`admissions.docLabels.${labelKey}`)}</span>
                {path ? (
                  url ? <a href={url} target="_blank" rel="noreferrer" className="text-navy hover:underline">{t("admissions.view")}</a>
                    : <span className="text-ink-faint">{t("admissions.loading")}</span>
                ) : <Badge tone="danger">{t("admissions.notUploaded")}</Badge>}
              </li>
            );
          })}
        </ul>
      </Panel>

      {data.payment_method && (
        <Panel>
          <PanelHeader title={t("admissions.payment")} />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="text-ink-faint">{t("admissions.method")}</dt><dd className="text-ink">{t(`admissions.paymentMethod.${data.payment_method}`)}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.total")}</dt><dd className="tabular-nums text-ink">{data.fees_total_etb} ETB</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.schoolBus")}</dt><dd className="text-ink">{data.bus_service_opted ? t("admissions.yes") : t("admissions.no")}</dd></div>
          </dl>
        </Panel>
      )}
    </div>
  );
}
