"use client";

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

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-8 w-8 items-center justify-center text-zinc-500 transition active:scale-[0.96] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
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
      <span className="w-7 text-center text-sm font-medium tabular-nums text-zinc-900">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex h-8 w-8 items-center justify-center text-zinc-500 transition active:scale-[0.96] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
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
}: {
  models: ModelsResponse | null;
  loading: boolean;
  value: string | undefined;
  onChange: (id: string) => void;
}) {
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
          "flex w-[200px] items-center gap-2 rounded-md border bg-white px-2 py-1 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60",
          open
            ? "border-zinc-900 ring-2 ring-zinc-900/10"
            : "border-zinc-200 hover:border-zinc-300",
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
            <span className="flex-1 truncate font-medium text-zinc-900">
              {selected.name}
            </span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
              {formatPrice(selected.inputPrice)}
            </span>
          </>
        ) : (
          <span className="flex-1 truncate text-zinc-500">
            {loading ? "Loading models…" : "Select a model"}
          </span>
        )}
        <ChevronIcon open={open} />
      </button>

      {open && models ? (
        <div className="shadow-popover absolute right-0 top-full z-40 mt-1 w-[320px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-white">
          <div
            ref={listRef}
            className="scrollbar-thin max-h-[60vh] overflow-y-auto"
          >
            {MODEL_TIER_ORDER.map((tier) => {
              const list = models.tiers[tier];
              if (!list || list.length === 0) return null;
              return (
                <div key={tier}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/95 px-3 py-1.5 text-xs font-medium text-zinc-500 backdrop-blur">
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
                            ? "bg-zinc-900 text-white"
                            : "text-zinc-800 hover:bg-zinc-50",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        <span
                          className={classNames(
                            "shrink-0 text-xs tabular-nums",
                            isActive ? "text-zinc-300" : "text-zinc-500",
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

function SettingsFields({
  settings,
  onChange,
  models,
  modelsLoading,
}: {
  settings: AnalysisSettings;
  onChange: (next: AnalysisSettings) => void;
  models: ModelsResponse | null;
  modelsLoading: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-700">Posts per subreddit</label>
        <Stepper
          value={settings.postsPerSubreddit}
          min={SETTINGS_LIMITS.postsPerSubreddit.min}
          max={SETTINGS_LIMITS.postsPerSubreddit.max}
          onChange={(n) => onChange({ ...settings, postsPerSubreddit: n })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-700">Comments per post</label>
        <Stepper
          value={settings.commentsPerPost}
          min={SETTINGS_LIMITS.commentsPerPost.min}
          max={SETTINGS_LIMITS.commentsPerPost.max}
          onChange={(n) => onChange({ ...settings, commentsPerPost: n })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-700">Language</label>
        <select
          value={settings.language}
          onChange={(e) =>
            onChange({ ...settings, language: e.target.value as LanguageCode })
          }
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-900"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-zinc-700">Model</label>
        <ModelPicker
          models={models}
          loading={modelsLoading}
          value={settings.model}
          onChange={(id) => onChange({ ...settings, model: id })}
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

  const [visibleCount, setVisibleCount] = useState(values.length);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Measure how many chips actually fit in the trigger and only render
  // those — append "+N more" when at least one chip overflows.
  useLayoutEffect(() => {
    if (values.length === 0) {
      setVisibleCount(0);
      return;
    }

    function recompute() {
      const slot = slotRef.current;
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
      setVisibleCount(count);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    if (triggerRef.current) ro.observe(triggerRef.current);
    return () => ro.disconnect();
  }, [values]);

  const visible = values.slice(0, visibleCount);
  const overflow = Math.max(0, values.length - visibleCount);

  return (
    <div className="relative w-full max-w-[520px]" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          "flex w-full items-center gap-2 rounded-full bg-zinc-900 py-2 pl-3 pr-3 text-sm text-white transition",
          "hover:bg-zinc-800",
          open && "ring-2 ring-white/15",
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 text-white/40"
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

        <span
          ref={slotRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
        >
          {values.length === 0 ? (
            <span className="truncate text-white/50">
              Add subreddits to analyze…
            </span>
          ) : (
            <>
              {visible.map((sub) => (
                <span
                  key={sub}
                  className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-1.5 py-0.5 text-[13px] font-medium"
                >
                  <span className="text-white/50">r/</span>
                  {sub}
                </span>
              ))}
              {overflow > 0 ? (
                <span className="shrink-0 text-xs text-white/60">
                  +{overflow} more
                </span>
              ) : null}
            </>
          )}
        </span>

        <span className="shrink-0 text-white/60">
          <ChevronIcon open={open} />
        </span>
      </button>

      {/* Hidden ghost row used purely to measure chip widths. Kept identical
          in styling to the visible chips so measurements stay accurate. */}
      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none absolute -z-10 flex items-center gap-1.5 whitespace-nowrap opacity-0"
        style={{
          top: 0,
          left: 0,
          visibility: "hidden",
        }}
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

      {open ? (
        <div className="shadow-popover absolute left-1/2 top-full z-30 mt-2 w-[420px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-xl bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Subreddits to analyze</SectionLabel>
            <span className="text-xs text-zinc-400 tabular-nums">
              {values.length}/{MAX_SUBS}
            </span>
          </div>

          <SubredditChipsField
            values={values}
            onChange={onChange}
            onSubmit={handleAnalyze}
            autoFocus
            size="sm"
          />

          <div className="mt-5">
            <SectionLabel>Settings</SectionLabel>
            <div className="mt-2">
              <SettingsFields
                settings={settings}
                onChange={onSettingsChange}
                models={models}
                modelsLoading={modelsLoading}
              />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
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
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 sm:gap-3">
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {showHero ? (
          <section className="py-10 sm:py-16">
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="space-y-3">
                <span className="inline-flex items-center rounded-md bg-zinc-900/5 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10">
                  v0.1 · Free stack
                </span>
                <h1 className="text-balance text-4xl font-semibold tracking-[-0.02em] text-zinc-900 sm:text-5xl">
                  Find recurring SaaS pain across multiple subreddits.
                </h1>
                <p className="text-pretty text-base leading-7 text-zinc-600">
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
                <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                  <span className="text-zinc-500">
                    Quick start with a preset:
                  </span>
                  {PRESETS.slice(0, 3).map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
                        const next = preset.subs.slice(0, MAX_SUBS);
                        setSubreddits(next);
                        runAnalysis(next);
                      }}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.97]"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-400">
                  or use the search bar above to add your own subreddits ↑
                </p>

                {redditOAuth === false && subreddits.length > 1 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    Reddit OAuth not configured — analysing{" "}
                    {subreddits.length} subreddits anonymously may hit rate
                    limits.{" "}
                    <a
                      href="https://github.com/Kwickos/saas-finder#reddit-oauth-setup-2-minutes-free-no-reddit-account-purchases"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2 hover:text-amber-950"
                    >
                      2-min setup
                    </a>{" "}
                    or stick to 1 subreddit for reliable results.
                  </div>
                ) : null}
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
