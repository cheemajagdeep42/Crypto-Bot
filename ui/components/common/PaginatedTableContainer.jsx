"use client";

import { Pagination } from "./Pagination";

export function PaginatedTableContainer({
  children,
  page,
  totalPages,
  onPageChange,
  className = "rounded-lg border border-[var(--border)]"
}) {
  return (
    <div className={className}>
      <div className="overflow-hidden">{children}</div>
      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}
