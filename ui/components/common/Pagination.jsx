import { Button } from "../ui/button";

export function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const windowSize = 2;
  const start = Math.max(1, page - windowSize);
  const end = Math.min(totalPages, page + windowSize);
  const pageNumbers = [];
  for (let p = start; p <= end; p += 1) {
    pageNumbers.push(p);
  }

  return (
    <div className="flex items-center justify-center border-t border-[var(--border)] px-3 py-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Prev
        </Button>
        {start > 1 ? (
          <>
            <Button size="sm" variant={page === 1 ? "default" : "outline"} onClick={() => onPageChange(1)}>
              1
            </Button>
            {start > 2 ? <span className="px-1 text-xs text-[var(--text-muted)]">...</span> : null}
          </>
        ) : null}
        {pageNumbers.map((pageNumber) => (
          <Button
            key={pageNumber}
            size="sm"
            variant={page === pageNumber ? "default" : "outline"}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </Button>
        ))}
        {end < totalPages ? (
          <>
            {end < totalPages - 1 ? <span className="px-1 text-xs text-[var(--text-muted)]">...</span> : null}
            <Button
              size="sm"
              variant={page === totalPages ? "default" : "outline"}
              onClick={() => onPageChange(totalPages)}
            >
              {totalPages}
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
