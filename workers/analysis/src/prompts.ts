import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type PromptName = "planner" | "collaboration" | "competitor_discourse" | "swot_actions";

const dir = fileURLToPath(new URL("../prompts/", import.meta.url));
const read = (file: string) => readFileSync(`${dir}${file}`, "utf8").trim();

/** Shared rules + workflow prompt. `version` is the file stem, e.g. "collaboration.v1", and is logged with every call. */
export function loadPrompt(name: PromptName, v = "v1"): { version: string; system: string } {
  return { version: `${name}.${v}`, system: `${read(`shared.${v}.md`)}\n\n---\n\n${read(`${name}.${v}.md`)}` };
}
