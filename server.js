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
  if (lowerMessage.includes("tooling") || lowerMessage.includes("collet") || lowerMessage.includes("tool holder")) return "tooling";

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

  return String(message || "").trim();
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
  if (lowerMessage.includes("tooling") || lowerMessage.includes("collet") || lowerMessage.includes("tool holder")) return "tooling";

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

      else if (
        lowerMessage.includes("tooling") ||
  lowerMessage.includes("tool holder") ||
  lowerMessage.includes("tool holders") ||
  lowerMessage.includes("collet") ||
  lowerMessage.includes("collets")
) {

  if (
    lowerMessage.includes("tool holder accessory") ||
    lowerMessage.includes("tool holder accessories")
  ) {
    productResults = [
      { title: "Tool Holder Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6403" }
    ];
  }

  else if (
    lowerMessage.includes("collet") ||
    lowerMessage.includes("collets")
  ) {
    productResults = [
      { title: "Collets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6402" }
    ];
  }

  else if (
    lowerMessage.includes("holder") ||
    lowerMessage.includes("holders")
  ) {
    productResults = [
      { title: "Tool Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6401" }
    ];
  }

  else {
    productResults = [
      { title: "Tooling Systems", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6400" },
      { title: "Tool Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6401" },
      { title: "Collets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6402" },
      { title: "Tool Holder Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6403" }
    ];
  }
}

else if (
  lowerMessage.includes("deburr") ||
  lowerMessage.includes("deburring") ||
  lowerMessage.includes("broach") ||
  lowerMessage.includes("broaching")
) {

  if (
    lowerMessage.includes("deburr") ||
    lowerMessage.includes("deburring")
  ) {
    productResults = [
      { title: "Deburring", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6601" }
    ];
  }

  else if (
    lowerMessage.includes("broach") ||
    lowerMessage.includes("broaching")
  ) {
    productResults = [
      { title: "Broaching", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6602" }
    ];
  }

  else {
    productResults = [
      { title: "Deburring & Broaching", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6600" },
      { title: "Deburring", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6601" },
      { title: "Broaching", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6602" }
    ];
  }
}

  else if (
  lowerMessage.includes("abrasive") ||
  lowerMessage.includes("abrasives") ||
  lowerMessage.includes("grinding") ||
  lowerMessage.includes("cutoff") ||
  lowerMessage.includes("flap wheel") ||
  lowerMessage.includes("brush") ||
  lowerMessage.includes("finishing") ||
  lowerMessage.includes("sandblast")
) {

  if (
    lowerMessage.includes("grinding wheel") ||
    lowerMessage.includes("grinding wheels")
  ) {
    productResults = [
      { title: "Grinding Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/235" }
    ];
  }

  else if (
    lowerMessage.includes("cutoff wheel") ||
    lowerMessage.includes("cutoff wheels")
  ) {
    productResults = [
      { title: "Cutoff Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/245" }
    ];
  }

  else if (
    lowerMessage.includes("flap wheel") ||
    lowerMessage.includes("flap wheels")
  ) {
    productResults = [
      { title: "Flap Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/247" }
    ];
  }

  else if (
    lowerMessage.includes("brush") ||
    lowerMessage.includes("brushes")
  ) {
    productResults = [
      { title: "Rotating Brushes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/253" }
    ];
  }

  else if (
    lowerMessage.includes("surface conditioning")
  ) {
    productResults = [
      { title: "Surface Conditioning", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/274" }
    ];
  }

  else if (
    lowerMessage.includes("mounted point") ||
    lowerMessage.includes("mounted points")
  ) {
    productResults = [
      { title: "Mounted Points", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/285" }
    ];
  }

  else if (
    lowerMessage.includes("sandblast") ||
    lowerMessage.includes("sandblasting")
  ) {
    productResults = [
      { title: "Sandblasting Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/290" }
    ];
  }

  else if (
    lowerMessage.includes("dressing tool") ||
    lowerMessage.includes("dressing tools")
  ) {
    productResults = [
      { title: "Dressing Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/304" }
    ];
  }

  else if (
    lowerMessage.includes("coated abrasive") ||
    lowerMessage.includes("coated abrasives") ||
    lowerMessage.includes("sandpaper")
  ) {
    productResults = [
      { title: "Coated Abrasives", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/217" }
    ];
  }

  else if (
    lowerMessage.includes("abrasive accessory") ||
    lowerMessage.includes("abrasive accessories")
  ) {
    productResults = [
      { title: "Abrasive Accessories & Replacement Parts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/203" }
    ];
  }

  else if (
    lowerMessage.includes("stone") ||
    lowerMessage.includes("stones") ||
    lowerMessage.includes("abrasive file")
  ) {
    productResults = [
      { title: "Abrasive Files, Sticks & Stones", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/267" }
    ];
  }

  else {
    productResults = [
      { title: "Abrasives & Finishing", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/202" },
      { title: "Grinding Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/235" },
      { title: "Cutoff Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/245" },
      { title: "Flap Wheels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/247" },
      { title: "Rotating Brushes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/253" },
      { title: "Coated Abrasives", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/217" }
    ];
  }
}

else if (
  lowerMessage.includes("fastener") ||
  lowerMessage.includes("fasteners") ||
  lowerMessage.includes("anchor") ||
  lowerMessage.includes("anchors") ||
  lowerMessage.includes("screw") ||
  lowerMessage.includes("screws") ||
  lowerMessage.includes("bolt") ||
  lowerMessage.includes("bolts") ||
  lowerMessage.includes("hook") ||
  lowerMessage.includes("hooks") ||
  lowerMessage.includes("threaded insert") ||
  lowerMessage.includes("threaded inserts") ||
  lowerMessage.includes("nail") ||
  lowerMessage.includes("nails") ||
  lowerMessage.includes("staple") ||
  lowerMessage.includes("staples") ||
  lowerMessage.includes("nut") ||
  lowerMessage.includes("nuts") ||
  lowerMessage.includes("pin") ||
  lowerMessage.includes("pins") ||
  lowerMessage.includes("rivet") ||
  lowerMessage.includes("rivets") ||
  lowerMessage.includes("spacer") ||
  lowerMessage.includes("spacers") ||
  lowerMessage.includes("standoff") ||
  lowerMessage.includes("standoffs") ||
  lowerMessage.includes("threaded rod") ||
  lowerMessage.includes("threaded rods") ||
  lowerMessage.includes("stud") ||
  lowerMessage.includes("studs") ||
  lowerMessage.includes("washer") ||
  lowerMessage.includes("washers") ||
  lowerMessage.includes("ring") ||
  lowerMessage.includes("rings") ||
  lowerMessage.includes("clamp") ||
  lowerMessage.includes("clamps") ||
  lowerMessage.includes("retaining ring") ||
  lowerMessage.includes("retaining rings")
) {

  if (
    lowerMessage.includes("anchor") ||
    lowerMessage.includes("anchors")
  ) {
    productResults = [
      { title: "Anchors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/314" }
    ];
  }

  else if (
    lowerMessage.includes("screw") ||
    lowerMessage.includes("screws") ||
    lowerMessage.includes("bolt") ||
    lowerMessage.includes("bolts")
  ) {
    productResults = [
      { title: "Screws & Bolts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/333" }
    ];
  }

  else if (
    lowerMessage.includes("hook") ||
    lowerMessage.includes("hooks")
  ) {
    productResults = [
      { title: "Hooks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/364" }
    ];
  }

  else if (
    lowerMessage.includes("threaded insert") ||
    lowerMessage.includes("threaded inserts")
  ) {
    productResults = [
      { title: "Threaded Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/368" }
    ];
  }

  else if (
    lowerMessage.includes("nail") ||
    lowerMessage.includes("nails") ||
    lowerMessage.includes("staple") ||
    lowerMessage.includes("staples")
  ) {
    productResults = [
      { title: "Nails & Staples", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/380" }
    ];
  }

  else if (
    lowerMessage.includes("nut") ||
    lowerMessage.includes("nuts")
  ) {
    productResults = [
      { title: "Nuts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/398" }
    ];
  }

  else if (
    lowerMessage.includes("pin") ||
    lowerMessage.includes("pins")
  ) {
    productResults = [
      { title: "Pins", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/420" }
    ];
  }

  else if (
    lowerMessage.includes("rivet") ||
    lowerMessage.includes("rivets")
  ) {
    productResults = [
      { title: "Rivets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/432" }
    ];
  }

  else if (
    lowerMessage.includes("spacer") ||
    lowerMessage.includes("spacers") ||
    lowerMessage.includes("standoff") ||
    lowerMessage.includes("standoffs")
  ) {
    productResults = [
      { title: "Spacers and Standoffs", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/441" }
    ];
  }

  else if (
    lowerMessage.includes("threaded rod") ||
    lowerMessage.includes("threaded rods") ||
    lowerMessage.includes("stud") ||
    lowerMessage.includes("studs")
  ) {
    productResults = [
      { title: "Threaded Rods & Studs", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/450" }
    ];
  }

  else if (
    lowerMessage.includes("retaining ring") ||
    lowerMessage.includes("retaining rings")
  ) {
    productResults = [
      { title: "Retaining Rings/Washers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/760" }
    ];
  }

  else if (
    lowerMessage.includes("washer") ||
    lowerMessage.includes("washers") ||
    lowerMessage.includes("ring") ||
    lowerMessage.includes("rings")
  ) {
    productResults = [
      { title: "Washers & Rings", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/456" }
    ];
  }

  else if (
    lowerMessage.includes("clamp") ||
    lowerMessage.includes("clamps")
  ) {
    productResults = [
      { title: "Clamps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/468" }
    ];
  }

  else {
    productResults = [
      { title: "Fasteners", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/313" },
      { title: "Anchors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/314" },
      { title: "Screws & Bolts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/333" },
      { title: "Nuts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/398" },
      { title: "Washers & Rings", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/456" },
      { title: "Threaded Rods & Studs", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/450" }
    ];
  }
}

     else if (
  lowerMessage.includes("saw") ||
  lowerMessage.includes("saws") ||
  lowerMessage.includes("hole saw") ||
  lowerMessage.includes("hole saws") ||
  lowerMessage.includes("bandsaw") ||
  lowerMessage.includes("band saw") ||
  lowerMessage.includes("bandsaw blade") ||
  lowerMessage.includes("bandsaw blades") ||
  lowerMessage.includes("circular saw") ||
  lowerMessage.includes("circular saws") ||
  lowerMessage.includes("reciprocating saw") ||
  lowerMessage.includes("reciprocating saws")
) {

  if (
    lowerMessage.includes("hole saw") ||
    lowerMessage.includes("hole saws")
  ) {
    productResults = [
      { title: "Hole Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6501" }
    ];
  }

  else if (
    lowerMessage.includes("bandsaw") ||
    lowerMessage.includes("band saw") ||
    lowerMessage.includes("bandsaw blade") ||
    lowerMessage.includes("bandsaw blades")
  ) {
    productResults = [
      { title: "Bandsaw Blades", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6502" }
    ];
  }

  else if (
    lowerMessage.includes("circular saw") ||
    lowerMessage.includes("circular saws")
  ) {
    productResults = [
      { title: "Circular Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6503" }
    ];
  }

  else if (
    lowerMessage.includes("reciprocating saw") ||
    lowerMessage.includes("reciprocating saws")
  ) {
    productResults = [
      { title: "Reciprocating Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6504" }
    ];
  }

  else {
    productResults = [
      { title: "Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6500" },
      { title: "Hole Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6501" },
      { title: "Bandsaw Blades", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6502" },
      { title: "Circular Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6503" },
      { title: "Reciprocating Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6504" }
    ];
  }
}

else if (
  lowerMessage.includes("power tool") ||
  lowerMessage.includes("power tools") ||
  lowerMessage.includes("demolition tool") ||
  lowerMessage.includes("demolition tools") ||
  lowerMessage.includes("polisher") ||
  lowerMessage.includes("polishers") ||
  lowerMessage.includes("finishing tool") ||
  lowerMessage.includes("finishing tools") ||
  lowerMessage.includes("heat gun") ||
  lowerMessage.includes("caulk gun") ||
  lowerMessage.includes("air gun") ||
  lowerMessage.includes("power drill") ||
  lowerMessage.includes("power drills") ||
  lowerMessage.includes("fastening tool") ||
  lowerMessage.includes("fastening tools") ||
  lowerMessage.includes("pipe threader") ||
  lowerMessage.includes("pipe threaders") ||
  lowerMessage.includes("pipe cutter") ||
  lowerMessage.includes("pipe cutters") ||
  lowerMessage.includes("shear") ||
  lowerMessage.includes("shears") ||
  lowerMessage.includes("nibbler") ||
  lowerMessage.includes("nibblers") ||
  lowerMessage.includes("power saw") ||
  lowerMessage.includes("power saws") ||
  lowerMessage.includes("combination kit") ||
  lowerMessage.includes("combination kits") ||
  lowerMessage.includes("router") ||
  lowerMessage.includes("routers") ||
  lowerMessage.includes("joiner") ||
  lowerMessage.includes("joiners") ||
  lowerMessage.includes("mixer") ||
  lowerMessage.includes("mixers") ||
  lowerMessage.includes("punch press") ||
  lowerMessage.includes("punch presses")
) {

  if (
    lowerMessage.includes("demolition tool") ||
    lowerMessage.includes("demolition tools")
  ) {
    productResults = [
      { title: "Demolition Tools and Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/771" }
    ];
  }

  else if (
    lowerMessage.includes("finishing tool") ||
    lowerMessage.includes("finishing tools") ||
    lowerMessage.includes("polisher") ||
    lowerMessage.includes("polishers")
  ) {
    productResults = [
      { title: "Finishing & Polishing Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/780" }
    ];
  }

  else if (
    lowerMessage.includes("heat gun") ||
    lowerMessage.includes("caulk gun") ||
    lowerMessage.includes("air gun")
  ) {
    productResults = [
      { title: "Heat, Caulk & Air Guns", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/794" }
    ];
  }

  else if (
    lowerMessage.includes("power drill") ||
    lowerMessage.includes("power drills") ||
    lowerMessage.includes("drill driver") ||
    lowerMessage.includes("drill drivers")
  ) {
    productResults = [
      { title: "Power Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/799" }
    ];
  }

  else if (
    lowerMessage.includes("fastening tool") ||
    lowerMessage.includes("fastening tools")
  ) {
    productResults = [
      { title: "Power Fastening Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/806" }
    ];
  }

  else if (
    lowerMessage.includes("pipe threader") ||
    lowerMessage.includes("pipe threaders") ||
    lowerMessage.includes("pipe cutter") ||
    lowerMessage.includes("pipe cutters")
  ) {
    productResults = [
      { title: "Power Pipe Threaders & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/819" }
    ];
  }

  else if (
    lowerMessage.includes("shear") ||
    lowerMessage.includes("shears") ||
    lowerMessage.includes("nibbler") ||
    lowerMessage.includes("nibblers") ||
    lowerMessage.includes("cutter") ||
    lowerMessage.includes("cutters")
  ) {
    productResults = [
      { title: "Power Shears, Nibblers & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/835" }
    ];
  }

  else if (
    lowerMessage.includes("power saw") ||
    lowerMessage.includes("power saws")
  ) {
    productResults = [
      { title: "Power Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/823" }
    ];
  }

  else if (
    lowerMessage.includes("combination kit") ||
    lowerMessage.includes("combination kits") ||
    lowerMessage.includes("combo kit") ||
    lowerMessage.includes("combo kits")
  ) {
    productResults = [
      { title: "Power Tool Combination Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/841" }
    ];
  }

  else if (
    lowerMessage.includes("router") ||
    lowerMessage.includes("routers") ||
    lowerMessage.includes("joiner") ||
    lowerMessage.includes("joiners")
  ) {
    productResults = [
      { title: "Routers & Joiners", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/843" }
    ];
  }

  else if (
    lowerMessage.includes("mixer") ||
    lowerMessage.includes("mixers")
  ) {
    productResults = [
      { title: "Powered Mixers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/848" }
    ];
  }

  else if (
    lowerMessage.includes("punch press") ||
    lowerMessage.includes("punch presses")
  ) {
    productResults = [
      { title: "Power Punch Presses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/850" }
    ];
  }

  else {
    productResults = [
      { title: "Power Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/770" },
      { title: "Power Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/799" },
      { title: "Power Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/823" },
      { title: "Power Fastening Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/806" },
      { title: "Power Pipe Threaders & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/819" },
      { title: "Power Tool Combination Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/841" }
    ];
  }
}

else if (
  lowerMessage.includes("hand tool") ||
  lowerMessage.includes("hand tools") ||
  lowerMessage.includes("wrench") ||
  lowerMessage.includes("wrenches") ||
  lowerMessage.includes("pliers") ||
  lowerMessage.includes("cutter") ||
  lowerMessage.includes("cutters") ||
  lowerMessage.includes("screwdriver") ||
  lowerMessage.includes("hex key") ||
  lowerMessage.includes("allen key") ||
  lowerMessage.includes("hammer") ||
  lowerMessage.includes("hammers") ||
  lowerMessage.includes("knife") ||
  lowerMessage.includes("knives") ||
  lowerMessage.includes("socket") ||
  lowerMessage.includes("ratchet") ||
  lowerMessage.includes("tool storage")
) {

  if (
    lowerMessage.includes("tool storage")
  ) {
    productResults = [
      { title: "Tool Storage", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/634" }
    ];
  }

  else if (
    lowerMessage.includes("wrench") ||
    lowerMessage.includes("wrenches")
  ) {
    productResults = [
      { title: "Wrenches", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/669" }
    ];
  }

  else if (
    lowerMessage.includes("pliers")
  ) {
    productResults = [
      { title: "Pliers & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/552" }
    ];
  }

  else if (
    lowerMessage.includes("screwdriver") ||
    lowerMessage.includes("nutdriver") ||
    lowerMessage.includes("hex key") ||
    lowerMessage.includes("allen key")
  ) {
    productResults = [
      { title: "Screwdrivers, Nutdrivers & Hex Keys", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/604" }
    ];
  }

  else if (
    lowerMessage.includes("hammer") ||
    lowerMessage.includes("hammers")
  ) {
    productResults = [
      { title: "Hammers & Striking Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/486" }
    ];
  }

  else if (
    lowerMessage.includes("knife") ||
    lowerMessage.includes("knives")
  ) {
    productResults = [
      { title: "Knives & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/526" }
    ];
  }

  else if (
    lowerMessage.includes("socket") ||
    lowerMessage.includes("sockets") ||
    lowerMessage.includes("ratchet") ||
    lowerMessage.includes("ratchets")
  ) {
    productResults = [
      { title: "Sockets & Ratchets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/619" }
    ];
  }

  else if (
    lowerMessage.includes("clamp") ||
    lowerMessage.includes("clamps") ||
    lowerMessage.includes("workholding")
  ) {
    productResults = [
      { title: "Workholding, Positioning & Clamping Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/645" }
    ];
  }

  else if (
    lowerMessage.includes("saw") ||
    lowerMessage.includes("hand saw")
  ) {
    productResults = [
      { title: "Hand Saws", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/504" }
    ];
  }

  else if (
    lowerMessage.includes("crimper") ||
    lowerMessage.includes("crimpers") ||
    lowerMessage.includes("stripper") ||
    lowerMessage.includes("strippers")
  ) {
    productResults = [
      { title: "Strippers & Crimpers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/473" }
    ];
  }

  else if (
    lowerMessage.includes("tool kit") ||
    lowerMessage.includes("tool kits")
  ) {
    productResults = [
      { title: "Hand Tool Kits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/511" }
    ];
  }

  else {
    productResults = [
      { title: "Hand Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/472" },
      { title: "Wrenches", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/669" },
      { title: "Pliers & Cutters", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/552" },
      { title: "Screwdrivers, Nutdrivers & Hex Keys", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/604" },
      { title: "Hammers & Striking Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/486" },
      { title: "Sockets & Ratchets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/619" }
    ];
  }
}

  else if (
  lowerMessage.includes("testing") ||
  lowerMessage.includes("measuring") ||
  lowerMessage.includes("measurement") ||
  lowerMessage.includes("inspection") ||
  lowerMessage.includes("gage") ||
  lowerMessage.includes("gages") ||
  lowerMessage.includes("gauge") ||
  lowerMessage.includes("gauges") ||
  lowerMessage.includes("calibration") ||
  lowerMessage.includes("layout") ||
  lowerMessage.includes("machine setup") ||
  lowerMessage.includes("torque") ||
  lowerMessage.includes("hardness") ||
  lowerMessage.includes("temperature") ||
  lowerMessage.includes("pressure") ||
  lowerMessage.includes("vacuum") ||
  lowerMessage.includes("optical")
) {

  if (
    lowerMessage.includes("depth") ||
    lowerMessage.includes("depth measurement")
  ) {
    productResults = [
      { title: "Depth Measurement Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1632" }
    ];
  }

  else if (
    lowerMessage.includes("height") ||
    lowerMessage.includes("height measurement")
  ) {
    productResults = [
      { title: "Height Measurement Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1725" }
    ];
  }

  else if (
    lowerMessage.includes("inside diameter") ||
    lowerMessage.includes("id measurement")
  ) {
    productResults = [
      { title: "Inside Diameter Measurement Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1730" }
    ];
  }

  else if (
    lowerMessage.includes("distance") ||
    lowerMessage.includes("linear") ||
    lowerMessage.includes("tape measure") ||
    lowerMessage.includes("rule")
  ) {
    productResults = [
      { title: "Linear & Distance Measuring Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1780" }
    ];
  }

  else if (
    lowerMessage.includes("angle") ||
    lowerMessage.includes("level") ||
    lowerMessage.includes("levelling")
  ) {
    productResults = [
      { title: "Levelling/Angle Measurement Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1745" }
    ];
  }

  else if (
    lowerMessage.includes("optical") ||
    lowerMessage.includes("visual inspection")
  ) {
    productResults = [
      { title: "Optical Inspection Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1799" }
    ];
  }

  else if (
    lowerMessage.includes("pressure") ||
    lowerMessage.includes("vacuum")
  ) {
    productResults = [
      { title: "Pressure & Vacuum Testing Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1812" }
    ];
  }

  else if (
    lowerMessage.includes("thread gage") ||
    lowerMessage.includes("thread gauge") ||
    lowerMessage.includes("gage") ||
    lowerMessage.includes("gauge")
  ) {
    productResults = [
      { title: "Reference & Thread Gages", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1824" }
    ];
  }

  else if (
    lowerMessage.includes("torque") ||
    lowerMessage.includes("force")
  ) {
    productResults = [
      { title: "Force & Torque Measuring Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1704" }
    ];
  }

  else if (
    lowerMessage.includes("hardness")
  ) {
    productResults = [
      { title: "Hardness Testing Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1709" }
    ];
  }

  else if (
    lowerMessage.includes("temperature") ||
    lowerMessage.includes("temp")
  ) {
    productResults = [
      { title: "Temperature Measuring Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1883" }
    ];
  }

  else if (
    lowerMessage.includes("thickness")
  ) {
    productResults = [
      { title: "Thickness Measurement Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1905" }
    ];
  }

  else if (
    lowerMessage.includes("calibration") ||
    lowerMessage.includes("layout") ||
    lowerMessage.includes("machine setup")
  ) {
    productResults = [
      { title: "Calibration, Layout & Machine Setup Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2124" }
    ];
  }

  else {
    productResults = [
      { title: "Testing, Measuring & Inspection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1568" },
      { title: "Linear & Distance Measuring Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1780" },
      { title: "Reference & Thread Gages", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1824" },
      { title: "Optical Inspection Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1799" },
      { title: "Force & Torque Measuring Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1704" },
      { title: "Calibration, Layout & Machine Setup Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2124" }
    ];
  }
}

   else if (
  lowerMessage.includes("adhesive") ||
  lowerMessage.includes("adhesives") ||
  lowerMessage.includes("sealant") ||
  lowerMessage.includes("sealants") ||
  lowerMessage.includes("tape") ||
  lowerMessage.includes("tapes") ||
  lowerMessage.includes("caulk") ||
  lowerMessage.includes("caulks") ||
  lowerMessage.includes("glue") ||
  lowerMessage.includes("glues") ||
  lowerMessage.includes("cement") ||
  lowerMessage.includes("cements") ||
  lowerMessage.includes("gasket sealant") ||
  lowerMessage.includes("thread sealant") ||
  lowerMessage.includes("dispensing")
) {

  if (
    lowerMessage.includes("caulk") ||
    lowerMessage.includes("caulks") ||
    lowerMessage.includes("sealant") ||
    lowerMessage.includes("sealants")
  ) {
    productResults = [
      { title: "Caulks and Sealants", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1391" }
    ];
  }

  else if (
    lowerMessage.includes("hard surface compound") ||
    lowerMessage.includes("hard surface compounds")
  ) {
    productResults = [
      { title: "Hard Surface Compounds", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1395" }
    ];
  }

  else if (
    lowerMessage.includes("dispensing") ||
    lowerMessage.includes("dispensing equipment")
  ) {
    productResults = [
      { title: "Adhesive Dispensing Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1400" }
    ];
  }

  else if (
    lowerMessage.includes("glue") ||
    lowerMessage.includes("glues") ||
    lowerMessage.includes("cement") ||
    lowerMessage.includes("cements")
  ) {
    productResults = [
      { title: "Glues and Cements", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1408" }
    ];
  }

  else if (
    lowerMessage.includes("tape") ||
    lowerMessage.includes("tapes")
  ) {
    productResults = [
      { title: "Tapes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1418" }
    ];
  }

  else if (
    lowerMessage.includes("thread sealant") ||
    lowerMessage.includes("gasket sealant") ||
    lowerMessage.includes("thread and gasket")
  ) {
    productResults = [
      { title: "Thread and Gasket Sealants", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1433" }
    ];
  }

  else {
    productResults = [
      { title: "Adhesives, Sealants & Tapes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1390" },
      { title: "Caulks and Sealants", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1391" },
      { title: "Glues and Cements", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1408" },
      { title: "Tapes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1418" },
      { title: "Thread and Gasket Sealants", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1433" }
    ];
  }
} 

     else if (
  lowerMessage.includes("hardware") ||
  lowerMessage.includes("bracket") ||
  lowerMessage.includes("brackets") ||
  lowerMessage.includes("brace") ||
  lowerMessage.includes("braces") ||
  lowerMessage.includes("hinge") ||
  lowerMessage.includes("hinges") ||
  lowerMessage.includes("door hardware") ||
  lowerMessage.includes("lock") ||
  lowerMessage.includes("locks") ||
  lowerMessage.includes("drawer") ||
  lowerMessage.includes("cabinet hardware") ||
  lowerMessage.includes("hook") ||
  lowerMessage.includes("hooks") ||
  lowerMessage.includes("closet rod") ||
  lowerMessage.includes("closet rods") ||
  lowerMessage.includes("garage door") ||
  lowerMessage.includes("gate hardware") ||
  lowerMessage.includes("fence hardware") ||
  lowerMessage.includes("machine hardware") ||
  lowerMessage.includes("equipment hardware")
) {

  if (
    lowerMessage.includes("brace") ||
    lowerMessage.includes("braces") ||
    lowerMessage.includes("bracket") ||
    lowerMessage.includes("brackets")
  ) {
    productResults = [
      { title: "Braces and Brackets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65386" }
    ];
  }

  else if (
    lowerMessage.includes("hinge") ||
    lowerMessage.includes("hinges")
  ) {
    productResults = [
      { title: "Hinges", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65390" }
    ];
  }

  else if (
    lowerMessage.includes("door hardware")
  ) {
    productResults = [
      { title: "Door Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65392" }
    ];
  }

  else if (
    lowerMessage.includes("lock") ||
    lowerMessage.includes("locks")
  ) {
    productResults = [
      { title: "Locks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65394" }
    ];
  }

  else if (
    lowerMessage.includes("drawer") ||
    lowerMessage.includes("cabinet hardware") ||
    lowerMessage.includes("cabinet")
  ) {
    productResults = [
      { title: "Drawer and Cabinet Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65396" }
    ];
  }

  else if (
    lowerMessage.includes("hook") ||
    lowerMessage.includes("hooks")
  ) {
    productResults = [
      { title: "Hooks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65398" }
    ];
  }

  else if (
    lowerMessage.includes("closet rod") ||
    lowerMessage.includes("closet rods")
  ) {
    productResults = [
      { title: "Closet Rods", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65400" }
    ];
  }

  else if (
    lowerMessage.includes("garage door")
  ) {
    productResults = [
      { title: "Garage Door Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65402" }
    ];
  }

  else if (
    lowerMessage.includes("gate hardware") ||
    lowerMessage.includes("fence hardware") ||
    lowerMessage.includes("gate") ||
    lowerMessage.includes("fence")
  ) {
    productResults = [
      { title: "Gate & Fence Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65404" }
    ];
  }

  else if (
    lowerMessage.includes("machine hardware") ||
    lowerMessage.includes("equipment hardware")
  ) {
    productResults = [
      { title: "Machine & Equipment Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65406" }
    ];
  }

  else {
    productResults = [
      { title: "Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65384" },
      { title: "Braces and Brackets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65386" },
      { title: "Hinges", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65390" },
      { title: "Door Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65392" },
      { title: "Locks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65394" },
      { title: "Machine & Equipment Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/65406" }
    ];
  }
}

       else if (
  lowerMessage.includes("safety") ||
  lowerMessage.includes("ppe") ||
  lowerMessage.includes("protective equipment") ||
  lowerMessage.includes("first aid") ||
  lowerMessage.includes("medical") ||
  lowerMessage.includes("fire protection") ||
  lowerMessage.includes("lockout") ||
  lowerMessage.includes("tagout") ||
  lowerMessage.includes("spill") ||
  lowerMessage.includes("containment") ||
  lowerMessage.includes("sign") ||
  lowerMessage.includes("warning") ||
  lowerMessage.includes("alarm") ||
  lowerMessage.includes("gas detection")
) {

  if (
    lowerMessage.includes("ppe") ||
    lowerMessage.includes("personal protective")
  ) {
    productResults = [
      { title: "Personal Protective Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1034" }
    ];
  }

  else if (
    lowerMessage.includes("first aid") ||
    lowerMessage.includes("medical")
  ) {
    productResults = [
      { title: "First Aid & Medical Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/884" }
    ];
  }

  else if (
    lowerMessage.includes("fire") ||
    lowerMessage.includes("fire protection")
  ) {
    productResults = [
      { title: "Fire Protection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/951" }
    ];
  }

  else if (
    lowerMessage.includes("lockout") ||
    lowerMessage.includes("tagout")
  ) {
    productResults = [
      { title: "Lockout & Tagout Products", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1022" }
    ];
  }

  else if (
    lowerMessage.includes("spill") ||
    lowerMessage.includes("containment")
  ) {
    productResults = [
      { title: "Spill Control & Containment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1082" }
    ];
  }

  else if (
    lowerMessage.includes("sign") ||
    lowerMessage.includes("signals")
  ) {
    productResults = [
      { title: "Safety Signs & Signals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1055" }
    ];
  }

  else if (
    lowerMessage.includes("alarm") ||
    lowerMessage.includes("warning light")
  ) {
    productResults = [
      { title: "Safety Alarms & Warning Lights", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1047" }
    ];
  }

  else if (
    lowerMessage.includes("gas detection") ||
    lowerMessage.includes("gas detector")
  ) {
    productResults = [
      { title: "Gas Detection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/969" }
    ];
  }

  else if (
    lowerMessage.includes("mat") ||
    lowerMessage.includes("matting")
  ) {
    productResults = [
      { title: "Matting", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1008" }
    ];
  }

  else if (
    lowerMessage.includes("guard") ||
    lowerMessage.includes("machine guard")
  ) {
    productResults = [
      { title: "Machine Guards & Shields", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1004" }
    ];
  }

  else {
    productResults = [
      { title: "Health & Safety", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/854" },
      { title: "Personal Protective Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1034" },
      { title: "First Aid & Medical Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/884" },
      { title: "Fire Protection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/951" },
      { title: "Lockout & Tagout Products", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1022" },
      { title: "Spill Control & Containment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1082" }
    ];
  }
}

      else if (
  lowerMessage.includes("safety") ||
  lowerMessage.includes("ppe") ||
  lowerMessage.includes("protective equipment") ||
  lowerMessage.includes("first aid") ||
  lowerMessage.includes("medical") ||
  lowerMessage.includes("fire protection") ||
  lowerMessage.includes("lockout") ||
  lowerMessage.includes("tagout") ||
  lowerMessage.includes("spill") ||
  lowerMessage.includes("containment") ||
  lowerMessage.includes("sign") ||
  lowerMessage.includes("warning") ||
  lowerMessage.includes("alarm") ||
  lowerMessage.includes("gas detection")
) {

  if (
    lowerMessage.includes("ppe") ||
    lowerMessage.includes("personal protective")
  ) {
    productResults = [
      { title: "Personal Protective Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1034" }
    ];
  }

  else if (
    lowerMessage.includes("first aid") ||
    lowerMessage.includes("medical")
  ) {
    productResults = [
      { title: "First Aid & Medical Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/884" }
    ];
  }

  else if (
    lowerMessage.includes("fire") ||
    lowerMessage.includes("fire protection")
  ) {
    productResults = [
      { title: "Fire Protection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/951" }
    ];
  }

  else if (
    lowerMessage.includes("lockout") ||
    lowerMessage.includes("tagout")
  ) {
    productResults = [
      { title: "Lockout & Tagout Products", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1022" }
    ];
  }

  else if (
    lowerMessage.includes("spill") ||
    lowerMessage.includes("containment")
  ) {
    productResults = [
      { title: "Spill Control & Containment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1082" }
    ];
  }

  else if (
    lowerMessage.includes("sign") ||
    lowerMessage.includes("signals")
  ) {
    productResults = [
      { title: "Safety Signs & Signals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1055" }
    ];
  }

  else if (
    lowerMessage.includes("alarm") ||
    lowerMessage.includes("warning light")
  ) {
    productResults = [
      { title: "Safety Alarms & Warning Lights", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1047" }
    ];
  }

  else if (
    lowerMessage.includes("gas detection") ||
    lowerMessage.includes("gas detector")
  ) {
    productResults = [
      { title: "Gas Detection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/969" }
    ];
  }

  else if (
    lowerMessage.includes("mat") ||
    lowerMessage.includes("matting")
  ) {
    productResults = [
      { title: "Matting", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1008" }
    ];
  }

  else if (
    lowerMessage.includes("guard") ||
    lowerMessage.includes("machine guard")
  ) {
    productResults = [
      { title: "Machine Guards & Shields", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1004" }
    ];
  }

  else {
    productResults = [
      { title: "Health & Safety", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/854" },
      { title: "Personal Protective Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1034" },
      { title: "First Aid & Medical Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/884" },
      { title: "Fire Protection", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/951" },
      { title: "Lockout & Tagout Products", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1022" },
      { title: "Spill Control & Containment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1082" }
    ];
  }
}   

        else if (
  lowerMessage.includes("hydraulic") ||
  lowerMessage.includes("hydraulics") ||
  lowerMessage.includes("accumulator") ||
  lowerMessage.includes("accumulators") ||
  lowerMessage.includes("hydraulic valve") ||
  lowerMessage.includes("hydraulic valves") ||
  lowerMessage.includes("filtration") ||
  lowerMessage.includes("hydraulic motor") ||
  lowerMessage.includes("hydraulic motors") ||
  lowerMessage.includes("hydraulic cylinder") ||
  lowerMessage.includes("hydraulic cylinders") ||
  lowerMessage.includes("quick coupler") ||
  lowerMessage.includes("quick couplers") ||
  lowerMessage.includes("hydraulic fitting") ||
  lowerMessage.includes("hydraulic fittings") ||
  lowerMessage.includes("hydraulic hose") ||
  lowerMessage.includes("hydraulic hoses") ||
  lowerMessage.includes("pressure gage") ||
  lowerMessage.includes("pressure gauge") ||
  lowerMessage.includes("hydraulic pump") ||
  lowerMessage.includes("hydraulic pumps") ||
  lowerMessage.includes("hydraulic seal") ||
  lowerMessage.includes("hydraulic seals") ||
  lowerMessage.includes("oil cooler") ||
  lowerMessage.includes("oil coolers")
) {

  if (
    lowerMessage.includes("accumulator") ||
    lowerMessage.includes("accumulators")
  ) {
    productResults = [
      { title: "Accumulators", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60808" }
    ];
  }

  else if (
    lowerMessage.includes("valve") ||
    lowerMessage.includes("valves")
  ) {
    productResults = [
      { title: "Hydraulic Valves & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60826" }
    ];
  }

  else if (
    lowerMessage.includes("filter") ||
    lowerMessage.includes("filtration")
  ) {
    productResults = [
      { title: "Hydraulic Filteration", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60846" }
    ];
  }

  else if (
    lowerMessage.includes("motor") ||
    lowerMessage.includes("motors")
  ) {
    productResults = [
      { title: "Hydraulic Motors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60864" }
    ];
  }

  else if (
    lowerMessage.includes("cylinder") ||
    lowerMessage.includes("cylinders")
  ) {
    productResults = [
      { title: "Hydraulic Cylinders & Mounting Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60868" }
    ];
  }

  else if (
    lowerMessage.includes("fitting") ||
    lowerMessage.includes("fittings") ||
    lowerMessage.includes("quick coupler") ||
    lowerMessage.includes("quick couplers")
  ) {
    productResults = [
      { title: "Hydraulic Fittings & Quick Couplers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60880" }
    ];
  }

  else if (
    lowerMessage.includes("hose") ||
    lowerMessage.includes("hoses")
  ) {
    productResults = [
      { title: "Hydraulic Hoses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60892" }
    ];
  }

  else if (
    lowerMessage.includes("pressure gage") ||
    lowerMessage.includes("pressure gages") ||
    lowerMessage.includes("pressure gauge") ||
    lowerMessage.includes("pressure gauges")
  ) {
    productResults = [
      { title: "Hydraulic Pressure Gages & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60900" }
    ];
  }

  else if (
    lowerMessage.includes("power unit") ||
    lowerMessage.includes("power units")
  ) {
    productResults = [
      { title: "Hydraulic Power Units", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60904" }
    ];
  }

  else if (
    lowerMessage.includes("pump") ||
    lowerMessage.includes("pumps")
  ) {
    productResults = [
      { title: "Hydraulic Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60908" }
    ];
  }

  else if (
    lowerMessage.includes("seal") ||
    lowerMessage.includes("seals")
  ) {
    productResults = [
      { title: "Hydraulic Seals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60930" }
    ];
  }

  else if (
    lowerMessage.includes("oil cooler") ||
    lowerMessage.includes("oil coolers")
  ) {
    productResults = [
      { title: "Oil Coolers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60934" }
    ];
  }

  else {
    productResults = [
      { title: "Hydraulics", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60806" },
      { title: "Hydraulic Valves & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60826" },
      { title: "Hydraulic Cylinders & Mounting Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60868" },
      { title: "Hydraulic Fittings & Quick Couplers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60880" },
      { title: "Hydraulic Hoses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60892" },
      { title: "Hydraulic Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60908" }
    ];
  }
}

  else if (
  lowerMessage.includes("hydraulic") ||
  lowerMessage.includes("hydraulics") ||
  lowerMessage.includes("accumulator") ||
  lowerMessage.includes("accumulators") ||
  lowerMessage.includes("hydraulic valve") ||
  lowerMessage.includes("hydraulic valves") ||
  lowerMessage.includes("filtration") ||
  lowerMessage.includes("hydraulic motor") ||
  lowerMessage.includes("hydraulic motors") ||
  lowerMessage.includes("hydraulic cylinder") ||
  lowerMessage.includes("hydraulic cylinders") ||
  lowerMessage.includes("quick coupler") ||
  lowerMessage.includes("quick couplers") ||
  lowerMessage.includes("hydraulic fitting") ||
  lowerMessage.includes("hydraulic fittings") ||
  lowerMessage.includes("hydraulic hose") ||
  lowerMessage.includes("hydraulic hoses") ||
  lowerMessage.includes("pressure gage") ||
  lowerMessage.includes("pressure gauge") ||
  lowerMessage.includes("hydraulic pump") ||
  lowerMessage.includes("hydraulic pumps") ||
  lowerMessage.includes("hydraulic seal") ||
  lowerMessage.includes("hydraulic seals") ||
  lowerMessage.includes("oil cooler") ||
  lowerMessage.includes("oil coolers")
) {

  if (
    lowerMessage.includes("accumulator") ||
    lowerMessage.includes("accumulators")
  ) {
    productResults = [
      { title: "Accumulators", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60808" }
    ];
  }

  else if (
    lowerMessage.includes("valve") ||
    lowerMessage.includes("valves")
  ) {
    productResults = [
      { title: "Hydraulic Valves & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60826" }
    ];
  }

  else if (
    lowerMessage.includes("filter") ||
    lowerMessage.includes("filtration")
  ) {
    productResults = [
      { title: "Hydraulic Filteration", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60846" }
    ];
  }

  else if (
    lowerMessage.includes("motor") ||
    lowerMessage.includes("motors")
  ) {
    productResults = [
      { title: "Hydraulic Motors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60864" }
    ];
  }

  else if (
    lowerMessage.includes("cylinder") ||
    lowerMessage.includes("cylinders")
  ) {
    productResults = [
      { title: "Hydraulic Cylinders & Mounting Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60868" }
    ];
  }

  else if (
    lowerMessage.includes("fitting") ||
    lowerMessage.includes("fittings") ||
    lowerMessage.includes("quick coupler") ||
    lowerMessage.includes("quick couplers")
  ) {
    productResults = [
      { title: "Hydraulic Fittings & Quick Couplers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60880" }
    ];
  }

  else if (
    lowerMessage.includes("hose") ||
    lowerMessage.includes("hoses")
  ) {
    productResults = [
      { title: "Hydraulic Hoses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60892" }
    ];
  }

  else if (
    lowerMessage.includes("pressure gage") ||
    lowerMessage.includes("pressure gages") ||
    lowerMessage.includes("pressure gauge") ||
    lowerMessage.includes("pressure gauges")
  ) {
    productResults = [
      { title: "Hydraulic Pressure Gages & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60900" }
    ];
  }

  else if (
    lowerMessage.includes("power unit") ||
    lowerMessage.includes("power units")
  ) {
    productResults = [
      { title: "Hydraulic Power Units", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60904" }
    ];
  }

  else if (
    lowerMessage.includes("pump") ||
    lowerMessage.includes("pumps")
  ) {
    productResults = [
      { title: "Hydraulic Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60908" }
    ];
  }

  else if (
    lowerMessage.includes("seal") ||
    lowerMessage.includes("seals")
  ) {
    productResults = [
      { title: "Hydraulic Seals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60930" }
    ];
  }

  else if (
    lowerMessage.includes("oil cooler") ||
    lowerMessage.includes("oil coolers")
  ) {
    productResults = [
      { title: "Oil Coolers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60934" }
    ];
  }

  else {
    productResults = [
      { title: "Hydraulics", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60806" },
      { title: "Hydraulic Valves & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60826" },
      { title: "Hydraulic Cylinders & Mounting Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60868" },
      { title: "Hydraulic Fittings & Quick Couplers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60880" },
      { title: "Hydraulic Hoses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60892" },
      { title: "Hydraulic Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/60908" }
    ];
  }
}

    else if (
  lowerMessage.includes("janitorial") ||
  lowerMessage.includes("sanitation") ||
  lowerMessage.includes("broom") ||
  lowerMessage.includes("brooms") ||
  lowerMessage.includes("brush") ||
  lowerMessage.includes("brushes") ||
  lowerMessage.includes("dust pan") ||
  lowerMessage.includes("dust pans") ||
  lowerMessage.includes("cleaner") ||
  lowerMessage.includes("cleaners") ||
  lowerMessage.includes("detergent") ||
  lowerMessage.includes("detergents") ||
  lowerMessage.includes("vacuum") ||
  lowerMessage.includes("vacuums") ||
  lowerMessage.includes("cleaning machine") ||
  lowerMessage.includes("cleaning machines") ||
  lowerMessage.includes("mop") ||
  lowerMessage.includes("mops") ||
  lowerMessage.includes("duster") ||
  lowerMessage.includes("dusters") ||
  lowerMessage.includes("cleaning pad") ||
  lowerMessage.includes("cleaning pads") ||
  lowerMessage.includes("janitorial cart") ||
  lowerMessage.includes("janitorial carts") ||
  lowerMessage.includes("odor control") ||
  lowerMessage.includes("hygiene") ||
  lowerMessage.includes("towel") ||
  lowerMessage.includes("towels") ||
  lowerMessage.includes("tissue") ||
  lowerMessage.includes("tissues") ||
  lowerMessage.includes("wipe") ||
  lowerMessage.includes("wipes") ||
  lowerMessage.includes("trash can") ||
  lowerMessage.includes("trash cans") ||
  lowerMessage.includes("trash bag") ||
  lowerMessage.includes("trash bags") ||
  lowerMessage.includes("compactor") ||
  lowerMessage.includes("compactors") ||
  lowerMessage.includes("washroom") ||
  lowerMessage.includes("dispenser") ||
  lowerMessage.includes("dispensers") ||
  lowerMessage.includes("dryer") ||
  lowerMessage.includes("dryers") ||
  lowerMessage.includes("partition") ||
  lowerMessage.includes("partitions") ||
  lowerMessage.includes("squeegee") ||
  lowerMessage.includes("squeegees") ||
  lowerMessage.includes("bucket") ||
  lowerMessage.includes("buckets")
) {

  if (
    lowerMessage.includes("broom") ||
    lowerMessage.includes("brooms") ||
    lowerMessage.includes("brush") ||
    lowerMessage.includes("brushes") ||
    lowerMessage.includes("dust pan") ||
    lowerMessage.includes("dust pans")
  ) {
    productResults = [
      { title: "Brooms, Brushes, and Dust Pans", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2395" }
    ];
  }

  else if (
    lowerMessage.includes("cleaner") ||
    lowerMessage.includes("cleaners") ||
    lowerMessage.includes("detergent") ||
    lowerMessage.includes("detergents")
  ) {
    productResults = [
      { title: "Cleaners & Detergents", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2399" }
    ];
  }

  else if (
    lowerMessage.includes("vacuum") ||
    lowerMessage.includes("vacuums") ||
    lowerMessage.includes("cleaning machine") ||
    lowerMessage.includes("cleaning machines")
  ) {
    productResults = [
      { title: "Cleaning Machines & Vacuums", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2411" }
    ];
  }

  else if (
    lowerMessage.includes("duster") ||
    lowerMessage.includes("dusters") ||
    lowerMessage.includes("cleaning pad") ||
    lowerMessage.includes("cleaning pads")
  ) {
    productResults = [
      { title: "Dust Mops, Dusters, and Cleaning Pads", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2421" }
    ];
  }

  else if (
    lowerMessage.includes("janitorial cart") ||
    lowerMessage.includes("janitorial carts") ||
    lowerMessage.includes("supply holder") ||
    lowerMessage.includes("supply holders")
  ) {
    productResults = [
      { title: "Janitorial Carts and Supply Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2428" }
    ];
  }

  else if (
    lowerMessage.includes("odor control")
  ) {
    productResults = [
      { title: "Odor Control", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2433" }
    ];
  }

  else if (
    lowerMessage.includes("personal care") ||
    lowerMessage.includes("hygiene")
  ) {
    productResults = [
      { title: "Personal Care & Hygiene", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2440" }
    ];
  }

  else if (
    lowerMessage.includes("towel") ||
    lowerMessage.includes("towels") ||
    lowerMessage.includes("tissue") ||
    lowerMessage.includes("tissues") ||
    lowerMessage.includes("wipe") ||
    lowerMessage.includes("wipes")
  ) {
    productResults = [
      { title: "Towels, Tissues & Wipes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2450" }
    ];
  }

  else if (
    lowerMessage.includes("trash can") ||
    lowerMessage.includes("trash cans") ||
    lowerMessage.includes("trash bag") ||
    lowerMessage.includes("trash bags") ||
    lowerMessage.includes("compactor") ||
    lowerMessage.includes("compactors")
  ) {
    productResults = [
      { title: "Trash Cans, Bags & Compactors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2461" }
    ];
  }

  else if (
    lowerMessage.includes("washroom") ||
    lowerMessage.includes("dispenser") ||
    lowerMessage.includes("dispensers") ||
    lowerMessage.includes("dryer") ||
    lowerMessage.includes("dryers") ||
    lowerMessage.includes("partition") ||
    lowerMessage.includes("partitions")
  ) {
    productResults = [
      { title: "Washroom Dispensers, Dryers & Partitions", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2469" }
    ];
  }

  else if (
    lowerMessage.includes("wet mop") ||
    lowerMessage.includes("wet mops") ||
    lowerMessage.includes("squeegee") ||
    lowerMessage.includes("squeegees") ||
    lowerMessage.includes("bucket") ||
    lowerMessage.includes("buckets")
  ) {
    productResults = [
      { title: "Wet Mops, Squeegees, and Buckets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2480" }
    ];
  }

  else {
    productResults = [
      { title: "Janitorial & Sanitation Supplies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2394" },
      { title: "Cleaners & Detergents", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2399" },
      { title: "Cleaning Machines & Vacuums", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2411" },
      { title: "Towels, Tissues & Wipes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2450" },
      { title: "Trash Cans, Bags & Compactors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2461" },
      { title: "Wet Mops, Squeegees, and Buckets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2480" }
    ];
  }
}

     else if (
  lowerMessage.includes("lighting") ||
  lowerMessage.includes("electrical") ||
  lowerMessage.includes("cord reel") ||
  lowerMessage.includes("cord reels") ||
  lowerMessage.includes("lamp") ||
  lowerMessage.includes("lamps") ||
  lowerMessage.includes("job site lighting") ||
  lowerMessage.includes("extension cord") ||
  lowerMessage.includes("extension cords") ||
  lowerMessage.includes("flashlight") ||
  lowerMessage.includes("flashlights") ||
  lowerMessage.includes("ballast") ||
  lowerMessage.includes("exit sign") ||
  lowerMessage.includes("work light") ||
  lowerMessage.includes("work lights") ||
  lowerMessage.includes("fixture") ||
  lowerMessage.includes("fixtures") ||
  lowerMessage.includes("bulb") ||
  lowerMessage.includes("bulbs") ||
  lowerMessage.includes("fuse") ||
  lowerMessage.includes("fuses") ||
  lowerMessage.includes("wire") ||
  lowerMessage.includes("cable") ||
  lowerMessage.includes("conduit") ||
  lowerMessage.includes("plug") ||
  lowerMessage.includes("connector") ||
  lowerMessage.includes("switch") ||
  lowerMessage.includes("breaker") ||
  lowerMessage.includes("transformer") ||
  lowerMessage.includes("sensor") ||
  lowerMessage.includes("electrician tool") ||
  lowerMessage.includes("electricians tools")
) {

  if (
    lowerMessage.includes("cord reel") ||
    lowerMessage.includes("cord reels")
  ) {
    productResults = [
      { title: "Cord Reels", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61686" }
    ];
  }

  else if (
    lowerMessage.includes("job site lighting") ||
    lowerMessage.includes("portable lamp") ||
    lowerMessage.includes("portable lamps")
  ) {
    productResults = [
      { title: "Portable Lamps & Job Site Lighting", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61346" }
    ];
  }

  else if (
    lowerMessage.includes("extension cord") ||
    lowerMessage.includes("extension cords")
  ) {
    productResults = [
      { title: "Extension Cords", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61881" }
    ];
  }

  else if (
    lowerMessage.includes("flashlight") ||
    lowerMessage.includes("flashlights")
  ) {
    productResults = [
      { title: "Flashlights", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61313" }
    ];
  }

  else if (
    lowerMessage.includes("ballast") ||
    lowerMessage.includes("ballasts")
  ) {
    productResults = [
      { title: "Ballasts & Ballast Recycling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61363" }
    ];
  }

  else if (
    lowerMessage.includes("emergency light") ||
    lowerMessage.includes("exit sign") ||
    lowerMessage.includes("exit sign lights")
  ) {
    productResults = [
      { title: "Emergency & Exit Sign Lights", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61392" }
    ];
  }

  else if (
    lowerMessage.includes("work light") ||
    lowerMessage.includes("work lights")
  ) {
    productResults = [
      { title: "Work Lights", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61440" }
    ];
  }

  else if (
    lowerMessage.includes("light fixture") ||
    lowerMessage.includes("light fixtures") ||
    lowerMessage.includes("lamp holder") ||
    lowerMessage.includes("lamp holders")
  ) {
    productResults = [
      { title: "Light Fixtures & Lamp Holders", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61413" }
    ];
  }

  else if (
    lowerMessage.includes("bulb") ||
    lowerMessage.includes("bulbs") ||
    lowerMessage.includes("lamp") ||
    lowerMessage.includes("lamps")
  ) {
    productResults = [
      { title: "Lamps & Bulbs", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61289" }
    ];
  }

  else if (
    lowerMessage.includes("fuse") ||
    lowerMessage.includes("fuses")
  ) {
    productResults = [
      { title: "Fuses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62160" }
    ];
  }

  else if (
    lowerMessage.includes("wire") ||
    lowerMessage.includes("cable")
  ) {
    productResults = [
      { title: "Electrical Wire & Cable", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61493" },
      { title: "Cable Connectors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61526" },
      { title: "Electrical Wire Management", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61612" }
    ];
  }

  else if (
    lowerMessage.includes("conduit") ||
    lowerMessage.includes("conduit fitting") ||
    lowerMessage.includes("conduit fittings")
  ) {
    productResults = [
      { title: "Conduit & Conduit Fittings", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61718" },
      { title: "Conduit Bodies, Outlet & Switch Boxes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61784" }
    ];
  }

  else if (
    lowerMessage.includes("plug") ||
    lowerMessage.includes("plugs") ||
    lowerMessage.includes("connector") ||
    lowerMessage.includes("connectors")
  ) {
    productResults = [
      { title: "Power Plugs & Connectors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61846" },
      { title: "Cable Connectors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61526" }
    ];
  }

  else if (
    lowerMessage.includes("switch") ||
    lowerMessage.includes("switches")
  ) {
    productResults = [
      { title: "Electrical Switches", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61945" }
    ];
  }

  else if (
    lowerMessage.includes("breaker") ||
    lowerMessage.includes("breakers") ||
    lowerMessage.includes("load center") ||
    lowerMessage.includes("load centers")
  ) {
    productResults = [
      { title: "Circuit Breakers & Load Centers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62252" }
    ];
  }

  else if (
    lowerMessage.includes("transformer") ||
    lowerMessage.includes("transformers")
  ) {
    productResults = [
      { title: "Electrical Transformers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62072" }
    ];
  }

  else if (
    lowerMessage.includes("sensor") ||
    lowerMessage.includes("sensors") ||
    lowerMessage.includes("control") ||
    lowerMessage.includes("controls")
  ) {
    productResults = [
      { title: "Electrical Sensors & Controls", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62298" },
      { title: "Light Control Systems", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61476" }
    ];
  }

  else if (
    lowerMessage.includes("electrician tool") ||
    lowerMessage.includes("electricians tools")
  ) {
    productResults = [
      { title: "Electricians Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62315" }
    ];
  }

  else {
    productResults = [
      { title: "Lighting & Electrical", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61287" },
      { title: "Lamps & Bulbs", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61289" },
      { title: "Extension Cords", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61881" },
      { title: "Electrical Wire & Cable", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61493" },
      { title: "Power Plugs & Connectors", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/61846" },
      { title: "Circuit Breakers & Load Centers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/62252" }
    ];
  }
}

    else if (
  lowerMessage.includes("lubrication") ||
  lowerMessage.includes("lubricant") ||
  lowerMessage.includes("lubricants") ||
  lowerMessage.includes("coolant") ||
  lowerMessage.includes("coolants") ||
  lowerMessage.includes("coolant system") ||
  lowerMessage.includes("coolant systems") ||
  lowerMessage.includes("greasing") ||
  lowerMessage.includes("grease") ||
  lowerMessage.includes("greasing equipment") ||
  lowerMessage.includes("lubrication pump") ||
  lowerMessage.includes("lubrication pumps") ||
  lowerMessage.includes("oiling") ||
  lowerMessage.includes("oiling equipment") ||
  lowerMessage.includes("parts washer") ||
  lowerMessage.includes("parts washers") ||
  lowerMessage.includes("industrial chemical") ||
  lowerMessage.includes("industrial chemicals")
) {

  if (
    lowerMessage.includes("coolant system") ||
    lowerMessage.includes("coolant systems")
  ) {
    productResults = [
      { title: "Coolant Systems & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1185" }
    ];
  }

  else if (
    lowerMessage.includes("greasing") ||
    lowerMessage.includes("greasing equipment") ||
    lowerMessage.includes("grease gun") ||
    lowerMessage.includes("grease guns")
  ) {
    productResults = [
      { title: "Greasing Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1156" }
    ];
  }

  else if (
    lowerMessage.includes("lubricant") ||
    lowerMessage.includes("lubricants") ||
    lowerMessage.includes("coolant") ||
    lowerMessage.includes("coolants") ||
    lowerMessage.includes("industrial chemical") ||
    lowerMessage.includes("industrial chemicals")
  ) {
    productResults = [
      { title: "Lubricants, Coolants & Industrial Chemicals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1139" }
    ];
  }

  else if (
    lowerMessage.includes("lubrication pump") ||
    lowerMessage.includes("lubrication pumps")
  ) {
    productResults = [
      { title: "Lubrication Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1181" }
    ];
  }

  else if (
    lowerMessage.includes("oiling") ||
    lowerMessage.includes("oiling equipment") ||
    lowerMessage.includes("oil can") ||
    lowerMessage.includes("oil cans")
  ) {
    productResults = [
      { title: "Oiling Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1165" }
    ];
  }

  else if (
    lowerMessage.includes("parts washer") ||
    lowerMessage.includes("parts washers")
  ) {
    productResults = [
      { title: "Parts Washers & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1192" }
    ];
  }

  else {
    productResults = [
      { title: "Lubrication", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1138" },
      { title: "Lubricants, Coolants & Industrial Chemicals", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1139" },
      { title: "Coolant Systems & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1185" },
      { title: "Greasing Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1156" },
      { title: "Lubrication Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1181" },
      { title: "Parts Washers & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/1192" }
    ];
  }
}

      else if (
  lowerMessage.includes("machine") ||
  lowerMessage.includes("machinery") ||
  lowerMessage.includes("air compressor") ||
  lowerMessage.includes("air compressors") ||
  lowerMessage.includes("vacuum pump") ||
  lowerMessage.includes("vacuum pumps") ||
  lowerMessage.includes("blast cabinet") ||
  lowerMessage.includes("vibratory") ||
  lowerMessage.includes("drill press") ||
  lowerMessage.includes("drill presses") ||
  lowerMessage.includes("grinding machine") ||
  lowerMessage.includes("buffing machine") ||
  lowerMessage.includes("sharpening machine") ||
  lowerMessage.includes("heat treating") ||
  lowerMessage.includes("oven") ||
  lowerMessage.includes("lathe") ||
  lowerMessage.includes("lathes") ||
  lowerMessage.includes("milling machine") ||
  lowerMessage.includes("milling machines") ||
  lowerMessage.includes("sanding machine") ||
  lowerMessage.includes("saw machine") ||
  lowerMessage.includes("woodworking machine")
) {

  if (
    lowerMessage.includes("air compressor") ||
    lowerMessage.includes("air compressors") ||
    lowerMessage.includes("vacuum pump") ||
    lowerMessage.includes("vacuum pumps")
  ) {
    productResults = [
      { title: "Air Compressors & Vacuum Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2166" }
    ];
  }

  else if (
    lowerMessage.includes("blast cabinet") ||
    lowerMessage.includes("vibratory")
  ) {
    productResults = [
      { title: "Blast Cabinets & Vibratory Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2178" }
    ];
  }

  else if (
    lowerMessage.includes("drill press") ||
    lowerMessage.includes("drill presses")
  ) {
    productResults = [
      { title: "Drill Presses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2196" }
    ];
  }

  else if (
    lowerMessage.includes("grinding") ||
    lowerMessage.includes("buffing") ||
    lowerMessage.includes("sharpening")
  ) {
    productResults = [
      { title: "Grinding, Buffing & Sharpening Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2203" }
    ];
  }

  else if (
    lowerMessage.includes("heat treating") ||
    lowerMessage.includes("oven") ||
    lowerMessage.includes("ovens")
  ) {
    productResults = [
      { title: "Heat Treating Ovens", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2211" }
    ];
  }

  else if (
    lowerMessage.includes("lathe") ||
    lowerMessage.includes("lathes")
  ) {
    productResults = [
      { title: "Lathes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2214" }
    ];
  }

  else if (
    lowerMessage.includes("milling machine") ||
    lowerMessage.includes("milling machines")
  ) {
    productResults = [
      { title: "Milling Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2249" }
    ];
  }

  else if (
    lowerMessage.includes("sanding machine") ||
    lowerMessage.includes("sanding machines")
  ) {
    productResults = [
      { title: "Sanding Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2258" }
    ];
  }

  else if (
    lowerMessage.includes("saw machine") ||
    lowerMessage.includes("saw machines")
  ) {
    productResults = [
      { title: "Saw Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2266" }
    ];
  }

  else if (
    lowerMessage.includes("woodworking")
  ) {
    productResults = [
      { title: "Woodworking Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2274" }
    ];
  }

  else if (
    lowerMessage.includes("forming") ||
    lowerMessage.includes("cutting machine")
  ) {
    productResults = [
      { title: "Metal Forming & Cutting Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2231" }
    ];
  }

  else {
    productResults = [
      { title: "Machinery", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2165" },
      { title: "Air Compressors & Vacuum Pumps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2166" },
      { title: "Drill Presses", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2196" },
      { title: "Lathes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2214" },
      { title: "Milling Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2249" },
      { title: "Saw Machines", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2266" }
    ];
  }
}

 else if (
  lowerMessage.includes("material handling") ||
  lowerMessage.includes("storage") ||
  lowerMessage.includes("cabinet") ||
  lowerMessage.includes("cabinets") ||
  lowerMessage.includes("chain") ||
  lowerMessage.includes("chains") ||
  lowerMessage.includes("rope") ||
  lowerMessage.includes("ropes") ||
  lowerMessage.includes("wire rope") ||
  lowerMessage.includes("wire ropes") ||
  lowerMessage.includes("cnc storage") ||
  lowerMessage.includes("workstation") ||
  lowerMessage.includes("workstations") ||
  lowerMessage.includes("container") ||
  lowerMessage.includes("containers") ||
  lowerMessage.includes("ladder") ||
  lowerMessage.includes("ladders") ||
  lowerMessage.includes("scaffold") ||
  lowerMessage.includes("scaffolding") ||
  lowerMessage.includes("lifting") ||
  lowerMessage.includes("loading dock") ||
  lowerMessage.includes("locker") ||
  lowerMessage.includes("lockers") ||
  lowerMessage.includes("shelving") ||
  lowerMessage.includes("storage rack") ||
  lowerMessage.includes("storage racks") ||
  lowerMessage.includes("tool storage") ||
  lowerMessage.includes("work bench") ||
  lowerMessage.includes("workbench") ||
  lowerMessage.includes("work stand") ||
  lowerMessage.includes("work stands")
) {

  if (
    lowerMessage.includes("cabinet") ||
    lowerMessage.includes("cabinets")
  ) {
    productResults = [
      { title: "Cabinets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2656" }
    ];
  }

  else if (
    lowerMessage.includes("chain") ||
    lowerMessage.includes("chains") ||
    lowerMessage.includes("rope") ||
    lowerMessage.includes("ropes") ||
    lowerMessage.includes("wire rope") ||
    lowerMessage.includes("wire ropes")
  ) {
    productResults = [
      { title: "Chains, Ropes & Wire Ropes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2669" }
    ];
  }

  else if (
    lowerMessage.includes("cnc storage") ||
    lowerMessage.includes("cnc workstation")
  ) {
    productResults = [
      { title: "CNC Storage & Workstations", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2674" }
    ];
  }

  else if (
    lowerMessage.includes("container") ||
    lowerMessage.includes("containers")
  ) {
    productResults = [
      { title: "Containers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2680" }
    ];
  }

  else if (
    lowerMessage.includes("ladder") ||
    lowerMessage.includes("ladders") ||
    lowerMessage.includes("scaffold") ||
    lowerMessage.includes("scaffolding")
  ) {
    productResults = [
      { title: "Ladders & Scaffolding", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2700" }
    ];
  }

  else if (
    lowerMessage.includes("lifting accessory") ||
    lowerMessage.includes("lifting accessories")
  ) {
    productResults = [
      { title: "Lifting Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2721" }
    ];
  }

  else if (
    lowerMessage.includes("lifting hardware")
  ) {
    productResults = [
      { title: "Lifting Hardware", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2746" }
    ];
  }

  else if (
    lowerMessage.includes("loading dock")
  ) {
    productResults = [
      { title: "Loading Dock Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2764" }
    ];
  }

  else if (
    lowerMessage.includes("locker") ||
    lowerMessage.includes("lockers")
  ) {
    productResults = [
      { title: "Lockers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2779" }
    ];
  }

  else if (
    lowerMessage.includes("lubrication storage") ||
    lowerMessage.includes("dispensing")
  ) {
    productResults = [
      { title: "Lubrication Storage & Dispensing", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2787" }
    ];
  }

  else if (
    lowerMessage.includes("material lifting")
  ) {
    productResults = [
      { title: "Material Lifting", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2793" }
    ];
  }

  else if (
    lowerMessage.includes("material transport") ||
    lowerMessage.includes("cart") ||
    lowerMessage.includes("carts")
  ) {
    productResults = [
      { title: "Material Transport", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2830" },
      { title: "Mobile Bin Carts and Workstations", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2848" }
    ];
  }

  else if (
    lowerMessage.includes("safe") ||
    lowerMessage.includes("safes")
  ) {
    productResults = [
      { title: "Safes", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2856" }
    ];
  }

  else if (
    lowerMessage.includes("safety storage")
  ) {
    productResults = [
      { title: "Safety Storage", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2862" }
    ];
  }

  else if (
    lowerMessage.includes("shelving") ||
    lowerMessage.includes("storage rack") ||
    lowerMessage.includes("storage racks")
  ) {
    productResults = [
      { title: "Shelving & Storage Racks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2883" }
    ];
  }

  else if (
    lowerMessage.includes("building") ||
    lowerMessage.includes("storage building") ||
    lowerMessage.includes("structures")
  ) {
    productResults = [
      { title: "Structures & Storage Buildings", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2905" }
    ];
  }

  else if (
    lowerMessage.includes("tool storage")
  ) {
    productResults = [
      { title: "Tool Storage", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2914" }
    ];
  }

  else if (
    lowerMessage.includes("work bench") ||
    lowerMessage.includes("workbench") ||
    lowerMessage.includes("work benches") ||
    lowerMessage.includes("work stand") ||
    lowerMessage.includes("work stands")
  ) {
    productResults = [
      { title: "Work Benches & Work Stands", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2929" }
    ];
  }

  else {
    productResults = [
      { title: "Material Handling & Storage", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2655" },
      { title: "Cabinets", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2656" },
      { title: "Containers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2680" },
      { title: "Ladders & Scaffolding", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2700" },
      { title: "Shelving & Storage Racks", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2883" },
      { title: "Work Benches & Work Stands", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/2929" }
    ];
  }
}

   else if (
  lowerMessage.includes("paint") ||
  lowerMessage.includes("paints") ||
  lowerMessage.includes("stain") ||
  lowerMessage.includes("stains") ||
  lowerMessage.includes("coating") ||
  lowerMessage.includes("coatings") ||
  lowerMessage.includes("primer") ||
  lowerMessage.includes("primers") ||
  lowerMessage.includes("spray paint")
) {

  if (
    lowerMessage.includes("spray paint") ||
    lowerMessage.includes("primer") ||
    lowerMessage.includes("primers")
  ) {
    productResults = [
      { title: "Spray Paints and Primers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13719" }
    ];
  }

  else if (
    lowerMessage.includes("coating") ||
    lowerMessage.includes("coatings") ||
    lowerMessage.includes("finisher") ||
    lowerMessage.includes("finishers")
  ) {
    productResults = [
      { title: "Sealants, Finishers and Coatings", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13712" }
    ];
  }

  else if (
    lowerMessage.includes("brush") ||
    lowerMessage.includes("roller") ||
    lowerMessage.includes("applicator")
  ) {
    productResults = [
      { title: "Brushes, Rollers and Applicators", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13722" }
    ];
  }

  else {
    productResults = [
      { title: "Paint & Equipment", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13704" },
      { title: "Paints and Stains", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13705" },
      { title: "Spray Paints and Primers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13719" },
      { title: "Paint and Wallpaper Tools", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13742" },
      { title: "Brushes, Rollers and Applicators", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13722" },
      { title: "Paint Sprayers & Accessories", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/13735" }
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
