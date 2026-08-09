import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";

interface BackupJob {
  id: string;
  status: string;
  backup_type: string;
  size_bytes: number | null;
  records_backed_up: number | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface RestoreJob {
  id: string;
  backup_job_id: string;
  status: string;
  dry_run: boolean;
  records_restored: number | null;
  created_at: string;
  error_message: string | null;
}

export function BackupsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);

  const { data: backups, isLoading: backupsLoading } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("backup_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as BackupJob[];
    },
  });

  const { data: restores } = useQuery({
    queryKey: ["restores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restore_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RestoreJob[];
    },
  });

  const triggerBackup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("backup_jobs").insert({
        backup_type: "full",
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
  });

  const startRestore = useMutation({
    mutationFn: async (backupId: string) => {
      const { error } = await supabase.from("restore_jobs").insert({
        backup_job_id: backupId,
        dry_run: isDryRun,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restores"] });
      setIsConfirmingRestore(false);
      setSelectedBackup(null);
    },
  });

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-ok-tint text-ok";
      case "running":
      case "pending":
        return "bg-navy-wash text-navy";
      case "failed":
        return "bg-danger-tint text-danger";
      default:
        return "bg-sidebar text-ink-faint";
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("backups.title")}</h1>

      <Card className="space-y-4 p-4">
        <h2 className="font-semibold text-ink">{t("backups.backupNow")}</h2>
        <p className="text-sm text-ink-soft">{t("backups.backupDescription")}</p>
        <Button onClick={() => triggerBackup.mutate()} disabled={triggerBackup.isPending || backupsLoading}>
          {triggerBackup.isPending ? t("backups.backingUp") : t("backups.startBackup")}
        </Button>
      </Card>

      {backups && backups.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-ink">{t("backups.history")}</h2>
          {backups.map((backup) => (
            <Panel key={backup.id}>
              <PanelHeader
                title={`${t("backups.backup")} · ${backup.backup_type.toUpperCase()}`}
                subtitle={<span className="flex items-center gap-2">
                  <span className={`inline-block rounded-control px-2 py-0.5 text-xs font-medium ${getStatusColor(backup.status)}`}>
                    {t(`backups.status.${backup.status}`)}
                  </span>
                  <EthDate value={new Date(backup.created_at)} /> {backup.created_at.slice(11, 19)}
                </span>}
              />
              <div className="space-y-3 p-5">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-ink-faint">{t("backups.size")}</p>
                    <p className="font-medium text-ink">{formatBytes(backup.size_bytes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-faint">{t("backups.records")}</p>
                    <p className="font-medium text-ink">{backup.records_backed_up ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-faint">{t("backups.duration")}</p>
                    <p className="font-medium text-ink">
                      {backup.completed_at
                        ? `${Math.round((new Date(backup.completed_at).getTime() - new Date(backup.created_at).getTime()) / 1000)}s`
                        : "—"}
                    </p>
                  </div>
                </div>
                {backup.error_message && (
                  <div className="rounded-control bg-danger-tint p-3 text-sm text-danger">
                    {backup.error_message}
                  </div>
                )}
                {backup.status === "completed" && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelectedBackup(backup.id);
                        setIsConfirmingRestore(false);
                      }}
                    >
                      {t("backups.restore")}
                    </Button>
                    <Button variant="ghost" onClick={() => {
                      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `backup-${backup.id}.json`;
                      a.click();
                    }}>
                      {t("backups.downloadMetadata")}
                    </Button>
                  </div>
                )}

                {selectedBackup === backup.id && (
                  <div className="space-y-3 border-t border-line pt-3">
                    <h3 className="font-semibold text-ink">{t("backups.restoreTitle")}</h3>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isDryRun}
                        onChange={(e) => setIsDryRun(e.target.checked)}
                        className="rounded-control"
                      />
                      <span className="text-sm text-ink">{t("backups.dryRun")}</span>
                    </label>
                    {isDryRun && (
                      <p className="text-xs text-ink-faint">{t("backups.dryRunDescription")}</p>
                    )}
                    {!isConfirmingRestore && (
                      <Button
                        variant="ghost"
                        onClick={() => setIsConfirmingRestore(true)}
                      >
                        {isDryRun ? t("backups.previewRestore") : t("backups.confirmRestore")}
                      </Button>
                    )}
                    {isConfirmingRestore && (
                      <div className="space-y-2 rounded-control bg-danger-tint p-3">
                        <p className="text-sm font-medium text-danger">
                          {isDryRun ? t("backups.dryRunWarning") : t("backups.restoreWarning")}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => startRestore.mutate(backup.id)}
                            disabled={startRestore.isPending}
                          >
                            {startRestore.isPending ? t("backups.restoring") : t("backups.proceed")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setIsConfirmingRestore(false);
                              setSelectedBackup(null);
                            }}
                          >
                            {t("backups.cancel")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {restores && restores.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-ink">{t("backups.restoreHistory")}</h2>
          {restores.map((restore) => (
            <Panel key={restore.id}>
              <PanelHeader
                title={`${t("backups.restore")} ${restore.dry_run ? `(${t("backups.dryRun")})` : ""}`}
                subtitle={<span className="flex items-center gap-2">
                  <span className={`inline-block rounded-control px-2 py-0.5 text-xs font-medium ${getStatusColor(restore.status)}`}>
                    {t(`backups.status.${restore.status}`)}
                  </span>
                  <EthDate value={new Date(restore.created_at)} /> {restore.created_at.slice(11, 19)}
                </span>}
              />
              <div className="space-y-2 p-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-faint">{t("backups.records")}</span>
                  <span className="font-medium text-ink">{restore.records_restored ?? "—"}</span>
                </div>
                {restore.error_message && (
                  <div className="rounded-control bg-danger-tint p-3 text-danger">
                    {restore.error_message}
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {backupsLoading && (
        <Card className="py-12 text-center text-ink-faint">{t("backups.loading")}</Card>
      )}
    </div>
  );
}
