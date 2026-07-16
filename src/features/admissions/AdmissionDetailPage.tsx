import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";

const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
} as const;

const DOC_LABELS: Record<string, string> = {
  birth_certificate_path: "Birth Certificate",
  transcript_path: "Academic Transcript",
  photo_path: "Student Photograph",
  payment_receipt_path: "Payment Receipt",
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
          <Badge tone={STAGE_TONE[data.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{data.stage}</Badge>
        </div>

        {hasBilingualName && (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-ink-faint">First name</dt><dd className="text-ink">{data.applicant_first_name} / {data.applicant_first_name_am}</dd></div>
            <div><dt className="text-ink-faint">Middle name</dt><dd className="text-ink">{data.applicant_middle_name} / {data.applicant_middle_name_am}</dd></div>
            <div><dt className="text-ink-faint">Last name</dt><dd className="text-ink">{data.applicant_last_name} / {data.applicant_last_name_am}</dd></div>
            <div><dt className="text-ink-faint">Gender</dt><dd className="capitalize text-ink">{data.gender}</dd></div>
          </dl>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">Date of birth</dt><dd className="text-ink"><EthDate value={data.date_of_birth} /></dd></div>
        </dl>
      </Card>

      <Panel>
        <PanelHeader title="Guardian" />
        <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div><dt className="text-ink-faint">Name</dt><dd className="text-ink">{data.guardian_name}{data.guardian_name_am ? ` / ${data.guardian_name_am}` : ""}</dd></div>
          <div><dt className="text-ink-faint">Relationship</dt><dd className="capitalize text-ink">{data.guardian_relationship ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">Occupation</dt><dd className="text-ink">{data.guardian_occupation ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">Phone</dt><dd className="text-ink">{data.guardian_phone}</dd></div>
          <div><dt className="text-ink-faint">Email</dt><dd className="text-ink">{data.guardian_email ?? "—"}</dd></div>
          <div>
            <dt className="text-ink-faint">Address</dt>
            <dd className="text-ink">
              {[data.guardian_house_number, data.guardian_woreda_kebele, data.guardian_subcity, data.guardian_region]
                .filter(Boolean).join(", ") || "—"}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <PanelHeader title="Documents" />
        <ul className="divide-y divide-line px-5">
          {Object.entries(DOC_LABELS).map(([key, label]) => {
            const path = data[key as keyof typeof data] as string | null;
            const url = docUrls?.[key];
            return (
              <li key={key} className="flex items-center justify-between py-3 text-sm">
                <span className="text-ink">{label}</span>
                {path ? (
                  url ? <a href={url} target="_blank" rel="noreferrer" className="text-navy hover:underline">View</a>
                    : <span className="text-ink-faint">Loading…</span>
                ) : <Badge tone="danger">Not uploaded</Badge>}
              </li>
            );
          })}
        </ul>
      </Panel>

      {data.payment_method && (
        <Panel>
          <PanelHeader title="Payment" />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="text-ink-faint">Method</dt><dd className="uppercase text-ink">{data.payment_method}</dd></div>
            <div><dt className="text-ink-faint">Total</dt><dd className="tabular-nums text-ink">{data.fees_total_etb} ETB</dd></div>
            <div><dt className="text-ink-faint">School bus</dt><dd className="text-ink">{data.bus_service_opted ? "Yes" : "No"}</dd></div>
          </dl>
        </Panel>
      )}
    </div>
  );
}
