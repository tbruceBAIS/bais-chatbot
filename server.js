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
    } catch (_err) {
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "BAIS chatbot" });
});

app.get("/widget", (_req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BAIS AI</title>
  <style>
    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      font-family: Arial, sans-serif;
    }

    body {
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    .chat-container {
      width: 100%;
      max-width: 390px;
      height: 520px;
      background: #ffffff;
      border: 1px solid #dfe5ef;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.16);
      display: flex;
      flex-direction: column;
    }

    .chat-header {
      background: #1c50af;
      color: #fff;
      padding: 14px 16px;
      text-align: center;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: 0.2px;
    }

    .chat-messages {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      background: #f6f8fc;
    }

    .msg {
      max-width: 78%;
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      line-height: 1.45;
      font-size: 14px;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .msg.bot {
      background: #e9eef7;
      color: #1f2937;
      margin-right: auto;
      border-bottom-left-radius: 4px;
    }

    .msg.user {
      background: #1c50af;
      color: #ffffff;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }

    .typing {
      opacity: 0.8;
      font-style: italic;
    }

    .chat-input {
      display: flex;
      align-items: center;
      gap: 0;
      border-top: 1px solid #dfe5ef;
      background: #fff;
    }

    .chat-input input {
      flex: 1;
      border: 0;
      outline: none;
      padding: 13px 14px;
      font-size: 14px;
      background: #fff;
    }

    .chat-input button {
      border: 0;
      background: #1c50af;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      min-width: 72px;
      height: 46px;
    }

    .chat-input button:hover {
      background: #17428f;
    }

    .chat-input button:disabled {
      background: #89a7dd;
      cursor: not-allowed;
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
      <input id="input" type="text" placeholder="Ask about products, vendors, or services..." />
      <button id="sendBtn" type="button">Send</button>
    </div>
  </div>

  <script>
    const history = [];
    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("input");
    const sendBtnEl = document.getElementById("sendBtn");

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function addMessage(text, role, extraClass) {
      const div = document.createElement("div");
      div.className = "msg " + role + (extraClass ? " " + extraClass : "");
      div.innerHTML = escapeHtml(text);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;

      addMessage(text, "user");
      history.push({ role: "user", content: text });

      inputEl.value = "";
      inputEl.disabled = true;
      sendBtnEl.disabled = true;

      const typingEl = addMessage("BAIS AI is typing...", "bot", "typing");

      try {
        const res = await fetch("/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: text,
            history: history
          })
        });

        const data = await res.json();
        typingEl.remove();

        const answer = data && data.answer
          ? data.answer
          : "Sorry, I couldn't generate a response.";

        addMessage(answer, "bot");
        history.push({ role: "assistant", content: answer });
      } catch (_err) {
        typingEl.remove();
        addMessage("Sorry, something went wrong. Please try again.", "bot");
      } finally {
        inputEl.disabled = false;
        sendBtnEl.disabled = false;
        inputEl.focus();
      }
    }

    sendBtnEl.addEventListener("click", sendMessage);

    inputEl.addEventListener("keydown", function(event) {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
  </script>
</body>
</html>
  `;

  res.type("html").send(html);
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
    const message = String(req.body && req.body.message ? req.body.message : "").trim();
    const history = Array.isArray(req.body && req.body.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    await ensureKnowledgeBase();

    const topChunks = getTopChunks(message, 6);

    const websiteContext = topChunks.length
      ? topChunks
          .map((c, i) => {
            return [
              `[Source ${i + 1}]`,
              `URL: ${c.url}`,
              `Title: ${c.title || "N/A"}`,
              `H1: ${c.h1 || "N/A"}`,
              `Content: ${c.text}`,
            ].join("\n");
          })
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
          content: [
            "You are BAIS Bot for Blue Ash Industrial Supply.",
            "",
            "Rules:",
            "- Answer using the website context when it is relevant.",
            "- If the answer is not clearly supported by the website context, say that you are not sure based on the website.",
            "- Do not make up policies, pricing, inventory, lead times, or contact details.",
            "- Be concise and helpful.",
            "- If useful, mention the page URL you used.",
          ].join("\n"),
        },
        ...recentHistory,
        {
          role: "user",
          content: [
            "Customer question:",
            message,
            "",
            "Website context:",
            websiteContext,
          ].join("\n"),
        },
      ],
    });

    const answer =
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
        ? completion.choices[0].message.content
        : "Sorry, I couldn't generate a response.";

    res.json({
      answer,
      sources: topChunks.map((c) => ({
        url: c.url,
        title: c.title || c.h1 || c.url,
      })),
    });
  } catch (err) {
    console.error("Chat error:", err && err.message ? err.message : err);
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
