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
      const res = await axios.get(url);
      const $ = cheerio.load(res.data);

      $("script, style, noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const pieces = text.match(/.{1,1200}/g) || [];

      for (const p of pieces) {
        chunks.push({ url, text: p });
      }

      console.log("Indexed:", url);
    } catch (err) {
      console.log("Failed:", url);
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
   CLEAN TEXT
========================= */
function cleanPlainText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

app.use(cors());
app.use(express.json());

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
body{margin:0;font-family:Arial;background:#eef1f6}
.chat{width:100%;max-width:390px;height:520px;margin:auto;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:#f3f4f8}
.header{background:#1c50af;color:#fff;padding:14px;text-align:center;font-weight:bold}
.messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.row{display:flex}
.user{justify-content:flex-end}
.bot{justify-content:flex-start}
.bubble{max-width:80%;padding:10px 14px;border-radius:18px;font-size:14px;white-space:pre-wrap}
.user .bubble{background:#1c50af;color:#fff}
.bot .bubble{background:#fff;border:1px solid #ddd}
.input{display:flex;border-top:1px solid #ddd}
input{flex:1;border:none;padding:12px}
button{background:#1c50af;color:#fff;border:none;width:80px}
</style>
</head>
<body>

<div class="chat">
  <div class="header">B.O.B.</div>
  <div id="messages" class="messages">
    <div class="row bot"><div class="bubble">Hey — I’m B.O.B. 👋</div></div>
  </div>

  <div class="input">
    <input id="msg" placeholder="Ask me anything..." />
    <button onclick="send()">Send</button>
  </div>
</div>

<script>
const messages = document.getElementById("messages");

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

async function send(){
  const input = document.getElementById("msg");
  const text = input.value.trim();
  if(!text) return;

  add(text,"user");
  input.value="";

  const res = await fetch("/chat",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:text})
  });

  const data = await res.json();
  add(data.answer,"bot");
}

document.getElementById("msg").addEventListener("keydown", function(e){
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
   PRODUCT SEARCH (FIXED)
========================= */
app.get("/product-search", async (req, res) => {
  try {
    const kw = String(req.query.kw || "").trim();

    const searchUrl = `${BASE_URL}/showgroups.php?kw=${encodeURIComponent(kw)}`;
    const page = await axios.get(searchUrl);
    const $ = cheerio.load(page.data);

    const results = [];
    const seen = new Set();

    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();

      if (!href || !title) return;

      const cleanHref = href.startsWith("/") ? href.slice(1) : href;

      const fullUrl = href.startsWith("http")
        ? href
        : `${BASE_URL}/${cleanHref}`;

      if (!seen.has(fullUrl)) {
        seen.add(fullUrl);
        results.push({ title, url: fullUrl });
      }
    });

    res.json({ results: results.slice(0, 10) });
  } catch (err) {
    console.log(err);
    res.json({ results: [] });
  }
});

/* =========================
   CHAT
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message) {
      return res.json({ answer: "Ask me something." });
    }

    if (message.toLowerCase().includes("bob stand")) {
      return res.json({
        answer: "B.O.B. stands for Blue's Operation Bot.",
      });
    }

    if (message.toLowerCase().includes("who made")) {
      return res.json({
        answer: "I was built by Trevor at Blue Ash Industrial Supply.",
      });
    }

    const context = getContext(message);

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are B.O.B., a machining and tooling assistant. Answer clearly and simply. No markdown.",
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

    let answer = response.output_text || "No response.";

    answer = cleanPlainText(answer);

    res.json({ answer });
  } catch (err) {
    console.log(err);
    res.json({ answer: "Error occurred." });
  }
});

/* =========================
   START
========================= */
app.listen(port, async () => {
  console.log("Running on port", port);
  await buildKnowledgeBase();
});
