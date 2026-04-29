import { ChartCandlestick, History, Lightbulb, PlayCircle, Wallet } from "lucide-react";

const navItems = [
  { id: "scanner", label: "Market", icon: ChartCandlestick },
  { id: "runBot", label: "Run Bot", icon: PlayCircle },
  { id: "history", label: "Logs", icon: History },
  { id: "wallet", label: "Wallet", icon: Wallet }
];

export function Sidebar({ activeSection, onSelect, theme, onToggleTheme }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 border-r border-[var(--border)] bg-[var(--panel-muted)] p-3 lg:block">
      <div className="mb-6 px-2 py-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--text)]">Crypto Bot</p>
          <button
            aria-label="Toggle theme"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-black/5 hover:text-[var(--text)]"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            type="button"
          >
            <Lightbulb className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Command Center</p>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              activeSection === item.id
                ? "bg-[var(--brand-soft)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text)]"
            }`}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
