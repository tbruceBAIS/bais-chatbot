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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

let kbChunks = [];

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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
      const res = await axios.get(url, { timeout: 12000 });
      const $ = cheerio.load(res.data);

      $("script, style, noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const pieces = text.match(/.{1,1200}/g) || [];
      for (const p of pieces) {
        chunks.push({ url, text: p });
      }

      console.log("Indexed:", url);
    } catch (err) {
      console.log("Failed to index:", url, err.message);
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
   HISTORY + VENDOR HELPERS
========================= */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-10)
    .map((item) => ({
      role: item.role,
      content: item.content.trim(),
    }));
}

function detectVendor(message, history = []) {
  const combined = [
    String(message || ""),
    ...history.map((h) => String(h.content || "")),
  ]
    .join(" ")
    .toLowerCase();

  if (combined.includes("guhring")) return "guhring";
  if (combined.includes("sandvik")) return "sandvik";
  if (combined.includes("iscar")) return "iscar";
  if (combined.includes("kyocera")) return "kyocera";
  if (combined.includes("sgs")) return "sgs";

  return null;
}

function getGuhringFollowUp(type) {
  switch (type) {
    case "drill":
      return [
        "Diameter and length",
        "Material to drill",
        "Drill style or series preference",
        "Application details",
      ];
    case "end_mill":
      return [
        "Diameter",
        "Material being cut",
        "Operation",
        "End style needed",
      ];
    case "tap":
      return [
        "Thread size",
        "Material being cut",
        "Cut tap or form tap",
        "Through hole or blind hole",
      ];
    case "reamer":
      return [
        "Reamer diameter",
        "Material being cut",
        "Tolerance requirement",
        "Solid or indexable preference",
      ];
    case "thread_mill":
      return [
        "Thread size",
        "Material being cut",
        "Internal or external thread",
        "Pitch requirement",
      ];
    default:
      return [
        "Tool size",
        "Material",
        "Application details",
      ];
  }
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9/.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GUHRING_RULES = {
  drill: {
    aliases: [
      "drill", "drills", "drilling", "jobber", "jobber drill", "jobber drills",
      "screw machine", "stub drill", "stub drills", "spot drill", "spot drills",
      "center drill", "center drills", "nc spotting", "deep hole", "insert drill"
    ],
    exactFilters: {
      jobber: ["jobber", "standard length", "jobber length"],
      cobalt: ["cobalt", "hsco", "hssco", "m35", "hss-e", "hsse"],
      carbide: ["solid carbide", "carbide", "ratio drill"],
      stub: ["stub", "screw machine", "short length"],
      parabolic: ["parabolic"],
      spot: ["spot", "spot drill", "spotting", "center drill", "nc spotting"],
      deepHole: ["deep hole", "gun drill"],
      insert: ["insert drill", "insert drilling", "replaceable tip"]
    },
    relatedGroups: [
      { title: "Drilling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6201" },
      { title: "HSS/Co Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6211" },
      { title: "Solid Carbide Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6210" },
      { title: "Drill Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/150" },
      { title: "Center and Spot Solid Drill Bits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/162" }
    ]
  },

  end_mill: {
    aliases: [
      "end mill", "end mills", "endmill", "endmills", "milling",
      "ball nose", "ballnose", "square end", "corner radius", "rougher", "roughing"
    ],
    exactFilters: {
      ball: ["ball nose", "ballnose", "ball"],
      square: ["square end", "square"],
      cornerRadius: ["corner radius"],
      roughing: ["roughing", "rougher"],
      finishing: ["finishing", "finish"]
    },
    relatedGroups: [
      { title: "Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6000" },
      { title: "Solid Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6001" },
      { title: "Indexable Milling", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6002" }
    ]
  },

  tap: {
    aliases: [
      "tap", "taps", "tapping", "form tap", "cut tap", "spiral flute", "spiral point"
    ],
    exactFilters: {
      form: ["form tap", "forming tap", "roll tap"],
      cut: ["cut tap", "cutting tap"],
      spiralFlute: ["spiral flute"],
      spiralPoint: ["spiral point", "gun tap"],
      blind: ["blind hole", "blind"],
      through: ["through hole", "through"]
    },
    relatedGroups: [
      { title: "Threading", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6300" },
      { title: "Taps", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6104" },
      { title: "Thread Mills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6303" }
    ]
  },

  thread_mill: {
    aliases: [
      "thread mill", "thread mills", "threadmill", "threadmilling",
      "drill thread mill", "micro thread mill"
    ],
    exactFilters: {
      drillThread: ["drill thread mill", "drill/thread mill"],
      micro: ["micro thread mill", "micro"],
      hardened: ["hardened", "hard steel"]
    },
    relatedGroups: [
      { title: "Thread Mills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6303" },
      { title: "Threading", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6300" },
      { title: "Dies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6302" }
    ]
  },

  reamer: {
    aliases: ["reamer", "reamers", "reaming"],
    exactFilters: {
      solid: ["solid reamer", "solid"],
      indexable: ["indexable reamer", "indexable"]
    },
    relatedGroups: [
      { title: "Reaming", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6202" },
      { title: "Solid/Brazed Reamers", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6220" },
      { title: "Indexable Reamer Bodies", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/98" },
      { title: "Indexable Reamer Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/94" }
    ]
  }
};

function detectGuhringFamilyAndFilters(message, history = []) {
  const combined = normalizeText([
    String(message || ""),
    ...history.map((h) => String(h.content || ""))
  ].join(" "));

  let family = null;
  let familyScore = -1;

  for (const [key, rule] of Object.entries(GUHRING_RULES)) {
    let score = 0;
    for (const alias of rule.aliases) {
      if (combined.includes(alias)) score += alias.split(" ").length;
    }
    if (score > familyScore) {
      familyScore = score;
      family = score > 0 ? key : null;
    }
  }

  const filters = [];
  if (family && GUHRING_RULES[family]) {
    for (const [filterKey, terms] of Object.entries(GUHRING_RULES[family].exactFilters)) {
      if (terms.some((term) => combined.includes(term))) {
        filters.push(filterKey);
      }
    }
  }

  const materialHints = [];
  const materials = ["stainless", "steel", "aluminum", "cast iron", "titanium", "inconel", "hardened"];
  for (const m of materials) {
    if (combined.includes(m)) materialHints.push(m);
  }

  return {
    family,
    filters,
    materialHints
  };
}

function getGuhringRelatedGroupsFromRules(family, message = "") {
  if (!family || !GUHRING_RULES[family]) return [];
  const lower = normalizeText(message);

  if (family === "drill") {
    if (lower.includes("jobber") || lower.includes("standard length")) {
      return [
        { title: "HSS/Co Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6211" }
      ];
    }
    if (lower.includes("cobalt") || lower.includes("hsco") || lower.includes("m35")) {
      return [
        { title: "HSS/Co Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6211" }
      ];
    }
    if (lower.includes("spot") || lower.includes("center")) {
      return [
        { title: "Center and Spot Solid Drill Bits", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/162" }
      ];
    }
    if (lower.includes("insert")) {
      return [
        { title: "Drill Inserts", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/150" }
      ];
    }
    if (lower.includes("carbide")) {
      return [
        { title: "Solid Carbide Drills", url: "https://blue-prod-01.bessig.com/browse/catalogue/group/6210" }
      ];
    }
  }

  return GUHRING_RULES[family].relatedGroups || [];
}

function formatGuhringMatchInstructions(familyInfo) {
  if (!familyInfo || !familyInfo.family) return "";

  const familyLabel = familyInfo.family.replace(/_/g, " ").toUpperCase();
  const filtersText = familyInfo.filters.length
    ? familyInfo.filters.join(", ").toUpperCase()
    : "NONE";
  const materialText = familyInfo.materialHints.length
    ? familyInfo.materialHints.join(", ").toUpperCase()
    : "NONE";

  return `
GUHRING MATCHING MODE:
- REQUIRED FAMILY: ${familyLabel}
- REQUESTED FILTERS: ${filtersText}
- MATERIAL HINTS: ${materialText}

MATCH PRIORITY:
1. Exact match within the required family
2. Closest acceptable match within the same family
3. Ask one short follow-up question if no strong same-family match exists

HARD RULES:
- Never switch families
- Never return a non-${familyLabel} product as the answer
- If the retrieved result conflicts with requested filters, do not present it as exact
- If only a partial match exists, label it as "Closest match"

OUTPUT RULES:
- If exact match is found, return exactly in this style:

PART #: [part number]
DESCRIPTION: [tool description in ALL CAPS]

[One or two short sentences max]

- If only closest match is found, return exactly in this style:

CLOSEST MATCH
PART #: [part number]
DESCRIPTION: [tool description in ALL CAPS]

[One or two short sentences max]

- Do not include pricing
- Do not include long paragraphs
- Do not include more than one product unless the user asks
`;
}

function buildGuhringPromptAddOn(message, history = []) {
  const familyInfo = detectGuhringFamilyAndFilters(message, history);

  if (!familyInfo.family) {
    return {
      familyInfo,
      promptText: ""
    };
  }

  const followUps = getGuhringFollowUp(familyInfo.family);

  const promptText = `
The user is asking about a GUHRING ${familyInfo.family.replace(/_/g, " ")}.
Continue refining the same tool request using conversation history.

${formatGuhringMatchInstructions(familyInfo)}

If no exact match is clearly supported by retrieved knowledge:
- Return the closest match only if it still fits the family and most important filters
- Otherwise ask one short follow-up question

Preferred follow-up topics:
${followUps.map((q) => `- ${q}`).join("\n")}
`;

  return {
    familyInfo,
    promptText
  };
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

  const productKeywords = [
    "drill", "drills", "drilling", "jobber",
    "insert", "inserts",
    "mill", "mills", "milling", "end mill", "end mills",
    "tap", "taps",
    "reamer", "reamers",
    "thread mill", "thread mills",
    "tool holder", "tool holders",
    "collet", "collets",
    "abrasive", "abrasives",
    "fastener", "fasteners",
    "saw", "saws",
    "power tool", "power tools",
    "hand tool", "hand tools",
    "safety",
    "paint",
    "electrical",
    "hydraulic",
    "lubrication",
    "janitorial",
    "hvac",
    "hardware",
    "clamp",
    "vise",
    "inspection",
    "gage",
    "gauge",
    "measuring"
  ];

  return productKeywords.some((k) => lower.includes(k));
}

function extractProductQuery(message) {
  const lowerMessage = String(message || "").toLowerCase();

  if (lowerMessage.includes("drill insert") || lowerMessage.includes("drill inserts")) return "drill inserts";
  if (
    lowerMessage.includes("solid carbide drill") ||
    lowerMessage.includes("solid carbide drills") ||
    lowerMessage.includes("carbide drill") ||
    lowerMessage.includes("carbide drills")
  ) return "solid carbide drills";
  if (
    lowerMessage.includes("hss drill") ||
    lowerMessage.includes("hss drills") ||
    lowerMessage.includes("co drill") ||
    lowerMessage.includes("co drills") ||
    lowerMessage.includes("jobber")
  ) return "hss/co drills";
  if (
    lowerMessage.includes("center drill") ||
    lowerMessage.includes("spot drill") ||
    lowerMessage.includes("center and spot")
  ) return "center and spot drills";

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
    const url = `${BASE_URL}/showgroups.php?kw=${encodeURIComponent(query)}`;
    const res = await axios.get(url, { timeout: 12000 });
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
    console.log("Product search error:", err.message);
    return [];
  }
}

function formatRelatedOptionsHtml(productResults) {
  if (!productResults.length) return "";

  let html = "<br><br><b>Related options:</b><br>";

  for (const p of productResults.slice(0, 5)) {
    html += `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a><br>`;
  }

  return html;
}

/* =========================
   STATIC ROUTES
========================= */
app.get("/", (_req, res) => {
  res.send("B.O.B. is running");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    kbChunks: kbChunks.length,
    baseUrl: BASE_URL,
    vectorStoreEnabled: !!VECTOR_STORE_ID,
  });
});

app.get("/product-search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.json({ results: [] });
    }

    const results = await searchProducts(query);
    return res.json({ results });
  } catch (err) {
    console.error("Product search route error:", err);
    return res.status(500).json({ results: [] });
  }
});

/* =========================
   WIDGET
========================= */
app.get("/widget", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>B.O.B. Widget</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: Arial, sans-serif;
      background: transparent;
      overflow: hidden;
    }
    #chat-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #f7f9fc;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #d9e2f2;
    }
    #chat-header {
      background: #1c50af;
      color: #fff;
      padding: 14px 16px;
      font-weight: bold;
      font-size: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #f7f9fc;
    }
    .message-row {
      display: flex;
      width: 100%;
    }
    .message-row.user {
      justify-content: flex-end;
    }
    .message-row.bot {
      justify-content: flex-start;
    }
    .bubble {
      max-width: 82%;
      padding: 12px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
      white-space: normal;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .user .bubble {
      background: #1c50af;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .bot .bubble {
      background: #ffffff;
      color: #1a1a1a;
      border: 1px solid #d9e2f2;
      border-bottom-left-radius: 4px;
    }
    .bubble a {
      color: #1c50af;
      text-decoration: underline;
    }
    #chat-input-area {
      display: flex;
      border-top: 1px solid #d9e2f2;
      background: #fff;
      padding: 0;
      min-height: 58px;
    }
    #chat-input {
      flex: 1;
      border: none;
      outline: none;
      padding: 0 14px;
      font-size: 14px;
      background: #fff;
      color: #222;
    }
    #send-btn {
      border: none;
      background: #1c50af;
      color: #fff;
      font-weight: bold;
      font-size: 14px;
      padding: 0 18px;
      cursor: pointer;
    }
    #send-btn:disabled {
      opacity: 0.65;
      cursor: default;
    }
    .typing {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      min-height: 18px;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #888;
      animation: bounce 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot:nth-child(3) { animation-delay: 0.3s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
    }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="chat-header">🤖 B.O.B. — Blue's Operation Bot</div>
    <div id="chat-messages"></div>
    <div id="chat-input-area">
      <input id="chat-input" type="text" placeholder="Ask about tools, MRO, or Blue Ash..." />
      <button id="send-btn">SEND</button>
    </div>
  </div>

  <script>
    const messagesEl = document.getElementById("chat-messages");
    const inputEl = document.getElementById("chat-input");
    const sendBtn = document.getElementById("send-btn");
    const history = [];

    const greetings = [
      "Hi there! 👋 I'm B.O.B. How can I help today?",
      "Hello! 👋 What can I help you find today?",
      "Hey there! 👋 Need help with tooling or MRO?",
      "Welcome! 👋 Ask me about products, tooling, or Blue Ash."
    ];
	    function addMessage(html, who = "bot") {
      const row = document.createElement("div");
      row.className = "message-row " + who;

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = html;

      row.appendChild(bubble);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      const row = document.createElement("div");
      row.className = "message-row bot";
      row.id = "typing-row";

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      const typing = document.createElement("div");
      typing.className = "typing";

      for (let i = 0; i < 3; i++) {
        const dot = document.createElement("span");
        dot.className = "dot";
        typing.appendChild(dot);
      }

      bubble.appendChild(typing);
      row.appendChild(bubble);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
      const typingRow = document.getElementById("typing-row");
      if (typingRow) typingRow.remove();
    }

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;

      addMessage(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"), "user");

      history.push({ role: "user", content: text });
      if (history.length > 10) history.shift();

      inputEl.value = "";
      inputEl.disabled = true;
      sendBtn.disabled = true;
      showTyping();

      try {
        const res = await fetch("/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: text,
            history,
          }),
        });

        const data = await res.json();
        hideTyping();

        const answer = data.answer || "Sorry, I ran into an issue.";
        addMessage(answer, "bot");

        history.push({ role: "assistant", content: answer });
        if (history.length > 10) history.shift();

      } catch (err) {
        hideTyping();
        addMessage("Sorry — I had trouble connecting just now.", "bot");
      }

      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }

    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    addMessage(greetings[Math.floor(Math.random() * greetings.length)], "bot");
  </script>
</body>
</html>`);
});

/* =========================
   CHAT ROUTE
========================= */
app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const history = sanitizeHistory(req.body.history);

    if (!message) {
      return res.status(400).json({
        answer: "Please enter a message.",
      });
    }

    const lowerMessage = message.toLowerCase();
    const vendor = detectVendor(message, history);
const familyInfo = detectGuhringFamilyAndFilters(message, history);
const guhringType = familyInfo.family;

    /* =========================
       SIMPLE RESPONSES (emoji restored)
    ========================= */
    if (
      lowerMessage.includes("who built you") ||
      lowerMessage.includes("who made you") ||
      lowerMessage.includes("who created you")
    ) {
      return res.json({
        answer:
          "I was built for Blue Ash Industrial Supply to help with tooling, product questions, and general company information. 🤖",
      });
    }

    if (
      lowerMessage === "hi" ||
      lowerMessage === "hello" ||
      lowerMessage === "hey"
    ) {
      const quickGreetings = [
        "Hi there! 👋 How can I help?",
        "Hello! 👋 What can I help you find today?",
        "Hey there! 👋 Need help with tooling or MRO?",
      ];

      return res.json({
        answer:
          quickGreetings[Math.floor(Math.random() * quickGreetings.length)],
      });
    }

    /* =========================
       RELATED PRODUCTS (FIXED)
    ========================= */
    let productResults = [];

if (vendor === "guhring" && guhringType) {
  productResults = getGuhringRelatedGroupsFromRules(
    guhringType,
    [message, ...history.map((h) => h.content || "")].join(" ")
  );
} else if (looksProductIntent(message)) {
  const query = extractProductQuery(message);
  productResults = await searchProducts(query);
}

    const relatedOptionsHtml = formatRelatedOptionsHtml(productResults);

    /* =========================
       CONTEXT
    ========================= */
    const context = getContext(message);

    /* =========================
       GUHRING GUIDANCE
    ========================= */
    let guhringGuidance = "";

if (vendor === "guhring" && guhringType) {
  const guhringMode = buildGuhringPromptAddOn(message, history);
  guhringGuidance = guhringMode.promptText || "";
}

    const systemPrompt = `
You are B.O.B. for Blue Ash Industrial Supply.

Tone:
- Friendly, natural, conversational
- Use emojis lightly where appropriate, especially greetings
- Keep answers concise and practical

Behavior:
- ALWAYS use prior conversation context
- If the user replies with short answers like "steel", "1/4", "cobalt", "jobber", "standard length", or "no coating", continue the previous request
- NEVER restart the conversation if a tool was already identified
- DO NOT ask what they are looking for again if already known
- Never switch tool families unless the user clearly changes the request
- If a likely exact product is supported, return it cleanly and briefly
- If no exact product is supported, return the closest match only if it still fits the correct family
- If neither exact nor close fit is clear, ask one short follow-up question

Product output rules:
- Exact match format:

PART #: [part number]
DESCRIPTION: [tool description in ALL CAPS]

[One or two short sentences max]

- Closest match format:

CLOSEST MATCH
PART #: [part number]
DESCRIPTION: [tool description in ALL CAPS]

[One or two short sentences max]

- Do not include pricing
- Do not mention list price, cost, net price, surcharge, or availability unless the user explicitly asks
- Do not return long generic tooling lectures when a likely product answer is available
- Do not return more than one product unless the user asks

Focus:
- Provide practical tooling recommendations
- Keep answers clear, short, and useful

${guhringGuidance}
`;

    const inputMessages = [
      { role: "system", content: systemPrompt },
      ...history,
      {
        role: "user",
        content: `
USER MESSAGE:
${message}

WEBSITE CONTEXT:
${context || "none"}

RELATED PRODUCTS:
${
  productResults.length
    ? productResults.map((p) => `${p.title} - ${p.url}`).join("\n")
    : "none"
}
`,
      },
    ];    
	  
	  const responseConfig = {
      model: OPENAI_MODEL,
      input: inputMessages,
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
      "Sorry, I couldn’t generate a response right now.";

    answer = cleanPlainText(answer);

    if (relatedOptionsHtml) {
      answer += relatedOptionsHtml;
    }

    return res.json({ answer });
  } catch (err) {
    console.error("CHAT ERROR:", err);

    return res.status(500).json({
      answer: "Sorry, something went wrong while processing that request.",
    });
  }
});

/* =========================
   STARTUP
========================= */
async function startServer() {
  try {
    console.log("STARTING B.O.B...");

    app.listen(port, async () => {
      console.log(`B.O.B. RUNNING ON PORT ${port}`);
      console.log(`BASE URL: ${BASE_URL}`);
      console.log(`VECTOR STORE: ${VECTOR_STORE_ID || "NOT SET"}`);
      console.log(`MODEL: ${OPENAI_MODEL}`);

      try {
        await buildKnowledgeBase();
        console.log("KNOWLEDGE BASE READY");
      } catch (err) {
        console.error("KNOWLEDGE BASE ERROR:", err.message);
      }
    });
  } catch (err) {
    console.error("STARTUP ERROR:", err);
    process.exit(1);
  }
}

startServer();
