export interface RedditPost {
  title: string;
  comments: string[];
  permalink: string;
  threadUrl: string;
  subreddit: string;
}

export interface SourceThread {
  title: string;
  thread_url: string;
}

export interface StructuredRedditData {
  subreddits: string[];
  scrapedAt: string;
  posts: RedditPost[];
}

export interface SaasIdea {
  idea_name: string;
  problem: string;
  demand_level: "Low" | "Medium" | "High";
  existing_solutions: string[];
  similar_competitors: string[];
  user_complaints: string[];
  opportunity: string;
  monetization_model: string;
  pricing_hint: string;
  revenue_potential: string;
  go_to_market: string;
  score: number;
  verdict: "Weak" | "Decent" | "Strong";
  source_threads: SourceThread[];
}

export interface AnalyzeIdeasResponse {
  subreddits: string[];
  source: StructuredRedditData;
  ideas: SaasIdea[];
}

export type LanguageCode = "en" | "fr" | "es" | "de" | "pt" | "it";

export interface AnalysisSettings {
  postsPerSubreddit: number;
  commentsPerPost: number;
  language: LanguageCode;
  model?: string;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  postsPerSubreddit: 8,
  commentsPerPost: 3,
  language: "en",
};

export type ModelTier = "free" | "cheap" | "mid" | "premium";

export interface CuratedModel {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
  contextLength: number;
}

export interface ModelsResponse {
  tiers: Record<ModelTier, CuratedModel[]>;
  fetchedAt: string;
}

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  free: "Free",
  cheap: "Cheap · under $1/M",
  mid: "Mid · $1-5/M",
  premium: "Premium · $5+/M",
};

export const SETTINGS_LIMITS = {
  postsPerSubreddit: { min: 3, max: 15 },
  commentsPerPost: { min: 2, max: 7 },
};

export const LANGUAGE_OPTIONS: { code: LanguageCode; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
];
