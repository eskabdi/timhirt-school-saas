import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { cn } from "@/lib/utils";

interface HealthMetric {
  id: string;
  tenant_id: string;
  metric_type: string;
  value: number;
  unit: string | null;
  threshold_warning: number | null;
  threshold_critical: number | null;
  status: "healthy" | "warning" | "critical";
  recorded_at: string;
}

interface HealthAlert {
  id: string;
  tenant_id: string;
  alert_type: string;
  severity: "warning" | "critical";
  message: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface BackupRecord {
  id: string;
  tenant_id: string;
  status: string;
  created_at: string;
}

export function HealthMonitoringPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const refreshInterval = 30000; // 30 seconds

  // Fetch latest health metrics
  const { data: metrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ["health-metrics", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .order("metric_type")
        .order("recorded_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      // Group by metric_type, keep only latest
      const latestByType = new Map<string, HealthMetric>();
      (data as HealthMetric[]).forEach((m) => {
        if (!latestByType.has(m.metric_type)) {
          latestByType.set(m.metric_type, m);
        }
      });
      return Array.from(latestByType.values());
    },
    refetchInterval: refreshInterval,
  });

  // Fetch health alerts
  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ["health-alerts", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_alerts")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as HealthAlert[];
    },
    refetchInterval: refreshInterval,
  });

  // Fetch failed jobs count
  const { data: failedJobs = 0 } = useQuery({
    queryKey: ["failed-jobs", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_jobs")
        .select("id")
        .eq("tenant_id", profile!.tenant_id!)
        .eq("status", "failed");
      if (error) throw error;
      return data?.length ?? 0;
    },
    refetchInterval: refreshInterval,
  });

  // Fetch backup status
  const { data: backupStatus } = useQuery({
    queryKey: ["backup-status", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("backups")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return data as BackupRecord | null;
    },
    refetchInterval: refreshInterval,
  });

  // Acknowledge alert mutation
  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc("acknowledge_alert", {
        p_alert_id: alertId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-alerts"] });
    },
  });

  // Resolve alert mutation (sets resolved_at)
  const resolveAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("health_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-alerts"] });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-700 bg-green-50";
      case "warning":
        return "text-yellow-700 bg-yellow-50";
      case "critical":
        return "text-red-700 bg-red-50";
      default:
        return "text-gray-700 bg-gray-50";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return "✓ Healthy";
      case "warning":
        return "⚠ Warning";
      case "critical":
        return "✗ Critical";
      default:
        return status;
    }
  };

  const formatValue = (value: number, unit: string | null) => {
    if (!unit) return value.toFixed(2);
    if (unit === "bytes") {
      if (value > 1e9) return `${(value / 1e9).toFixed(2)} GB`;
      if (value > 1e6) return `${(value / 1e6).toFixed(2)} MB`;
      return `${(value / 1e3).toFixed(2)} KB`;
    }
    if (unit === "percent") return `${value.toFixed(1)}%`;
    if (unit === "ms") return `${value.toFixed(0)}ms`;
    return `${value.toFixed(2)} ${unit}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">{t("nav.healthMonitoring")}</h1>
        <div className="flex gap-2">
          <Button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["health-metrics"] })}
            variant="ghost"
          >
            {t("actions.refresh")}
          </Button>
        </div>
      </div>

      {/* System Status Overview Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Database Status */}
        <Card className="p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-ink-faint">Database</p>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold text-ink">
                {metricsLoading ? "—" : "Active"}
              </p>
              {metricsLoading ? (
                <span className="text-xs text-ink-faint">Loading…</span>
              ) : (
                <span className="inline-block rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                  ✓ Healthy
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Storage Usage */}
        <Card className="p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-ink-faint">Storage</p>
            {metricsLoading ? (
              <p className="text-2xl font-bold text-ink">—</p>
            ) : (
              <>
                <p className="text-2xl font-bold text-ink">
                  {
                    // eslint-disable-next-line no-restricted-syntax
                    metrics
                    .find((m) => m.metric_type === "storage_used")
                    ?.value
                    .toLocaleString()}{" "}
                  MB
                </p>
                <div className="h-1 bg-gray-200 rounded">
                  <div
                    className="h-1 bg-blue-500 rounded"
                    style={{
                      width: `${Math.min(
                        ((metrics.find((m) => m.metric_type === "storage_used")
                          ?.value ?? 0) / 1000) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Failed Jobs */}
        <Card className="p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-ink-faint">Failed Jobs</p>
            <p className="text-2xl font-bold text-ink">{failedJobs}</p>
            {failedJobs > 0 && (
              <p className="text-xs text-red-600">{failedJobs} job(s) need attention</p>
            )}
          </div>
        </Card>

        {/* Last Backup */}
        <Card className="p-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-ink-faint">Last Backup</p>
            {backupStatus ? (
              <>
                <p className="text-sm font-medium text-ink">
                  <EthDate value={new Date(backupStatus.created_at)} />
                </p>
                <span
                  className={cn(
                    "inline-block rounded px-2 py-1 text-xs font-medium",
                    backupStatus.status === "completed"
                      ? "bg-green-50 text-green-700"
                      : "bg-yellow-50 text-yellow-700"
                  )}
                >
                  {backupStatus.status}
                </span>
              </>
            ) : (
              <p className="text-sm text-ink-faint">No backups yet</p>
            )}
          </div>
        </Card>
      </div>

      {/* Health Metrics Table */}
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">System Metrics</h2>
        {metricsLoading ? (
          <p className="text-center text-ink-faint">{t("backups.loading")}</p>
        ) : metrics.length === 0 ? (
          <p className="text-center text-ink-faint">{t("noRecordsYet")}</p>
        ) : (
          <div className="space-y-2">
            {metrics.map((metric) => (
              <div
                key={metric.id}
                className={cn(
                  "flex items-center justify-between rounded-control p-4",
                  getStatusColor(metric.status)
                )}
              >
                <div className="flex-1">
                  <p className="font-medium capitalize">
                    {metric.metric_type.replace(/_/g, " ")}
                  </p>
                  <p className="text-sm opacity-75">
                    {formatValue(metric.value, metric.unit)}
                    {metric.threshold_warning && (
                      <span className="ml-2 text-xs">
                        (warn: {metric.threshold_warning}, crit:{" "}
                        {metric.threshold_critical})
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded px-2 py-1 text-xs font-semibold">
                    {getStatusBadge(metric.status)}
                  </span>
                  <p className="mt-1 text-xs opacity-75">
                    {new Date(metric.recorded_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Health Alerts */}
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          {t("health.alerts")} {alerts.length > 0 && `(${alerts.length})`}
        </h2>
        {alertsLoading ? (
          <p className="text-center text-ink-faint">{t("backups.loading")}</p>
        ) : alerts.length === 0 ? (
          <p className="text-center text-ink-faint">{t("health.noAlerts")}</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "rounded-control border p-4",
                  alert.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : "border-yellow-200 bg-yellow-50"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-ink">
                        {alert.alert_type.replace(/_/g, " ")}
                      </h3>
                      <span
                        className={cn(
                          "inline-block rounded px-2 py-0.5 text-xs font-medium",
                          alert.severity === "critical"
                            ? "bg-red-200 text-red-800"
                            : "bg-yellow-200 text-yellow-800"
                        )}
                      >
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{alert.message}</p>
                    <p className="mt-2 text-xs text-ink-faint">
                      <EthDate value={alert.created_at} /> {new Date(alert.created_at).toLocaleTimeString()}
                      {alert.acknowledged_at && (
                        <>
                          {" "}
                          · Acknowledged{" "}
                          <EthDate value={alert.acknowledged_at} /> {new Date(alert.acknowledged_at).toLocaleTimeString()}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {!alert.acknowledged_at && (
                      <Button
                        onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                        variant="ghost"
                        disabled={acknowledgeAlertMutation.isPending}
                      >
                        {acknowledgeAlertMutation.isPending ? "…" : "Acknowledge"}
                      </Button>
                    )}
                    <Button
                      onClick={() => resolveAlertMutation.mutate(alert.id)}
                      variant="ghost"
                      disabled={resolveAlertMutation.isPending}
                    >
                      {resolveAlertMutation.isPending ? "…" : "Resolve"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
