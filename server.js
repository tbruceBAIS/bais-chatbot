import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Blue Ash chatbot is running.");
});

app.get("/widget", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blue Ash AI BAAI</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: transparent;
    }
    .chat-wrap {
      width: 100%;
      height: 100vh;
      display: flex;
      flex-direction: column;
      border: 1px solid #dbe6fb;
      border-radius: 16px;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 18px 45px rgba(0,0,0,0.18);
    }
    .chat-header {
      background: #1f4aa8;
      color: #fff;
      padding: 14px 16px;
    }
    .chat-header h3 {
      margin: 0 0 4px;
      font-size: 18px;
    }
    .chat-header p {
      margin: 0;
      font-size: 12px;
      line-height: 1.4;
      opacity: 0.95;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #f7f9fc;
    }
    .msg {
      margin-bottom: 10px;
      display: flex;
    }
    .msg.user {
      justify-content: flex-end;
    }
    .bubble {
      max-width: 82%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.bot .bubble {
      background: #fff;
      color: #213047;
      border: 1px solid #dbe6fb;
      border-bottom-left-radius: 6px;
    }
    .msg.user .bubble {
      background: #1f4aa8;
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .chat-footer {
      padding: 12px;
      border-top: 1px solid #e4ebf7;
      background: #fff;
    }
    .chat-form {
      display: flex;
      gap: 8px;
    }
    .chat-input {
      flex: 1;
      height: 42px;
      border: 1px solid #cfdcf5;
      border-radius: 10px;
      padding: 0 12px;
      font-size: 14px;
      outline: none;
    }
    .chat-send {
      height: 42px;
      border: none;
      border-radius: 10px;
      background: #1f4aa8;
      color: #fff;
      padding: 0 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .chat-note {
      margin-top: 8px;
      font-size: 11px;
      color: #667892;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="chat-wrap">
    <div class="chat-header">
      <h3>Blue Ash Assistant</h3>
      <p>General company questions only.</p>
    </div>

    <div class="chat-messages" id="messages">
      <div class="msg bot">
        <div class="bubble">Hi! I can help with general questions about Blue Ash Industrial Supply, brands, careers, and vending solutions.

For quotes, orders, pricing, or order-specific help, please contact sales@blueashsupply.com or call (513) 530-0188.</div>
      </div>
    </div>

    <div class="chat-footer">
      <form class="chat-form" id="chatForm">
        <input id="chatInput" class="chat-input" type="text" placeholder="Ask a question..." autocomplete="off" />
        <button class="chat-send" type="submit">Send</button>
      </form>
      <div class="chat-note">Friendly, technical, and general-info only.</div>
    </div>
  </div>

  <script>
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");
    const messages = document.getElementById("messages");

    function addMessage(text, type) {
      const msg = document.createElement("div");
      msg.className = "msg " + type;

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = text;

      msg.appendChild(bubble);
      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
    }

    function addTyping() {
      const msg = document.createElement("div");
      msg.className = "msg bot";
      msg.id = "typing-msg";

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = "Typing...";

      msg.appendChild(bubble);
      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
    }

    function removeTyping() {
      const el = document.getElementById("typing-msg");
      if (el) el.remove();
    }

    form.addEventListener("submit", async function(e) {
      e.preventDefault();

      const text = input.value.trim();
      if (!text) return;

      addMessage(text, "user");
      input.value = "";
      addTyping();

      try {
        const response = await fetch("/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });

        const data = await response.json();
        removeTyping();
        addMessage(data.reply || "Sorry, I couldn't get a response.", "bot");
      } catch (err) {
        removeTyping();
        addMessage("Sorry, I couldn't connect right now. Please contact sales@blueashsupply.com or call (513) 530-0188.", "bot");
      }
    });
  </script>
</body>
</html>`);
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage || !userMessage.trim()) {
    return res.json({ reply: "Please enter a question." });
  }

  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: `
You are the Blue Ash Industrial Supply assistant.

Answer only general questions about the company, brands, careers, contact details, and vending solutions.

Tone: friendly and technical.

Company facts:
- Blue Ash Industrial Supply is a family-owned distributor established in 1984.
- The company is based in Cincinnati, Ohio.
- It serves customers in Ohio, Kentucky, Indiana, and West Virginia.
- It focuses on metalworking, MRO, and vending solutions.
- It emphasizes technical expertise, responsive service, dependable solutions, and strong vendor partnerships.

Do not:
- give pricing
- create quotes
- help with orders
- promise inventory
- promise shipping or lead times
- provide account-specific support

If asked about those topics, reply:
"Please contact our team at sales@blueashsupply.com or call (513) 530-0188."

If unsure, say so and direct the visitor to sales@blueashsupply.com or (513) 530-0188.
          `
        },
        {
          role: "user",
          content: userMessage
        }
      ]
    });

    const reply =
      response.output_text?.trim() ||
      "Sorry, I couldn't get a response right now. Please contact sales@blueashsupply.com or call (513) 530-0188.";

    res.json({ reply });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({
      reply: "Sorry, something went wrong. Please contact our team at sales@blueashsupply.com or call (513) 530-0188."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
