// server.js — Voice Mentor embeddable widget server
//
// The flow (Pillar 3):
//   1. A paying user visits the client's members-only page.
//   2. That page's server generates a short-lived signed token (JWT) using
//      the embed secret we gave the client, and puts it in the iframe URL:
//      <iframe src="https://voicementor.io/embed?token=..."></iframe>
//   3. GET /embed validates the token signature, expiry, and the Referer
//      (which site is embedding us). If all good, we serve the widget with
//      a fresh SESSION token baked in.
//   4. The widget calls POST /api/chat with that session token on every turn.
//      No token → no AI. No second login anywhere.

const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

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

const SYSTEM_PROMPT = `You are a warm, sharp mentor who helps people think
clearly and turn ideas into action. You are speaking out loud in a voice
conversation, so:
- Keep replies short: 2-4 spoken sentences, no lists, no markdown.
- Ask one good question more often than you give advice.
- When the user has an idea, help them find the single smallest next action.
- Be encouraging but honest.`;

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

  // Step A: read the token's clientId claim (unverified so far) to know
  // whose secret to check it against.
  const unverified = jwt.decode(token);
  const client = unverified && clients[unverified.clientId];
  if (!client) return res.status(401).send(deniedPage("Unknown client."));

  // Step B: verify the signature and expiry with THAT client's secret.
  // If the token was forged or is older than its expiry, this throws.
  try {
    jwt.verify(token, client.embedSecret);
  } catch (err) {
    const reason =
      err.name === "TokenExpiredError"
        ? "This access link has expired. Please refresh the page."
        : "Invalid access token.";
    return res.status(401).send(deniedPage(reason));
  }

  // Step C: domain lock. The Referer header tells us which page embedded
  // the iframe. It must be on the client's approved list.
  const refererOrigin = originOf(req.get("referer") || "");
  if (!refererOrigin || !client.allowedOrigins.includes(refererOrigin)) {
    return res.status(403).send(deniedPage("This widget is not authorized to run on this website."));
  }

  // Step D: all checks passed. Mint a session token (signed with OUR
  // secret, not the client's) and bake it into the widget page.
  const sessionToken = jwt.sign(
    { clientId: unverified.clientId },
    SESSION_SECRET,
    { expiresIn: SESSION_LIFETIME }
  );

  // Step E: CSP frame-ancestors = the browser itself refuses to render
  // this page inside an iframe on any non-approved site. Strongest lock.
  res.set(
    "Content-Security-Policy",
    `frame-ancestors ${client.allowedOrigins.join(" ")}`
  );

  const html = fs
    .readFileSync(path.join(__dirname, "views", "widget.html"), "utf8")
    .replace("__SESSION_TOKEN__", sessionToken);
  res.send(html);
});

// ---- Route 2: the AI endpoint (requires a valid session) ----

function requireSession(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer /, "");
  try {
    req.session = jwt.verify(token, SESSION_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired — please refresh the page." });
  }
}

app.post("/api/chat", requireSession, async (req, res) => {
  const messages = req.body.messages;

  // Basic abuse limits: cap conversation size so nobody can run up our bill
  // with one giant request.
  if (
    !Array.isArray(messages) ||
    messages.length > 60 ||
    messages.some((m) => typeof m.content !== "string" || m.content.length > 4000)
  ) {
    return res.status(400).json({ error: "Invalid conversation format." });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    res.json({ reply: text });
  } catch (error) {
    console.error("Claude API error:", error.message);
    res.status(500).json({ error: "The mentor is briefly unavailable. Try again." });
  }
});

// ---- Route 3 (dev only): a fake client website to test the whole flow ----
// This simulates what a real client's members-only page does: it generates
// a signed token server-side and embeds the iframe. Disabled in production.

app.get("/dev/demo", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();

  const embedToken = jwt.sign(
    { clientId: "demo" },
    clients.demo.embedSecret,
    { expiresIn: "5m" } // short-lived on purpose: a stolen URL dies fast
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
