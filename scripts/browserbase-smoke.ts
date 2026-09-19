import "dotenv/config";
import { browseWithBrowserbase } from "../apps/api/src/browserbase";

const requestedUrl = process.argv[2] ?? "https://example.com";

try {
  const result = await browseWithBrowserbase({
    url: requestedUrl,
    timeoutMs: 30_000,
    maxTextLength: 200,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionId: result.sessionId,
        title: result.title,
        finalUrl: result.finalUrl,
        textPreview: result.text,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
