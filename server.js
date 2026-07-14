// server.js — our backend. Run with: npm start
//
// It does 3 things:
//   1. Serves the webpage (everything in the /public folder)
//   2. Keeps our Anthropic API key secret (it never leaves this server)
//   3. Receives the conversation from the browser, asks Claude for the
//      mentor's reply, and sends that reply back

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());          // lets us read JSON sent by the browser
app.use(express.static("public")); // serves public/index.html at "/"

// The SDK automatically reads the ANTHROPIC_API_KEY environment variable.
const anthropic = new Anthropic();

// This is the mentor's personality. Changing this text changes the product.
const SYSTEM_PROMPT = `You are a warm, sharp mentor who helps people think
clearly and turn ideas into action. You are speaking out loud in a voice
conversation, so:
- Keep replies short: 2-4 spoken sentences, no lists, no markdown.
- Ask one good question more often than you give advice.
- When the user has an idea, help them find the single smallest next action.
- Be encouraging but honest.`;

// The browser will POST the conversation here as { messages: [...] }
app.post("/api/chat", async (req, res) => {
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 500, // replies are deliberately short — this is spoken aloud
      system: SYSTEM_PROMPT,
      messages: req.body.messages,
    });

    // The reply arrives as content blocks; we just want the text.
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    res.json({ reply: text });
  } catch (error) {
    console.error("Error talking to Claude:", error.message);
    res.status(500).json({ error: "Something went wrong talking to the AI." });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Voice mentor running → http://localhost:${PORT}`);
});
