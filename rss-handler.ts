import Parser from "rss-parser";
import fs from "node:fs/promises";
import path from "node:path";

const parser = new Parser();
const RSS_FEED_URL = "https://shopify.dev/changelog/feed.xml";
const STATE_FILE = path.join(process.cwd(), ".rss-state.json");
const PLACEHOLDER_IMAGE =
  "https://lh6.googleusercontent.com/proxy/Fc6uVmi69MN5KRXYUqAArKGO3uKYuVlkwBGJiiawS-CKHZgh6Tn1jsoZjgIYr3YWuGwpLTjBgv3wvBU0iCEJ8fgWltsAgSkVFpLZDrRMX0ToJWoeXOpXzpRNzFUcI1WWMnSsdL3KqWHfJH4Of56CtiARx8oYRs6aQKkEFD8P1dukJc71FGvq7k29eR8wnA";

interface ProcessedState {
  lastProcessedDate: string;
}

function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday.toISOString();
}

async function getProcessedState(): Promise<ProcessedState> {
  try {
    const data = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(data);
    // If we have a valid date, use it; otherwise use yesterday
    if (parsed.lastProcessedDate) {
      return { lastProcessedDate: parsed.lastProcessedDate };
    }
  } catch (error) {
    // File doesn't exist or is invalid
  }
  // Initialize with yesterday's date
  return { lastProcessedDate: getYesterdayDate() };
}

async function saveProcessedState(state: ProcessedState): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function handleRSSFeed() {
  const feed = await getRSSFeed();
  const newItems = await filterNewItems(feed);

  if (newItems.length > 0) {
    await sendToGchat(newItems);
    await updateProcessedState(newItems);
  } else {
    console.log("No new items to process");
  }
}

async function getRSSFeed() {
  const feed = await parser.parseURL(RSS_FEED_URL);
  await fs.writeFile("feed.json", JSON.stringify(feed, null, 2));
  return feed;
}

async function filterNewItems(
  feed: Awaited<ReturnType<typeof getRSSFeed>>
): Promise<typeof feed.items> {
  const state = await getProcessedState();
  const lastProcessedDate = new Date(state.lastProcessedDate);

  // Filter items that are newer than the last processed date
  const newItems = feed.items.filter((item) => {
    const itemDate = item.isoDate || item.pubDate;
    if (!itemDate) return false;

    const itemDateObj = new Date(itemDate);
    // Include items that are after the last processed date
    return itemDateObj > lastProcessedDate;
  });

  // Sort by date (newest first)
  newItems.sort((a, b) => {
    const dateA = new Date(a.isoDate || a.pubDate || 0).getTime();
    const dateB = new Date(b.isoDate || b.pubDate || 0).getTime();
    return dateB - dateA;
  });

  return newItems;
}

async function updateProcessedState(
  items: Awaited<ReturnType<typeof getRSSFeed>>["items"]
): Promise<void> {
  if (items.length === 0) return;

  // Find the most recent date from the items
  let mostRecentDate: Date | null = null;

  for (const item of items) {
    const itemDate = item.isoDate || item.pubDate;
    if (itemDate) {
      const date = new Date(itemDate);
      if (!mostRecentDate || date > mostRecentDate) {
        mostRecentDate = date;
      }
    }
  }

  if (mostRecentDate) {
    const state: ProcessedState = {
      lastProcessedDate: mostRecentDate.toISOString(),
    };
    await saveProcessedState(state);
  }
}

/**
 * Formats a date string into a readable format.
 */
function formatDate(dateString?: string): string {
  if (!dateString) return "Unknown date";

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString;
    }

    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (error) {
    return dateString;
  }
}

/**
 * Gets the image URL, falling back to placeholder if needed.
 */
function getImageUrl(): string {
  // Try Shopify logo first, fallback to placeholder
  return PLACEHOLDER_IMAGE;
}

async function sendToGchat(
  items: Awaited<ReturnType<typeof getRSSFeed>>["items"]
) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL environment variable is not set");
  }

  if (items.length === 0) {
    console.log("No items to send");
    return;
  }

  try {
    // Filter out items without title or link
    const validItems = items.filter((item) => item.title && item.link);

    if (validItems.length === 0) {
      console.log("No valid items to send");
      return;
    }

    // Get the most recent date for the subtitle
    const mostRecentDate = validItems[0]?.isoDate || validItems[0]?.pubDate;
    const formattedDate = formatDate(mostRecentDate);
    const dateSubtitle = `${validItems.length} new update${
      validItems.length > 1 ? "s" : ""
    } • Latest: ${formattedDate}`;

    // Build list widgets using DecoratedText for better formatting
    const listWidgets = validItems.map((item) => {
      const title = item.title || "Untitled";
      const link = item.link || "#";
      const itemDate = item.isoDate || item.pubDate;
      const formattedItemDate = formatDate(itemDate);

      return {
        decoratedText: {
          startIcon: {
            knownIcon: "BOOKMARK",
          },
          text: `<a href="${link}"><b>${title}</b></a><br><font color="#5f6368">${formattedItemDate}</font>`,
        },
      };
    });

    // Build a single card with all updates
    const cardMessage = {
      cardsV2: [
        {
          card: {
            header: {
              title: "Shopify Changelog Updates",
              subtitle: dateSubtitle,
              imageUrl: getImageUrl(),
            },
            sections: [
              {
                widgets: listWidgets,
              },
            ],
          },
        },
      ],
      accessoryWidgets: [
        {
          buttonList: {
            buttons: [
              {
                text: "View All Changelogs",
                icon: { materialIcon: { name: "open_in_new" } },
                onClick: {
                  openLink: {
                    url: "https://shopify.dev/changelog",
                  },
                },
              },
            ],
          },
        },
      ],
    };

    // Send to Google Chat
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cardMessage),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to send updates to Gchat:`,
        response.statusText,
        errorText
      );
      throw new Error(
        `Failed to send to Gchat: ${response.statusText} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log(
      `Successfully sent ${validItems.length} update(s) to Google Chat`
    );
  } catch (error) {
    console.error(`Error sending updates to Gchat:`, error);
    throw error;
  }
}
