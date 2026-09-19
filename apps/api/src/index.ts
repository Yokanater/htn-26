import express from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createPlatform } from "./platform";
if (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "demo")
  throw new Error(
    "Only demo providers are implemented. See docs/PLATFORM_HANDOFF.md.",
  );
const platform = createPlatform({
  databasePath: process.env.DATABASE_PATH ?? ".data/grove.sqlite",
});
const webRoot = resolve("dist/web");
if (existsSync(webRoot)) {
  platform.app.use(express.static(webRoot));
  platform.app.use((req, res) =>
    req.method === "GET"
      ? res.sendFile(resolve(webRoot, "index.html"))
      : res.sendStatus(404),
  );
}
const server = platform.app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Grove demo API listening on http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      platform.close();
      process.exit(0);
    }),
  );
