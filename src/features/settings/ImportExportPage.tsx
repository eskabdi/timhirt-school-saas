import { useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { buildImportTemplates } from "./importTemplates";
import { callFunction } from "@/lib/functions";

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

interface DataJob {
  id: string;
  entity_type: string;
  job_type: "import" | "export";
  status: "queued" | "processing" | "completed" | "failed";
  progress_percent: number;
  total_rows: number | null;
  processed_rows: number;
  error_count: number;
  created_at: string;
  completed_at: string | null;
}

export function ImportExportPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedEntity, setSelectedEntity] = useState<string>("students");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const entities = ["students", "teachers", "fees"];
  const templates = useMemo(() => buildImportTemplates(t), [t]);
  const activeTemplate = templates[selectedEntity as keyof typeof templates];

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ["data-jobs", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("data_jobs")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data as DataJob[]) || [];
    },
  });

  const createImportJobMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!profile?.tenant_id) throw new Error("No tenant");

      const { data: job } = await supabase.rpc("create_import_job", {
        p_tenant_id: profile.tenant_id,
        p_entity_type: selectedEntity,
        p_file_size: file.size,
      });

      if (!job) throw new Error("Failed to create job");

      const filePath = `${profile.tenant_id}/${job}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("data-imports")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Kicks off the actual row-by-row parse + insert. Errors here are
      // per-row and land in data_jobs.error_log (surfaced via the Job
      // History list below), not thrown -- the job record is the result,
      // not this call's return value.
      await callFunction("process-import-job", { job_id: job, storage_path: filePath });

      return job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-jobs"] });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const createExportJobMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("No tenant");

      const { data: job } = await supabase.rpc("create_export_job", {
        p_tenant_id: profile.tenant_id,
        p_entity_type: selectedEntity,
      });

      if (!job) throw new Error("Failed to create job");
      return job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-jobs"] });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      createImportJobMutation.mutate(selectedFile);
    }
  };

  const getJobStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "processing":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink mb-2">{t("importExport.title")}</h1>
        <p className="text-sm text-ink-faint">{t("importExport.subtitle")}</p>
      </div>

      {/* Import Section */}
      <div className="rounded-lg border border-line p-6">
        <h2 className="text-xl font-bold text-ink mb-4">{t("importExport.import")}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              {t("importExport.entityType")}
            </label>
            <select
              value={selectedEntity}
              onChange={(e) => setSelectedEntity(e.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            >
              {entities.map((entity) => (
                <option key={entity} value={entity}>
                  {entity.charAt(0).toUpperCase() + entity.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              {t("importExport.selectFile")}
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="text-sm"
              />
              {selectedFile && (
                <span className="text-sm text-ink-faint">{selectedFile.name}</span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={!selectedFile || createImportJobMutation.isPending}
            >
              {t("importExport.startImport")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                downloadCsv(`${selectedEntity}-import-template.csv`, [
                  activeTemplate.headers,
                  activeTemplate.example,
                ])
              }
            >
              {t("importExport.downloadTemplate")}
            </Button>
          </div>

          <div className="pt-2">
            <h3 className="text-sm font-semibold text-ink mb-1">{t("importExport.templatePreview")}</h3>
            <p className="text-xs text-ink-faint mb-3">{t("importExport.templateHint")}</p>
            <div className="overflow-x-auto rounded border border-line">
              <table className="min-w-full text-xs">
                <thead className="bg-sidebar">
                  <tr>
                    {activeTemplate.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line">
                    {activeTemplate.example.map((v, i) => (
                      <td key={i} className="whitespace-nowrap px-3 py-2 text-ink-faint">
                        {v}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">{t("importExport.exampleRow")}</p>
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="rounded-lg border border-line p-6">
        <h2 className="text-xl font-bold text-ink mb-4">{t("importExport.export")}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              {t("importExport.entityType")}
            </label>
            <select
              value={selectedEntity}
              onChange={(e) => setSelectedEntity(e.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            >
              {entities.map((entity) => (
                <option key={entity} value={entity}>
                  {entity.charAt(0).toUpperCase() + entity.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            onClick={() => createExportJobMutation.mutate()}
            disabled={createExportJobMutation.isPending}
          >
            {t("importExport.startExport")}
          </Button>
        </div>
      </div>

      {/* Job History */}
      <div className="rounded-lg border border-line p-6">
        <h2 className="text-xl font-bold text-ink mb-4">{t("importExport.jobHistory")}</h2>
        {jobsLoading ? (
          <div className="text-center text-ink-faint">{t("common.loading")}</div>
        ) : !jobs || jobs.length === 0 ? (
          <div className="text-center text-ink-faint">{t("importExport.noJobs")}</div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-lg border border-line p-4 hover:bg-sidebar transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">
                        {job.job_type === "import" ? t("importExport.import") : t("importExport.export")}
                      </span>
                      <span className="text-sm text-ink-faint">· {job.entity_type}</span>
                      <span className={`text-xs font-medium rounded px-2 py-1 ${getJobStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="text-xs text-ink-faint mt-2">
                      <EthDate value={new Date(job.created_at)} />
                    </div>
                  </div>
                  {job.status === "processing" && (
                    <div className="text-right">
                      <div className="text-sm font-medium text-ink">{job.progress_percent}%</div>
                      <div className="w-24 h-2 bg-gray-200 rounded mt-1">
                        <div
                          className="h-full bg-blue-500 rounded"
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {job.status === "completed" && (
                    <div className="text-right text-sm">
                      <div className="text-ink-faint">{job.processed_rows} {t("importExport.rows")}</div>
                      {job.error_count > 0 && (
                        <div className="text-danger">{job.error_count} {t("importExport.errors")}</div>
                      )}
                    </div>
                  )}
                  {job.status === "failed" && (
                    <div className="text-right text-sm text-danger">
                      {job.error_count} {t("importExport.errors")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
