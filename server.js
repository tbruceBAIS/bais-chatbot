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

/* =========================
   BASIC KB (WEBSITE)
========================= */
async function buildKnowledgeBase() {
  const urls = [
    BASE_URL,
    BASE_URL + "/content/page/aboutus",
    BASE_URL + "/contact.php",
    BASE_URL + "/content/page/vending-solutions",
  ];

  const chunks = [];

  for (const url of urls) {
    try {
      const res = await axios.get(url);
      const $ = cheerio.load(res.data);

      $("script, style").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const pieces = text.match(/.{1,1200}/g) || [];

      for (const p of pieces) {
        chunks.push({ url, text: p });
      }

      console.log("Indexed:", url);
    } catch {
      console.log("Failed:", url);
    }
  }

  kbChunks = chunks;
}

function getContext(query) {
  return kbChunks
    .map(c => ({
      ...c,
      score: c.text.toLowerCase().includes(query.toLowerCase()) ? 1 : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(c => c.text)
    .join("\n\n");
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
.bubble{max-width:80%;padding:10px 14px;border-radius:18px;font-size:14px}
.user .bubble{background:#1c50af;color:#fff;border-bottom-right-radius:6px}
.bot .bubble{background:#fff;border:1px solid #ddd;border-bottom-left-radius:6px}
.input{display:flex;border-top:1px solid #ddd}
input{flex:1;border:none;padding:12px}
button{background:#1c50af;color:#fff;border:none;width:80px}
.dot{height:6px;width:6px;background:#999;border-radius:50%;display:inline-block;margin:2px;animation:blink 1.4s infinite}
@keyframes blink{0%{opacity:.2}20%{opacity:1}100%{opacity:.2}}
</style>
</head>
<body>

<div class="chat">
  <div class="header">BAIS AI Assistant</div>
  <div id="messages" class="messages">
    <div class="row bot"><div class="bubble">Hi! How can I help you today?</div></div>
  </div>

  <div class="input">
    <input id="msg" placeholder="Ask something...">
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

function typing(){
  const row = document.createElement("div");
  row.className = "row bot";
  row.id = "typing";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  bubble.innerHTML = "<span class='dot'></span><span class='dot'></span><span class='dot'></span>";

  row.appendChild(bubble);
  messages.appendChild(row);
}

async function send(){
  const input = document.getElementById("msg");
  const text = input.value;
  if(!text) return;

  add(text,"user");
  input.value="";

  typing();

  const res = await fetch("/chat",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:text})
  });

  const data = await res.json();

  document.getElementById("typing").remove();
  add(data.answer,"bot");
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

    const context = getContext(message);

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
    } catch (e) {}

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
