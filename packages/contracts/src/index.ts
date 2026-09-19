import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";
export const phases = [
  "queued",
  "profiling",
  "discovering",
  "collecting",
  "enriching",
  "analyzing",
  "synthesizing",
] as const;
export type Phase = (typeof phases)[number];
export type Status = Phase | "completed" | "partial" | "failed" | "cancelled";
export const terminal = (status: Status) =>
  ["completed", "partial", "failed", "cancelled"].includes(status);
export const profileInput = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120).default("Specialty coffee"),
  audience: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .default("People who make a little ritual out of their everyday"),
  geography: z.string().trim().min(1).max(80).default("North America"),
  goal: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .default("Find complementary brand partnerships"),
});
export type ProfileInput = z.input<typeof profileInput>;
export type ProfileFields = z.output<typeof profileInput>;
export type ProfileResearch = {
  sessionId: string;
  shopifyConfidence: number;
  shopifySignals: string[];
  pagesVisited: number;
  products: string[];
  sources: {
    url: string;
    title: string;
    span: string;
    imageUrl?: string;
    sourceType: string;
    fetchedAt: string;
    contentHash: string;
  }[];
};
export type Profile = ProfileFields & {
  id: string;
  version: number;
  confirmed: boolean;
  mode: "demo" | "browserbase";
  research?: ProfileResearch;
};
export type Evidence = {
  id: string;
  title: string;
  sourceType: string;
  span: string;
  publishedAt: string;
  url: string | null;
  synthetic: boolean;
};
export type Candidate = {
  id: string;
  name: string;
  domain: string;
  category: string;
  tagline: string;
  description: string;
  imageUrl?: string;
  imageAlt?: string;
  score: number;
  confidence: "High" | "Medium" | "Low";
  tone: string;
  mark: string;
  idea: string;
  reason: string;
  caveat: string;
  evidenceIds: string[];
  components: { label: string; score: number; weight: number }[];
  type?: "direct" | "adjacent" | "substitute";
};
export type Theme = {
  id: string;
  kind: "Praise" | "Complaint" | "Switching trigger" | "Unmet need";
  title: string;
  description: string;
  mentions: number;
  evidenceIds: string[];
};
export type SwotItem = {
  id: string;
  title: string;
  description: string;
  confidence: string;
  claimType: "observation" | "inference";
  evidenceIds: string[];
};
export type Report = {
  id: string;
  schemaVersion: string;
  profile: Profile;
  status: Status;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  mode: "demo";
  warning: string | null;
  collaborators: Candidate[];
  competitors: Candidate[];
  themes: Theme[];
  swot: Record<
    "strengths" | "weaknesses" | "opportunities" | "threats",
    SwotItem[]
  >;
  actions: {
    title: string;
    experiment: string;
    effort: string;
    evidenceIds: string[];
  }[];
  evidence: Evidence[];
};
