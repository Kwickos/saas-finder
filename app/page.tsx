"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  buildDevPrompt,
  distinctSubredditsFromThreads,
} from "@/lib/build-prompt";
import type {
  AnalyzeIdeasResponse,
  RedditPost,
  SaasIdea,
} from "@/lib/types";

const STORAGE_KEY = "saas-finder:subreddits";
const MAX_SUBS = 5;

type Preset = { name: string; subs: string[] };

const PRESETS: Preset[] = [
  {
    name: "SaaS founders",
    subs: ["saas", "smallbusiness", "Entrepreneur", "indiehackers"],
  },
  {
    name: "Freelancers",
    subs: ["freelance", "forhire", "freelanceWriters"],
  },
  {
    name: "Marketing & growth",
    subs: ["marketing", "digital_marketing", "advertising"],
  },
  {
    name: "Devs & makers",
    subs: ["webdev", "reactjs", "Frontend", "SideProject"],
  },
];

type Verdict = SaasIdea["verdict"];
type Demand = SaasIdea["demand_level"];
type SortKey = "score-desc" | "score-asc" | "recurrence-desc" | "name";

const VERDICT_OPTIONS: Array<Verdict | "All"> = [
  "All",
  "Strong",
  "Decent",
  "Weak",
];
function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizeSub(value: string): string {
  return value
    .trim()
    .replace(/^\/?r\//i, "")
    .replace(/[^A-Za-z0-9_]/g, "");
}

function scoreBadge(score: number) {
  if (score >= 8) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (score >= 5) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function verdictTone(verdict: Verdict) {
  if (verdict === "Strong") return "bg-emerald-100 text-emerald-800";
  if (verdict === "Decent") return "bg-amber-100 text-amber-800";
  return "bg-zinc-100 text-zinc-600";
}

function demandTone(demand: Demand) {
  if (demand === "High") return "bg-zinc-900 text-white";
  if (demand === "Medium") return "bg-zinc-200 text-zinc-700";
  return "bg-zinc-100 text-zinc-500";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-zinc-500">{children}</p>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={classNames(
        "transition-transform duration-200 text-zinc-500",
        open && "rotate-180",
      )}
      aria-hidden
    >
      <path
        d="M3 5.5l4 3 4-3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScoreChip({ score }: { score: number }) {
  return (
    <span
      className={classNames(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums ring-1 ring-inset",
        scoreBadge(score),
      )}
      aria-label={`Score ${score} out of 10`}
    >
      {score}
    </span>
  );
}

function RecurrenceBadge({ count }: { count: number }) {
  const tone =
    count >= 4
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : count >= 2
        ? "bg-zinc-100 text-zinc-700 ring-zinc-200"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tone,
      )}
      title={`Mentioned across ${count} Reddit thread${count === 1 ? "" : "s"}`}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3.5 4.5h7a3 3 0 010 6h-1m-5.5-6L6 2.5m-2.5 2L6 6.5M12.5 11.5h-7a3 3 0 010-6h1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {count} thread{count === 1 ? "" : "s"}
    </span>
  );
}

function CrossSubBadge({ subs }: { subs: string[] }) {
  if (subs.length < 2) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-inset ring-violet-200"
      title={`Pain point appears across r/${subs.join(", r/")}`}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M5 3a3 3 0 100 6 3 3 0 000-6zM11 7a3 3 0 100 6 3 3 0 000-6z"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
      Cross-sub · {subs.length}
    </span>
  );
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-sm leading-6 text-zinc-800">{value}</p>
    </div>
  );
}

function IdeaDetail({
  idea,
  onBuildPrompt,
}: {
  idea: SaasIdea;
  onBuildPrompt: () => void;
}) {
  return (
    <div className="space-y-5 pb-6 pl-12 pr-2 pt-1 text-sm leading-7 text-zinc-700">
      <p className="text-[15px] leading-7 text-zinc-800">{idea.opportunity}</p>

      {idea.user_complaints.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">
            What users complain about
          </p>
          <ul className="ml-4 list-disc space-y-0.5 marker:text-zinc-300">
            {idea.user_complaints.map((c, i) => (
              <li key={`${i}-${c.slice(0, 20)}`}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {idea.existing_solutions.length > 0 ||
      idea.similar_competitors.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {idea.existing_solutions.length > 0 ? (
            <p className="text-zinc-800">
              <span className="text-zinc-500">Existing solutions — </span>
              {idea.existing_solutions.join(", ")}
            </p>
          ) : null}
          {idea.similar_competitors.length > 0 ? (
            <p className="text-zinc-800">
              <span className="text-zinc-500">Competitors — </span>
              {idea.similar_competitors.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <MiniMeta label="Monetization" value={idea.monetization_model} />
        <MiniMeta label="Pricing" value={idea.pricing_hint} />
        <MiniMeta label="Revenue ceiling" value={idea.revenue_potential} />
      </div>

      <MiniMeta label="Go to market" value={idea.go_to_market} />

      {idea.source_threads.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">
            {idea.source_threads.length} source thread
            {idea.source_threads.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-0.5">
            {idea.source_threads.map((thread, index) => {
              const sub = thread.thread_url.match(/\/r\/([^/]+)/i)?.[1];
              return (
                <li key={`${thread.thread_url}-${index}`}>
                  <a
                    href={thread.thread_url}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-2 text-zinc-700 transition hover:text-zinc-900"
                  >
                    {sub ? (
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-700">
                        r/{sub}
                      </span>
                    ) : null}
                    <span className="line-clamp-1 underline decoration-zinc-200 underline-offset-2 group-hover:decoration-zinc-500">
                      {thread.title}
                    </span>
                    <span className="text-zinc-400 group-hover:text-zinc-600">
                      ↗
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onBuildPrompt}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 2v3m0 6v3m6-6h-3M5 8H2m9.5-4.5L9 6m-2 4l-2.5 2.5m7-7L9.5 5.5m-3 5L4 13"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          Build prompt
        </button>
      </div>
    </div>
  );
}

function IdeaRow({
  idea,
  expanded,
  onToggle,
  onBuildPrompt,
}: {
  idea: SaasIdea;
  expanded: boolean;
  onToggle: () => void;
  onBuildPrompt: () => void;
}) {
  const distinctSubs = useMemo(
    () => distinctSubredditsFromThreads(idea.source_threads),
    [idea.source_threads],
  );

  return (
    <li className={expanded ? "bg-zinc-50/60" : ""}>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-start gap-4 px-2 py-4 text-left transition hover:bg-zinc-50/80"
        aria-expanded={expanded}
      >
        <ScoreChip score={idea.score} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate text-[15px] font-semibold leading-6 text-zinc-900">
              {idea.idea_name}
            </h3>
            <span className="shrink-0 pt-0.5">
              <ChevronIcon open={expanded} />
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm leading-6 text-zinc-600">
            {idea.problem}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RecurrenceBadge count={idea.source_threads.length} />
            <span
              className={classNames(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                demandTone(idea.demand_level),
              )}
            >
              {idea.demand_level} demand
            </span>
            <CrossSubBadge subs={distinctSubs} />
            <span
              className={classNames(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                verdictTone(idea.verdict),
              )}
            >
              {idea.verdict}
            </span>
          </div>
        </div>
      </button>

      {expanded ? (
        <IdeaDetail idea={idea} onBuildPrompt={onBuildPrompt} />
      ) : null}
    </li>
  );
}

function ThreadRow({ post }: { post: RedditPost }) {
  return (
    <details className="group rounded-lg border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-800 marker:hidden [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
            r/{post.subreddit}
          </span>
          <span className="line-clamp-1">{post.title}</span>
        </div>
        <span className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            {post.comments.length} comment
            {post.comments.length === 1 ? "" : "s"}
          </span>
          <a
            href={post.threadUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Open
          </a>
        </span>
      </summary>
      {post.comments.length > 0 ? (
        <div className="space-y-2 border-t border-zinc-100 px-4 py-3">
          {post.comments.map((comment, idx) => (
            <p
              key={`${post.permalink}-${idx}`}
              className="rounded-md bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700"
            >
              {comment}
            </p>
          ))}
        </div>
      ) : (
        <p className="border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
          No comments extracted.
        </p>
      )}
    </details>
  );
}

function IdeaSkeleton() {
  return (
    <li className="px-2 py-4">
      <div className="flex items-start gap-4">
        <div className="h-7 w-7 rounded-md skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded skeleton" />
          <div className="h-3 w-full rounded skeleton" />
          <div className="h-3 w-5/6 rounded skeleton" />
          <div className="flex gap-2 pt-1">
            <div className="h-5 w-20 rounded skeleton" />
            <div className="h-5 w-16 rounded skeleton" />
          </div>
        </div>
      </div>
    </li>
  );
}

function SubredditChipsField({
  values,
  onChange,
  onSubmit,
  autoFocus = false,
  size = "md",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  size?: "sm" | "md";
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function add(raw: string) {
    const cleaned = normalizeSub(raw);
    if (!cleaned) return;
    if (values.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      setDraft("");
      return;
    }
    if (values.length >= MAX_SUBS) return;
    onChange([...values, cleaned]);
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft.trim()) {
        add(draft);
      } else if (values.length > 0 && onSubmit) {
        onSubmit();
      }
    } else if (e.key === "," || e.key === " " || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        add(draft);
      }
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const tokens = pasted.split(/[\s,]+/).filter(Boolean);
    if (tokens.length > 1) {
      e.preventDefault();
      const next = [...values];
      for (const tok of tokens) {
        const cleaned = normalizeSub(tok);
        if (
          cleaned &&
          !next.some((v) => v.toLowerCase() === cleaned.toLowerCase()) &&
          next.length < MAX_SUBS
        ) {
          next.push(cleaned);
        }
      }
      onChange(next);
      setDraft("");
    }
  }

  const canAdd = values.length < MAX_SUBS;
  const inputPlaceholder =
    values.length === 0
      ? "Type a subreddit and press Enter…"
      : canAdd
        ? "+ add another"
        : `Max ${MAX_SUBS} subreddits`;

  return (
    <div
      className={classNames(
        "flex flex-1 flex-wrap items-center gap-1.5 rounded-xl border bg-white transition",
        "border-zinc-200 focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900/10",
        size === "sm" ? "px-2 py-1.5" : "px-3 py-2",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((sub) => (
        <span
          key={sub}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 py-1 pl-2 pr-1 text-sm font-medium text-zinc-800"
        >
          <span className="text-zinc-400">r/</span>
          {sub}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(sub);
            }}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
            aria-label={`Remove r/${sub}`}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path
                d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onInputKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={inputPlaceholder}
        autoComplete="off"
        spellCheck={false}
        disabled={!canAdd && draft.length === 0}
        className={classNames(
          "min-w-[140px] flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:placeholder:text-zinc-300",
          size === "sm" ? "py-1" : "py-1.5",
        )}
      />
    </div>
  );
}

function SubredditEditor({
  values,
  onChange,
  onSubmit,
  loading,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex w-full items-stretch gap-2">
      <SubredditChipsField
        values={values}
        onChange={onChange}
        onSubmit={onSubmit}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || values.length === 0}
        className="shrink-0 rounded-xl bg-zinc-900 px-5 py-3 text-[15px] font-medium text-white transition hover:bg-zinc-800 active:bg-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {loading
          ? "Analyzing…"
          : values.length > 1
            ? `Analyze ${values.length} subs`
            : "Analyze"}
      </button>
    </div>
  );
}

function CompactSubredditPopover({
  values,
  onChange,
  onSubmit,
  loading,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    if (open) window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close popover when an analysis kicks off
  useEffect(() => {
    if (loading) setOpen(false);
  }, [loading]);

  const VISIBLE = 2;
  const visible = values.slice(0, VISIBLE);
  const more = Math.max(0, values.length - VISIBLE);

  function handleSubmit() {
    setOpen(false);
    onSubmit();
  }

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          "flex max-w-[460px] items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 text-sm transition",
          open
            ? "border-zinc-900 ring-2 ring-zinc-900/10"
            : "border-zinc-200 hover:border-zinc-300",
        )}
      >
        {values.length === 0 ? (
          <span className="px-1 text-zinc-400">Select subreddits</span>
        ) : (
          <>
            {visible.map((sub) => (
              <span
                key={sub}
                className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[13px] font-medium text-zinc-800"
              >
                <span className="text-zinc-400">r/</span>
                {sub}
              </span>
            ))}
            {more > 0 ? (
              <span className="rounded-md bg-zinc-50 px-1.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
                +{more} more
              </span>
            ) : null}
          </>
        )}
        <ChevronIcon open={open} />
      </button>

      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || values.length === 0}
        className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 active:bg-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {loading
          ? "Analyzing…"
          : values.length > 1
            ? `Analyze ${values.length} subs`
            : "Analyze"}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[420px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Subreddits to analyze</SectionLabel>
            <span className="text-xs text-zinc-400 tabular-nums">
              {values.length}/{MAX_SUBS}
            </span>
          </div>

          <SubredditChipsField
            values={values}
            onChange={onChange}
            onSubmit={handleSubmit}
            autoFocus
            size="sm"
          />

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3">
            <PresetMenu onPick={onChange} />
            <div className="flex items-center gap-1.5">
              {values.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PresetMenu({ onPick }: { onPick: (subs: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Presets ▾
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                onPick(p.subs.slice(0, MAX_SUBS));
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm transition hover:bg-zinc-50"
            >
              <div className="font-medium text-zinc-900">{p.name}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">
                r/{p.subs.join(", r/")}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PromptModal({
  idea,
  subreddits,
  onClose,
}: {
  idea: SaasIdea;
  subreddits: string[];
  onClose: () => void;
}) {
  const prompt = useMemo(
    () => buildDevPrompt(idea, subreddits),
    [idea, subreddits],
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function handleDownload() {
    const slug = idea.idea_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const blob = new Blob([prompt], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug || "saas-idea"}.prompt.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <SectionLabel>Build prompt</SectionLabel>
            <h3 className="truncate text-base font-semibold text-zinc-900">
              {idea.idea_name}
            </h3>
            <p className="text-xs text-zinc-500">
              Paste this into Claude, ChatGPT, Cursor, v0, or any coding agent.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin">
          <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-6 text-zinc-800">
            {prompt}
          </pre>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-5 py-3">
          <span className="text-xs text-zinc-500">
            {prompt.length.toLocaleString()} chars · ~
            {Math.ceil(prompt.length / 4).toLocaleString()} tokens
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100"
            >
              Download .md
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={classNames(
                "rounded-md px-3 py-1.5 text-xs font-semibold text-white transition",
                copied
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-zinc-900 hover:bg-zinc-800",
              )}
            >
              {copied ? "Copied ✓" : "Copy prompt"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [subreddits, setSubreddits] = useState<string[]>(["saas"]);
  const [hydrated, setHydrated] = useState(false);
  const [activeSubreddits, setActiveSubreddits] = useState<string[] | null>(
    null,
  );

  const [result, setResult] = useState<AnalyzeIdeasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [verdictFilter, setVerdictFilter] = useState<Verdict | "All">("All");
  const [sort, setSort] = useState<SortKey>("score-desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [promptIdea, setPromptIdea] = useState<SaasIdea | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed
            .filter((v): v is string => typeof v === "string")
            .map(normalizeSub)
            .filter(Boolean)
            .slice(0, MAX_SUBS);
          if (cleaned.length > 0) setSubreddits(cleaned);
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subreddits));
    } catch {
      /* ignore */
    }
  }, [subreddits, hydrated]);

  // Loading timer
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, [loading]);

  async function runAnalysis(input = subreddits) {
    const cleaned = Array.from(
      new Set(input.map(normalizeSub).filter(Boolean)),
    ).slice(0, MAX_SUBS);
    if (cleaned.length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setExpanded(new Set());
    setVerdictFilter("All");
    setSort("score-desc");
    setActiveSubreddits(cleaned);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subreddits: cleaned }),
      });

      const payload = (await response.json()) as AnalyzeIdeasResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Request failed.");
      }
      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected request error.",
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredIdeas = useMemo(() => {
    if (!result) return [];
    let list = result.ideas.slice();
    if (verdictFilter !== "All")
      list = list.filter((i) => i.verdict === verdictFilter);
    if (sort === "score-desc") list.sort((a, b) => b.score - a.score);
    else if (sort === "score-asc") list.sort((a, b) => a.score - b.score);
    else if (sort === "recurrence-desc")
      list.sort(
        (a, b) =>
          b.source_threads.length - a.source_threads.length ||
          b.score - a.score,
      );
    else list.sort((a, b) => a.idea_name.localeCompare(b.idea_name));
    return list;
  }, [result, verdictFilter, sort]);

  const stats = useMemo(() => {
    if (!result || result.ideas.length === 0) return null;
    const total = result.ideas.length;
    const avg =
      result.ideas.reduce((s, i) => s + i.score, 0) / Math.max(1, total);
    const strong = result.ideas.filter((i) => i.verdict === "Strong").length;
    const high = result.ideas.filter((i) => i.demand_level === "High").length;
    const totalSources = result.ideas.reduce(
      (s, i) => s + i.source_threads.length,
      0,
    );
    const avgRecurrence = totalSources / Math.max(1, total);
    const crossSub = result.ideas.filter(
      (i) => distinctSubredditsFromThreads(i.source_threads).length > 1,
    ).length;
    return { total, avg, strong, high, avgRecurrence, crossSub };
  }, [result]);

  function toggleIdea(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasResults = !!result && result.ideas.length > 0;
  const showHero = !loading && !result && !error;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-[11px] font-bold text-white">
              SF
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-900">
              SaaS Finder
            </span>
          </div>

          {hasResults || loading ? (
            <div className="flex flex-1 justify-end">
              <CompactSubredditPopover
                values={subreddits}
                onChange={setSubreddits}
                onSubmit={() => runAnalysis()}
                loading={loading}
              />
            </div>
          ) : (
            <a
              href="https://github.com/Nova-Designs-Creative/validly"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
            >
              GitHub →
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {showHero ? (
          <section className="py-10 sm:py-16">
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="space-y-3">
                <span className="inline-flex items-center rounded-md bg-zinc-900/5 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10">
                  v0.1 · Free stack
                </span>
                <h1 className="text-4xl font-semibold tracking-[-0.02em] text-zinc-900 sm:text-5xl">
                  Find recurring SaaS pain across multiple subreddits.
                </h1>
                <p className="text-base leading-7 text-zinc-600">
                  SaaS Finder pulls this week's hottest Reddit threads from up
                  to {MAX_SUBS} subreddits, then asks an OpenRouter model to{" "}
                  <span className="font-medium text-zinc-900">
                    cluster pain points across communities
                  </span>{" "}
                  — the strongest signals are the ones that show up everywhere.
                  One click and you get a build prompt for the SaaS.
                </p>
              </div>

              <div className="space-y-3">
                <SubredditEditor
                  values={subreddits}
                  onChange={setSubreddits}
                  onSubmit={() => runAnalysis()}
                  loading={loading}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <PresetMenu onPick={(subs) => setSubreddits(subs)} />
                  <span className="text-xs text-zinc-400">
                    or build your own list ·{" "}
                    <span className="tabular-nums">{subreddits.length}/{MAX_SUBS}</span>
                  </span>
                  {subreddits.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSubreddits([])}
                      className="ml-auto text-xs text-zinc-500 transition hover:text-zinc-900"
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>
              </div>

              <ul className="grid gap-3 pt-6 text-sm leading-6 text-zinc-600 sm:grid-cols-3">
                <li className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="font-medium text-zinc-900">Multi-sub scrape</p>
                  <p className="mt-1 text-zinc-600">
                    Up to 5 subreddits, fetched in parallel. Saved between
                    sessions.
                  </p>
                </li>
                <li className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="font-medium text-zinc-900">
                    Cross-sub clustering
                  </p>
                  <p className="mt-1 text-zinc-600">
                    Pain points appearing in 2+ subs get top scores
                    automatically.
                  </p>
                </li>
                <li className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="font-medium text-zinc-900">
                    One-click build prompt
                  </p>
                  <p className="mt-1 text-zinc-600">
                    Hand the result to Claude, Cursor, or v0 and start
                    shipping.
                  </p>
                </li>
              </ul>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-medium text-rose-800">
              Analysis failed
            </p>
            <p className="mt-1 text-sm text-rose-700">{error}</p>
          </section>
        ) : null}

        {loading ? (
          <section>
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3 text-sm">
              <div className="flex items-center gap-2 text-zinc-600">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Analyzing{" "}
                <span className="font-medium text-zinc-900">
                  {activeSubreddits && activeSubreddits.length > 0
                    ? `r/${activeSubreddits.join(", r/")}`
                    : "subreddits"}
                </span>
              </div>
              <span className="text-xs text-zinc-400 tabular-nums">
                {elapsedSeconds}s
              </span>
            </div>
            <ul className="divide-y divide-zinc-100">
              {[0, 1, 2, 3].map((i) => (
                <IdeaSkeleton key={i} />
              ))}
            </ul>
          </section>
        ) : null}

        {result && !loading ? (
          <section>
            {/* Quiet meta + filter row */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-zinc-600">
                <span className="font-semibold text-zinc-900">
                  {stats?.total ?? 0} ideas
                </span>
                {stats && stats.strong > 0 ? (
                  <span className="text-zinc-500">· {stats.strong} strong</span>
                ) : null}
                {stats && stats.crossSub > 0 ? (
                  <span className="text-violet-700">
                    · {stats.crossSub} cross-sub
                  </span>
                ) : null}
                <span className="text-zinc-400">
                  · in r/{result.subreddits.join(", r/")}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-md border border-zinc-200 bg-white p-0.5 text-xs">
                  {VERDICT_OPTIONS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVerdictFilter(v)}
                      className={classNames(
                        "rounded px-2 py-1 font-medium transition",
                        verdictFilter === v
                          ? "bg-zinc-900 text-white"
                          : "text-zinc-600 hover:text-zinc-900",
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-900"
                >
                  <option value="score-desc">Sort: Score</option>
                  <option value="recurrence-desc">Sort: Most recurring</option>
                  <option value="score-asc">Sort: Lowest score</option>
                  <option value="name">Sort: Name</option>
                </select>
              </div>
            </div>

            {filteredIdeas.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {filteredIdeas.map((idea) => (
                  <IdeaRow
                    key={`${idea.idea_name}-${idea.problem.slice(0, 40)}`}
                    idea={idea}
                    expanded={expanded.has(idea.idea_name)}
                    onToggle={() => toggleIdea(idea.idea_name)}
                    onBuildPrompt={() => setPromptIdea(idea)}
                  />
                ))}
              </ul>
            ) : (
              <div className="py-12 text-center text-sm text-zinc-500">
                No ideas match this filter.
              </div>
            )}

            {/* Source threads — compact accordion */}
            <details className="group mt-8 border-t border-zinc-200 pt-4">
              <summary className="flex cursor-pointer items-center justify-between text-sm marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="text-zinc-700">
                  <span className="text-zinc-500">Source data — </span>
                  {result.source.posts.length} threads ·{" "}
                  {result.source.posts.reduce(
                    (s, p) => s + p.comments.length,
                    0,
                  )}{" "}
                  comments
                </span>
                <span className="text-zinc-400 transition group-open:rotate-180">
                  <ChevronIcon open={false} />
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {result.source.posts.map((post, idx) => (
                  <ThreadRow key={`${post.permalink}-${idx}`} post={post} />
                ))}
              </div>
            </details>
          </section>
        ) : null}
      </main>

      {promptIdea && result ? (
        <PromptModal
          idea={promptIdea}
          subreddits={result.subreddits}
          onClose={() => setPromptIdea(null)}
        />
      ) : null}
    </div>
  );
}
