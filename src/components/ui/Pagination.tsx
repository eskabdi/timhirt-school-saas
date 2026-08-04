import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Fixed page size for every paginated list in the app — one constant so
 *  "how many rows per page" never drifts between screens. */
export const PAGE_SIZE = 25;

/** [from, to] inclusive range for a 1-based page, for Supabase's .range(). */
export function pageRange(page: number, pageSize = PAGE_SIZE): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/** Prev/Next + "Page X of Y" + total-row count — the one pagination control
 *  every list page shares. Renders nothing for a single page of results, so
 *  small reference tables (Subjects, Roles, …) don't grow a dead footer. */
export function Pagination({ page, totalCount, pageSize = PAGE_SIZE, onPageChange, className }: {
  page: number;
  totalCount: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  if (pageCount <= 1) return null;

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className={cn("flex items-center justify-between gap-4 border-t border-line px-1 py-3", className)}>
      <p className="text-sm text-ink-faint">
        {t("pagination.showing", { from, to, total: totalCount })}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40">
          {t("pagination.previous")}
        </button>
        <span className="text-sm text-ink-soft">{t("pagination.pageOf", { page, pageCount })}</span>
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40">
          {t("pagination.next")}
        </button>
      </div>
    </div>
  );
}
