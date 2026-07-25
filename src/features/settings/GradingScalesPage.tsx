import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
export function GradingScalesPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.gradingScales")}</h1>
      <Card className="text-ink-faint">{t("settingsPages.gradingScalesDesc")}</Card>
    </div>
  );
}
