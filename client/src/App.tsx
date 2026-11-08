import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import congregationWorship from "./assets/congregation-worship.jpg";

type Bill = ApiResponse<typeof api, "listBills">["bills"][number];

const CATEGORIES = [
  "Electric",
  "Rent / Housing",
  "Water",
  "Gas / Heating",
  "Phone / Internet",
  "Medical",
  "Car / Insurance",
  "Groceries / Essentials",
  "Other",
] as const;

type StatusFilter = "all" | "needs" | "partial" | "funded" | "paid";

const STATUS_LABELS: Record<Bill["status"], string> = {
  needs: "Needs help",
  partial: "Partly helped",
  funded: "Fully funded",
  paid: "Paid & confirmed",
};

const FIELD =
  "mt-1 w-full rounded-[14px] border border-[var(--border)] bg-[#070d1f] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[#5b6b8f] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[rgb(34_211_238/0.35)]";
const BTN_PRIMARY =
  "rounded-full bg-[var(--accent)] px-5 py-2.5 font-display text-base font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_24px_rgb(34_211_238/0.35)] transition hover:brightness-110 disabled:opacity-60 active:translate-y-px";
const BTN_GHOST =
  "rounded-full border border-[var(--border)] bg-[rgb(255_255_255/0.04)] px-4 py-2.5 font-display text-base font-bold text-[var(--text)] backdrop-blur";

function statusPillClass(status: Bill["status"]): string {
  const tone =
    status === "needs"
      ? "bg-[var(--tone-needs-bg)] text-[var(--tone-needs-text)]"
      : status === "partial"
        ? "bg-[var(--tone-partial-bg)] text-[var(--tone-partial-text)]"
        : status === "funded"
          ? "bg-[var(--tone-funded-bg)] text-[var(--tone-funded-text)]"
          : "bg-[var(--tone-paid-bg)] text-[var(--tone-paid-text)]";
  return `inline-flex shrink-0 items-center rounded-full border border-white/10 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] ${tone}`;
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseDueDate(value: string): Date | null {
  const parts = value.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return null;
  return new Date(y, m - 1, d);
}

function dueInfo(dueDate: string): { label: string; urgent: boolean } {
  const due = parseDueDate(dueDate);
  if (!due) return { label: dueDate, urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const formatted = due.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffDays < 0) {
    const overdue = Math.abs(diffDays);
    return {
      label: overdue === 1 ? `Overdue by 1 day · due ${formatted}` : `Overdue by ${overdue} days · due ${formatted}`,
      urgent: true,
    };
  }
  if (diffDays === 0) return { label: `Due today · ${formatted}`, urgent: true };
  if (diffDays === 1) return { label: `Due tomorrow · ${formatted}`, urgent: true };
  if (diffDays <= 7) return { label: `Due in ${diffDays} days · ${formatted}`, urgent: true };
  return { label: `Due ${formatted}`, urgent: false };
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents) || cents < 100 || cents > 5_000_000) return null;
  return cents;
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}

type Me = { id: number; email: string; name: string; role: string } | null;

/** The signed-in account, shared across components via one cached query. */
function useMe(): { me: Me; isLoading: boolean } {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe({}),
  });
  return { me: query.data?.user ?? null, isLoading: query.isPending };
}

function AuthView({
  initialMode,
  onDone,
  onCancel,
}: {
  initialMode: "signin" | "signup";
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const auth = useMutation({
    mutationFn: async () => {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Add your first name.");
        return api.signUp({ email: email.trim(), name: name.trim(), password });
      }
      return api.signIn({ email: email.trim(), password });
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error ?? "Could not sign in. Try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
      onDone();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (password.length < 8) {
      setError("Your password needs at least 8 characters.");
      return;
    }
    auth.mutate();
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="faith-headline">
        <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight text-[var(--text)]">
          {mode === "signin" ? "Sign in" : "Create an account"}
        </h2>
        <p className="mt-2 text-base text-[var(--dim)]">
          {mode === "signin"
            ? "Sign in to post a bill, record a payment, or manage your bills."
            : "One account is all you need to post bills and record payments. Your password stays on this site — it is stored as a one-way hash, never as plain text."}
        </p>
      </div>

      <div role="group" aria-label="Sign in or create an account" className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-bold ${
              mode === m ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--dim)]"
            }`}
          >
            {m === "signin" ? "Sign in" : "Create an account"}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border-2 border-[var(--amber)] bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)]">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "signup" ? (
          <div>
            <label htmlFor="auth-name" className="block text-sm font-semibold text-[var(--text)]">
              Your first name
            </label>
            <input
              id="auth-name"
              aria-label="Your first name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="given-name"
              className={FIELD}
              placeholder="Alex"
            />
          </div>
        ) : null}
        <div>
          <label htmlFor="auth-email" className="block text-sm font-semibold text-[var(--text)]">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            autoComplete="email"
            className={FIELD}
            placeholder="you@example.org"
          />
        </div>
        <div>
          <label htmlFor="auth-password" className="block text-sm font-semibold text-[var(--text)]">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={FIELD}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className={BTN_GHOST}>
            Cancel
          </button>
          <button type="submit" disabled={auth.isPending} className={BTN_PRIMARY}>
            {auth.isPending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create my account"}
          </button>
        </div>
      </form>
    </div>
  );
}

const REPORT_REASONS = [
  "Spam",
  "Scam / fake bill",
  "Wrong amount",
  "Abusive content",
  "Other",
] as const;

function AdminView({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const [error, setError] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.listReports({}),
  });
  const usersQuery = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => api.listUsers({}),
  });

  const act = useMutation({
    mutationFn: (fn: () => Promise<{ ok: boolean; error?: string }>) => fn(),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error ?? "That did not work. Try again.");
        return;
      }
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    },
  });

  const reports = reportsQuery.data?.reports ?? [];
  const openReports = reports.filter((r) => r.status === "open");
  const resolvedReports = reports.filter((r) => r.status !== "open");
  const users = usersQuery.data?.users ?? [];

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="text-base font-bold text-[var(--accent)] underline underline-offset-4"
      >
        ← All bills
      </button>
      <div className="faith-headline">
        <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight text-[var(--text)]">
          Moderation
        </h2>
        <p className="mt-2 text-base text-[var(--dim)]">
          Reports from signed-in users, and the accounts on this site. Hiding
          a bill takes it off the board for everyone but admins.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border-2 border-[var(--amber)] bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)]">
          {error}
        </p>
      ) : null}

      <section aria-label="Bill reports" className="space-y-3">
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">
          Reports {openReports.length > 0 ? `(${openReports.length} open)` : ""}
        </h3>
        {reportsQuery.isPending ? (
          <p className="text-[var(--dim)]">Loading reports…</p>
        ) : reports.length === 0 ? (
          <p className="text-[var(--dim)]">No one has reported a bill.</p>
        ) : (
          <>
            {openReports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">
                      {report.billBiller} · {money(report.billAmountCents)}
                    </p>
                    <p className="text-sm text-[var(--dim)]">
                      {report.reason} — reported by {report.reporterName} ({report.reporterEmail})
                      {" · "}
                      {new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {report.billHidden ? " · Hidden from the board" : ""}
                    </p>
                    {report.note ? <p className="mt-1 text-sm text-[var(--text)]">{report.note}</p> : null}
                  </div>
                  <span className="bg-[var(--tone-partial-bg)] text-[var(--tone-partial-text)] inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold">
                    Open
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.billHidden ? (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() => act.mutate(() => api.unhideBill({ billId: report.billId }))}
                      className={BTN_GHOST}
                    >
                      Show bill again
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={() => act.mutate(() => api.hideBill({ billId: report.billId }))}
                      className={BTN_GHOST}
                    >
                      Hide bill
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={() => act.mutate(() => api.deleteBill({ id: report.billId }))}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-base font-semibold text-[var(--amber)]"
                  >
                    Remove bill
                  </button>
                  <button
                    type="button"
                    disabled={act.isPending}
                    onClick={() => act.mutate(() => api.resolveReport({ reportId: report.id, status: "resolved" }))}
                    className="text-sm font-semibold text-[var(--accent)] underline underline-offset-2"
                  >
                    Mark resolved
                  </button>
                </div>
              </div>
            ))}
            {resolvedReports.length > 0 ? (
              <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <summary className="cursor-pointer text-sm font-bold text-[var(--text)]">
                  Resolved reports ({resolvedReports.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {resolvedReports.map((report) => (
                    <div key={report.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-[var(--text)]">
                        {report.billBiller} · {report.reason} · {report.reporterName}
                      </span>
                      <button
                        type="button"
                        disabled={act.isPending}
                        onClick={() => act.mutate(() => api.resolveReport({ reportId: report.id, status: "open" }))}
                        className="font-semibold text-[var(--accent)] underline underline-offset-2"
                      >
                        Reopen
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </section>

      <section aria-label="Accounts" className="space-y-3">
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">
          Accounts ({users.length})
        </h3>
        {usersQuery.isPending ? (
          <p className="text-[var(--dim)]">Loading accounts…</p>
        ) : (
          users.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div>
                <p className="font-bold text-[var(--text)]">
                  {user.name} <span className="font-normal text-[var(--dim)]">({user.email})</span>
                </p>
                <p className="text-sm text-[var(--dim)]">
                  {user.role === "admin" ? "Admin" : "User"}
                  {user.blocked ? " · Blocked" : ""}
                  {" · Joined "}
                  {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              {user.id !== me?.id && user.role !== "admin" ? (
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate(() => api.blockUser({ userId: user.id, blocked: !user.blocked }))}
                  className={BTN_GHOST}
                >
                  {user.blocked ? "Unblock" : "Block"}
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function BillForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Bill;
  onCancel: () => void;
  onSaved: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const formKeyRef = useRef(newKey());
  const [displayName, setDisplayName] = useState(initial?.displayName ?? me?.name ?? "");
  const [biller, setBiller] = useState(initial?.biller ?? "");
  const [category, setCategory] = useState<string>(initial?.category ?? CATEGORIES[0] ?? "Other");
  const [amount, setAmount] = useState(
    initial ? centsToDollars(initial.amountCents) : "",
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [story, setStory] = useState(initial?.story ?? "");
  const [paymentUrl, setPaymentUrl] = useState(initial?.paymentUrl ?? "");
  const [paymentReference, setPaymentReference] = useState(
    initial?.paymentReference ?? "",
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removeProof, setRemoveProof] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const amountCents = dollarsToCents(amount);
      if (!displayName.trim()) throw new Error("Add a first name so donors know who they are helping.");
      if (!biller.trim()) throw new Error("Add the biller's name.");
      if (amountCents === null) throw new Error("Enter an amount between $1.00 and $50,000.00, with at most two decimal places.");
      if (!dueDate) throw new Error("Pick a due date.");
      const proofImageDataUrl = photoFile ? await readFileAsDataUrl(photoFile) : null;
      if (initial) {
        return api.updateBill({
          id: initial.id,
          displayName: displayName.trim(),
          biller: biller.trim(),
          category: category as (typeof CATEGORIES)[number],
          amountCents,
          dueDate,
          story: story.trim(),
          paymentUrl: paymentUrl.trim() || null,
          paymentReference: paymentReference.trim() || null,
          proofImageDataUrl,
          removeProof,
        });
      }
      return api.createBill({
        displayName: displayName.trim(),
        biller: biller.trim(),
        category: category as (typeof CATEGORIES)[number],
        amountCents,
        dueDate,
        story: story.trim(),
        paymentUrl: paymentUrl.trim() || null,
        paymentReference: paymentReference.trim() || null,
        proofImageDataUrl,
        formKey: formKeyRef.current,
      });
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setFormError(result.error ?? "The bill could not be saved. Try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
      if (result.id !== undefined) onSaved(result.id);
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "The bill could not be saved. Try again.");
    },
  });

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("Choose a photo file (JPG, PNG, WebP, or GIF).");
      return;
    }
    if (file.size > 6_000_000) {
      setFormError("That photo is over 6 MB. Choose a smaller one.");
      return;
    }
    setFormError(null);
    setPhotoFile(file);
    setRemoveProof(false);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="faith-headline">
        <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight text-[var(--text)]">
          {initial ? "Edit this bill" : "Post a bill"}
        </h2>
        <p className="mt-2 text-base text-[var(--dim)]">
          Only a first name shows. Never put a full account number, password,
          or address in any field.
        </p>
      </div>

      {formError ? (
        <p role="alert" className="rounded-xl border-2 border-[var(--amber)] bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)]">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="display-name" className="block text-sm font-semibold text-[var(--text)]">
            Your first name
          </label>
          <input
            id="display-name"
            aria-label="Your first name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            autoComplete="given-name"
            className={FIELD}
            placeholder="Alex"
          />
        </div>
        <div>
          <label htmlFor="biller" className="block text-sm font-semibold text-[var(--text)]">
            Biller
          </label>
          <input
            id="biller"
            aria-label="Biller"
            value={biller}
            onChange={(e) => setBiller(e.target.value)}
            maxLength={80}
            className={FIELD}
            placeholder="City electric company"
          />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-semibold text-[var(--text)]">
            Kind of bill
          </label>
          <select
            id="category"
            aria-label="Kind of bill"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={FIELD}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="amount" className="block text-sm font-semibold text-[var(--text)]">
            Amount due
          </label>
          <div className="relative mt-1">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dim)]">$</span>
            <input
              id="amount"
              aria-label="Amount due in dollars"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-7 pr-3 text-base text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label htmlFor="due-date" className="block text-sm font-semibold text-[var(--text)]">
            Due date
          </label>
          <input
            id="due-date"
            type="date"
            aria-label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      <div>
        <label htmlFor="story" className="block text-sm font-semibold text-[var(--text)]">
          What should donors know? <span className="font-normal text-[var(--dim)]">(optional)</span>
        </label>
        <textarea
          id="story"
          aria-label="What should donors know?"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          maxLength={600}
          rows={4}
          className={FIELD}
          placeholder="A sentence or two about the situation — no account numbers or addresses."
        />
        <p className="mt-1 text-right text-xs text-[var(--dim)]">{story.length}/600</p>
      </div>

      <div className="space-y-4 glass-panel rounded-2xl bg-[var(--surface)] p-4 shadow-[0_16px_36px_rgb(0_0_0/0.4)] sm:p-5">
        <div className="stained-bar" aria-hidden="true" />
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">How a donor pays this</h3>
        <p className="text-sm text-[var(--dim)]">
          Donors pay the biller directly, from the biller&apos;s own payment
          page. Add the link from your bill so they land in the right place.
        </p>
        <div>
          <label htmlFor="payment-url" className="block text-sm font-semibold text-[var(--text)]">
            Biller&apos;s guest payment link <span className="font-normal text-[var(--dim)]">(optional)</span>
          </label>
          <input
            id="payment-url"
            type="url"
            aria-label="Biller's guest payment link"
            value={paymentUrl}
            onChange={(e) => setPaymentUrl(e.target.value)}
            inputMode="url"
            placeholder="https://…"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="payment-reference" className="block text-sm font-semibold text-[var(--text)]">
            What the donor types at checkout <span className="font-normal text-[var(--dim)]">(optional)</span>
          </label>
          <input
            id="payment-reference"
            aria-label="What the donor types at checkout"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            maxLength={120}
            className={FIELD}
            placeholder="e.g. Account ending in 1234, or the name on the account"
          />
          <p className="mt-1 text-sm text-[var(--dim)]">
            Only what a donor needs to enter to pay the right account. Leave
            it blank if you are unsure.
          </p>
        </div>
      </div>

      <div className="space-y-2 glass-panel rounded-2xl bg-[var(--surface)] p-4 shadow-[0_16px_36px_rgb(0_0_0/0.4)] sm:p-5">
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Proof photo <span className="text-xl font-bold italic text-[var(--gold)]">(optional)</span></h3>
        <p className="text-sm text-[var(--dim)]">
          A photo of the bill helps donors trust it. Cover account numbers,
          barcodes, and your address before you photograph it.
        </p>
        {initial?.proofUrl && !photoPreview && !removeProof ? (
          <div className="space-y-2">
            <img src={initial.proofUrl} alt="Current proof photo for this bill" className="max-h-56 w-full rounded-xl object-contain bg-[var(--surface-alt)]" />
            <button
              type="button"
              onClick={() => setRemoveProof(true)}
              className="text-sm font-semibold text-[var(--amber)] underline underline-offset-2"
            >
              Remove this photo
            </button>
          </div>
        ) : null}
        {removeProof ? (
          <p className="text-sm text-[var(--text)]">
            The current photo will be removed when you save.
            <button type="button" onClick={() => setRemoveProof(false)} className="ml-2 font-semibold underline underline-offset-2">Keep it instead</button>
          </p>
        ) : null}
        {photoPreview ? (
          <img src={photoPreview} alt="Preview of the proof photo you chose" className="max-h-56 w-full rounded-xl object-contain bg-[var(--surface-alt)]" />
        ) : null}
        <label htmlFor="proof-photo" className="block text-sm font-semibold text-[var(--text)]">
          {photoPreview ? "Choose a different photo" : "Choose a photo of the bill"}
        </label>
        <input
          id="proof-photo"
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="block w-full text-sm text-[var(--text)]"
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Cancel
        </button>
        <button type="submit" disabled={save.isPending} className={BTN_PRIMARY}>
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Post this bill"}
        </button>
      </div>
    </form>
  );
}

function DonorFlow({ bill, onSignIn }: { bill: Bill; onSignIn: () => void }) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const pledgeKeyRef = useRef(newKey());
  const [amount, setAmount] = useState(centsToDollars(bill.remainingCents));
  const [donorName, setDonorName] = useState("");
  const [note, setNote] = useState("");
  const [paidDirectly, setPaidDirectly] = useState(false);
  const [linkOpened, setLinkOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const record = useMutation({
    mutationFn: () => {
      const cents = dollarsToCents(amount);
      if (cents === null) throw new Error("Enter an amount between $1.00 and the amount still needed.");
      if (cents > bill.remainingCents) throw new Error(`Only ${money(bill.remainingCents)} is still needed.`);
      if (!paidDirectly) throw new Error("Confirm you paid the biller directly before recording it.");
      return api.recordPayment({
        billId: bill.id,
        amountCents: cents,
        donorName: donorName.trim() || undefined,
        note: note.trim() || undefined,
        pledgeKey: pledgeKeyRef.current,
      });
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error ?? "The payment could not be recorded. Try again.");
        return;
      }
      pledgeKeyRef.current = newKey();
      setRecorded(true);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "The payment could not be recorded. Try again.");
    },
  });

  async function copyReference() {
    if (!bill.paymentReference) return;
    try {
      await navigator.clipboard.writeText(bill.paymentReference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy did not work on this device — type the reference from the box above.");
    }
  }

  if (bill.status === "paid") {
    return (
      <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)]">
        This bill is confirmed paid. Thank you to everyone who helped.
      </p>
    );
  }
  if (bill.remainingCents <= 0) {
    return (
      <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)]">
        This bill is fully funded from donor-reported payments. It is waiting
        for the poster to confirm the biller received it.
      </p>
    );
  }

  if (recorded) {
    return (
      <div role="status" className="rounded-2xl border border-[var(--green)] bg-[var(--surface)] p-4">
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Recorded — <span className="italic text-[var(--accent)]">thank you.</span></h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Your payment is shown as donor-reported until the poster confirms
          the biller received it. The money went straight to {bill.biller} —
          it never passed through this app.
        </p>
        <button
          type="button"
          onClick={() => {
            setRecorded(false);
            setPaidDirectly(false);
            setAmount(centsToDollars(bill.remainingCents));
          }}
          className="mt-3 text-sm font-semibold text-[var(--accent)] underline underline-offset-2"
        >
          Record another payment for this bill
        </button>
      </div>
    );
  }

  const quickAmounts = [2500, 5000, 10000].filter((c) => c < bill.remainingCents);

  return (
    <section aria-label="Help pay this bill" className="glass-panel rounded-2xl bg-[var(--surface)] p-4 shadow-[0_16px_36px_rgb(0_0_0/0.4)] sm:p-5">
      <div className="stained-bar" aria-hidden="true" />
      <h3 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-[var(--text)]">Help pay <span className="font-bold italic text-[var(--accent)]">this bill</span></h3>
      <ol className="mt-4 space-y-5 text-sm text-[var(--text)]">
        <li className="flex gap-3">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-extrabold text-[var(--accent-ink)]">1</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Choose how much you will pay</p>
            <p className="text-[var(--dim)]">Any part helps. {money(bill.remainingCents)} is still needed.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {quickAmounts.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAmount(centsToDollars(c))}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-semibold"
                >
                  {money(c)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmount(centsToDollars(bill.remainingCents))}
                className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-semibold"
              >
                All {money(bill.remainingCents)}
              </button>
            </div>
            <label htmlFor="donor-amount" className="mt-3 block text-sm font-semibold">
              Amount you will pay
            </label>
            <div className="relative mt-1 max-w-56">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dim)]">$</span>
              <input
                id="donor-amount"
                aria-label="Amount you will pay in dollars"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-7 pr-3 text-base focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-extrabold text-[var(--accent-ink)]">2</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Pay {bill.biller} directly</p>
            {bill.paymentUrl ? (
              <>
                <p className="text-[var(--dim)]">
                  This opens the biller&apos;s own payment page in a new tab.
                  Pay there, then come back here.
                </p>
                <a
                  href={bill.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setLinkOpened(true)}
                  className="mt-2 inline-block rounded-full bg-[var(--accent)] px-5 py-2.5 font-display text-base font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_24px_rgb(34_211_238/0.35)]"
                >
                  Go to {bill.biller}&apos;s payment page
                </a>
                {linkOpened ? (
                  <p className="mt-2 text-[var(--dim)]">Payment page opened. When you have paid, finish step 3 below.</p>
                ) : null}
              </>
            ) : (
              <p className="text-[var(--dim)]">
                No payment link was added for this bill. Pay through the
                biller&apos;s own website or app, then come back and finish step 3.
              </p>
            )}
            {bill.paymentReference ? (
              <div className="mt-3 rounded-xl bg-[var(--surface-alt)] p-3">
                <p className="text-sm font-bold">Enter this when you pay</p>
                <p className="mt-1 break-words text-base">{bill.paymentReference}</p>
                <button
                  type="button"
                  onClick={copyReference}
                  className="mt-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold"
                >
                  {copied ? "Copied" : "Copy reference"}
                </button>
              </div>
            ) : null}
          </div>
        </li>
        <li className="flex gap-3">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-extrabold text-[var(--accent-ink)]">3</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Record what you paid</p>
            <p className="text-[var(--dim)]">
              This only updates the progress shown here. It is donor-reported
              until the poster confirms it.
            </p>
            {me ? (
            <div className="mt-2 space-y-3">
              <div>
                <label htmlFor="donor-name" className="block text-sm font-semibold">
                  Your first name <span className="font-normal text-[var(--dim)]">(optional — shows as “Anonymous helper” if blank)</span>
                </label>
                <input
                  id="donor-name"
                  aria-label="Your first name, optional"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  maxLength={40}
                  className="mt-1 w-full max-w-80 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="donor-note" className="block text-sm font-semibold">
                  Note for the poster <span className="font-normal text-[var(--dim)]">(optional)</span>
                </label>
                <input
                  id="donor-note"
                  aria-label="Note for the poster, optional"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base focus:border-[var(--accent)] focus:outline-none"
                  placeholder="e.g. Paid the electric company this morning"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`I paid ${bill.biller} directly, not through this app and not to the poster`}
                  checked={paidDirectly}
                  onChange={(e) => setPaidDirectly(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  I paid {bill.biller} directly — not through this app, and not
                  to the person who posted this bill.
                </span>
              </label>
            </div>
            ) : (
            <div className="mt-2 rounded-xl bg-[var(--surface-alt)] p-3">
              <p className="text-sm">
                Sign in to record what you paid — it keeps payments tied to
                real accounts, so the poster knows who helped.
              </p>
              <button
                type="button"
                onClick={onSignIn}
                className="mt-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)]"
              >
                Sign in or create an account
              </button>
            </div>
            )}
          </div>
        </li>
      </ol>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl border-2 border-[var(--amber)] bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
      {me ? (
      <button
        type="button"
        disabled={record.isPending}
        onClick={() => {
          setError(null);
          record.mutate();
        }}
        className="mt-5 w-full rounded-full bg-[var(--accent)] px-4 py-3 font-display text-base font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_24px_rgb(34_211_238/0.35)] disabled:opacity-60 sm:w-auto"
      >
        {record.isPending ? "Recording…" : "Record that I paid"}
      </button>
      ) : null}
    </section>
  );
}

function BillDetail({
  bill,
  onBack,
  onEdit,
  onDeleted,
  onSignIn,
}: {
  bill: Bill;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onSignIn: () => void;
}) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0] ?? "Spam");
  const [reportNote, setReportNote] = useState("");
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const info = dueInfo(bill.dueDate);
  const percent = bill.amountCents > 0 ? Math.min(100, Math.round((bill.reportedCents / bill.amountCents) * 100)) : 0;

  const confirmPledge = useMutation({
    mutationFn: (args: { pledgeId: number; confirmed: boolean }) =>
      api.setPledgeConfirmed(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bills"] }),
  });
  const setPaid = useMutation({
    mutationFn: (paid: boolean) => api.setBillPaid({ billId: bill.id, paid }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bills"] }),
  });
  const report = useMutation({
    mutationFn: () =>
      api.reportBill({
        billId: bill.id,
        reason: reportReason as (typeof REPORT_REASONS)[number],
        note: reportNote.trim() || undefined,
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setReportError(result.error ?? "The report could not be sent. Try again.");
        return;
      }
      setReported(true);
      setReporting(false);
    },
    onError: (err) => {
      setReportError(err instanceof Error ? err.message : "The report could not be sent. Try again.");
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteBill({ id: bill.id }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setActionError(result.error ?? "The bill could not be deleted.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
      onDeleted();
    },
    onError: () => setActionError("The bill could not be deleted. Try again."),
  });

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-base font-bold text-[var(--accent)] underline underline-offset-4"
      >
        ← All bills
      </button>

      <div className="faith-headline">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
          {bill.category} · Posted by {bill.displayName}
        </p>
        <h2 className="mt-2 font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-[var(--text)] sm:text-6xl">{bill.biller}</h2>
        <p className={`mt-1 text-sm font-semibold ${info.urgent ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}>
          {info.label}
        </p>
        <span className={`${statusPillClass(bill.status)} mt-3`}>
          {STATUS_LABELS[bill.status]}
        </span>
      </div>

      <div className="glass-panel rounded-[22px] p-5 text-[var(--panel-text)] shadow-[0_18px_40px_rgb(0_0_0/0.45)]">
        <p className="font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums text-[var(--panel-gold)]">
          {bill.status === "paid" ? money(bill.amountCents) : money(bill.remainingCents)}
        </p>
        <p className="mt-1 text-sm text-[var(--panel-dim)]">
          {bill.status === "paid"
            ? `paid, of ${money(bill.amountCents)} total`
            : `still needed, of ${money(bill.amountCents)} total · ${money(bill.reportedCents)} reported paid`}
        </p>
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of this bill reported paid"
          className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--panel-track)]"
        >
          <div className="progress-fill h-full rounded-full" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-sm font-semibold text-[var(--panel-dim)]">
          {percent}% funded · {bill.helperCount} {bill.helperCount === 1 ? "helper" : "helpers"}
        </p>
      </div>

      {bill.story ? (
        <div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Why help is needed</h3>
          <p className="story-dropcap mt-2 whitespace-pre-wrap text-lg leading-relaxed text-[var(--text)]">{bill.story}</p>
        </div>
      ) : null}

      {bill.proofUrl ? (
        <div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Proof photo</h3>
          <img
            src={bill.proofUrl}
            alt="Proof photo attached to this bill"
            className="mt-2 max-h-96 w-full rounded-2xl border border-[var(--border)] object-contain bg-[var(--surface)]"
          />
          <p className="mt-1 text-sm text-[var(--dim)]">
            Posted by {bill.displayName}. Check that account numbers are covered before trusting it.
          </p>
        </div>
      ) : null}

      <DonorFlow bill={bill} onSignIn={onSignIn} />

      {bill.pledges.length > 0 ? (
        <section aria-label="Reported payments" className="space-y-2">
          <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Reported payments</h3>
          <p className="text-sm text-[var(--dim)]">
            These are what donors say they paid. The poster confirms each one.
          </p>
          {bill.pledges.map((pledge) => (
            <div key={pledge.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-3xl font-extrabold tracking-tight tabular-nums text-[var(--text)]">{money(pledge.amountCents)}</p>
                  <p className="text-sm text-[var(--dim)]">
                    {pledge.donorName || "Anonymous helper"} ·{" "}
                    {new Date(pledge.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  {pledge.note ? <p className="mt-1 text-sm text-[var(--text)]">{pledge.note}</p> : null}
                </div>
                <span className={pledge.confirmed ? "bg-[var(--tone-funded-bg)] text-[var(--tone-funded-text)] inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold" : "bg-[var(--tone-partial-bg)] text-[var(--tone-partial-text)] inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold"}>
                  {pledge.confirmed ? "Confirmed" : "Awaiting confirmation"}
                </span>
              </div>
              <button
                type="button"
                disabled={confirmPledge.isPending}
                onClick={() =>
                  confirmPledge.mutate({ pledgeId: pledge.id, confirmed: !pledge.confirmed })
                }
                className="mt-2 text-sm font-semibold text-[var(--accent)] underline underline-offset-2 disabled:opacity-60"
              >
                {pledge.confirmed ? "Undo confirmation" : "Confirm the biller received this"}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {bill.canManage ? (
      <section aria-label="Poster actions" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_16px_36px_rgb(0_0_0/0.4)] sm:p-5">
        <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">For the person who posted this</h3>
        {actionError ? (
          <p role="alert" className="mt-2 text-sm font-medium text-[var(--amber)]">{actionError}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPaid.mutate(!bill.paidConfirmed)}
            disabled={setPaid.isPending}
            className={BTN_PRIMARY}
          >
            {bill.paidConfirmed ? "Reopen this bill" : "Mark as paid & confirmed"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={BTN_GHOST}
          >
            Edit bill
          </button>
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-base font-semibold text-[var(--amber)]"
            >
              Delete bill
            </button>
          ) : null}
        </div>
        {confirmingDelete ? (
          <div className="mt-3 rounded-xl bg-[var(--surface-alt)] p-3">
            <p className="text-sm text-[var(--text)]">
              Delete this bill? Its reported payments will be removed too.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="rounded-full bg-[var(--amber)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {remove.isPending ? "Deleting…" : "Yes, delete it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {me && !bill.mine ? (
        <section aria-label="Report this bill" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h3 className="font-display text-2xl font-extrabold tracking-tight text-[var(--text)]">Something wrong with this bill?</h3>
          {reported ? (
            <p className="mt-2 text-sm text-[var(--dim)]">
              Thanks — an admin will review this bill.
            </p>
          ) : reporting ? (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="report-reason" className="block text-sm font-semibold text-[var(--text)]">
                  What&apos;s wrong?
                </label>
                <select
                  id="report-reason"
                  aria-label="What is wrong with this bill?"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className={FIELD}
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="report-note" className="block text-sm font-semibold text-[var(--text)]">
                  Anything to add? <span className="font-normal text-[var(--dim)]">(optional)</span>
                </label>
                <input
                  id="report-note"
                  aria-label="Anything to add?"
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  maxLength={200}
                  className={FIELD}
                  placeholder="A sentence about what you noticed"
                />
              </div>
              {reportError ? (
                <p role="alert" className="text-sm font-medium text-[var(--amber)]">{reportError}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={report.isPending}
                  onClick={() => {
                    setReportError(null);
                    report.mutate();
                  }}
                  className={BTN_PRIMARY}
                >
                  {report.isPending ? "Sending…" : "Send report"}
                </button>
                <button type="button" onClick={() => setReporting(false)} className={BTN_GHOST}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="mt-2 text-sm font-semibold text-[var(--amber)] underline underline-offset-2"
            >
              Report this bill to an admin
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function BillCard({ bill, onOpen }: { bill: Bill; onOpen: () => void }) {
  const info = dueInfo(bill.dueDate);
  const percent = bill.amountCents > 0 ? Math.min(100, Math.round((bill.reportedCents / bill.amountCents) * 100)) : 0;
  return (
    <article className="glass-panel overflow-hidden rounded-[24px] shadow-[0_18px_40px_rgb(0_0_0/0.45)] transition hover:border-[rgb(34_211_238/0.45)]">
      <div className="stained-bar rounded-none" aria-hidden="true" />
      <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--gold)]">
          {bill.category} · {bill.displayName}
        </p>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {bill.hidden ? (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-[var(--tone-needs-bg)] px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--tone-needs-text)]">
              Hidden
            </span>
          ) : null}
          <span className={statusPillClass(bill.status)}>
            {STATUS_LABELS[bill.status]}
          </span>
        </span>
      </div>
      <h3 className="mt-1.5 font-display text-3xl font-extrabold leading-none tracking-tight text-[var(--text)]">{bill.biller}</h3>
      <p className={`mt-0.5 text-sm font-semibold ${info.urgent ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}>
        {info.label}
      </p>
      {bill.story ? <p className="mt-2 line-clamp-3 text-base text-[var(--text)]">{bill.story}</p> : null}
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <p className="font-display text-5xl font-extrabold leading-none tracking-tight tabular-nums text-[var(--accent)]">
          {bill.status === "paid" ? money(bill.amountCents) : money(bill.remainingCents)}
        </p>
        <p className="text-sm font-medium text-[var(--dim)]">
          {bill.status === "paid" ? "paid" : `still needed of ${money(bill.amountCents)}`}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Share of ${bill.biller} bill reported paid`}
        className="mt-3 h-3.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"
      >
        <div className="progress-fill h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-sm text-[var(--dim)]">
        {money(bill.reportedCents)} reported paid · {bill.helperCount} {bill.helperCount === 1 ? "helper" : "helpers"}
        {bill.proofUrl ? " · Proof photo attached" : ""}
      </p>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View and help pay the ${bill.biller} bill for ${money(bill.remainingCents)}`}
        className="mt-4 w-full rounded-full bg-[var(--accent)] px-5 py-3 font-display text-base font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_24px_rgb(34_211_238/0.35)] sm:w-auto"
      >
        View &amp; help pay →
      </button>
      </div>
    </article>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const [view, setView] = useState<
    | { name: "browse" }
    | { name: "post" }
    | { name: "detail"; id: number }
    | { name: "edit"; id: number }
    | { name: "auth" }
    | { name: "admin" }
  >({ name: "browse" });
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [afterAuth, setAfterAuth] = useState<
    | { name: "browse" }
    | { name: "post" }
    | { name: "detail"; id: number }
  >({ name: "browse" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("All categories");

  const signOut = useMutation({
    mutationFn: () => api.signOut({}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["bills"] });
      setView({ name: "browse" });
    },
  });

  function goAuth(mode: "signin" | "signup", after: typeof afterAuth) {
    setAuthMode(mode);
    setAfterAuth(after);
    setView({ name: "auth" });
  }

  function goPost() {
    if (me) {
      setView({ name: "post" });
    } else {
      goAuth("signup", { name: "post" });
    }
  }

  const billsQuery = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.listBills({}),
  });

  const bills = useMemo(() => billsQuery.data?.bills ?? [], [billsQuery.data]);
  const selectedBill = view.name === "detail" || view.name === "edit"
    ? bills.find((b) => b.id === view.id)
    : undefined;

  const filtered = useMemo(() => {
    return bills.filter((bill) => {
      if (statusFilter !== "all" && bill.status !== statusFilter) return false;
      if (categoryFilter !== "All categories" && bill.category !== categoryFilter) return false;
      return true;
    });
  }, [bills, statusFilter, categoryFilter]);

  const openCount = bills.filter((b) => b.status === "needs" || b.status === "partial").length;
  const openTotal = bills
    .filter((b) => b.status === "needs" || b.status === "partial")
    .reduce((sum, b) => sum + b.remainingCents, 0);

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[var(--bg)]" />
        <div className="future-grid absolute inset-0 opacity-70" />
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-[rgb(34_211_238/0.13)] blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-[rgb(124_58_237/0.12)] blur-3xl" />
      </div>
      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-10 pt-8 sm:pt-10">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          {me ? (
            <>
              <span className="text-sm text-[var(--dim)]">
                Signed in as <span className="font-bold text-[var(--text)]">{me.name}</span>
              </span>
              {me.role === "admin" ? (
                <button
                  type="button"
                  onClick={() => setView({ name: "admin" })}
                  className={BTN_GHOST}
                >
                  Moderation
                </button>
              ) : null}
              <button
                type="button"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
                className={BTN_GHOST}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => goAuth("signin", { name: "browse" })}
                className={BTN_GHOST}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => goAuth("signup", { name: "browse" })}
                className={BTN_PRIMARY}
              >
                Create an account
              </button>
            </>
          )}
        </div>
        {view.name === "auth" ? (
          <AuthView
            initialMode={authMode}
            onDone={() => setView(afterAuth)}
            onCancel={() => setView({ name: "browse" })}
          />
        ) : view.name === "admin" ? (
          <AdminView onBack={() => setView({ name: "browse" })} />
        ) : view.name === "post" ? (
          <BillForm
            onCancel={() => setView({ name: "browse" })}
            onSaved={(id) => setView({ name: "detail", id })}
          />
        ) : view.name === "edit" && selectedBill ? (
          <BillForm
            initial={selectedBill}
            onCancel={() => setView({ name: "detail", id: selectedBill.id })}
            onSaved={(id) => setView({ name: "detail", id })}
          />
        ) : view.name === "detail" && selectedBill ? (
          <BillDetail
            key={selectedBill.id}
            bill={selectedBill}
            onBack={() => setView({ name: "browse" })}
            onEdit={() => setView({ name: "edit", id: selectedBill.id })}
            onDeleted={() => setView({ name: "browse" })}
            onSignIn={() => goAuth("signin", { name: "detail", id: selectedBill.id })}
          />
        ) : (
          <>
            <section className="relative overflow-hidden rounded-[28px] border border-[rgb(34_211_238/0.35)] bg-[#070d1f] shadow-[0_24px_60px_rgb(0_0_0/0.55),0_0_40px_rgb(34_211_238/0.12)]">
              <img
                src={congregationWorship}
                alt="A diverse congregation worshipping together in a church, hands raised"
                className="absolute inset-0 h-full w-full object-cover object-[50%_28%] opacity-70"
              />
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[rgb(4_7_15/0.5)] via-[rgb(4_7_15/0.62)] to-[#04070f]" />
              <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(100deg,rgb(34_211_238/0.18),transparent_45%,rgb(124_58_237/0.22))]" />
              <div className="relative p-5 sm:p-8">
                <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200">
                  <span aria-hidden="true" className="live-dot" />
                  We are all God&rsquo;s children · Neighbors helping neighbors
                </p>
                <h1 className="mt-4 font-display text-[44px] font-extrabold leading-[0.95] tracking-tight text-white sm:text-6xl">
                  Help goes
                  <span className="block">straight</span>
                  <span className="block text-[var(--accent)]">to the bill.</span>
                </h1>
                <p className="mt-3 max-w-xl text-lg leading-snug text-[#dbe6ff]">
                  Donors pay the biller directly. This app never takes money,
                  and a bill only counts as paid when the poster confirms it.
                </p>
                <p className="mt-2 max-w-xl text-base leading-snug text-cyan-100">
                  Be nice and respectful — everyone here is going through
                  something. Treat people the way you&rsquo;d want to be
                  treated.
                </p>
                <button
                  type="button"
                  onClick={goPost}
                  className="mt-5 rounded-full bg-[var(--accent)] px-7 py-3.5 font-display text-lg font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_28px_rgb(34_211_238/0.45)] transition hover:brightness-110 active:translate-y-px"
                >
                  Post a bill →
                </button>
              </div>
              <div className="relative flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 bg-[rgb(4_7_15/0.72)] px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#9aa9cc] backdrop-blur sm:px-8">
                <span>01 · Pay the biller direct</span>
                <span>02 · Poster confirms</span>
                <span>03 · $0 through this app</span>
              </div>
            </section>

            {bills.length > 0 ? (
              <div className="glass-panel mt-6 flex flex-wrap gap-x-10 gap-y-3 rounded-[22px] px-5 py-4 text-[var(--panel-text)] shadow-[0_18px_40px_rgb(0_0_0/0.45)]">
                <div>
                  <p className="font-display text-4xl font-extrabold tracking-tight tabular-nums text-[var(--panel-gold)]">{openCount}</p>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--panel-dim)]">{openCount === 1 ? "bill" : "bills"} still needing help</p>
                </div>
                <div>
                  <p className="font-display text-4xl font-extrabold tracking-tight tabular-nums text-[var(--panel-gold)]">{money(openTotal)}</p>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--panel-dim)]">still needed in total</p>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filter bills by status" className="flex flex-wrap gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
                {(
                  [
                    ["all", "All"],
                    ["needs", "Needs help"],
                    ["partial", "Partly helped"],
                    ["funded", "Fully funded"],
                    ["paid", "Paid & confirmed"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                    className={`rounded-full px-3 py-1.5 text-sm font-bold ${
                      statusFilter === value
                        ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                        : "text-[var(--dim)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                id="category-filter"
                aria-label="Filter by kind of bill"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)]"
              >
                <option>All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["bills"] })}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold"
              >
                Refresh
              </button>
            </div>

            {billsQuery.isPending ? (
              <p className="py-10 text-center text-[var(--dim)]">Loading bills…</p>
            ) : billsQuery.isError ? (
              <div className="py-10 text-center">
                <p className="text-[var(--text)]">The bills could not be loaded.</p>
                <button
                  type="button"
                  onClick={() => billsQuery.refetch()}
                  className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2.5 text-base font-bold text-[var(--accent-ink)]"
                >
                  Try again
                </button>
              </div>
            ) : bills.length === 0 ? (
              <section className="glass-panel mt-6 overflow-hidden rounded-[24px] shadow-[0_18px_40px_rgb(0_0_0/0.45)]">
                <div className="stained-bar rounded-none" aria-hidden="true" />
                <div className="p-5 sm:p-6">
                <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight">No bills <span className="italic text-[var(--accent)]">posted yet.</span></h2>
                <p className="mt-2 text-lg text-[var(--dim)]">
                  Try the whole flow with a bill of your own:
                </p>
                <ol className="mt-4 space-y-3 text-base">
                  {[
                    "Post a bill — biller, amount, due date, and the biller's payment link.",
                    "Open it as a donor, go to the biller's page, and pay there.",
                    "Come back, record what you paid, and confirm it as the poster.",
                  ].map((step, i) => (
                    <li key={step} className="flex gap-3">
                      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-extrabold text-[var(--accent-ink)]">{i + 1}</span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={goPost}
                  className="mt-5 rounded-full bg-[var(--accent)] px-6 py-3 font-display text-base font-extrabold tracking-wide text-[var(--accent-ink)] shadow-[0_0_24px_rgb(34_211_238/0.35)]"
                >
                  Post the first bill
                </button>
                </div>
              </section>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[var(--text)]">Nothing matches those filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setCategoryFilter("All categories");
                  }}
                  className="mt-3 text-base font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {filtered.map((bill) => (
                  <BillCard
                    key={bill.id}
                    bill={bill}
                    onOpen={() => setView({ name: "detail", id: bill.id })}
                  />
                ))}
              </div>
            )}

            <p className="mt-8 border-t-2 border-[var(--border)] pt-4 text-sm text-[var(--dim)]">
              Anyone can browse these bills. Sign in to post a bill or record
              a payment. Amounts marked “reported paid” are what donors say
              they paid — the poster&apos;s confirmation is what marks a bill
              paid.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
