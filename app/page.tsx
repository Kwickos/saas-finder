"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  buildDevPrompt,
  distinctSubredditsFromThreads,
} from "@/lib/build-prompt";
import {
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  MODEL_TIER_LABELS,
  SETTINGS_LIMITS,
  type AnalysisSettings,
  type AnalyzeIdeasResponse,
  type LanguageCode,
  type ModelTier,
  type ModelsResponse,
  type RedditPost,
  type SaasIdea,
} from "@/lib/types";

const STORAGE_KEY = "saas-finder:subreddits";
const SETTINGS_STORAGE_KEY = "saas-finder:settings";
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
type SortKey = "score-desc" | "score-asc" | "recurrence-desc" | "name";

type PreviewIdea = {
  score: number;
  name: string;
  problem: string;
  threads: number;
  crossSub?: number;
  demand: "Low" | "Medium" | "High";
};

const PREVIEW_IDEAS: PreviewIdea[] = [
  {
    score: 9,
    name: "AI email automation for SMB founders",
    problem:
      "Solo founders need personalized email sequences but can't justify Mailchimp's pricing or learn its complexity. They paste prompts into ChatGPT and copy-paste manually.",
    threads: 6,
    crossSub: 3,
    demand: "High",
  },
  {
    score: 7,
    name: "Inventory sync across e-commerce channels",
    problem:
      "Multi-channel sellers manage stock across Amazon, Shopify, eBay separately. Updates take hours, stockouts happen, and integrations are too expensive.",
    threads: 4,
    crossSub: 2,
    demand: "High",
  },
  {
    score: 6,
    name: "Freelance contract generator from a 5-question form",
    problem:
      "Freelancers waste hours adapting generic templates per client and routinely miss key clauses (kill fees, IP, late penalties).",
    threads: 3,
    demand: "Medium",
  },
];

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
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[17px] font-bold tabular-nums ring-1 ring-inset",
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

function IdeaDetail({
  idea,
  onBuildPrompt,
}: {
  idea: SaasIdea;
  onBuildPrompt: () => void;
}) {
  return (
    <div className="border-t border-zinc-100 bg-zinc-50/40 px-3 py-6 sm:pl-[3.75rem] sm:pr-5">
      {/* Hero — the opportunity */}
      <p className="text-pretty text-[17px] leading-[1.7] text-zinc-900">
        {idea.opportunity}
      </p>

      {/* Primary CTA right after hero */}
      <button
        type="button"
        onClick={onBuildPrompt}
        className="group mt-5 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.96] hover:bg-zinc-800"
      >
        Build this with AI
        <span className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </button>

      <hr className="my-7 border-zinc-200" />

      {/* Evidence — complaints */}
      {idea.user_complaints.length > 0 ? (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-semibold text-zinc-900">
            What users complain about
          </h4>
          <ul className="ml-4 list-disc space-y-1 text-[14px] leading-7 text-zinc-700 marker:text-zinc-300">
            {idea.user_complaints.map((c, i) => (
              <li key={`${i}-${c.slice(0, 20)}`}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Market context */}
      {idea.existing_solutions.length > 0 ||
      idea.similar_competitors.length > 0 ? (
        <section className="mb-6 grid gap-4 text-[14px] sm:grid-cols-2">
          {idea.existing_solutions.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-zinc-500">
                Existing solutions
              </p>
              <p className="mt-1 leading-6 text-zinc-700">
                {idea.existing_solutions.join(", ")}
              </p>
            </div>
          ) : null}
          {idea.similar_competitors.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-zinc-500">
                Direct competitors
              </p>
              <p className="mt-1 leading-6 text-zinc-700">
                {idea.similar_competitors.join(", ")}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Business model — small stats strip */}
      <section className="my-6 grid gap-4 border-y border-zinc-200 py-4 text-[14px] sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-zinc-500">Monetization</p>
          <p className="mt-1 leading-6 text-zinc-900">
            {idea.monetization_model}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-500">Pricing</p>
          <p className="mt-1 leading-6 text-zinc-900">{idea.pricing_hint}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-500">Revenue ceiling</p>
          <p className="mt-1 leading-6 text-zinc-900">
            {idea.revenue_potential}
          </p>
        </div>
      </section>

      {/* Go to market */}
      <section className="mb-6 text-[14px]">
        <p className="text-xs font-medium text-zinc-500">Go to market</p>
        <p className="mt-1 leading-7 text-zinc-700">{idea.go_to_market}</p>
      </section>

      {/* Sources — collapsed by default */}
      {idea.source_threads.length > 0 ? (
        <details className="text-[14px]">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-900 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90">
              ›
            </span>
            Show {idea.source_threads.length} source thread
            {idea.source_threads.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
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
        </details>
      ) : null}
    </div>
  );
}

function IdeaRow({
  idea,
  expanded,
  onToggle,
  onBuildPrompt,
  animationDelayMs = 0,
}: {
  idea: SaasIdea;
  expanded: boolean;
  onToggle: () => void;
  onBuildPrompt: () => void;
  animationDelayMs?: number;
}) {
  const distinctSubs = useMemo(
    () => distinctSubredditsFromThreads(idea.source_threads),
    [idea.source_threads],
  );

  return (
    <li
      className={classNames(
        "animate-row-enter",
        expanded && "bg-zinc-50/40",
      )}
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-start gap-4 px-3 py-5 text-left transition hover:bg-zinc-50/80"
        aria-expanded={expanded}
      >
        <ScoreChip score={idea.score} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="truncate text-balance text-base font-semibold leading-snug text-zinc-900">
              {idea.idea_name}
            </h3>
            <span className="shrink-0 pt-1">
              <ChevronIcon open={expanded} />
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-zinc-600">
            {idea.problem}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <RecurrenceBadge count={idea.source_threads.length} />
            <CrossSubBadge subs={distinctSubs} />
            {idea.demand_level === "High" ? (
              <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                High demand
              </span>
            ) : null}
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

function PreviewIdeaCard({ idea }: { idea: PreviewIdea }) {
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition hover:border-zinc-300">
      <div className="flex items-start gap-4">
        <span
          className={classNames(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[17px] font-bold tabular-nums ring-1 ring-inset",
            scoreBadge(idea.score),
          )}
        >
          {idea.score}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-balance text-base font-semibold leading-snug text-zinc-900">
            {idea.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-[14px] leading-6 text-zinc-600">
            {idea.problem}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <RecurrenceBadge count={idea.threads} />
            {idea.crossSub && idea.crossSub > 1 ? (
              <CrossSubBadge subs={Array(idea.crossSub).fill("x")} />
            ) : null}
            {idea.demand === "High" ? (
              <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                High demand
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function StepCard({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white">
        {n}
      </span>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-zinc-900">
        {title}
      </h3>
      <p className="mt-1 text-sm leading-6 text-zinc-600">{body}</p>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  theme = "light",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  theme?: "light" | "dark";
}) {
  const isDark = theme === "dark";
  return (
    <div
      className={classNames(
        "inline-flex items-center rounded-md",
        isDark
          ? "border border-white/10 bg-white/5"
          : "border border-zinc-200 bg-white",
      )}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={classNames(
          "flex h-8 w-8 items-center justify-center transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100",
          isDark
            ? "text-white/60 hover:text-white"
            : "text-zinc-500 hover:text-zinc-900",
        )}
        aria-label="Decrease"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span
        className={classNames(
          "w-7 text-center text-sm font-medium tabular-nums",
          isDark ? "text-white" : "text-zinc-900",
        )}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className={classNames(
          "flex h-8 w-8 items-center justify-center transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100",
          isDark
            ? "text-white/60 hover:text-white"
            : "text-zinc-500 hover:text-zinc-900",
        )}
        aria-label="Increase"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M5 2v6M2 5h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function formatPrice(p: number): string {
  if (p === 0) return "Free";
  if (p < 1) return `$${p.toFixed(2)}/M`;
  return `$${p.toFixed(p < 10 ? 2 : 0)}/M`;
}

const MODEL_TIER_ORDER: ModelTier[] = ["free", "cheap", "mid", "premium"];

function tierOfModel(
  modelId: string | undefined,
  models: ModelsResponse | null,
): ModelTier | null {
  if (!modelId || !models) return null;
  for (const t of MODEL_TIER_ORDER) {
    if (models.tiers[t]?.some((m) => m.id === modelId)) return t;
  }
  return null;
}

function findModel(
  modelId: string | undefined,
  models: ModelsResponse | null,
): { id: string; name: string; inputPrice: number } | null {
  if (!modelId || !models) return null;
  for (const t of MODEL_TIER_ORDER) {
    const hit = models.tiers[t]?.find((m) => m.id === modelId);
    if (hit) return hit;
  }
  return null;
}

function tierDot(tier: ModelTier | null): string {
  if (tier === "free") return "bg-zinc-400";
  if (tier === "cheap") return "bg-emerald-500";
  if (tier === "mid") return "bg-amber-500";
  if (tier === "premium") return "bg-violet-500";
  return "bg-zinc-300";
}

function ModelPicker({
  models,
  loading,
  value,
  onChange,
  theme = "light",
}: {
  models: ModelsResponse | null;
  loading: boolean;
  value: string | undefined;
  onChange: (id: string) => void;
  theme?: "light" | "dark";
}) {
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Center the selected model inside the scroll container when opening.
  // useLayoutEffect runs synchronously after DOM mutations and before paint,
  // so the panel is mounted and laid out by the time we measure.
  useLayoutEffect(() => {
    if (!open) return;
    const container = listRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    if (!active) return;
    // Account for sticky tier headers (~32px) by skewing the target up a bit
    const stickyOffset = 32;
    const containerHeight = container.clientHeight;
    const target =
      active.offsetTop -
      (containerHeight - stickyOffset) / 2 +
      active.offsetHeight / 2 -
      stickyOffset;
    container.scrollTop = Math.max(0, target);
  }, [open]);

  const hasModels =
    models && MODEL_TIER_ORDER.some((t) => (models.tiers[t]?.length ?? 0) > 0);
  const selected = findModel(value, models);
  const selectedTier = tierOfModel(value, models);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading || !hasModels}
        className={classNames(
          "flex w-[200px] items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60",
          isDark
            ? classNames(
                "border border-white/10 bg-white/5",
                open
                  ? "border-white/30 ring-2 ring-white/10"
                  : "hover:bg-white/10",
              )
            : classNames(
                "border bg-white",
                open
                  ? "border-zinc-900 ring-2 ring-zinc-900/10"
                  : "border-zinc-200 hover:border-zinc-300",
              ),
        )}
      >
        {selected ? (
          <>
            <span
              className={classNames(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                tierDot(selectedTier),
              )}
            />
            <span
              className={classNames(
                "flex-1 truncate font-medium",
                isDark ? "text-white" : "text-zinc-900",
              )}
            >
              {selected.name}
            </span>
            <span
              className={classNames(
                "shrink-0 text-xs tabular-nums",
                isDark ? "text-white/50" : "text-zinc-500",
              )}
            >
              {formatPrice(selected.inputPrice)}
            </span>
          </>
        ) : (
          <span
            className={classNames(
              "flex-1 truncate",
              isDark ? "text-white/50" : "text-zinc-500",
            )}
          >
            {loading ? "Loading models…" : "Select a model"}
          </span>
        )}
        <ChevronIcon open={open} />
      </button>

      {open && models ? (
        <div
          className={classNames(
            "shadow-modal absolute right-0 top-full z-40 mt-1 w-[320px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl",
            isDark ? "bg-zinc-950 ring-1 ring-white/10" : "bg-white",
          )}
        >
          <div
            ref={listRef}
            className="scrollbar-thin max-h-[60vh] overflow-y-auto"
          >
            {MODEL_TIER_ORDER.map((tier) => {
              const list = models.tiers[tier];
              if (!list || list.length === 0) return null;
              return (
                <div key={tier}>
                  <div
                    className={classNames(
                      "sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium backdrop-blur",
                      isDark
                        ? "border-white/5 bg-zinc-900/95 text-white/50"
                        : "border-zinc-100 bg-zinc-50/95 text-zinc-500",
                    )}
                  >
                    <span
                      className={classNames(
                        "h-1.5 w-1.5 rounded-full",
                        tierDot(tier),
                      )}
                    />
                    {MODEL_TIER_LABELS[tier]}
                  </div>
                  {list.map((m) => {
                    const isActive = m.id === value;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        data-active={isActive ? "true" : undefined}
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                        }}
                        className={classNames(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition",
                          isActive
                            ? isDark
                              ? "bg-white text-zinc-900"
                              : "bg-zinc-900 text-white"
                            : isDark
                              ? "text-white/80 hover:bg-white/5"
                              : "text-zinc-800 hover:bg-zinc-50",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        <span
                          className={classNames(
                            "shrink-0 text-xs tabular-nums",
                            isActive
                              ? isDark
                                ? "text-zinc-500"
                                : "text-zinc-300"
                              : isDark
                                ? "text-white/40"
                                : "text-zinc-500",
                          )}
                        >
                          {formatPrice(m.inputPrice)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LanguagePicker({
  value,
  onChange,
  theme = "light",
}: {
  value: LanguageCode;
  onChange: (next: LanguageCode) => void;
  theme?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = LANGUAGE_OPTIONS.find((opt) => opt.code === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          "flex w-[120px] items-center justify-between gap-2 rounded-md px-2 py-1 text-sm font-medium transition",
          isDark
            ? classNames(
                "border border-white/10 bg-white/5 text-white",
                open
                  ? "border-white/30 ring-2 ring-white/10"
                  : "hover:bg-white/10",
              )
            : classNames(
                "border bg-white text-zinc-700",
                open
                  ? "border-zinc-900 ring-2 ring-zinc-900/10"
                  : "border-zinc-200 hover:border-zinc-300",
              ),
        )}
      >
        <span className="truncate">{selected?.label ?? "Language"}</span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div
          className={classNames(
            "shadow-modal absolute right-0 top-full z-40 mt-1 w-[140px] overflow-hidden rounded-lg",
            isDark
              ? "bg-zinc-950 ring-1 ring-white/10"
              : "border border-zinc-200 bg-white",
          )}
        >
          {LANGUAGE_OPTIONS.map((opt) => {
            const isActive = opt.code === value;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  onChange(opt.code);
                  setOpen(false);
                }}
                className={classNames(
                  "block w-full px-3 py-2 text-left text-sm transition",
                  isActive
                    ? isDark
                      ? "bg-white text-zinc-900"
                      : "bg-zinc-900 text-white"
                    : isDark
                      ? "text-white/80 hover:bg-white/5"
                      : "text-zinc-800 hover:bg-zinc-50",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SettingsFields({
  settings,
  onChange,
  models,
  modelsLoading,
  theme = "light",
}: {
  settings: AnalysisSettings;
  onChange: (next: AnalysisSettings) => void;
  models: ModelsResponse | null;
  modelsLoading: boolean;
  theme?: "light" | "dark";
}) {
  const isDark = theme === "dark";
  const labelCls = isDark ? "text-sm text-white/70" : "text-sm text-zinc-700";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <label className={labelCls}>Posts per subreddit</label>
        <Stepper
          value={settings.postsPerSubreddit}
          min={SETTINGS_LIMITS.postsPerSubreddit.min}
          max={SETTINGS_LIMITS.postsPerSubreddit.max}
          onChange={(n) => onChange({ ...settings, postsPerSubreddit: n })}
          theme={theme}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className={labelCls}>Comments per post</label>
        <Stepper
          value={settings.commentsPerPost}
          min={SETTINGS_LIMITS.commentsPerPost.min}
          max={SETTINGS_LIMITS.commentsPerPost.max}
          onChange={(n) => onChange({ ...settings, commentsPerPost: n })}
          theme={theme}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className={labelCls}>Language</label>
        <LanguagePicker
          value={settings.language}
          onChange={(lang) => onChange({ ...settings, language: lang })}
          theme={theme}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className={labelCls}>Model</label>
        <ModelPicker
          models={models}
          loading={modelsLoading}
          value={settings.model}
          onChange={(id) => onChange({ ...settings, model: id })}
          theme={theme}
        />
      </div>
    </div>
  );
}

function SubredditChipsField({
  values,
  onChange,
  onSubmit,
  autoFocus = false,
  size = "md",
  theme = "light",
  onFocus,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  size?: "sm" | "md";
  theme?: "light" | "dark";
  onFocus?: () => void;
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
  const isDark = theme === "dark";
  const inputPlaceholder =
    values.length === 0
      ? isDark
        ? "Add subreddits to analyze…"
        : "Type a subreddit and press Enter…"
      : canAdd
        ? "+ add"
        : `Max ${MAX_SUBS}`;

  return (
    <div
      className={classNames(
        "flex min-w-0 flex-1 flex-wrap items-center gap-1.5",
        isDark
          ? "py-0.5"
          : classNames(
              "rounded-xl border bg-white transition",
              "border-zinc-200 focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-900/10",
              size === "sm" ? "px-2 py-1.5" : "px-3 py-2",
            ),
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((sub) => (
        <span
          key={sub}
          className={classNames(
            "inline-flex shrink-0 items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[13px] font-medium",
            isDark
              ? "bg-white/10 text-white"
              : "bg-zinc-100 py-1 text-sm text-zinc-800",
          )}
        >
          <span className={isDark ? "text-white/50" : "text-zinc-400"}>r/</span>
          {sub}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(sub);
            }}
            className={classNames(
              "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded transition",
              isDark
                ? "text-white/40 hover:bg-white/10 hover:text-white"
                : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700",
            )}
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
        onFocus={onFocus}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={inputPlaceholder}
        autoComplete="off"
        spellCheck={false}
        disabled={!canAdd && draft.length === 0}
        className={classNames(
          "min-w-[80px] flex-1 bg-transparent outline-none",
          isDark
            ? "text-sm text-white placeholder:text-white/40 disabled:placeholder:text-white/20"
            : classNames(
                "text-[15px] text-zinc-900 placeholder:text-zinc-400 disabled:placeholder:text-zinc-300",
                size === "sm" ? "py-1" : "py-1.5",
              ),
        )}
      />
    </div>
  );
}

function NavSubredditPopover({
  values,
  onChange,
  onAnalyze,
  loading,
  settings,
  onSettingsChange,
  models,
  modelsLoading,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  onAnalyze: () => void;
  loading: boolean;
  settings: AnalysisSettings;
  onSettingsChange: (next: AnalysisSettings) => void;
  models: ModelsResponse | null;
  modelsLoading: boolean;
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

  function handleAnalyze() {
    setOpen(false);
    onAnalyze();
  }

  // Measure how many chips fit in the collapsed summary view, render
  // "+N more" for the rest. Only relevant when !open.
  const summarySlotRef = useRef<HTMLButtonElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [summaryVisibleCount, setSummaryVisibleCount] = useState(values.length);

  useLayoutEffect(() => {
    if (open || values.length === 0) return;

    function recompute() {
      const slot = summarySlotRef.current;
      const ghost = ghostRef.current;
      if (!slot || !ghost) return;

      const available = slot.clientWidth;
      const ghostChips = Array.from(
        ghost.querySelectorAll<HTMLElement>("[data-ghost-chip]"),
      );
      const ghostMore = ghost.querySelector<HTMLElement>("[data-ghost-more]");
      const moreWidth = ghostMore?.offsetWidth ?? 70;
      const gap = 6;

      let total = 0;
      let count = 0;
      for (let i = 0; i < ghostChips.length; i++) {
        const chipWidth = ghostChips[i].offsetWidth;
        const isLast = i === ghostChips.length - 1;
        const reserveMore = isLast ? 0 : moreWidth + gap;
        const next = total + chipWidth + (i > 0 ? gap : 0);
        if (next + reserveMore > available) break;
        total = next;
        count = i + 1;
      }
      setSummaryVisibleCount(count);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    if (summarySlotRef.current) ro.observe(summarySlotRef.current);
    return () => ro.disconnect();
  }, [values, open]);

  const summaryVisible = values.slice(0, summaryVisibleCount);
  const summaryOverflow = Math.max(0, values.length - summaryVisibleCount);

  return (
    <div className="relative w-full max-w-[520px]" ref={ref}>
      <div
        className={classNames(
          "flex w-full gap-2 rounded-3xl bg-zinc-900 py-2 pl-3 pr-2 text-sm text-white transition",
          open ? "items-start" : "items-center",
          open && "ring-2 ring-white/15",
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={classNames(
            "shrink-0 text-white/40",
            open && "mt-1",
          )}
          aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10.5 10.5l3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        {open ? (
          <div className="animate-content-fade flex min-w-0 flex-1">
            <SubredditChipsField
              values={values}
              onChange={onChange}
              onSubmit={handleAnalyze}
              theme="dark"
              autoFocus
            />
          </div>
        ) : (
          <button
            ref={summarySlotRef}
            type="button"
            onClick={() => setOpen(true)}
            className="animate-content-fade flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left"
          >
            {values.length === 0 ? (
              <span className="truncate text-white/50">
                Add subreddits to analyze…
              </span>
            ) : (
              <>
                {summaryVisible.map((sub) => (
                  <span
                    key={sub}
                    className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-1.5 py-0.5 text-[13px] font-medium"
                  >
                    <span className="text-white/50">r/</span>
                    {sub}
                  </span>
                ))}
                {summaryOverflow > 0 ? (
                  <span className="shrink-0 text-xs text-white/60">
                    +{summaryOverflow} more
                  </span>
                ) : null}
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={classNames(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition",
            open && "mt-0.5",
            open
              ? "bg-white/15 text-white"
              : "text-white/60 hover:bg-white/10 hover:text-white",
          )}
          aria-label="Settings & presets"
          title="Settings & presets"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 5h6m4 0h-1M3 11h1m4 0h5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="11" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="6" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {/* Hidden ghost row for measuring chip widths in the collapsed view */}
      {!open && values.length > 0 ? (
        <div
          ref={ghostRef}
          aria-hidden
          className="pointer-events-none absolute -z-10 flex items-center gap-1.5 whitespace-nowrap"
          style={{ top: 0, left: 0, visibility: "hidden" }}
        >
          {values.map((sub) => (
            <span
              key={`ghost-${sub}`}
              data-ghost-chip
              className="inline-flex items-center rounded-md bg-white/10 px-1.5 py-0.5 text-[13px] font-medium text-white"
            >
              <span className="text-white/50">r/</span>
              {sub}
            </span>
          ))}
          <span data-ghost-more className="text-xs text-white/60">
            +{values.length} more
          </span>
        </div>
      ) : null}

      {open ? (
        <div className="absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2">
          <div className="animate-popover-slide shadow-modal w-[420px] max-w-[calc(100vw-1.5rem)] rounded-2xl bg-zinc-900 p-4 ring-1 ring-white/10">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-white/50">Settings</span>
            <span className="text-xs text-white/40 tabular-nums">
              {values.length}/{MAX_SUBS} subs
            </span>
          </div>

          <SettingsFields
            settings={settings}
            onChange={onSettingsChange}
            models={models}
            modelsLoading={modelsLoading}
            theme="dark"
          />

          <div className="mt-5 flex items-center justify-between gap-2">
            <PresetMenu onPick={onChange} theme="dark" />
            <div className="flex items-center gap-1.5">
              {values.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="rounded-md px-2 py-1 text-xs font-medium text-white/50 transition hover:text-white"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading || values.length === 0}
                className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-zinc-900 transition active:scale-[0.96] hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                Done
              </button>
            </div>
          </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PresetMenu({
  onPick,
  theme = "light",
}: {
  onPick: (subs: string[]) => void;
  theme?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isDark = theme === "dark";

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
        className={classNames(
          "rounded-md px-3 py-1.5 text-xs font-medium transition",
          isDark
            ? "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
            : "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
        )}
      >
        Presets ▾
      </button>
      {open ? (
        <div
          className={classNames(
            "shadow-modal absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg",
            isDark
              ? "bg-zinc-950 ring-1 ring-white/10"
              : "border border-zinc-200 bg-white",
          )}
        >
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                onPick(p.subs.slice(0, MAX_SUBS));
                setOpen(false);
              }}
              className={classNames(
                "block w-full px-3 py-2 text-left text-sm transition",
                isDark ? "hover:bg-white/5" : "hover:bg-zinc-50",
              )}
            >
              <div
                className={classNames(
                  "font-medium",
                  isDark ? "text-white" : "text-zinc-900",
                )}
              >
                {p.name}
              </div>
              <div
                className={classNames(
                  "mt-0.5 truncate text-xs",
                  isDark ? "text-white/40" : "text-zinc-500",
                )}
              >
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
      className="animate-modal-enter fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="shadow-modal animate-modal-card-enter flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white sm:h-[85vh] sm:rounded-2xl"
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
          <span className="text-xs text-zinc-500 tabular-nums">
            {prompt.length.toLocaleString()} chars · ~
            {Math.ceil(prompt.length / 4).toLocaleString()} tokens
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition active:scale-[0.96] hover:border-zinc-300 hover:bg-zinc-100"
            >
              Download .md
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={classNames(
                "rounded-md px-3 py-1.5 text-xs font-semibold text-white transition active:scale-[0.96]",
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
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
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

  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [redditOAuth, setRedditOAuth] = useState<boolean | null>(null);

  // Fetch curated model list + server status once
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: ModelsResponse) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        /* models stay null — picker shows Default only */
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.reddit) setRedditOAuth(Boolean(data.reddit.oauth));
      })
      .catch(() => {
        /* keep null */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-pick a default model when /api/models loads and the user hasn't
  // chosen one yet (or the previously stored one is no longer offered).
  // Order of preference: cheap → free → mid → premium.
  useEffect(() => {
    if (!hydrated || !models) return;
    if (settings.model && findModel(settings.model, models)) return;

    const preference: ModelTier[] = ["cheap", "free", "mid", "premium"];
    for (const t of preference) {
      const first = models.tiers[t]?.[0];
      if (first) {
        setSettings((s) => ({ ...s, model: first.id }));
        return;
      }
    }
  }, [models, hydrated, settings.model]);

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
    try {
      const savedSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as Partial<AnalysisSettings>;
        setSettings((prev) => ({ ...prev, ...parsed }));
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

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(settings),
      );
    } catch {
      /* ignore */
    }
  }, [settings, hydrated]);

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
        body: JSON.stringify({ subreddits: cleaned, settings }),
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

  const showHero = !loading && !result && !error;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="fixed inset-x-0 top-0 z-30 h-16 px-3 pt-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-6xl items-start gap-2 sm:gap-3">
          {/* Brand pill */}
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-900 py-1.5 pl-1.5 pr-3 text-white sm:pl-2 sm:pr-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[10px] font-bold text-zinc-900">
              SF
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              SaaS Finder
            </span>
          </div>

          {/* Subreddit popover (centered, fluid) */}
          <div className="flex min-w-0 flex-1 justify-center">
            <NavSubredditPopover
              values={subreddits}
              onChange={setSubreddits}
              onAnalyze={() => runAnalysis()}
              loading={loading}
              settings={settings}
              onSettingsChange={setSettings}
              models={models}
              modelsLoading={modelsLoading}
            />
          </div>

          {/* Analyze action pill */}
          <button
            type="button"
            onClick={() => runAnalysis()}
            disabled={loading || subreddits.length === 0}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition active:scale-[0.96] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 disabled:active:scale-100 sm:px-5"
          >
            {loading
              ? "Analyzing…"
              : subreddits.length > 1
                ? `Analyze ${subreddits.length}`
                : "Analyze"}
          </button>
        </div>
      </header>

      <main className="flex-1">
        {showHero ? (
          <>
            {/* Hero */}
            <section className="relative min-h-[100svh] overflow-hidden">
              {/* Background illustration */}
              <Image
                src="/hero-bg.webp"
                alt=""
                fill
                priority
                sizes="100vw"
                className="object-cover object-center"
              />
              {/* Bottom fade to white — no hard border into the next section */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white"
              />

              <div className="relative mx-auto max-w-6xl px-5 pt-24 pb-12 sm:pt-32 sm:pb-16">
                <div className="max-w-3xl space-y-6">
                  <span className="inline-flex items-center rounded-full bg-zinc-900/5 px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10">
                    v0.1 · Open source
                  </span>

                  <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-zinc-900 sm:text-6xl lg:text-7xl">
                    Real founders.
                    <br />
                    Real pain.
                    <br />
                    <span className="text-zinc-400">Real SaaS ideas.</span>
                  </h1>

                  <p className="text-pretty max-w-xl text-base leading-7 text-zinc-600 sm:text-lg">
                    SaaS Finder pulls this week's top threads from up to{" "}
                    {MAX_SUBS} subreddits, clusters recurring pain points with
                    AI, and hands you a build prompt for each idea.{" "}
                    <span className="font-medium text-zinc-900">
                      In about 30 seconds.
                    </span>
                  </p>
                </div>

              </div>
            </section>

            {/* Sample output */}
            <section className="bg-white">
              <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
                <div className="mx-auto mb-8 max-w-2xl">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Sample output
                  </p>
                  <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                    What you'll actually get back.
                  </h2>
                  <p className="mt-3 text-pretty text-sm leading-6 text-zinc-600 sm:text-base">
                    Each idea is scored, cited (with the exact threads that
                    back it), and comes with monetization, pricing, and
                    go-to-market notes — plus a markdown build prompt you
                    paste straight into Claude, Cursor, or v0.
                  </p>
                </div>
                <div className="mx-auto max-w-3xl space-y-3">
                  {PREVIEW_IDEAS.map((idea, i) => (
                    <div
                      key={idea.name}
                      className="animate-row-enter"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <PreviewIdeaCard idea={idea} />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* How it works */}
            <section className="border-t border-zinc-200">
              <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
                <div className="mx-auto mb-8 max-w-2xl">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    How it works
                  </p>
                  <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                    Three steps. ~30 seconds.
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StepCard
                    n="1"
                    title="Pick subreddits"
                    body="Type your own or use a preset. Up to 5 subreddits at once. Reddit OAuth is optional — anonymous works for 1 sub."
                  />
                  <StepCard
                    n="2"
                    title="AI clusters pain"
                    body="Top weekly threads + comments are sent to your chosen model. Pain points that recur across communities get top scores automatically."
                  />
                  <StepCard
                    n="3"
                    title="Get build prompts"
                    body="One click on any idea generates a 2-page markdown brief: problem, opportunity, monetization, GTM, and source threads."
                  />
                </div>
              </div>
            </section>

          </>
        ) : null}

        <div className="mx-auto w-full max-w-6xl px-5 pt-24 pb-8">
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
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-zinc-600 tabular-nums">
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
                {filteredIdeas.map((idea, idx) => (
                  <IdeaRow
                    key={`${idea.idea_name}-${idea.problem.slice(0, 40)}`}
                    idea={idea}
                    expanded={expanded.has(idea.idea_name)}
                    onToggle={() => toggleIdea(idea.idea_name)}
                    onBuildPrompt={() => setPromptIdea(idea)}
                    animationDelayMs={Math.min(idx, 10) * 50}
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
        </div>
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
