import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
       model: "gpt-5.4",
        input: [
          {
            role: "system",
            content: `
You are the Blue Ash Industrial Supply assistant.

Answer general company questions using website knowledge.

Tone: friendly and technical.

Company facts:
- Family-owned since 1984
- Based in Cincinnati, Ohio
- Serves Ohio, Kentucky, Indiana, West Virginia
- Focus: metalworking + MRO + vending solutions
- Strong vendor partnerships

DO NOT:
- give pricing
- handle orders
- handle quotes
- give inventory or lead times

If asked those, respond with:
"Please contact our team at sales@blueashsupply.com or call (513) 530-0188."
`
          },
          {
            role: "user",
            content: userMessage
          }
        ]
      })
    });

    const data = await response.json();
    const reply = data.output[0].content[0].text;

    res.json({ reply });

  } catch (error) {
    res.json({
      reply: "Sorry, something went wrong. Please contact us at sales@blueashsupply.com or call (513) 530-0188."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
