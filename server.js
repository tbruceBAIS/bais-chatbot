import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import csv from "csv-parser";

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

const GUHRING_CSV_PATH =
  process.env.GUHRING_CSV_PATH || path.join(process.cwd(), "guhring-p21.csv");

let kbChunks = [];
let guhringProducts = [];

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

      if (lower.includes(q)) score += 10;

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
   CLEAN TEXT
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
   LOCAL GUHRING CSV
========================= */
function loadGuhringCSV() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(GUHRING_CSV_PATH)) {
      console.log("GUHRING CSV NOT FOUND:", GUHRING_CSV_PATH);
      guhringProducts = [];
      resolve();
      return;
    }

    const results = [];

    fs.createReadStream(GUHRING_CSV_PATH)
      .pipe(csv())
      .on("data", (row) => {
        results.push({
          vendor: "GUHRING",
          partNumber: String(row["Supplier Part #"] || "").trim(),
          description: String(row["Description"] || "").trim(),
          extDescription: String(row["Ext Description"] || "").trim(),
          listPrice: row["List Price"] ?? null,
        });
      })
      .on("end", () => {
        guhringProducts = results.filter(
          (p) => p.partNumber || p.description || p.extDescription
        );
        console.log(`GUHRING CSV LOADED: ${guhringProducts.length}`);
        resolve();
      })
      .on("error", (err) => {
        console.log("GUHRING CSV LOAD ERROR:", err.message);
        reject(err);
      });
  });
}

function up(text) {
  return text ? String(text).toUpperCase() : "";
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9./\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectVendor(message) {
  const m = String(message || "").toLowerCase();
  if (m.includes("guhring")) return "guhring";
  return null;
}

function detectGuhringToolType(message) {
  const m = String(message || "").toLowerCase();

  if (m.includes("thread mill") || m.includes("threadmill")) return "thread_mill";
  if (m.includes("end mill") || m.includes("endmill")) return "end_mill";
  if (m.includes("reamer") || m.includes("reaming")) return "reamer";
  if (m.includes("tap") || m.includes("tapping")) return "tap";
  if (m.includes("drill") || m.includes("drilling")) return "drill";

  return null;
}

function matchesGuhringType(desc, type) {
  const d = normalize(desc);

  if (type === "drill") return d.includes("drill");
  if (type === "tap") return d.includes("tap");
  if (type === "reamer") return d.includes("reamer");
  if (type === "thread_mill") return d.includes("thread mill") || d.includes("threadmill");
  if (type === "end_mill") {
    return (
      d.includes("end mill") ||
      d.includes("endmill") ||
      d.includes("ballnose") ||
      d.includes("ball nose") ||
      d.includes("square end") ||
      d.includes("corner radius")
    );
  }

  return false;
}

function scoreGuhringMatch(message, product, type) {
  const msg = normalize(message);
  const desc = normalize(`${product.description} ${product.extDescription}`);

  if (!matchesGuhringType(desc, type)) return -999;

  let score = 10;

  const tokens = msg.split(" ").filter(Boolean);
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (desc.includes(token)) score += 2;
  }

  const fractions = msg.match(/\d+\/\d+/g) || [];
  for (const f of fractions) {
    if (desc.includes(f)) score += 10;
  }

  const decimals = msg.match(/\d+\.\d+/g) || [];
  for (const d of decimals) {
    if (desc.includes(d)) score += 10;
  }

  const strongTerms = [
    "carbide",
    "hss",
    "cobalt",
    "ball",
    "ballnose",
    "ball nose",
    "square",
    "corner radius",
    "4fl",
    "3fl",
    "2fl",
    "5fl",
    "6fl",
    "solid",
    "indexable",
    "form",
    "forming",
    "cut",
    "blind",
    "through",
    "coolant",
  ];

  for (const term of strongTerms) {
    if (msg.includes(term) && desc.includes(term)) {
      score += 4;
    }
  }

  if (product.partNumber && msg.includes(product.partNumber.toLowerCase())) {
    score += 50;
  }

  return score;
}

function findBestGuhringMatch(message, type) {
  if (!type || !guhringProducts.length) return null;

  const scored = guhringProducts
    .map((p) => ({
      ...p,
      score: scoreGuhringMatch(message, p, type),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function formatListPrice(price) {
  if (price === null || price === undefined || price === "") return "N/A";

  const numeric = Number(String(price).replace(/[$,]/g, ""));
  if (Number.isNaN(numeric)) return String(price);

  return `$${numeric.toFixed(2)}`;
}

function formatGuhringProduct(product) {
  const lines = [
    "MOST SIMILAR GUHRING MATCH:",
    "",
    `PART #: ${up(product.partNumber)}`,
    `DESCRIPTION: ${up(product.description)}`,
  ];

  if (product.extDescription) {
    lines.push(`EXT DESCRIPTION: ${up(product.extDescription)}`);
  }

  lines.push(`LIST PRICE: ${up(formatListPrice(product.listPrice))}`);

  return lines.join("\n");
}

function getGuhringFollowUp(type) {
  switch (type) {
    case "drill":
      return [
        "MATERIAL BEING CUT",
        "DRILL DIAMETER",
        "THROUGH HOLE OR BLIND HOLE",
        "COOLANT-THROUGH REQUIRED OR NOT",
      ];
    case "tap":
      return [
        "THREAD SIZE",
        "MATERIAL BEING CUT",
        "CUT TAP OR FORM TAP",
        "THROUGH HOLE OR BLIND HOLE",
      ];
    case "reamer":
      return [
        "REAMER DIAMETER",
        "MATERIAL BEING CUT",
        "SOLID OR INDEXABLE PREFERENCE",
        "TOLERANCE REQUIREMENT",
      ];
    case "thread_mill":
      return [
        "THREAD SIZE",
        "MATERIAL BEING CUT",
        "INTERNAL OR EXTERNAL THREAD",
        "THREAD PITCH",
      ];
    case "end_mill":
      return [
        "MATERIAL BEING CUT",
        "CUTTER DIAMETER",
        "ROUGHING OR FINISHING",
        "SQUARE END, BALL NOSE, OR CORNER RADIUS",
      ];
    default:
      return [
        "MATERIAL BEING CUT",
        "TOOL SIZE",
        "APPLICATION DETAILS",
      ];
  }
}

function buildGuhringReply(type, product) {
  const followUp = getGuhringFollowUp(type);

  if (product) {
    return [
      "GUHRING IS A STRONG OPTION FOR THIS APPLICATION.",
      "",
      formatGuhringProduct(product),
      "",
      "TO FURTHER OPTIMIZE SELECTION, PLEASE CONFIRM:",
      ...followUp.map((q) => `- ${q}`),
    ].join("\n");
  }

  return [
    "I CAN HELP NARROW THE GUHRING SELECTION, BUT I NEED A LITTLE MORE DETAIL.",
    "",
    "PLEASE CONFIRM:",
    ...followUp.map((q) => `- ${q}`),
  ].join("\n");
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
  const lowerMessage = String(message || "").toLowerCase();

  return (
    lowerMessage.includes("find") ||
    lowerMessage.includes("looking for") ||
    lowerMessage.includes("show me") ||
    lowerMessage.includes("need") ||
    lowerMessage.includes("do you have") ||
    lowerMessage.includes("where can i find") ||
    lowerMessage.includes("drill") ||
    lowerMessage.includes("end mill") ||
    lowerMessage.includes("endmill") ||
    lowerMessage.includes("tap") ||
    lowerMessage.includes("reamer") ||
    lowerMessage.includes("thread mill") ||
    lowerMessage.includes("insert") ||
    lowerMessage.includes("tool holder") ||
    lowerMessage.includes("collet") ||
    lowerMessage.includes("abrasive") ||
    lowerMessage.includes("fastener") ||
    lowerMessage.includes("saw") ||
    lowerMessage.includes("power tool") ||
    lowerMessage.includes("hand tool") ||
    lowerMessage.includes("safety") ||
    lowerMessage.includes("paint") ||
    lowerMessage.includes("electrical") ||
    lowerMessage.includes("hydraulic")
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

async function searchProducts(query) {
  try {
    const url = `${BASE_URL}/search.php?kw=${encodeURIComponent(query)}`;
    const res = await axios.get(url, { timeout: 20000 });
    const $ = cheerio.load(res.data);

    const results = [];
    const seen = new Set();

    $("a").each((_, el) => {
      const href = ($(el).attr("href") || "").trim();
      const title = $(el).text().replace(/\s+/g, " ").trim();

      if (!href || !title || isJunkTitle(title)) return;

      const absolute = href.startsWith("http")
        ? href
        : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;

      const isRelevant =
        absolute.includes("/catalogue/group/") ||
        absolute.includes("/browse/catalogue/group/") ||
        absolute.includes("/catalogue/product/") ||
        absolute.includes("/browse/catalogue/product/") ||
        absolute.includes("/showgroups.php") ||
        absolute.includes("/search.php");

      if (!isRelevant) return;
      if (seen.has(absolute)) return;

      seen.add(absolute);
      results.push({ title, url: absolute });
    });

    return results.slice(0, 8);
  } catch (err) {
    console.log("PRODUCT SEARCH ERROR:", err.message);
    return [];
  }
}

function formatRelatedOptionsHtml(productResults) {
  if (!productResults.length) return "";

  let html = "<br><br><b>Related options:</b><br>";

  for (const p of productResults) {
    html += `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a><br>`;
  }

  return html;
}/* =========================
   ROUTES
========================= */
app.get("/", (_req, res) => {
  res.send("B.O.B. IS RUNNING");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    kbChunks: kbChunks.length,
    guhringProducts: guhringProducts.length,
    vectorStoreEnabled: !!VECTOR_STORE_ID,
  });
});

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
       SIMPLE DIRECT RESPONSES
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
        answer:
          "HELLO, I AM B.O.B. HOW CAN I HELP YOU TODAY?",
      });
    }

    /* =========================
       LOCAL GUHRING MATCHING
    ========================= */
    const vendor = detectVendor(message);
    const guhringType = detectGuhringToolType(message);

    if (vendor === "guhring" && guhringType) {
      const bestMatch = findBestGuhringMatch(message, guhringType);
      const guhringReply = buildGuhringReply(guhringType, bestMatch);

      return res.json({
        answer: guhringReply,
      });
    }

    /* =========================
       SITE PRODUCT SEARCH HELP
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
       OPENAI RESPONSE
    ========================= */
    const systemPrompt = `
You are B.O.B. for Blue Ash Industrial Supply.

Your role:
- Help users with industrial tooling and MRO questions
- Answer questions about Blue Ash Industrial Supply
- Use the provided website context when relevant
- Be concise, helpful, and technically competent
- Do not claim to place orders or quotes
- When needed, direct customers to call (513) 530-0188 or email sales@blueashsupply.com

Important behavior rules:
- If the user is asking about a Guhring product and the local Guhring matcher did not already answer, you may still answer generally, but do not invent exact part numbers
- If product data is uncertain, ask clarifying questions
- Prefer practical recommendations over vague marketing language
- If the user asks for company/contact information, provide Blue Ash Industrial Supply contact details
- If the user asks about products/categories, you may reference relevant categories or options
- Keep responses readable in plain text
`;

    const userPrompt = `
USER MESSAGE:
${message}

WEBSITE CONTEXT:
${context || "NO ADDITIONAL CONTEXT FOUND."}
`;

    const responseConfig = {
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    if (VECTOR_STORE_ID) {
      responseConfig.tools = [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ];
    }

    const response = await client.responses.create(responseConfig);

    let answer =
      response.output_text ||
      "I'M SORRY, I COULDN'T GENERATE A RESPONSE RIGHT NOW.";

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
   STARTUP
========================= */
async function startServer() {
  try {
    console.log("STARTING B.O.B...");
    await loadGuhringCSV();
    await buildKnowledgeBase();

    app.listen(port, () => {
      console.log(`B.O.B. RUNNING ON PORT ${port}`);
      console.log(`BASE URL: ${BASE_URL}`);
      console.log(`VECTOR STORE: ${VECTOR_STORE_ID || "NOT SET"}`);
      console.log(`GUHRING CSV: ${GUHRING_CSV_PATH}`);
    });
  } catch (err) {
    console.error("STARTUP ERROR:", err);
    process.exit(1);
  }
}

startServer();
