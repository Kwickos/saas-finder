import type { SaasIdea } from "@/lib/types";

function bullets(items: string[]): string {
  if (items.length === 0) return "_No data._";
  return items.map((item) => `- ${item}`).join("\n");
}

function joinList(items: string[], fallback = "none mentioned"): string {
  if (items.length === 0) return fallback;
  return items.join(", ");
}

export function distinctSubredditsFromThreads(
  threads: SaasIdea["source_threads"],
): string[] {
  const subs = new Set<string>();
  for (const thread of threads) {
    const match = thread.thread_url.match(/\/r\/([^/]+)/i);
    if (match?.[1]) subs.add(match[1]);
  }
  return Array.from(subs);
}

export function buildDevPrompt(
  idea: SaasIdea,
  subreddits: string[],
): string {
  const sourcesBlock = idea.source_threads
    .map((t, i) => `${i + 1}. [${t.title}](${t.thread_url})`)
    .join("\n");

  const distinctSubs = distinctSubredditsFromThreads(idea.source_threads);
  const subsLabel =
    subreddits.length > 1
      ? `r/${subreddits.join(", r/")}`
      : `r/${subreddits[0] ?? "reddit"}`;
  const validation =
    distinctSubs.length > 1
      ? `cited in ${idea.source_threads.length} threads spanning **${distinctSubs.length} different subreddits** (r/${distinctSubs.join(", r/")})`
      : `cited in ${idea.source_threads.length} thread${idea.source_threads.length === 1 ? "" : "s"} from ${subsLabel}`;

  return `# Build a SaaS — ${idea.idea_name}

You are a senior full-stack engineer. Build a production-ready MVP for the SaaS described below. The opportunity has been validated — ${validation}.

---

## 1. Problem we're solving

${idea.problem}

**Demand:** ${idea.demand_level} · **Verdict:** ${idea.verdict} · **Validation score:** ${idea.score}/10${distinctSubs.length > 1 ? ` · **Cross-subreddit:** yes` : ""}

### What users actually complain about
${bullets(idea.user_complaints)}

### Existing solutions and why they fall short
- **Existing solutions / workarounds:** ${joinList(idea.existing_solutions)}
- **Direct competitors:** ${joinList(idea.similar_competitors)}

---

## 2. The opportunity

${idea.opportunity}

---

## 3. Business model

- **Monetization model:** ${idea.monetization_model}
- **Pricing hypothesis:** ${idea.pricing_hint}
- **Realistic revenue ceiling:** ${idea.revenue_potential}
- **Go-to-market wedge:** ${idea.go_to_market}

---

## 4. Tech stack (use this unless you have a strong reason not to)

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Next.js Route Handlers, server actions where appropriate
- **Database & auth:** Supabase (Postgres + Row Level Security + Auth)
- **Payments:** Stripe (Checkout + Customer Portal + webhooks)
- **Email:** Resend
- **Hosting:** Vercel

---

## 5. What I want you to deliver

Work in this order. After each step, briefly summarize what you built before moving on.

### Step A — Product spec
1. List the 3-5 core features required for an MVP that delivers the opportunity above.
2. For each feature, write a one-paragraph user story.
3. Define the key data models (tables, columns, relationships).
4. Define the user flows (signup → first value → conversion to paid).

### Step B — Project scaffold
1. Generate the folder structure.
2. Output the \`package.json\` with exact dependencies.
3. Output the Tailwind, Next.js, and shadcn/ui config.
4. Set up Supabase: SQL migrations for the data models, RLS policies, auth.
5. Set up Stripe: products, prices matching the pricing hypothesis above, webhook handler skeleton.

### Step C — Build the MVP
Implement features one by one with full, runnable code. For each feature:
- Server-side route(s)
- Database queries
- React UI (server components first, client components only when needed)
- Error and loading states
- A short test plan I can run by hand

### Step D — Hand-off
- A \`README.md\` with setup instructions, env vars, and "how to deploy".
- A 5-item launch checklist (analytics, error tracking, transactional email, legal, customer support).

---

## 6. Constraints and quality bar

- TypeScript strict, no \`any\`. Validate inputs at the edge with Zod.
- Server-first rendering; only opt into client components for interactivity.
- No premature abstractions. Three similar lines is fine.
- Don't add error handling for impossible cases.
- Keep dependencies minimal — every \`npm install\` is a deliberate choice.
- Make reasonable assumptions and proceed. Only ask clarifying questions if a decision would be genuinely unrecoverable.

---

## 7. Source evidence (Reddit threads cited for this opportunity)

${sourcesBlock}

---

Begin with Step A.
`;
}
