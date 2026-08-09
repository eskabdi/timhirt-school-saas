import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
export function BillingPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("platformPages.billing")}</h1>
      <Card className="text-ink-faint">{t("platformPages.billingDesc")}</Card>
    </div>
  );
}
