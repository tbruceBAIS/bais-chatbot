import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BASE_URL = process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";
const VECTOR_STORE_ID =
  process.env.OPENAI_VECTOR_STORE_ID || "vs_69c695df0a1881919287c9ed05b5cf6c";

let kbChunks = [];
let kbLastBuiltAt = 0;
const KB_TTL_MS = 1000 * 60 * 30;

const FALLBACK_URLS = [
  `${BASE_URL}/`,
  `${BASE_URL}/content/page/aboutus`,
  `${BASE_URL}/contact.php`,
  `${BASE_URL}/content/page/vending-solutions`,
];

function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function sanitizeTextForModel(text = "") {
  return normalizeText(text)
    .replace(/(javascript is required|skip to content|toggle navigation)/gi, "")
    .trim();
}

function chunkText(text, maxLen = 1400) {
  const clean = sanitizeTextForModel(text);
  if (!clean) return [];

  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function scoreChunk(query, chunk) {
  const qWords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const text = chunk.text.toLowerCase();
  let score = 0;

  for (const word of qWords) {
    const matches = text.split(word).length - 1;
    score += matches;
  }

  for (const word of qWords) {
    if (chunk.title && chunk.title.toLowerCase().includes(word)) score += 3;
    if (chunk.h1 && chunk.h1.toLowerCase().includes(word)) score += 4;
    if (chunk.url && chunk.url.toLowerCase().includes(word)) score += 2;
  }

  return score;
}

async function fetchSitemapUrls() {
  const candidates = [
    `${BASE_URL}/sitemap.xml`,
    `${BASE_URL}/sitemap_index.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const res = await axios.get(sitemapUrl, { timeout: 15000 });
      const xml = String(res.data || "");

      const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) =>
        m[1].trim()
      );

      const urls = matches.filter(
        (u) =>
          u.startsWith(BASE_URL) &&
          !u.match(/\.(jpg|jpeg|png|gif|webp|pdf|svg)$/i) &&
          !u.includes("/cart") &&
          !u.includes("/checkout") &&
          !u.includes("/account") &&
          !u.includes("/search")
      );

      if (urls.length) return [...new Set(urls)];
    } catch (_err) {}
  }

  return FALLBACK_URLS;
}

function htmlToStructuredContent(html, url) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg").remove();

  const title = normalizeText($("title").first().text());
  const h1 = normalizeText($("h1").first().text());

  const preferredSelectors = [
    "main",
    ".cms_content_area",
    ".uk-container",
    ".content",
    "#content",
    "body",
  ];

  let bodyText = "";

  for (const selector of preferredSelectors) {
    const text = normalizeText($(selector).first().text());
    if (text && text.length > bodyText.length) {
      bodyText = text;
    }
  }

  const finalText = sanitizeTextForModel(bodyText);
  return { url, title, h1, text: finalText };
}

async function fetchPage(url) {
  const res = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent": "BAISBot-Retrieval/1.0",
    },
  });

  return htmlToStructuredContent(res.data, url);
}

async function buildKnowledgeBase() {
  console.log("Building website knowledge base...");
  const urls = await fetchSitemapUrls();
  const allChunks = [];

  for (const url of urls) {
    try {
      const page = await fetchPage(url);
      if (!page.text || page.text.length < 200) continue;

      const pieces = chunkText(page.text, 1400);

      for (const piece of pieces) {
        allChunks.push({
          url: page.url,
          title: page.title,
          h1: page.h1,
          text: piece,
        });
      }

      console.log(`Indexed: ${url}`);
    } catch (err) {
      console.warn(`Failed to index ${url}: ${err.message}`);
    }
  }

  kbChunks = allChunks;
  kbLastBuiltAt = Date.now();
  console.log(`Knowledge base ready: ${kbChunks.length} chunks`);
}

async function ensureKnowledgeBase() {
  const stale = Date.now() - kbLastBuiltAt > KB_TTL_MS;
  if (!kbChunks.length || stale) {
    await buildKnowledgeBase();
  }
}

function getTopChunks(query, limit = 6) {
  return kbChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(query, chunk),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message || "";

    await ensureKnowledgeBase();
    const topChunks = getTopChunks(message, 6);

    const websiteContext = topChunks.map(c => c.text).join("\n\n");

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: message + "\n\nContext:\n" + websiteContext,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    // ✅ FIXED PARSING (THIS WAS YOUR ISSUE)
    let answer = "Sorry, I couldn't generate a response.";

    try {
      if (response.output_text) {
        answer = response.output_text;
      } else if (response.output && response.output.length) {
        answer = response.output
          .map(item =>
            item.content?.map(c => c.text || "").join("")
          )
          .join("\n");
      }
    } catch (e) {
      console.error("Parsing error:", e);
    }

    res.json({ answer });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      error: "Something went wrong while processing the chat request.",
    });
  }
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);

  try {
    await buildKnowledgeBase();
  } catch (err) {
    console.error("Initial KB build failed:", err.message);
  }
});
