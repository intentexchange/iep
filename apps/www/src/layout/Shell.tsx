import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { NavLink, Outlet } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }): string => {
  return [
    "text-sm tracking-tight",
    isActive ? "text-rust" : "text-ink/70 hover:text-ink",
  ].join(" ");
};

export const Shell = () => {
  return (
    <div className="min-h-[100dvh]">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <NavLink to="/" className="font-mono text-sm tracking-tight text-ink">
            IEP
          </NavLink>
          <nav aria-label="Primary" className="flex items-center gap-6">
            <NavLink to="/" className={linkClass} end>
              Overview
            </NavLink>
            <NavLink to="/protocol" className={linkClass}>
              Protocol
            </NavLink>
            <a
              href="https://github.com/intentexchange/iep"
              className="inline-flex items-center gap-1 text-sm text-ink/70 hover:text-ink"
            >
              Source
              <ArrowUpRightIcon aria-hidden size={14} weight="bold" />
            </a>
          </nav>
        </div>
      </header>
      <div id="content">
        <Outlet />
      </div>
      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-ink/50">Apache-2.0</p>
          <p className="font-mono text-xs text-ink/50">intentexchange.dev</p>
        </div>
      </footer>
    </div>
  );
};
