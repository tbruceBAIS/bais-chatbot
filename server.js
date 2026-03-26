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

// ===== SIMPLE WEBSITE KB CACHE =====
let kbChunks = [];
let kbLastBuiltAt = 0;
const KB_TTL_MS = 1000 * 60 * 30; // 30 minutes

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
    if (chunk.title?.toLowerCase().includes(word)) score += 3;
    if (chunk.h1?.toLowerCase().includes(word)) score += 4;
    if (chunk.url?.toLowerCase().includes(word)) score += 2;
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
    } catch {
      // try next sitemap candidate
    }
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
  const scored = kbChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(query, chunk),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

// ===== EXPRESS =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "BAIS chatbot" });
});

app.get("/widget", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>BAIS AI</title>
  <style>
    body {
      font-family: Arial;
      background: #f5f7fa;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
    }
    .chat-container {
      width: 400px;
      height: 500px;
      background: white;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      overflow: hidden;
    }
    .chat-header {
      background: #1c50af;
      color: white;
      padding: 12px;
      font-weight: bold;
      text-align: center;
    }
    .chat-messages {
      flex: 1;
      padding: 10px;
      overflow-y: auto;
      font-size: 14px;
    }
    .msg {
      margin-bottom: 10px;
    }
    .user {
      text-align: right;
      color: #1c50af;
    }
    .bot {
      text-align: left;
      color: #333;
    }
    .chat-input {
      display: flex;
      border-top: 1px solid #ddd;
    }
    .chat-input input {
      flex: 1;
      padding: 10px;
      border: none;
      outline: none;
    }
    .chat-input button {
      background: #1c50af;
      color: white;
      border: none;
      padding: 10px 15px;
      cursor: pointer;
    }
  </style>
</head>
<body>

<div class="chat-container">
  <div class="chat-header">BAIS AI Assistant</div>
  <div class="chat-messages" id="messages"></div>

  <div class="chat-input">
    <input id="input" placeholder="Ask something..." />
    <button onclick="send()">Send</button>
  </div>
</div>

<script>
async function send() {
  const input = document.getElementById("input");
  const messages = document.getElementById("messages");

  const text = input.value.trim();
  if (!text) return;

  messages.innerHTML += '<div class="msg user">' + text + '</div>';
  input.value = "";

  const res = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: text })
  });

  const data = await res.json();

  messages.innerHTML += '<div class="msg bot">' + data.answer + '</div>';
  messages.scrollTop = messages.scrollHeight;
}
</script>

</body>
</html>
  `);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    kbChunks: kbChunks.length,
    kbLastBuiltAt,
  });
});

app.post("/refresh-kb", async (_req, res) => {
  try {
    await buildKnowledgeBase();
    res.json({ ok: true, chunks: kbChunks.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to rebuild knowledge base." });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    await ensureKnowledgeBase();

    const topChunks = getTopChunks(message, 6);

    const websiteContext = topChunks.length
      ? topChunks
          .map(
            (c, i) => `
[Source ${i + 1}]
URL: ${c.url}
Title: ${c.title || "N/A"}
H1: ${c.h1 || "N/A"}
Content: ${c.text}
`.trim()
          )
          .join("\n\n")
      : "No relevant website content was found.";

    const recentHistory = history.slice(-6).map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: String(msg.content || ""),
    }));

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are BAIS Bot for Blue Ash Industrial Supply.

Rules:
- Answer using the website context when it is relevant.
- If the answer is not clearly supported by the website context, say that you are not sure based on the website.
- Do not make up policies, pricing, inventory, lead times, or contact details.
- Be concise and helpful.
- If useful, mention the page URL you used.
`.trim(),
        },
        ...recentHistory,
        {
          role: "user",
          content: `
Customer question:
${message}

Website context:
${websiteContext}
`.trim(),
        },
      ],
    });

    const answer =
      completion.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    res.json({
      answer,
      sources: topChunks.map((c) => ({
        url: c.url,
        title: c.title || c.h1 || c.url,
      })),
    });
  } catch (err) {
    console.error("Chat error:", err?.response?.data || err.message || err);
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
