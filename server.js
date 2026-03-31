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
   CLEAN TEXT
========================= */
function cleanPlainText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================
   PRODUCT SEARCH HELPERS
========================= */
function isJunkTitle(title) {
  const lower = title.toLowerCase();

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

  const productKeywords = [
    "drill",
    "drills",
    "insert",
    "inserts",
    "mill",
    "mills",
    "end mill",
    "tap",
    "taps",
    "tool",
    "tools",
    "holder",
    "holders",
    "sandvik",
    "iscar",
    "kyocera",
    "sgs",
    "carbide",
    "thread",
    "threading",
    "boring",
    "grooving",
    "parting",
    "reamer",
    "reaming",
    "coolant",
    "cutting fluid",
    "show me",
    "do you carry",
    "do you have",
    "looking for",
    "recommend a",
    "recommend me",
    "need a",
    "need an"
  ];

  return productKeywords.some((k) => lower.includes(k));
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
  if (lowerMessage.includes("holder")) return "tool holder";
  if (lowerMessage.includes("coolant")) return "coolant";
  if (lowerMessage.includes("cutting fluid")) return "cutting fluid";
  if (lowerMessage.includes("sandvik")) return "sandvik";
  if (lowerMessage.includes("iscar")) return "iscar";
  if (lowerMessage.includes("kyocera")) return "kyocera";
  if (lowerMessage.includes("sgs")) return "sgs";

  return String(message || "").trim();
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
    console.log("Product search helper error:", err.message);
    return [];
  }
}

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
.bubble {
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
  bubble.innerHTML = text;

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
   PRODUCT SEARCH ROUTE
========================= */
app.get("/product-search", async (req, res) => {
  try {
    const kw = String(req.query.kw || "").trim();

    if (!kw) {
      return res.json({ results: [] });
    }

    const results = await searchProducts(kw);
    res.json({ results });
  } catch (err) {
    console.log("Product search route error:", err.message);
    res.json({ results: [] });
  }
});

/* =========================
   CHAT
========================= */
const greetings = [
  "Hey — what can I help you find today?",
  "Welcome to Blue Ash Industrial Supply. What are you looking for?",
  "Need help finding a product? I’ve got you.",
  "Hey there — what are we working on today?",
  "Looking for something specific or just browsing?"
];

function getRandomGreeting() {
  return greetings[Math.floor(Math.random() * greetings.length)];
}

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const lowerMessage = message.toLowerCase();

    if (!message) {
      return res.json({ answer: "Ask me something." });
    }

    const isGreeting =
      lowerMessage === "hi" ||
      lowerMessage === "hello" ||
      lowerMessage === "hey";

    if (isGreeting) {
      return res.json({
        answer: getRandomGreeting()
      });
    }

    if (
      lowerMessage.includes("bob stand") ||
      lowerMessage.includes("b.o.b. stand") ||
      lowerMessage.includes("what does bob mean")
    ) {
      return res.json({
        answer: "B.O.B. stands for Blue's Operation Bot."
      });
    }

    if (
      lowerMessage.includes("who made you") ||
      lowerMessage.includes("who built you") ||
      lowerMessage.includes("who created you")
    ) {
      return res.json({
        answer: "I was built by Trevor at Blue Ash Industrial Supply."
      });
    }

    const context = getContext(message);

    let productResults = [];

    if (looksProductIntent(message)) {
      let productQuery = extractProductQuery(message);

      if (productQuery === "drilling") {
        if (lowerMessage.includes("drill insert") || lowerMessage.includes("drill inserts")) {
          productResults = [
            { title: "Drill Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/150" }
          ];
        }
        else if (
          lowerMessage.includes("solid carbide drill") ||
          lowerMessage.includes("solid carbide drills") ||
          lowerMessage.includes("carbide drill") ||
          lowerMessage.includes("carbide drills")
        ) {
          productResults = [
            { title: "Solid Carbide Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6210" }
          ];
        }
        else if (
          lowerMessage.includes("hss drill") ||
          lowerMessage.includes("hss drills") ||
          lowerMessage.includes("co drill") ||
          lowerMessage.includes("co drills") ||
          lowerMessage.includes("hss/co drill") ||
          lowerMessage.includes("hss/co drills")
        ) {
          productResults = [
            { title: "HSS/Co Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6211" }
          ];
        }
        else if (
          lowerMessage.includes("center drill") ||
          lowerMessage.includes("center drills") ||
          lowerMessage.includes("spot drill") ||
          lowerMessage.includes("spot drills") ||
          lowerMessage.includes("center and spot")
        ) {
          productResults = [
            { title: "Center and Spot Solid Drill Bits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/162" }
          ];
        }
        else {
          productResults = [
            { title: "Drilling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6201" },
            { title: "Drill Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/150" },
            { title: "HSS/Co Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6211" },
            { title: "Solid Carbide Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6210" },
            { title: "Center and Spot Solid Drill Bits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/162" }
          ];
        }
      }
      else if (productQuery === "turning") {
        if (lowerMessage.includes("external turning")) {
          productResults = [
            { title: "External Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6101" }
          ];
        }
        else if (
          lowerMessage.includes("internal turning") ||
          lowerMessage.includes("boring bar") ||
          lowerMessage.includes("boring bars")
        ) {
          productResults = [
            { title: "Internal Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6102" }
          ];
        }
        else if (
          lowerMessage.includes("thread turning") ||
          lowerMessage.includes("single point thread") ||
          lowerMessage.includes("thread insert")
        ) {
          productResults = [
            { title: "Thread Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" }
          ];
        }
        else if (
          lowerMessage.includes("insert") ||
          lowerMessage.includes("inserts")
        ) {
          productResults = [
            { title: "Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6100" },
            { title: "External Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6101" },
            { title: "Internal Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6102" },
            { title: "Thread Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" }
          ];
        }
        else {
          productResults = [
            { title: "Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6100" },
            { title: "External Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6101" },
            { title: "Internal Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6102" },
            { title: "Thread Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" }
          ];
        }
      }
      else if (productQuery === "threading") {
        if (
          lowerMessage.includes("thread turning") ||
          lowerMessage.includes("single point thread") ||
          lowerMessage.includes("thread insert")
        ) {
          productResults = [
            { title: "Thread Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" }
          ];
        }
        else if (
          lowerMessage.includes("tap") ||
          lowerMessage.includes("taps")
        ) {
          productResults = [
            { title: "Taps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" }
          ];
        }
        else if (
          lowerMessage.includes("die") ||
          lowerMessage.includes("dies")
        ) {
          productResults = [
            { title: "Dies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6302" }
          ];
        }
        else if (
          lowerMessage.includes("thread mill") ||
          lowerMessage.includes("thread mills")
        ) {
          productResults = [
            { title: "Thread Mills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6303" }
          ];
        }
        else {
          productResults = [
            { title: "Threading", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6300" },
            { title: "Thread Turning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" },
            { title: "Taps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" },
            { title: "Dies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6302" },
            { title: "Thread Mills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6303" }
          ];
        }
      }
      else if (productQuery === "milling") {
        if (
          lowerMessage.includes("solid end mill") ||
          lowerMessage.includes("solid carbide end mill") ||
          lowerMessage.includes("solid milling")
        ) {
          productResults = [
            { title: "Solid Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6001" }
          ];
        }
        else if (
          lowerMessage.includes("indexable mill") ||
          lowerMessage.includes("indexable milling") ||
          lowerMessage.includes("face mill") ||
          lowerMessage.includes("face mills") ||
          lowerMessage.includes("shell mill")
        ) {
          productResults = [
            { title: "Indexable Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6002" }
          ];
        }
        else if (
          lowerMessage.includes("milling kit") ||
          lowerMessage.includes("milling kits")
        ) {
          productResults = [
            { title: "Milling Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6003" }
          ];
        }
        else if (
          lowerMessage.includes("end mill") ||
          lowerMessage.includes("end mills")
        ) {
          productResults = [
            { title: "Solid Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6001" },
            { title: "Indexable Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6002" }
          ];
        }
        else {
          productResults = [
            { title: "Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6000" },
            { title: "Solid Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6001" },
            { title: "Indexable Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6002" },
            { title: "Milling Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6003" }
          ];
        }
      }
      else if (productQuery === "reaming") {
        if (
          lowerMessage.includes("reamer accessory") ||
          lowerMessage.includes("reamer accessories")
        ) {
          productResults = [
            { title: "Reamer Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/50" }
          ];
        }
        else if (
          lowerMessage.includes("shell reamer") ||
          lowerMessage.includes("head reamer") ||
          lowerMessage.includes("shell/head reaming")
        ) {
          productResults = [
            { title: "Shell/Head Reaming Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/90" },
            { title: "Reaming Shell/Head Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/96" }
          ];
        }
        else if (
          lowerMessage.includes("reamer kit") ||
          lowerMessage.includes("reamer kits")
        ) {
          productResults = [
            { title: "Reamer Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/92" }
          ];
        }
        else if (
          lowerMessage.includes("indexable reamer insert") ||
          lowerMessage.includes("indexable reamer inserts") ||
          lowerMessage.includes("reamer insert") ||
          lowerMessage.includes("reamer inserts")
        ) {
          productResults = [
            { title: "Indexable Reamer Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/94" },
            { title: "Reaming Shell/Head Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/96" }
          ];
        }
        else if (
          lowerMessage.includes("indexable reamer body") ||
          lowerMessage.includes("indexable reamer bodies") ||
          lowerMessage.includes("reamer body") ||
          lowerMessage.includes("reamer bodies")
        ) {
          productResults = [
            { title: "Indexable Reamer Bodies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/98" }
          ];
        }
        else if (
          lowerMessage.includes("solid reamer") ||
          lowerMessage.includes("solid reamers") ||
          lowerMessage.includes("brazed reamer") ||
          lowerMessage.includes("brazed reamers")
        ) {
          productResults = [
            { title: "Solid/Brazed Reamers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6220" }
          ];
        }
        else if (
          lowerMessage.includes("reamer") ||
          lowerMessage.includes("reamers")
        ) {
          productResults = [
            { title: "Reaming", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6202" },
            { title: "Solid/Brazed Reamers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6220" },
            { title: "Indexable Reamer Bodies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/98" },
            { title: "Indexable Reamer Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/94" }
          ];
        }
        else {
          productResults = [
            { title: "Reaming", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6202" },
            { title: "Solid/Brazed Reamers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6220" },
            { title: "Indexable Reamer Bodies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/98" },
            { title: "Indexable Reamer Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/94" },
            { title: "Shell/Head Reaming Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/90" },
            { title: "Reaming Shell/Head Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/96" },
            { title: "Reamer Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/92" },
            { title: "Reamer Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/50" }
          ];
        }
      }
      else if (productQuery === "grooving" || productQuery === "parting") {
        if (
          lowerMessage.includes("solid groove") ||
          lowerMessage.includes("solid grooving") ||
          lowerMessage.includes("brazed groove") ||
          lowerMessage.includes("brazed grooving") ||
          lowerMessage.includes("solid and brazed")
        ) {
          productResults = [
            { title: "Solid and Brazed Groove/Turn & Part Off", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/14" }
          ];
        }
        else if (
          lowerMessage.includes("face groove insert") ||
          lowerMessage.includes("face groove inserts") ||
          lowerMessage.includes("face groove/turn insert") ||
          lowerMessage.includes("face groove/turn inserts")
        ) {
          productResults = [
            { title: "Face Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5501" }
          ];
        }
        else if (
          lowerMessage.includes("groove insert") ||
          lowerMessage.includes("groove inserts") ||
          lowerMessage.includes("grooving insert") ||
          lowerMessage.includes("grooving inserts") ||
          lowerMessage.includes("groove/turn insert") ||
          lowerMessage.includes("groove/turn inserts")
        ) {
          productResults = [
            { title: "Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5502" }
          ];
        }
        else if (
          lowerMessage.includes("parting insert") ||
          lowerMessage.includes("parting inserts") ||
          lowerMessage.includes("parting off insert") ||
          lowerMessage.includes("parting off inserts")
        ) {
          productResults = [
            { title: "Parting Off Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5503" }
          ];
        }
        else if (
          lowerMessage.includes("groove holder") ||
          lowerMessage.includes("groove holders") ||
          lowerMessage.includes("grooving holder") ||
          lowerMessage.includes("grooving holders") ||
          lowerMessage.includes("groove/turn holder") ||
          lowerMessage.includes("groove/turn holders")
        ) {
          productResults = [
            { title: "Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5504" }
          ];
        }
        else if (
          lowerMessage.includes("face groove holder") ||
          lowerMessage.includes("face groove holders") ||
          lowerMessage.includes("face groove/turn holder") ||
          lowerMessage.includes("face groove/turn holders")
        ) {
          productResults = [
            { title: "Face Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5505" }
          ];
        }
        else if (
          lowerMessage.includes("parting holder") ||
          lowerMessage.includes("parting holders") ||
          lowerMessage.includes("parting off holder") ||
          lowerMessage.includes("parting off holders")
        ) {
          productResults = [
            { title: "Parting Off Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5506" }
          ];
        }
        else if (
          lowerMessage.includes("grooving kit") ||
          lowerMessage.includes("grooving kits") ||
          lowerMessage.includes("parting kit") ||
          lowerMessage.includes("parting kits") ||
          lowerMessage.includes("groove/turn kit") ||
          lowerMessage.includes("groove/turn kits")
        ) {
          productResults = [
            { title: "Groove/Turn & Parting Off Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5507" }
          ];
        }
        else if (
          lowerMessage.includes("parting") ||
          lowerMessage.includes("parting off")
        ) {
          productResults = [
            { title: "Groove/Turn & Parting Off", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6103" },
            { title: "Parting Off Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5503" },
            { title: "Parting Off Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5506" }
          ];
        }
        else if (
          lowerMessage.includes("groove") ||
          lowerMessage.includes("grooving")
        ) {
          productResults = [
            { title: "Groove/Turn & Parting Off", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6103" },
            { title: "Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5502" },
            { title: "Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5504" },
            { title: "Face Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5501" },
            { title: "Face Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5505" }
          ];
        }
        else {
          productResults = [
            { title: "Groove/Turn & Parting Off", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6103" },
            { title: "Solid and Brazed Groove/Turn & Part Off", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/14" },
            { title: "Face Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5501" },
            { title: "Groove/Turn Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5502" },
            { title: "Parting Off Indexable Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5503" },
            { title: "Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5504" },
            { title: "Face Groove/Turn Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5505" },
            { title: "Parting Off Indexable Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5506" },
            { title: "Groove/Turn & Parting Off Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/5507" }
          ];
        }
      }
      else {
        productResults = await searchProducts(productQuery);
      }
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are B.O.B., Blue's Operation Bot for Blue Ash Industrial Supply. " +
            "Answer clearly and simply in plain text. " +
            "Do not use markdown. " +
            "Keep answers short, practical, and helpful. " +
            "If asked what B.O.B. stands for, say Blue's Operation Bot. " +
            "If asked who built you, say Trevor at Blue Ash Industrial Supply built you. " +
            "If product options are available, briefly explain them without inventing specs, pricing, or inventory."
        },
        {
          role: "user",
          content:
            message +
            "\n\nWebsite context:\n" +
            context +
            "\n\nProduct search results:\n" +
            (productResults.length
              ? productResults.map((p) => `${p.title} - ${p.url}`).join("\n")
              : "No product results found.")
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    let answer = "No response.";

    try {
      if (response.output_text) {
        answer = response.output_text;
      } else if (response.output) {
        answer = response.output
          .map((o) => (o.content || []).map((c) => c.text || "").join(""))
          .join("\n");
      }
    } catch (err) {
      console.log("Parse error:", err.message);
    }

    answer = cleanPlainText(answer);

    if (productResults.length > 0) {
      let productText = "<br><br><b>Related options:</b><br>";

      productResults.slice(0, 3).forEach((p) => {
        productText += `<a href="${p.url}" target="_blank"
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
          ${p.title}
        </a>`;
      });

      answer += productText;
    }

    res.json({ answer });
  } catch (err) {
    console.log("Chat error:", err.message);
    res.json({ answer: "Error occurred." });
  }
});

/* =========================
   START
========================= */
app.listen(port, async () => {
  console.log("Running on port", port);

  try {
    await buildKnowledgeBase();
  } catch (err) {
    console.log("KB build failed:", err.message);
  }
});
