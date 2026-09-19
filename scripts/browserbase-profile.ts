import "dotenv/config";
import { profileInput } from "../packages/contracts/src/index";
import { profileStorefront } from "../apps/api/src/store-profiler";

const url = process.argv[2] ?? "https://example.com";
const parsed = profileInput.parse({ name: new URL(url).hostname, url });

try {
  const result = await profileStorefront(parsed);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
