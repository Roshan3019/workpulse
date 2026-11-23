"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center overflow-y-auto bg-[rgba(23,22,20,.38)] p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-slide-in my-auto w-full ${wide ? "max-w-2xl" : "max-w-xl"} rounded-[14px] border border-line bg-white p-6 shadow-[0_16px_40px_-12px_rgba(23,22,20,.22)] sm:p-7`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{title}</h2>
            {subtitle ? <p className="mt-1 max-w-[46ch] text-[12.5px] leading-relaxed text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-[#f2efea] hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-[#f3c2c2] bg-bad-soft text-[#b91c1c]",
    success: "border-[#bfe9d6] bg-ok-soft text-ok-dark",
    info: "border-brand-line bg-brand-soft text-brand-dark",
  } as const;
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${styles[tone]}`} role="status">
      {children}
    </div>
  );
}
