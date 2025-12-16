import { Hono } from "hono";
import { handleRSSFeed } from "./rss-handler.js";

const app = new Hono();

app.get("/healthcheck", (c) => {
  return c.text("Running!");
});

app.get("/get-rss-feed", async (c) => {
  await handleRSSFeed();
  return c.text("Done!", 200);
});

export default app;
