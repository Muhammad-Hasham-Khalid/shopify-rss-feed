import Parser from "rss-parser";

const parser = new Parser();
const RSS_FEED_URL = "https://shopify.dev/changelog/feed.xml";

export async function handleRSSFeed() {
  const feed = await getRSSFeed();
}

async function getRSSFeed() {
  const feed = await parser.parseURL(RSS_FEED_URL);
  return feed;
}

async function sendToGchat() {
  // TODO:
}
