// Display-only EC date (§17.4). Ad-hoc toLocaleDateString is banned by lint;
// every rendered date goes through this component or formatEth.
import { useTranslation } from "react-i18next";
import { formatEth } from "@/lib/ethiopian-date";

export function EthDate({ value, geez = false }: { value: Date | string; geez?: boolean }) {
  const { t } = useTranslation("calendar");
  const d = typeof value === "string" ? new Date(value + "T00:00:00Z") : value;
  const months = t("months", { returnObjects: true }) as string[];
  return <time dateTime={d.toISOString().slice(0, 10)}>{formatEth(d, { monthNames: months, eraSuffix: t("eraSuffix"), geez })}</time>;
}
