import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createPlatform } from "./platform";
const providerMode = process.env.PROVIDER_MODE ?? "demo";
if (!["demo", "browserbase"].includes(providerMode))
  throw new Error("PROVIDER_MODE must be either demo or browserbase.");
const platform = createPlatform({
  databasePath: process.env.DATABASE_PATH ?? ".data/grove.sqlite",
  providerMode: providerMode as "demo" | "browserbase",
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
      `Grove API (${providerMode}) listening on http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      platform.close();
      process.exit(0);
    }),
  );
