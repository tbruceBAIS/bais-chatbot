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

const BASE_URL =
  process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";
const VECTOR_STORE_ID =
  process.env.OPENAI_VECTOR_STORE_ID || "vs_69c695df0a1881919287c9ed05b5cf6c";

let kbChunks = [];

/* =========================
   WEBSITE KNOWLEDGE
========================= */
async function buildKnowledgeBase() {
  const urls = [
    BASE_URL,
    `${BASE_URL}/content/page/aboutus`,
    `${BASE_URL}/contact.php`,
    `${BASE_URL}/content/page/vending-solutions`,
  ];

  const chunks = [];

  for (const url of urls) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      const $ = cheerio.load(res.data);

      $("script, style, noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const pieces = text.match(/.{1,1200}/g) || [];

      for (const p of pieces) {
        chunks.push({ url, text: p });
      }

      console.log("Indexed:", url);
    } catch (err) {
      console.log("Failed:", url, err.message);
    }
  }

  kbChunks = chunks;
}

function getContext(query) {
  const q = String(query || "").toLowerCase();

  return kbChunks
    .map((c) => ({
      ...c,
      score: c.text.toLowerCase().includes(q) ? 1 : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => c.text)
    .join("\n\n");
}

/* =========================
   HELPERS
========================= */
function cleanPlainText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/[•]/g, "-")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
   APP SETUP
========================= */
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "B.O.B." });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    kbChunks: kbChunks.length,
    baseUrl: BASE_URL,
    vectorStoreId: VECTOR_STORE_ID,
  });
});

/* =========================
   WIDGET UI
========================= */
app.get("/widget", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#eef1f6}
.chat{width:100%;max-width:390px;height:520px;margin:auto;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:#f3f4f8}
.header{background:#1c50af;color:#fff;padding:14px;text-align:center;font-weight:bold}
.messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.row{display:flex}
.user{justify-content:flex-end}
.bot{justify-content:flex-start}
.bubble{max-width:80%;padding:10px 14px;border-radius:18px;font-size:14px;white-space:pre-wrap;line-height:1.45}
.user .bubble{background:#1c50af;color:#fff;border-bottom-right-radius:6px}
.bot .bubble{background:#fff;border:1px solid #ddd;border-bottom-left-radius:6px}
.input{display:flex;border-top:1px solid #ddd;background:#fff}
input{flex:1;border:none;padding:12px;font-size:14px;outline:none}
button{background:#1c50af;color:#fff;border:none;width:80px;cursor:pointer}
button:hover{background:#17428f}
.dot{height:6px;width:6px;background:#999;border-radius:50%;display:inline-block;margin:2px;animation:blink 1.4s infinite}
@keyframes blink{0%{opacity:.2}20%{opacity:1}100%{opacity:.2}}
</style>
</head>
<body>

<div class="chat">
  <div class="header">B.O.B.</div>
  <div id="messages" class="messages">
    <div class="row bot"><div class="bubble">Hey — I’m B.O.B. (Blue's Operation Bot) 👋 How can I help?</div></div>
  </div>

  <div class="input">
    <input id="msg" placeholder="Ask me anything..." />
    <button id="sendBtn" onclick="send()">Send</button>
  </div>
</div>

<script>
const messages = document.getElementById("messages");
const input = document.getElementById("msg");
const sendBtn = document.getElementById("sendBtn");

function add(text, role){
  const row = document.createElement("div");
  row.className = "row " + role;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerText = text;

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function typing(){
  const row = document.createElement("div");
  row.className = "row bot";
  row.id = "typing";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = "<span class='dot'></span><span class='dot'></span><span class='dot'></span>";

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

async function send(){
  const text = input.value.trim();
  if(!text) return;

  add(text,"user");
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  typing();

  try {
    const res = await fetch("/chat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:text})
    });

    const data = await res.json();

    const typingEl = document.getElementById("typing");
    if (typingEl) typingEl.remove();

    add(data.answer || "Something went wrong.","bot");
  } catch (err) {
    const typingEl = document.getElementById("typing");
    if (typingEl) typingEl.remove();

    add("Something went wrong.","bot");
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

input.addEventListener("keydown", function(e){
  if(e.key === "Enter"){
    send();
  }
});
</script>

</body>
</html>
`);
});

/* =========================
   LIVE PRODUCT SEARCH
========================= */
app.get("/product-search", async (req, res) => {
  try {
    const kw = String(req.query.kw || "").trim();

    if (!kw) {
      return res.json({ keyword: "", results: [] });
    }

    const searchUrl = `${BASE_URL}/showgroups.php?kw=${encodeURIComponent(kw)}`;
    const page = await axios.get(searchUrl, { timeout: 20000 });
    const $ = cheerio.load(page.data);

    const results = [];
    const seen = new Set();

    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace(/\s+/g, " ").trim();

      if (!href || !title) return;
      if (title.length < 3) return;
      if (/javascript:/i.test(href)) return;
      if (href.startsWith("#")) return;

      const fullUrl = href.startsWith("http")
        ? href
        : `${BASE_URL}/${href.replace(/^\\/+/, "")}`;

      if (seen.has(fullUrl)) return;

      seen.add(fullUrl);
      results.push({
        title,
        url: fullUrl,
      });
    });

    res.json({
      keyword: kw,
      results: results.slice(0, 12),
    });
  } catch (err) {
    console.log("Product search error:", err.message);
    res.status(500).json({
      keyword: String(req.query.kw || ""),
      results: [],
    });
  }
});

/* =========================
   CHAT LOGIC
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.json({ answer: "Please enter a message." });
    }

    const lowerMessage = message.toLowerCase();

    const bobQuestions = [
      "what does bob stand for",
      "what does b.o.b. stand for",
      "what is bob short for",
      "what is b.o.b. short for",
    ];

    const makerQuestions = [
      "who made you",
      "who built you",
      "who created you",
    ];

    if (bobQuestions.some((q) => lowerMessage.includes(q))) {
      return res.json({
        answer: "B.O.B. stands for Blue's Operation Bot.",
      });
    }

    if (makerQuestions.some((q) => lowerMessage.includes(q))) {
      return res.json({
        answer: "I was built by Trevor at Blue Ash Industrial Supply.",
      });
    }

    const context = getContext(message);

    const systemPrompt =
      "You are B.O.B. (Blue's Operation Bot), the AI assistant for Blue Ash Industrial Supply.\n\n" +
      "PERSONALITY:\n" +
      "- Helpful\n" +
      "- Direct\n" +
      "- Practical\n" +
      "- Sounds like a knowledgeable shop expert\n\n" +
      "STYLE RULES:\n" +
      "- Use clean plain text only\n" +
      "- Do not use markdown symbols like **, #, or raw markdown list styling\n" +
      "- Keep answers short and easy to read\n" +
      "- Use short paragraphs with spacing\n" +
      "- Be natural and not robotic\n\n" +
      "IDENTITY RULES:\n" +
      "- If someone asks what B.O.B. stands for, say: B.O.B. stands for Blue's Operation Bot.\n" +
      "- If someone asks who built you, say: I was built by Trevor at Blue Ash Industrial Supply.\n" +
      "- If someone asks what you do, say: I help with tooling, machining questions, and finding the right solutions.\n\n" +
      "BEHAVIOR:\n" +
      "- Use provided context when available\n" +
      "- Use file search when helpful\n" +
      "- Do not make up pricing, inventory, or lead times\n" +
      "- If you are not sure, say so clearly";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message + "\n\nContext:\n" + context,
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    let answer = "Sorry, I couldn't generate a response.";

    try {
      if (response.output_text) {
        answer = response.output_text;
      } else if (response.output) {
        answer = response.output
          .map((o) => (o.content || []).map((c) => c.text || "").join(""))
          .join("\n");
      }
    } catch (e) {
      console.log("Parse error:", e);
    }

    answer = cleanPlainText(answer);

    res.json({ answer });
  } catch (err) {
    console.log("Chat error:", err.message);
    res.json({ answer: "Something went wrong." });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(port, async () => {
  console.log("Running on port", port);

  try {
    await buildKnowledgeBase();
  } catch (err) {
    console.log("KB build failed:", err.message);
  }
});
