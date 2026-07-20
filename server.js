require('dotenv').config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const pdfParse = require("pdf-parse");

async function getKnowledgeBase() {
  const dirPath = path.join(__dirname, "knowledge_base");
  if (!fs.existsSync(dirPath)) return "";
  const files = fs.readdirSync(dirPath);
  let contextText = "";
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (file.endsWith(".txt") || file.endsWith(".md")) {
      contextText += `\n--- SOURCE: ${file} ---\n` + fs.readFileSync(filePath, "utf8");
    } else if (file.endsWith(".pdf")) {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      contextText += `\n--- SOURCE: ${file} ---\n` + pdfData.text;
    }
  }
  return contextText;
}

const app = express();
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "views", "public", "images")));
app.use(express.static(path.join(__dirname, "views")));

const anthropic = new Anthropic();
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

let KNOWLEDGE_DATA = "";
getKnowledgeBase().then((data) => {
  KNOWLEDGE_DATA = data;
  console.log("Knowledge base loaded successfully!");
});

function getSystemPrompt() {
  return `You are a warm, sharp mentor named Mark who helps people think clearly and turn ideas into action. You are speaking out loud in a voice conversation, so:
- Keep replies short: 2-4 spoken sentences, no lists, no markdown.
- Ask one good question more often than you give advice.
- When the user has an idea, help them find the single smallest next action.
- Be encouraging but honest.

CRITICAL BOUNDARY RULES:
1. You are AI Mark, acting as a mentor to the USER. Do NOT attribute Mark's background to the user.
2. Protect Mark's personal financial and private details.
3. Keep user focused on business strategy and implementation.

Knowledge base:
${KNOWLEDGE_DATA}`;
}

// Serve widget directly at the root URL
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "widget.html"));
});

// Direct chat endpoint without JWT verification
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: "Invalid request" });

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 250,
      system: getSystemPrompt(),
      messages,
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");

    let audioBase64 = null;
    if (process.env.ELEVENLABS_VOICE_ID) {
      const audioStream = await elevenlabs.textToSpeech.stream(
        process.env.ELEVENLABS_VOICE_ID,
        { text, modelId: "eleven_flash_v2_5", output_format: "mp3_44100_128" }
      );
      const chunks = [];
      for await (const chunk of audioStream) chunks.push(chunk);
      audioBase64 = Buffer.concat(chunks).toString("base64");
    }

    res.json({ reply: text, audio: audioBase64 });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Mentor briefly unavailable" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
