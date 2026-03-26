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
  return kbChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(query, chunk),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ===== EXPRESS =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "BAIS chatbot" });
});

app.get("/widget", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BAIS AI</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: transparent;
    }

    .chat-container {
      width: 100%;
      max-width: 380px;
      height: 520px;
      background: #ffffff;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      overflow: hidden;
      border: 1px solid #e6e6e6;
    }

    .chat-header {
      background: #1c50af;
      color: white;
      padding: 14px 16px;
      font-weight: bold;
      font-size: 16px;
      text-align: center;
      letter-spacing: 0.3px;
    }

    .chat-messages {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      background: #f7f9fc;
      font-size: 14px;
    }

    .msg {
      max-width: 78%;
      padding: 10px 12px;
      border-radius: 12px;
      margin-bottom: 10px;
      line-height: 1.45;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .user {
      background: #1c50af;
      color: white;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }

    .bot {
      background: #e9edf5;
      color: #333;
      margin-right: auto;
      border-bottom-left-radius: 4px;
    }

    .chat-input {
      display: flex;
      border-top: 1px solid #ddd;
      background: white;
    }

    .chat-input input {
      flex: 1;
      padding: 12px;
      border: none;
      outline: none;
      font-size: 14px;
    }

    .chat-input button {
      background: #1c50af;
      color: white;
      border: none;
      padding: 0 18px;
      cursor: pointer;
      font-weight: bold;
      min-width: 72px;
    }

    .chat-input button:hover {
      background: #17428f;
    }

    .chat-input button:disabled {
      background: #7d9ed8;
      cursor: not-allowed;
    }

    .typing {
      opacity: 0.8;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">BAIS AI Assistant</div>

    <div class="chat-messages" id="messages">
      <div class="msg bot">Hi there — how can I help you today?</div>
    </div>

    <div class="chat-input">
      <input id="input" placeholder="Ask about products, vendors, or services..." />
      <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>
  </div>

  <script>
    const history = [];

    function escapeHtml(str) {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function addMessage(text, type, extraClass = "") {
      const messages = document.getElementById("messages");
      const div = document.createElement("div");
      div.className = "msg " + type + (extraClass ? " " + extraClass : "");
      div.innerHTML = escapeHtml(text);
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    async function sendMessage() {
      const input = document.getElementById("input");
      const sendBtn = document.getElementById("sendBtn");
      const text = input.value.trim();

      if (!text) return;

      addMessage(text, "user");
      history.push({ role: "user", content: text });

      input.value = "";
      input.disabled = true;
      sendBtn.disabled = true;

      const typingMsg = addMessage("BAIS AI is typing...", "bot", "typing");

      try {
        const res = await fetch("/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: text,
            history
          })
        });

        const data = await res.json();
        typingMsg.remove();

        const answer = data.answer || "Sorry, I couldn't generate a response.";
        addMessage(answer, "bot");
        history.push({ role: "assistant", content: answer });
      } catch (err) {
        typingMsg.remove();
        addMessage("Sorry, something went wrong. Please try again.", "bot");
      } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }

    document.getElementById("input").addEventListener("keydown", function(event) {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
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
          .join("\\n\\n")
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

  try {
    await buildKnowledgeBase();
  } catch (err) {
    console.error("Initial KB build failed:", err.message);
  }
});
