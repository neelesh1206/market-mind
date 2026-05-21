"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  codeStatus,
  normalizeCode,
  type PromoCodeRow,
} from "@/lib/promo-codes";
import {
  createPromoCode,
  deactivatePromoCode,
} from "@/app/actions/promo-codes";

type Props = {
  initialCodes: PromoCodeRow[];
};

/**
 * Admin panel for promo codes — create form + table of existing codes.
 * Layout is server-component-rendered (admin gating happens there);
 * mutations + optimistic updates live here.
 */
export function CodesAdminPanel({ initialCodes }: Props) {
  const [codes, setCodes] = useState<PromoCodeRow[]>(initialCodes);

  function handleCreated(newCode: PromoCodeRow) {
    setCodes((prev) => [newCode, ...prev]);
  }

  function handleDeactivated(id: string) {
    setCodes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isActive: false } : c)),
    );
  }

  return (
    <div className="space-y-8">
      <CreateForm onCreated={handleCreated} />
      <CodesTable codes={codes} onDeactivated={handleDeactivated} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Create form
// ----------------------------------------------------------------------------

function CreateForm({ onCreated }: { onCreated: (row: PromoCodeRow) => void }) {
  const [code, setCode] = useState("");
  const [credits, setCredits] = useState("100");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState(""); // date string YYYY-MM-DD
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setCode("");
    setCredits("100");
    setMaxRedemptions("");
    setExpiresAt("");
    setDescription("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = normalizeCode(code);
    const creditsNum = Number.parseInt(credits, 10);
    const maxNum = maxRedemptions ? Number.parseInt(maxRedemptions, 10) : null;
    const expiresIso = expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null;

    startTransition(async () => {
      const out = await createPromoCode({
        code: cleaned,
        credits: creditsNum,
        maxRedemptions: maxNum,
        expiresAt: expiresIso,
        description: description.trim() || undefined,
      });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      // Optimistic — we don't have the full row back from the server, but
      // we know the fields the user just submitted. redeem_count starts at 0.
      onCreated({
        id: crypto.randomUUID(),
        code: cleaned,
        credits: creditsNum,
        description: description.trim() || null,
        maxRedemptions: maxNum,
        redeemCount: 0,
        expiresAt: expiresIso,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      toast.success(`Code ${cleaned} created.`);
      reset();
    });
  }

  return (
    <section className="border-border/60 bg-card/30 space-y-4 rounded-xl border p-5">
      <h2 className="text-base font-semibold">Create a new code</h2>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint="A-Z, 0-9, hyphen. 4-32 chars. Stored uppercase.">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH2026"
            required
            maxLength={32}
            className="input-base font-mono tracking-wider uppercase"
          />
        </Field>

        <Field label="Credits per redemption" hint="Whole number, 1-1000.">
          <input
            type="number"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            min={1}
            max={1000}
            required
            className="input-base tabular-nums"
          />
        </Field>

        <Field label="Max redemptions" hint="Empty = unlimited. Total across all users.">
          <input
            type="number"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            min={1}
            placeholder="unlimited"
            className="input-base tabular-nums"
          />
        </Field>

        <Field label="Expires" hint="Empty = never. Code becomes invalid after this date.">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="input-base"
          />
        </Field>

        <Field
          label="Internal description"
          hint="Optional. Visible only on this admin page."
          className="sm:col-span-2"
        >
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Q2 launch campaign"
            maxLength={200}
            className="input-base"
          />
        </Field>

        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create code"}
          </Button>
        </div>
      </form>
      <style>{`
        .input-base {
          width: 100%;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border) / 0.6);
          background-color: hsl(var(--card) / 0.4);
        }
        .input-base:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px rgb(16 185 129);
        }
      `}</style>
    </section>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-foreground text-xs font-semibold">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground text-[11px] leading-tight">{hint}</span>}
    </label>
  );
}

// ----------------------------------------------------------------------------
// Codes table
// ----------------------------------------------------------------------------

function CodesTable({
  codes,
  onDeactivated,
}: {
  codes: PromoCodeRow[];
  onDeactivated: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleDeactivate(id: string, code: string) {
    if (!confirm(`Deactivate ${code}? Past redemptions are preserved; further redemptions will be rejected.`)) {
      return;
    }
    startTransition(async () => {
      const out = await deactivatePromoCode(id);
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      onDeactivated(id);
      toast.success(`${code} deactivated.`);
    });
  }

  if (codes.length === 0) {
    return (
      <section className="border-border/60 bg-card/30 rounded-xl border p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No codes yet. Create one above.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Existing codes</h2>
      <div className="border-border/60 overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-card/40 text-muted-foreground text-[11px] tracking-wider uppercase">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Code</th>
              <th className="px-4 py-2 text-right font-semibold">Credits</th>
              <th className="px-4 py-2 text-right font-semibold">Redeemed</th>
              <th className="px-4 py-2 text-left font-semibold">Status</th>
              <th className="px-4 py-2 text-left font-semibold">Notes</th>
              <th className="px-4 py-2 text-right font-semibold sr-only">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-border/40 divide-y">
            {codes.map((c) => {
              const status = codeStatus(c);
              const expiry = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : null;
              return (
                <tr key={c.id} className="bg-card/20">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{c.code}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {c.credits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {c.redeemCount}
                    {c.maxRedemptions !== null && (
                      <span className="text-muted-foreground"> / {c.maxRedemptions}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={status} />
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {c.description && <div>{c.description}</div>}
                    {expiry && <div className="text-[10px]">Expires {expiry}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {status === "active" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleDeactivate(c.id, c.code)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusChip({ status }: { status: "active" | "inactive" | "expired" | "exhausted" }) {
  const styles: Record<typeof status, string> = {
    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    inactive: "border-border/60 bg-card/40 text-muted-foreground",
    expired: "border-border/60 bg-card/40 text-muted-foreground",
    exhausted: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
