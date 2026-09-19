import "dotenv/config";
import { profileInput, type Profile } from "../packages/contracts/src/index";
import { profileStorefront } from "../apps/api/src/store-profiler";
import { researchMarket } from "../apps/api/src/market-research";

const url = process.argv[2] ?? "https://maguireshoes.com";
const fields = profileInput.parse({ name: new URL(url).hostname, url });
const extracted = await profileStorefront(fields);
const profile: Profile = {
  ...extracted,
  id: "market-smoke",
  version: 1,
  confirmed: true,
  mode: "browserbase",
};
const result = await researchMarket(profile);
console.log(
  JSON.stringify(
    {
      profile: { name: profile.name, category: profile.category },
      collaborators: result.collaborators.map(({ name, domain, reason }) => ({
        name,
        domain,
        reason,
      })),
      competitors: result.competitors.map(({ name, domain, reason }) => ({
        name,
        domain,
        reason,
      })),
      evidence: result.evidence.map(({ title, url }) => ({ title, url })),
      warning: result.warning,
    },
    null,
    2,
  ),
);
