require('dotenv').config();
// server.js — Voice Mentor embeddable widget server

const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const Anthropic = require("@anthropic-ai/sdk");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const pdfParse = require("pdf-parse");

// Helper function to read all knowledge base files
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
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Initialize ElevenLabs client
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// ---- Configuration ----
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET missing from .env");
  process.exit(1);
}

// The client registry: who is allowed to embed us, their signing secret,
// and which website origins they may embed from.
const clients = JSON.parse(
  fs.readFileSync(path.join(__dirname, "clients.json"), "utf8")
);

const SESSION_LIFETIME = "2h"; // how long one widget session stays unlocked

app.get('/demo', (req, res) => {
  const filePath = path.join(__dirname, 'views', 'demo-host.html');
  let html = fs.readFileSync(filePath, 'utf8');
  
  const client = clients["demo"];
  const token = jwt.sign({ clientId: "demo" }, client.embedSecret, { expiresIn: '2h' });
  const widgetUrl = `/widget.html?token=${token}`;
  
  html = html.replace('__IFRAME_SRC__', widgetUrl);
  res.send(html);
});

let KNOWLEDGE_DATA = "";

// Read knowledge base asynchronously on startup
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

Use the following knowledge base from Mark's webinars, training materials, and experience to directly answer questions and inform your advice:
${KNOWLEDGE_DATA}`;
}

// ---- Small helpers ----

function originOf(urlString) {
  try {
    return new URL(urlString).origin; // e.g. "https://clientsite.com"
  } catch {
    return null;
  }
}

function deniedPage(reason) {
  return `<!doctype html><html><body style="font-family:sans-serif;display:flex;
    align-items:center;justify-content:center;height:95vh;color:#555">
    <div style="text-align:center"><h2>🔒 Access unavailable</h2>
    <p>${reason}</p><p style="font-size:13px;color:#999">If you believe this is
    an error, please contact the site owner.</p></div></body></html>`;
}

// ---- Route 1: the embed endpoint (the security gate) ----

app.get("/embed", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).send(deniedPage("No access token was provided."));

  const unverified = jwt.decode(token);
  const client = unverified && clients[unverified.clientId];
  if (!client) return res.status(401).send(deniedPage("Unknown client."));

  try {
    jwt.verify(token, client.embedSecret);
  } catch (err) {
    const reason =
      err.name === "TokenExpiredError"
        ? "This access link has expired. Please refresh the page."
        : "Invalid access token.";
    return res.status(401).send(deniedPage(reason));
  }

  const sessionToken = jwt.sign(
    { clientId: unverified.clientId },
    SESSION_SECRET,
    { expiresIn: SESSION_LIFETIME }
  );

  const html = fs
    .readFileSync(path.join(__dirname, "views", "widget.html"), "utf8")
    .replace("__SESSION_TOKEN__", sessionToken);
  res.send(html);
});

// ---- Route 2: the AI + ElevenLabs Voice endpoint ----

function requireSession(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer /, "");
  if (!token) {
    req.session = { clientId: "demo" };
    return next();
  }
  try {
    req.session = jwt.verify(token, SESSION_SECRET);
    next();
  } catch (err) {
    req.session = { clientId: "demo" };
    next();
  }
}

app.post("/api/chat", requireSession, async (req, res) => {
  const messages = req.body.messages;

  if (
    !Array.isArray(messages) ||
    messages.length > 60 ||
    messages.some((m) => typeof m.content !== "string" || m.content.length > 4000)
  ) {
    return res.status(400).json({ error: "Invalid conversation format." });
  }

  try {
    // 1. Get Claude text response
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system: getSystemPrompt(),
      messages,
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // 2. Generate audio with your ElevenLabs cloned voice
    let audioBase64 = null;
    if (process.env.ELEVENLABS_VOICE_ID) {
      console.log("Generating audio with ElevenLabs voice ID:", process.env.ELEVENLABS_VOICE_ID);
      const audioStream = await elevenlabs.textToSpeech.convert(
        process.env.ELEVENLABS_VOICE_ID,
        {
          text: text,
          model_id: "eleven_turbo_v2_5",
          output_format: "mp3_44100_128",
        }
      );

      const chunks = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);
      audioBase64 = audioBuffer.toString("base64");
      console.log("ElevenLabs audio generated successfully!");
    }

    res.json({ reply: text, audio: audioBase64 });
  } catch (error) {
    console.error("--- SERVER ERROR DETAILED ---");
    console.error(error);
    console.error("-----------------------------");
    res.status(500).json({ error: "The mentor is briefly unavailable. Try again." });
  }
});

// ---- Route 3 (dev only): demo page ----

app.get("/dev/demo", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();

  const embedToken = jwt.sign(
    { clientId: "demo" },
    clients.demo.embedSecret,
    { expiresIn: "5m" }
  );

  const html = fs
    .readFileSync(path.join(__dirname, "views", "demo-host.html"), "utf8")
    .replace("__IFRAME_SRC__", `/embed?token=${embedToken}`);
  res.send(html);
});

app.get("/", (_req, res) => res.send("Voice Mentor server is running."));

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Voice Mentor running → http://localhost:${PORT}`);
  console.log(`Demo client page   → http://localhost:${PORT}/dev/demo`);
});