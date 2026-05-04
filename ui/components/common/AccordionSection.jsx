"use client";

import { ChevronDown } from "lucide-react";

export function AccordionSection({
  title,
  titleMeta,
  isOpen,
  onToggle,
  headerRight,
  headerRightWhenCollapsed,
  children,
  contentClassName = "px-3 pb-3",
  headerClassName = "min-h-[64px] gap-3 px-5 py-4",
  titleClassName = "text-base font-semibold",
  iconClassName = "h-7 w-7",
  containerClassName = "rounded-lg border border-[var(--border)]"
}) {
  return (
    <section className={containerClassName}>
      <div
        className={`flex w-full cursor-pointer items-center justify-between text-left ${headerClassName}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`${titleClassName} text-[var(--text)]`}>{title}</span>
          {titleMeta ? <span className="text-xs font-normal text-[var(--text-muted)]">{titleMeta}</span> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {isOpen ? headerRight : headerRightWhenCollapsed}
          <button
            type="button"
            className="cursor-pointer"
            onClick={onToggle}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}
          >
            <ChevronDown
              className={`${iconClassName} text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      {isOpen ? <div className={contentClassName}>{children}</div> : null}
    </section>
  );
}
