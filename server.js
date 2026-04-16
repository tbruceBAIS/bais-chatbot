import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || "vs_69c695df0a1881919287c9ed05b5cf6c";
const OPENAI_MODEL    = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const BASE_URL        = process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* ─────────────────────────────────────────
   SYSTEM PROMPT
───────────────────────────────────────── */
const SYSTEM_PROMPT = `
You are B.O.B. (Blue's Operation Bot), the AI assistant for Blue Ash Industrial Supply.
Blue Ash Industrial Supply is an industrial distributor based in Blue Ash, Ohio.
They carry a wide range of MRO products including cutting tools, abrasives, fasteners,
safety equipment, hand tools, power tools, measuring/inspection, workholding, and more.
They are an authorized Guhring distributor.

YOUR PERSONALITY:
- Friendly, knowledgeable, and direct — like a helpful counter rep who knows their stuff
- Use light emojis where natural (greetings, good news, etc.) but don't overdo it
- Keep answers concise and practical — no walls of text
- If you don't know something, say so honestly and suggest contacting the team

YOUR PRIORITIES (in order):
1. Answer questions about Blue Ash Industrial Supply (hours, location, services, capabilities, vendors)
2. Share general tooling and MRO knowledge (materials, applications, best practices)
3. Help users find the right product or product category
4. Direct users to relevant product pages on the website when helpful

GUHRING TOOLS:
You have deep knowledge of Guhring cutting tools. When a user asks about a Guhring tool:
- Ask clarifying questions to narrow down: tool type, diameter/size, material being cut,
  application (through hole, blind hole, etc.), and any coating or substrate preferences
- Once you have enough info, recommend a specific Guhring series or part if you can
- Always mention you can help them find it on the website or they can call the team

PRODUCT PAGE LINKS:
When directing to product categories, use these URLs:
- Drilling: ${BASE_URL}/browse/catalogue/group/6201
- HSS/Co Drills: ${BASE_URL}/browse/catalogue/group/6211
- Solid Carbide Drills: ${BASE_URL}/browse/catalogue/group/6210
- Milling: ${BASE_URL}/browse/catalogue/group/6000
- Threading/Taps: ${BASE_URL}/browse/catalogue/group/6300
- Reaming: ${BASE_URL}/browse/catalogue/group/6202
- Thread Mills: ${BASE_URL}/browse/catalogue/group/6303

FORMATTING:
- Use plain line breaks between sections, not markdown headers
- When showing a product match, use this structure:

Part #: [number]
Description: [description]
Why it fits: [one sentence]

- Never use ** bold markdown — the chat renders plain text
- Keep responses under ~150 words unless detail is truly needed
`.trim();

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.trim() }));
}

/* ─────────────────────────────────────────
   ROUTES
───────────────────────────────────────── */
app.get("/", (_req, res) => res.send("B.O.B. is running ✅"));

app.get("/health", (_req, res) => res.json({
  ok: true,
  model: OPENAI_MODEL,
  vectorStore: VECTOR_STORE_ID || "not set",
  baseUrl: BASE_URL,
}));

/* ─────────────────────────────────────────
   CHAT
───────────────────────────────────────── */
app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const history = sanitizeHistory(req.body.history);

    if (!message) {
      return res.status(400).json({ answer: "Please send a message." });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    const config = {
      model: OPENAI_MODEL,
      input: messages,
      max_output_tokens: 512,
    };

    if (VECTOR_STORE_ID) {
      config.tools = [{
        type: "file_search",
        vector_store_ids: [VECTOR_STORE_ID],
      }];
    }

    const response = await openai.responses.create(config);
    const answer = (response.output_text || "Sorry, I couldn't generate a response right now.").trim();

    return res.json({ answer });

  } catch (err) {
    console.error("CHAT ERROR:", err?.message || err);
    return res.status(500).json({ answer: "Sorry, something went wrong. Please try again." });
  }
});

/* ─────────────────────────────────────────
   WIDGET
───────────────────────────────────────── */
app.get("/widget", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(WIDGET_HTML);
});

/* ─────────────────────────────────────────
   START
───────────────────────────────────────── */
app.listen(port, () => {
  console.log("B.O.B. running on port", port);
  console.log("Model:", OPENAI_MODEL);
  console.log("Vector store:", VECTOR_STORE_ID || "NOT SET");
});

/* ─────────────────────────────────────────
   WIDGET HTML
───────────────────────────────────────── */
const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>B.O.B.</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:          #0f1117;
      --surface:     #1a1d27;
      --surface2:    #22263a;
      --border:      #2e3250;
      --accent:      #4f8ef7;
      --accent-dim:  #1e3a6e;
      --text:        #e8eaf6;
      --text-muted:  #6b7280;
      --text-dim:    #9ca3af;
      --user-bg:     #4f8ef7;
      --user-text:   #ffffff;
      --bot-bg:      #1a1d27;
      --bot-text:    #e8eaf6;
      --radius:      14px;
      --font:        'DM Sans', sans-serif;
      --mono:        'DM Mono', monospace;
    }

    html, body {
      width: 100%; height: 100%;
      background: var(--bg);
      font-family: var(--font);
      color: var(--text);
      overflow: hidden;
    }

    #shell {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: var(--bg);
    }

    /* ── Header ── */
    #header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }

    #avatar {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    #header-text { display: flex; flex-direction: column; gap: 1px; }

    #header-name {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    #header-sub {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--mono);
      letter-spacing: 0.04em;
    }

    #status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #22c55e;
      margin-left: auto;
      box-shadow: 0 0 6px #22c55e88;
      animation: pulse 2.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* ── Messages ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }

    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }

    .row.user { justify-content: flex-end; }
    .row.bot  { justify-content: flex-start; }

    .bot-icon {
      width: 26px; height: 26px;
      border-radius: 8px;
      background: var(--accent-dim);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
      margin-bottom: 2px;
    }

    .bubble {
      max-width: 78%;
      padding: 11px 14px;
      border-radius: var(--radius);
      font-size: 13.5px;
      line-height: 1.55;
      word-break: break-word;
    }

    .row.user .bubble {
      background: var(--user-bg);
      color: var(--user-text);
      border-bottom-right-radius: 4px;
    }

    .row.bot .bubble {
      background: var(--bot-bg);
      color: var(--bot-text);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }

    .bubble a {
      color: var(--accent);
      text-decoration: underline;
      text-decoration-color: var(--accent-dim);
    }

    .bubble a:hover { text-decoration-color: var(--accent); }

    /* Typing dots */
    .typing-dots {
      display: flex;
      gap: 5px;
      align-items: center;
      padding: 4px 2px;
    }

    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: bop 1.3s ease-in-out infinite;
    }

    .dot:nth-child(2) { animation-delay: 0.18s; }
    .dot:nth-child(3) { animation-delay: 0.36s; }

    @keyframes bop {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40%            { transform: translateY(-5px); opacity: 1; }
    }

    /* ── Input bar ── */
    #input-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }

    #input {
      flex: 1;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: var(--font);
      font-size: 13.5px;
      color: var(--text);
      outline: none;
      transition: border-color 0.15s;
      min-height: 42px;
    }

    #input::placeholder { color: var(--text-muted); }

    #input:focus {
      border-color: var(--accent);
    }

    #send {
      width: 42px; height: 42px;
      border-radius: 10px;
      background: var(--accent);
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, transform 0.1s;
    }

    #send:hover:not(:disabled) { background: #6ba3ff; }
    #send:active:not(:disabled) { transform: scale(0.94); }
    #send:disabled { opacity: 0.4; cursor: default; }

    #send svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

    /* fade-in for new messages */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .row { animation: fadeUp 0.2s ease; }
  </style>
</head>
<body>
<div id="shell">
  <div id="header">
    <div id="avatar">🤖</div>
    <div id="header-text">
      <span id="header-name">B.O.B.</span>
      <span id="header-sub">Blue's Operation Bot · BAIS</span>
    </div>
    <div id="status-dot"></div>
  </div>

  <div id="messages"></div>

  <div id="input-bar">
    <input id="input" type="text" placeholder="Ask about tools, products, or Blue Ash..." autocomplete="off" />
    <button id="send" aria-label="Send">
      <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>
  </div>
</div>

<script>
  var API = "https://bais-chatbot.onrender.com/chat";
  var history = [];

  var msgs   = document.getElementById("messages");
  var input  = document.getElementById("input");
  var sendBtn = document.getElementById("send");

  var greetings = [
    "Hey! 👋 I'm B.O.B. — Blue Ash Industrial Supply's assistant. What can I help you find?",
    "Hi there! 👋 I'm B.O.B. Ask me about products, tooling, or anything about Blue Ash.",
    "Hello! I'm B.O.B. 🤖 Ready to help with tools, MRO, or questions about Blue Ash Industrial."
  ];

  function scrollBottom() {
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addMessage(text, who) {
    var row = document.createElement("div");
    row.className = "row " + who;

    if (who === "bot") {
      var icon = document.createElement("div");
      icon.className = "bot-icon";
      icon.textContent = "🤖";
      row.appendChild(icon);
    }

    var bubble = document.createElement("div");
    bubble.className = "bubble";

    // Safe text rendering — convert newlines to <br>, linkify URLs
    var safe = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");

    // Linkify bare URLs
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, function(url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });

    bubble.innerHTML = safe;
    row.appendChild(bubble);
    msgs.appendChild(row);
    scrollBottom();
    return row;
  }

  function showTyping() {
    var row = document.createElement("div");
    row.className = "row bot";
    row.id = "typing";

    var icon = document.createElement("div");
    icon.className = "bot-icon";
    icon.textContent = "🤖";
    row.appendChild(icon);

    var bubble = document.createElement("div");
    bubble.className = "bubble";

    var dots = document.createElement("div");
    dots.className = "typing-dots";
    for (var i = 0; i < 3; i++) {
      var d = document.createElement("span");
      d.className = "dot";
      dots.appendChild(d);
    }

    bubble.appendChild(dots);
    row.appendChild(bubble);
    msgs.appendChild(row);
    scrollBottom();
  }

  function hideTyping() {
    var t = document.getElementById("typing");
    if (t) t.remove();
  }

  function lock(val) {
    input.disabled = val;
    sendBtn.disabled = val;
  }

  async function send() {
    var text = input.value.trim();
    if (!text) return;

    addMessage(text, "user");
    input.value = "";
    lock(true);
    showTyping();

    history.push({ role: "user", content: text });

    // Cold-start nudge after 9s
    var nudge = setTimeout(function() {
      var t = document.getElementById("typing");
      if (t) {
        var b = t.querySelector(".bubble");
        if (b) b.innerHTML = '<span style="font-size:12px;color:#6b7280">⏳ Waking up, one moment...</span>';
      }
    }, 9000);

    try {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 60000);

      var res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      clearTimeout(nudge);
      hideTyping();

      var data = await res.json();
      var answer = (data.answer || "Sorry, I ran into an issue.").trim();

      addMessage(answer, "bot");
      history.push({ role: "assistant", content: answer });

      // Keep history trimmed to last 20 messages (10 pairs)
      if (history.length > 20) history = history.slice(history.length - 20);

    } catch (err) {
      clearTimeout(nudge);
      hideTyping();
      if (err.name === "AbortError") {
        addMessage("⏱️ That took too long — Render may be waking up. Try again in a moment.", "bot");
      } else {
        addMessage("Connection error. Please try again.", "bot");
      }
      // Roll back the user message from history on failure
      if (history.length && history[history.length - 1].role === "user") {
        history.pop();
      }
    }

    lock(false);
    input.focus();
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) send();
  });

  // Greeting on load
  addMessage(greetings[Math.floor(Math.random() * greetings.length)], "bot");
</script>
</body>
</html>`;
