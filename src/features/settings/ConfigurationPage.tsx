import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";

interface Config {
  id: string;
  key: string;
  value: unknown;
  value_type: string;
  description: string | null;
}

interface FeatureFlag {
  id: string;
  flag_key: string;
  enabled: boolean;
  description: string | null;
}


export function ConfigurationPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const [editingConfig, setEditingConfig] = useState<Config | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const { data: configs, isLoading: configsLoading } = useQuery({
    queryKey: ["system-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("system_config")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .order("key");
      return (data as Config[]) || [];
    },
  });

  const { data: featureFlags, isLoading: flagsLoading } = useQuery({
    queryKey: ["feature-flags", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("feature_flags")
        .select("*")
        .eq("tenant_id", profile!.tenant_id!)
        .order("flag_key");
      return (data as FeatureFlag[]) || [];
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (updatedConfig: Config) => {
      let value: unknown;
      try {
        if (updatedConfig.value_type === "boolean") {
          value = editValue === "true";
        } else if (updatedConfig.value_type === "number") {
          value = parseInt(editValue, 10);
        } else {
          value = editValue;
        }
      } catch {
        throw new Error("Invalid value for type");
      }

      const { error } = await supabase
        .from("system_config")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("id", updatedConfig.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-config"] });
      setEditingConfig(null);
    },
  });

  const toggleFeatureFlagMutation = useMutation({
    mutationFn: async (flag: FeatureFlag) => {
      const { error } = await supabase
        .from("feature_flags")
        .update({ enabled: !flag.enabled, updated_at: new Date().toISOString() })
        .eq("id", flag.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });

  const handleEditConfig = (config: Config) => {
    setEditingConfig(config);
    setEditValue(String(config.value));
  };

  const handleSaveConfig = () => {
    if (editingConfig) {
      updateConfigMutation.mutate(editingConfig);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink mb-2">{t("config.title")}</h1>
        <p className="text-sm text-ink-faint">{t("config.subtitle")}</p>
      </div>

      {/* Feature Flags Section */}
      <div className="rounded-lg border border-line p-6">
        <h2 className="text-xl font-bold text-ink mb-4">{t("config.featureToggles")}</h2>
        {flagsLoading ? (
          <div className="text-center text-ink-faint">{t("common.loading")}</div>
        ) : !featureFlags || featureFlags.length === 0 ? (
          <div className="text-center text-ink-faint">{t("config.noFlags")}</div>
        ) : (
          <div className="space-y-3">
            {featureFlags.map((flag) => (
              <div
                key={flag.id}
                className="flex items-start justify-between rounded-lg border border-line p-4 hover:bg-sidebar transition-colors"
              >
                <div>
                  <div className="font-semibold text-ink">{flag.flag_key}</div>
                  {flag.description && (
                    <div className="text-sm text-ink-faint mt-1">{flag.description}</div>
                  )}
                </div>
                <button
                  onClick={() => toggleFeatureFlagMutation.mutate(flag)}
                  disabled={toggleFeatureFlagMutation.isPending}
                  className={`px-3 py-1 rounded-control text-sm font-medium transition-colors ${
                    flag.enabled
                      ? "bg-green-100 text-green-800 hover:bg-green-200"
                      : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                  }`}
                >
                  {flag.enabled ? t("config.enabled") : t("config.disabled")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Configuration Section */}
      <div className="rounded-lg border border-line p-6">
        <h2 className="text-xl font-bold text-ink mb-4">{t("config.systemSettings")}</h2>
        {configsLoading ? (
          <div className="text-center text-ink-faint">{t("common.loading")}</div>
        ) : !configs || configs.length === 0 ? (
          <div className="text-center text-ink-faint">{t("config.noConfig")}</div>
        ) : (
          <div className="space-y-4">
            {configs.map((config) => (
              <div
                key={config.id}
                className="rounded-lg border border-line p-4 hover:bg-sidebar transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-ink">{config.key}</div>
                    {config.description && (
                      <div className="text-sm text-ink-faint mt-1">{config.description}</div>
                    )}
                    {editingConfig?.id !== config.id && (
                      <div className="text-sm text-ink mt-2">
                        {t("config.currentValue")}: <span className="font-mono">{String(config.value)}</span>
                      </div>
                    )}
                  </div>
                  {editingConfig?.id === config.id ? (
                    <div className="flex gap-2">
                      {config.value_type === "boolean" ? (
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded border border-line px-2 py-1 text-sm"
                        >
                          <option value="true">{t("config.true")}</option>
                          <option value="false">{t("config.false")}</option>
                        </select>
                      ) : (
                        <input
                          type={config.value_type === "number" ? "number" : "text"}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded border border-line px-2 py-1 text-sm flex-1"
                        />
                      )}
                      <Button
                        variant="primary"
                        onClick={handleSaveConfig}
                        disabled={updateConfigMutation.isPending}
                        className="text-xs py-1"
                      >
                        {t("common.save")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setEditingConfig(null)}
                        className="text-xs py-1"
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => handleEditConfig(config)}
                      className="text-xs"
                    >
                      {t("common.edit")}
                    </Button>
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
