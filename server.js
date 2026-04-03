import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BASE_URL =
  process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";
const VECTOR_STORE_ID =
  process.env.OPENAI_VECTOR_STORE_ID || "vs_69c695df0a1881919287c9ed05b5cf6c";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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

      console.log("INDEXED:", url);
    } catch (err) {
      console.log("FAILED TO INDEX:", url, err.message);
    }
  }

  kbChunks = chunks;
}

function getContext(query) {
  const q = String(query || "").toLowerCase();

  return kbChunks
    .map((c) => {
      const lower = c.text.toLowerCase();
      let score = 0;

      if (q && lower.includes(q)) score += 10;

      const tokens = q.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (token.length > 2 && lower.includes(token)) {
          score += 2;
        }
      }

      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => c.text)
    .join("\n\n");
}

/* =========================
   CLEANERS
========================= */
function cleanPlainText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* =========================
   PRODUCT SEARCH HELPERS
========================= */
function isJunkTitle(title) {
  const lower = String(title || "").toLowerCase();

  return (
    title.length < 4 ||
    lower.includes("skip") ||
    lower.includes("facebook") ||
    lower.includes("twitter") ||
    lower.includes("linkedin") ||
    lower.includes("email") ||
    lower.includes("search") ||
    lower.includes("navigation") ||
    lower.includes("footer") ||
    lower.includes("shopping cart") ||
    lower.includes("cart") ||
    lower.includes("phone") ||
    lower.includes("road cincinnati") ||
    lower.includes("google") ||
    lower.includes("all categories")
  );
}

function looksProductIntent(message) {
  const lower = String(message || "").toLowerCase();

  return (
    lower.includes("find") ||
    lower.includes("looking for") ||
    lower.includes("show me") ||
    lower.includes("need") ||
    lower.includes("do you have") ||
    lower.includes("where can i find") ||
    lower.includes("drill") ||
    lower.includes("end mill") ||
    lower.includes("endmill") ||
    lower.includes("tap") ||
    lower.includes("reamer") ||
    lower.includes("thread mill") ||
    lower.includes("insert") ||
    lower.includes("tool holder") ||
    lower.includes("collet") ||
    lower.includes("abrasive") ||
    lower.includes("fastener") ||
    lower.includes("saw") ||
    lower.includes("power tool") ||
    lower.includes("hand tool") ||
    lower.includes("safety") ||
    lower.includes("paint") ||
    lower.includes("electrical") ||
    lower.includes("hydraulic")
  );
}

function extractProductQuery(message) {
  const lowerMessage = String(message || "").toLowerCase();

  if (lowerMessage.includes("drill") || lowerMessage.includes("drilling")) return "drilling";
  if (lowerMessage.includes("insert") || lowerMessage.includes("turning")) return "turning";
  if (lowerMessage.includes("end mill")) return "milling";
  if (lowerMessage.includes("mill") || lowerMessage.includes("milling")) return "milling";
  if (lowerMessage.includes("tap") || lowerMessage.includes("thread")) return "threading";
  if (lowerMessage.includes("ream")) return "reaming";
  if (lowerMessage.includes("groov")) return "grooving";
  if (lowerMessage.includes("part")) return "parting";
  if (lowerMessage.includes("boring")) return "boring";

  if (
    lowerMessage.includes("tooling") ||
    lowerMessage.includes("collet") ||
    lowerMessage.includes("tool holder")
  ) return "tooling";

  if (
    lowerMessage.includes("abrasive") ||
    lowerMessage.includes("grinding wheel") ||
    lowerMessage.includes("cutoff wheel") ||
    lowerMessage.includes("flap wheel")
  ) return "abrasives";

  if (
    lowerMessage.includes("fastener") ||
    lowerMessage.includes("nut") ||
    lowerMessage.includes("bolt") ||
    lowerMessage.includes("screw") ||
    lowerMessage.includes("washer") ||
    lowerMessage.includes("anchor") ||
    lowerMessage.includes("rivet") ||
    lowerMessage.includes("threaded rod") ||
    lowerMessage.includes("stud")
  ) return "fasteners";

  if (
    lowerMessage.includes("hole saw") ||
    lowerMessage.includes("bandsaw") ||
    lowerMessage.includes("band saw") ||
    lowerMessage.includes("circular saw") ||
    lowerMessage.includes("reciprocating saw") ||
    lowerMessage.includes("saws")
  ) return "saws";

  if (
    lowerMessage.includes("power tool") ||
    lowerMessage.includes("power drill") ||
    lowerMessage.includes("router") ||
    lowerMessage.includes("nibbler") ||
    lowerMessage.includes("punch press")
  ) return "power tools";

  if (
    lowerMessage.includes("hand tool") ||
    lowerMessage.includes("wrench") ||
    lowerMessage.includes("pliers") ||
    lowerMessage.includes("screwdriver") ||
    lowerMessage.includes("socket") ||
    lowerMessage.includes("ratchet")
  ) return "hand tools";

  if (
    lowerMessage.includes("gage") ||
    lowerMessage.includes("gauge") ||
    lowerMessage.includes("inspection") ||
    lowerMessage.includes("measuring") ||
    lowerMessage.includes("measurement") ||
    lowerMessage.includes("calibration")
  ) return "inspection";

  if (
    lowerMessage.includes("clamp") ||
    lowerMessage.includes("vise") ||
    lowerMessage.includes("workholding") ||
    lowerMessage.includes("fixture") ||
    lowerMessage.includes("lathe chuck")
  ) return "clamping";

  if (
    lowerMessage.includes("adhesive") ||
    lowerMessage.includes("sealant") ||
    lowerMessage.includes("tape")
  ) return "adhesives";

  if (
    lowerMessage.includes("paint") ||
    lowerMessage.includes("spray paint") ||
    lowerMessage.includes("primer") ||
    lowerMessage.includes("coating")
  ) return "paint";

  if (
    lowerMessage.includes("hardware") ||
    lowerMessage.includes("hinge") ||
    lowerMessage.includes("lock") ||
    lowerMessage.includes("bracket")
  ) return "hardware";

  if (
    lowerMessage.includes("ppe") ||
    lowerMessage.includes("safety") ||
    lowerMessage.includes("first aid") ||
    lowerMessage.includes("fire protection")
  ) return "safety";

  if (
    lowerMessage.includes("hvac") ||
    lowerMessage.includes("air conditioner") ||
    lowerMessage.includes("heater") ||
    lowerMessage.includes("thermostat") ||
    lowerMessage.includes("hvac filter") ||
    lowerMessage.includes("hvac filters")
  ) return "hvac";

  if (
    lowerMessage.includes("hydraulic") ||
    lowerMessage.includes("hose") ||
    lowerMessage.includes("pump") ||
    lowerMessage.includes("accumulator")
  ) return "hydraulics";

  if (
    lowerMessage.includes("janitorial") ||
    lowerMessage.includes("sanitation") ||
    lowerMessage.includes("cleaner") ||
    lowerMessage.includes("trash bag") ||
    lowerMessage.includes("trash bags")
  ) return "janitorial";

  if (
    lowerMessage.includes("electrical") ||
    lowerMessage.includes("lighting") ||
    lowerMessage.includes("extension cord") ||
    lowerMessage.includes("extension cords") ||
    lowerMessage.includes("flashlight")
  ) return "electrical";

  if (
    lowerMessage.includes("lubrication") ||
    lowerMessage.includes("lubricant") ||
    lowerMessage.includes("coolant") ||
    lowerMessage.includes("grease")
  ) return "lubrication";

  if (
    lowerMessage.includes("lathe") ||
    lowerMessage.includes("milling machine") ||
    lowerMessage.includes("drill press") ||
    lowerMessage.includes("machinery")
  ) return "machinery";

  if (
    lowerMessage.includes("shelving") ||
    lowerMessage.includes("storage rack") ||
    lowerMessage.includes("storage racks") ||
    lowerMessage.includes("material handling") ||
    lowerMessage.includes("work bench") ||
    lowerMessage.includes("workbench")
  ) return "storage";

  if (lowerMessage.includes("sandvik")) return "sandvik";
  if (lowerMessage.includes("iscar")) return "iscar";
  if (lowerMessage.includes("kyocera")) return "kyocera";
  if (lowerMessage.includes("sgs")) return "sgs";
  if (lowerMessage.includes("guhring")) return "guhring";

  return message;
}

async function searchProducts(keyword) {
  try {
    const kw = String(keyword || "").trim();
    if (!kw) return [];

    const searchUrl = `${BASE_URL}/showgroups.php?kw=${encodeURIComponent(kw)}`;
    const page = await axios.get(searchUrl, { timeout: 20000 });
    const $ = cheerio.load(page.data);

    const results = [];
    const seen = new Set();

    $("a[href*='/catalogue/']").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().replace(/\s+/g, " ").trim();

      if (!href || !title) return;
      if (isJunkTitle(title)) return;
      if (href.includes("javascript")) return;
      if (href.startsWith("#")) return;
      if (href.startsWith("tel:")) return;
      if (href.startsWith("mailto:")) return;
      if (href.includes("basket.php")) return;
      if (href.includes("facebook.com")) return;
      if (href.includes("twitter.com")) return;
      if (href.includes("linkedin.com")) return;
      if (href.includes("google.com")) return;
      if (!href.includes("/catalogue/")) return;

      const cleanHref = href.startsWith("/") ? href.slice(1) : href;

      const fullUrl = href.startsWith("http")
        ? href
        : `${BASE_URL}/${cleanHref}`;

      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

      results.push({
        title,
        url: fullUrl,
      });
    });

    return results.slice(0, 5);
  } catch (err) {
    console.log("PRODUCT SEARCH HELPER ERROR:", err.message);
    return [];
  }
}

function formatRelatedOptionsHtml(productResults) {
  if (!productResults.length) return "";

  let productText = "<br><br><b>Related options:</b><br>";

  productResults.slice(0, 3).forEach((p) => {
    productText += `<a href="${escapeHtml(p.url)}" target="_blank"
      style="
        display:inline-flex;
        align-items:center;
        justify-content:flex-start;
        background:#eef3ff;
        color:#1c50af;
        padding:6px 10px;
        border-radius:14px;
        margin:4px 6px 0 0;
        text-decoration:none;
        font-size:12px;
        border:1px solid #d0dcff;
        text-align:left;
        white-space:nowrap;
      ">
      ${escapeHtml(p.title)}
    </a>`;
  });

  return productText;
}

/* =========================
   STATIC ROUTES
========================= */
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
<title>B.O.B.</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#eef1f6}
.chat{width:100%;max-width:390px;height:520px;margin:auto;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:#f3f4f8}
.header{background:#1c50af;color:#fff;padding:14px;text-align:center;font-weight:bold}
.messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.row{display:flex}
.user{justify-content:flex-end}
.bot{justify-content:flex-start}
.bubble{
  display:inline-block;
  max-width:80%;
  padding:10px 14px;
  border-radius:18px;
  font-size:14px;
  white-space:pre-wrap;
  line-height:1.45;
}
.user .bubble{background:#1c50af;color:#fff;border-bottom-right-radius:6px}
.bot .bubble{background:#fff;border:1px solid #ddd;border-bottom-left-radius:6px}
.input{display:flex;border-top:1px solid #ddd;background:#fff}
.input input{
  flex:1;
  border:none;
  padding:14px;
  font-size:14px;
  outline:none;
}
.input button{
  border:none;
  background:#1c50af;
  color:#fff;
  padding:0 18px;
  cursor:pointer;
  font-size:14px;
}
.typing .bubble{
  display:flex;
  gap:4px;
  align-items:center;
}
.dot{
  width:7px;
  height:7px;
  border-radius:50%;
  background:#888;
  display:inline-block;
  animation:bob 1.1s infinite ease-in-out;
}
.dot:nth-child(2){animation-delay:.15s}
.dot:nth-child(3){animation-delay:.3s}
@keyframes bob{
  0%,80%,100%{transform:scale(.7);opacity:.5}
  40%{transform:scale(1);opacity:1}
}
a{color:#1c50af}
</style>
</head>
<body>
<div class="chat">
  <div class="header">B.O.B. — BLUE'S OPERATION BOT</div>
  <div class="messages" id="messages"></div>
  <div class="input">
    <input id="input" type="text" placeholder="ASK ABOUT TOOLS, MRO, OR BLUE ASH..." />
    <button id="sendBtn" onclick="send()">SEND</button>
  </div>
</div>

<script>
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");

function add(text, who){
  const row = document.createElement("div");
  row.className = "row " + who;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = text;

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}function showTyping(){
  const row = document.createElement("div");
  row.className = "row bot typing";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  for(let i=0;i<3;i++){
    const dot = document.createElement("div");
    dot.className = "dot";
    bubble.appendChild(dot);
  }

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  return row;
}

async function send(){
  const text = input.value.trim();
  if(!text) return;

  add(text, "user");
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  const typingEl = showTyping();

  try{
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    const data = await res.json();
    typingEl.remove();
    add(data.answer || "NO RESPONSE RECEIVED.", "bot");

  }catch(e){
    typingEl.remove();
    add("ERROR CONNECTING TO SERVER.", "bot");
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

input.addEventListener("keydown", e=>{
  if(e.key === "Enter") send();
});

add("HELLO, I AM B.O.B. HOW CAN I HELP YOU TODAY?", "bot");
</script>
</body>
</html>
`);
});

/* =========================
   CHAT ROUTE (VECTOR-BASED)
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({
        answer: "PLEASE ENTER A MESSAGE.",
      });
    }

    const lowerMessage = message.toLowerCase();

    /* =========================
       SIMPLE RESPONSES
    ========================= */
    if (
      lowerMessage.includes("who built you") ||
      lowerMessage.includes("who made you") ||
      lowerMessage.includes("who created you")
    ) {
      return res.json({
        answer:
          "I WAS BUILT FOR BLUE ASH INDUSTRIAL SUPPLY TO HELP WITH TOOLING, PRODUCT QUESTIONS, AND GENERAL COMPANY INFORMATION.",
      });
    }

    if (
      lowerMessage === "hi" ||
      lowerMessage === "hello" ||
      lowerMessage === "hey"
    ) {
      return res.json({
        answer: "HELLO, I AM B.O.B. HOW CAN I HELP YOU TODAY?",
      });
    }

    /* =========================
       PRODUCT SEARCH HELP
    ========================= */
    let relatedOptionsHtml = "";

    if (looksProductIntent(message)) {
      const query = extractProductQuery(message);
      const productResults = await searchProducts(query);
      relatedOptionsHtml = formatRelatedOptionsHtml(productResults);
    }

    /* =========================
       WEBSITE CONTEXT
    ========================= */
    const context = getContext(message);

    /* =========================
       SYSTEM PROMPT
    ========================= */
    const systemPrompt = `
You are B.O.B. for Blue Ash Industrial Supply.

You are a knowledgeable industrial tooling assistant.

Your responsibilities:
- Help users find tools and MRO products
- Provide recommendations based on application
- Use vector store knowledge when available
- Use website context when relevant

Behavior rules:
- Do NOT say you can place orders or quotes
- Always be concise and technical
- Ask clarifying questions when needed
- Prefer practical recommendations
- If unsure, guide user toward better inputs

Company contact:
Phone: (513) 530-0188
Email: sales@blueashsupply.com
`;

    const userPrompt = `
USER MESSAGE:
${message}

WEBSITE CONTEXT:
${context || "NONE"}
`;

    /* =========================
       OPENAI REQUEST
    ========================= */
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        }
      ]
    });

    let answer =
      response.output_text ||
      "I'M SORRY, I COULDN'T GENERATE A RESPONSE.";

    answer = cleanPlainText(answer);

    if (relatedOptionsHtml) {
      answer += relatedOptionsHtml;
    }

    return res.json({ answer });

  } catch (err) {
    console.error("CHAT ERROR:", err);

    return res.status(500).json({
      answer:
        "I'M SORRY, SOMETHING WENT WRONG WHILE PROCESSING THAT REQUEST.",
    });
  }
});

/* =========================
   START SERVER
========================= */
async function startServer() {
  try {
    console.log("STARTING B.O.B...");

    await buildKnowledgeBase();

    app.listen(port, () => {
      console.log(`B.O.B. RUNNING ON PORT ${port}`);
      console.log(`BASE URL: ${BASE_URL}`);
      console.log(`VECTOR STORE: ${VECTOR_STORE_ID}`);
    });

  } catch (err) {
    console.error("STARTUP ERROR:", err);
    process.exit(1);
  }
}

startServer();
