import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const port   = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || "vs_69c695df0a1881919287c9ed05b5cf6c";
const OPENAI_MODEL    = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const BASE_URL        = process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = [
  "You are B.O.B. (Blue's Operation Bot), the AI assistant for Blue Ash Industrial Supply.",
  "Blue Ash Industrial Supply is an industrial distributor based in Blue Ash, Ohio.",
  "They carry MRO products: cutting tools, abrasives, fasteners, safety, hand tools,",
  "power tools, measuring/inspection, workholding, and more.",
  "They are an authorized Guhring distributor.",
  "",
  "COMPANY INFO:",
  "Address: 6909 Cornell Rd, Cincinnati, OH 45242",
  "Phone: (513) 530-0188",
  "Hours: Monday through Friday, 8 AM to 5 PM",
  "Website: https://blue-prod-01.bessig.com",
  "",
  "YOUR PERSONALITY:",
  "- Friendly, knowledgeable, direct - like a helpful counter rep who knows their stuff",
  "- Use light emojis where natural but do not overdo it",
  "- Keep answers concise and practical",
  "- If you do not know something, say so and suggest contacting the team",
  "",
  "YOUR PRIORITIES (in order):",
  "1. Answer questions about Blue Ash Industrial Supply (hours, location, services, vendors)",
  "2. Share general tooling and MRO knowledge (materials, applications, best practices)",
  "3. Help users find the right product or product category",
  "4. Direct users to relevant product pages on the website when helpful",
  "",
  "GUHRING TOOLS:",
  "You have access to the real Guhring product catalogs via file search.",
  "ALWAYS search the uploaded files before recommending any Guhring part number.",
  "Only recommend part numbers you find in the catalog files - never guess or invent them.",
  "When asked about a Guhring tool:",
  "- Ask clarifying questions: tool type, diameter/size, material being cut,",
  "  application (through hole, blind hole), coating or substrate preferences",
  "- Search the catalog files for matching parts",
  "- If you find a match, give the exact part number and description from the catalog",
  "- If you cannot find a match, say so and suggest calling (513) 530-0188",
  "",
  "PRODUCT PAGE LINKS - use these when directing users to categories:",
  "Drilling: " + BASE_URL + "/browse/catalogue/group/6201",
  "HSS/Co Drills: " + BASE_URL + "/browse/catalogue/group/6211",
  "Solid Carbide Drills: " + BASE_URL + "/browse/catalogue/group/6210",
  "Milling: " + BASE_URL + "/browse/catalogue/group/6000",
  "Threading/Taps: " + BASE_URL + "/browse/catalogue/group/6300",
  "Reaming: " + BASE_URL + "/browse/catalogue/group/6202",
  "Thread Mills: " + BASE_URL + "/browse/catalogue/group/6303",
  "",
  "FORMATTING:",
  "- Use plain line breaks, not markdown headers",
  "- For product matches use this exact format:",
  "  Part #: [number from catalog]",
  "  Description: [description from catalog]",
  "  Why it fits: [one sentence]",
  "- Never invent part numbers - only use numbers found in the catalog files",
  "- Keep responses under 150 words unless detail is truly needed",
].join("\n");

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(function(m) {
      return (m.role === "user" || m.role === "assistant") &&
             typeof m.content === "string" && m.content.trim();
    })
    .slice(-12)
    .map(function(m) { return { role: m.role, content: m.content.trim() }; });
}

app.get("/", function(_req, res) { res.send("B.O.B. is running"); });

app.get("/health", function(_req, res) {
  res.json({ ok: true, model: OPENAI_MODEL, vectorStore: VECTOR_STORE_ID, baseUrl: BASE_URL });
});

app.get("/widget", function(_req, res) {
  res.sendFile(path.join(__dirname, "public", "widget.html"));
});

app.post("/chat", async function(req, res) {
  try {
    const message = String(req.body.message || "").trim();
    const history = sanitizeHistory(req.body.history);
    if (!message) return res.status(400).json({ answer: "Please send a message." });

    console.log("CHAT:", message);

    // Build input array for responses API
    const input = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: input,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        }
      ],
    });

    console.log("RESPONSE OK");

    const answer = (response.output_text || "Sorry, I could not generate a response.").trim();
    return res.json({ answer: answer });

  } catch (err) {
    console.error("CHAT ERROR:", err && err.message ? err.message : JSON.stringify(err));

    // Fallback to chat completions if responses API fails
    try {
      console.log("TRYING FALLBACK...");
      const history2 = sanitizeHistory(req.body.history);
      const message2 = String(req.body.message || "").trim();
      const fallback = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history2,
          { role: "user", content: message2 },
        ],
        max_tokens: 512,
      });
      const answer = (fallback.choices[0].message.content || "Sorry, something went wrong.").trim();
      console.log("FALLBACK OK");
      return res.json({ answer: answer });
    } catch (err2) {
      console.error("FALLBACK ERROR:", err2 && err2.message ? err2.message : err2);
      return res.status(500).json({ answer: "Sorry, something went wrong. Please try again or call us at (513) 530-0188." });
    }
  }
});

app.listen(port, "0.0.0.0", function() {
  console.log("B.O.B. running on port " + port);
  console.log("Model:", OPENAI_MODEL);
  console.log("Vector store:", VECTOR_STORE_ID || "NOT SET");
});
