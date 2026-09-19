import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type PromptName = "planner" | "collaboration" | "competitor_discourse" | "swot_actions";

const dir = fileURLToPath(new URL("../prompts/", import.meta.url));
const read = (file: string) => readFileSync(`${dir}${file}`, "utf8").trim();

/** Current version of each prompt file. Older versions stay in prompts/ so runs remain comparable. */
export const CURRENT: Record<PromptName | "shared", string> = {
  shared: "v2",
  planner: "v1",
  collaboration: "v1",
  competitor_discourse: "v2",
  swot_actions: "v1",
};

/** Shared rules + workflow prompt. `version` names both files, e.g. "competitor_discourse.v2+shared.v2", and is logged with every call. */
export function loadPrompt(name: PromptName, v = CURRENT[name], shared = CURRENT.shared): { version: string; system: string } {
  return { version: `${name}.${v}+shared.${shared}`, system: `${read(`shared.${shared}.md`)}\n\n---\n\n${read(`${name}.${v}.md`)}` };
}
