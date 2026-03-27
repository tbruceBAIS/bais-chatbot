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

  return score;
}

async function fetchPage(url) {
  const res = await axios.get(url, { timeout: 20000 });
  const $ = cheerio.load(res.data);

  $("script, style").remove();

  const text = normalizeText($("body").text());

  return {
    url,
    text,
  };
}

async function buildKnowledgeBase() {
  console.log("Building KB...");

  const allChunks = [];

  for (const url of FALLBACK_URLS) {
    try {
      const page = await fetchPage(url);
      const pieces = chunkText(page.text);

      for (const piece of pieces) {
        allChunks.push({
          url: page.url,
          text: piece,
        });
      }

      console.log("Indexed:", url);
    } catch (err) {
      console.warn("Failed:", url);
    }
  }

  kbChunks = allChunks;
  kbLastBuiltAt = Date.now();
}

async function ensureKnowledgeBase() {
  if (!kbChunks.length) {
    await buildKnowledgeBase();
  }
}

function getTopChunks(query, limit = 5) {
  return kbChunks
    .map((c) => ({
      ...c,
      score: scoreChunk(query, c),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

app.use(cors());
app.use(express.json());

/* =========================
   WIDGET
========================= */
app.get("/widget", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>BAIS AI</title>
<style>
body{font-family:Arial;background:#f5f7fb}
.chat{width:350px;margin:20px auto;border-radius:12px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.2)}
.header{background:#1c50af;color:#fff;padding:12px;text-align:center;font-weight:bold}
.messages{height:400px;overflow:auto;padding:10px;background:#eef2f9}
.msg{margin:6px 0;padding:8px;border-radius:8px}
.user{background:#1c50af;color:#fff;text-align:right}
.bot{background:#ddd}
.input{display:flex}
input{flex:1;padding:10px;border:none}
button{background:#1c50af;color:#fff;border:none;padding:10px}
</style>
</head>
<body>
<div class="chat">
<div class="header">BAIS AI Assistant</div>
<div id="messages" class="messages"></div>
<div class="input">
<input id="msg"/>
<button onclick="send()">Send</button>
</div>
</div>

<script>
async function send(){
  const text=document.getElementById("msg").value;

  const messages=document.getElementById("messages");
  messages.innerHTML+=\`<div class="msg user">\${text}</div>\`;

  const res=await fetch("/chat",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:text})
  });

  const data=await res.json();

  messages.innerHTML+=\`<div class="msg bot">\${data.answer}</div>\`;

  document.getElementById("msg").value="";
  messages.scrollTop=messages.scrollHeight;
}
</script>
</body>
</html>
`);
});

/* =========================
   CHAT
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    await ensureKnowledgeBase();
    const topChunks = getTopChunks(message);

    const context = topChunks.map(c => c.text).join("\n\n");

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: "You are a helpful assistant for Blue Ash Industrial Supply."
        },
        {
          role: "user",
          content: message + "\\n\\nContext:\\n" + context
        }
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID]
        }
      ]
    });

    let answer = "Sorry, I couldn't generate a response.";

    try {
      if (response.output_text) {
        answer = response.output_text;
      } else if (response.output) {
        answer = response.output.map(o =>
          o.content?.map(c => c.text || "").join("")
        ).join("\\n");
      }
    } catch (e) {
      console.error(e);
    }

    res.json({ answer });

  } catch (err) {
    console.error(err);
    res.json({ answer: "Error occurred." });
  }
});

app.listen(port, async () => {
  console.log("Running on", port);
  await buildKnowledgeBase();
});
