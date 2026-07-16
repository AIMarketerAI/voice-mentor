# The Complete AI Twin Build & Deployment Blueprint
### Master Standard Operating Procedure — from zero to a working AI twin

**What this manual builds:** a voice AI "twin" of a real person — it speaks in
their cloned voice, answers from their knowledge base, and embeds securely on
any client website behind their existing membership login. Written for someone
with zero coding experience. Every command is copy-pasteable into Terminal
(Mac: `Cmd+Space`, type "Terminal", Enter).

**Verified against the working AI Mark build, 16 July 2026.**

---

## PART 1 — Software & Account Setup (once per computer)

### 1.1 Install Homebrew (the Mac app store for developer tools)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Follow the prompts (it will ask for your Mac password — typing is invisible, that's normal).

### 1.2 Install Node.js (the engine that runs our server)

```bash
brew install node
node -v   # should print v26 or higher — that means it worked
```

### 1.3 Install a code editor

**VS Code** (recommended — free, the industry standard):
download from https://code.visualstudio.com, drag to Applications.
TextEdit works in a pinch, but VS Code colours the code and catches typos.

### 1.4 Anthropic account (the AI brain)

1. Sign up at **https://platform.claude.com**
2. Add billing credit (£5+ — conversations cost well under a penny each)
3. **API Keys → Create Key** → copy it (starts `sk-ant-`). You'll paste it into
   the `.env` file in Part 2. Treat it like a bank password: never in code,
   never in chat, never in git.

### 1.5 ElevenLabs account (the cloned voice)

1. Sign up at **https://elevenlabs.io** (voice cloning needs the Starter plan or above)
2. **Voices → Add a new voice → Instant Voice Clone** → upload 1–3 minutes of
   clean solo speech (no music, no other voices)
3. Copy two things:
   - Your **API key**: click your profile icon → API Keys
   - Your **Voice ID**: open the cloned voice → ID button (a string like `pNIn...`)

---

## PART 2 — Project Setup & Architecture

### 2.1 Create the project skeleton

```bash
mkdir -p ~/ai-twin/views/public/images ~/ai-twin/knowledge_base
cd ~/ai-twin
git init
npm init -y
```

### 2.2 Install the six libraries

```bash
npm install express @anthropic-ai/sdk @elevenlabs/elevenlabs-js jsonwebtoken dotenv pdf-parse@1.1.1
```

| Library | What it does |
|---|---|
| `express` | The web server framework |
| `@anthropic-ai/sdk` | Talks to Claude (the brain) |
| `@elevenlabs/elevenlabs-js` | Talks to ElevenLabs (the voice) |
| `jsonwebtoken` | Signs/verifies the security tokens |
| `dotenv` | Loads secrets from the `.env` file |
| `pdf-parse` | Reads PDF knowledge-base files |

> ⚠️ **`pdf-parse` MUST be version 1.1.1.** Version 2 changed its interface and
> crashes our server with `TypeError: pdfParse is not a function`. The command
> above pins it. (This bug cost us a debugging session — learn from our pain.)

### 2.3 The `.env` file — where all secrets live

Create a file called `.env` in the project folder containing exactly four lines:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
ELEVENLABS_API_KEY=your-elevenlabs-key-here
ELEVENLABS_VOICE_ID=your-cloned-voice-id-here
SESSION_SECRET=paste-result-of-command-below
```

Generate the `SESSION_SECRET` value with:

```bash
openssl rand -hex 32
```

### 2.4 The `.gitignore` file — what git must never track

Create `.gitignore` containing:

```
node_modules/
.env
clients.json
.DS_Store
```

`.env` and `clients.json` hold secrets; committing them is how keys get stolen.
**If you ever push this repo to GitHub, make the repository PRIVATE** — the
knowledge base is your (or your client's) intellectual property.

### 2.5 The start command

```bash
npm pkg set scripts.start="node --env-file=.env server.js"
```

From now on, `npm start` runs the whole app. `Ctrl+C` stops it.

### 2.6 Final folder structure

```
ai-twin/
├── server.js                  # Backend: security gate + AI + voice (Part 3)
├── views/
│   ├── widget.html            # The embeddable widget UI (Part 4)
│   ├── demo-host.html         # Fake client site for local testing
│   └── public/images/
│       └── profile.jpg        # The twin's portrait photo
├── knowledge_base/            # Drop .txt / .md / .pdf files here (Part 3)
├── clients.json               # Client registry: embed secrets + domains
├── clients.example.json       # Committed template of the above
├── .env                       # The four secrets (git-ignored)
├── .gitignore
└── package.json               # Project manifest + dependency list
```

The reference copies of `server.js`, `widget.html`, `demo-host.html`, and
`clients.example.json` live in the master repo (`~/voice-mentor`) — when
building a new twin you copy the whole folder anyway (Part 5), so you never
type them from scratch.

---

## PART 3 — The Backend & Knowledge Base (how server.js works)

`server.js` has four jobs, in order:

### 3.1 Load the knowledge base at startup

The `getKnowledgeBase()` function reads **every** `.txt`, `.md`, and `.pdf`
file in `knowledge_base/` — no code changes needed to add material, just drop
files in and restart:

```js
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
      const pdfData = await pdfParse(fs.readFileSync(filePath));
      contextText += `\n--- SOURCE: ${file} ---\n` + pdfData.text;
    }
  }
  return contextText;
}
```

### 3.2 Inject it into the twin's personality

`getSystemPrompt()` combines the persona instructions with the knowledge text.
**This one function IS the twin's character** — edit the wording here to change
how it behaves:

```js
function getSystemPrompt() {
  return `You are a warm, sharp mentor named Mark who helps people think
clearly and turn ideas into action. You are speaking out loud, so keep replies
to 2-4 spoken sentences...
Use the following knowledge base to inform your advice:
${KNOWLEDGE_DATA}`;
}
```

Current model: `claude-haiku-4-5` (fast + cheap — right for short voice
replies). One-line swap to `claude-opus-4-8` if you ever want deeper answers
at higher cost.

### 3.3 The security gate (`/embed`)

Checks three locks before serving the widget — a forged token, an expired
token, or an unregistered website each produce a polite denial page:

1. **JWT signature** — signed by the client's secret, 5-minute expiry
2. **Referer check** — the embedding page's domain must be registered in `clients.json`
3. **CSP `frame-ancestors`** — the browser refuses to render the widget on any other site

If all pass, the widget is served with a 2-hour session token baked in.

### 3.4 The AI + voice endpoint (`/api/chat`)

Requires the session token. Then: Claude generates the reply text → ElevenLabs
converts it to MP3 in the cloned voice → both go back to the widget:

```js
const audioStream = await elevenlabs.textToSpeech.convert(
  process.env.ELEVENLABS_VOICE_ID,
  { text, model_id: "eleven_turbo_v2_5", output_format: "mp3_44100_128" }
);
// ...collect stream to a buffer, base64-encode, send as { reply, audio }
```

If `ELEVENLABS_VOICE_ID` is missing, the widget automatically falls back to
the free (robotic) browser voice — the app never breaks, just sounds worse.

---

## PART 4 — The Widget UI & Embedding

### 4.1 `views/widget.html` — the whole user experience in one file

- **Card layout:** portrait photo (`/images/profile.jpg`) → bold name →
  "Ask a question by typing or speaking." → text input with 🎤 icon →
  green **📞 Call** button → red **🛑 End Call** button (hidden until a call starts)
- **The call loop:** Call → mic opens → you pause → text goes to `/api/chat` →
  MP3 plays in the cloned voice → mic reopens. Hands-free until End Call.
- **Transcript:** builds up on screen during the conversation.
- **No external CSS/JS libraries** — everything inline, loads instantly in any iframe.

### 4.2 Embedding on a website

```html
<iframe
  src="https://YOUR-DOMAIN/embed?token=GENERATED_JWT_HERE"
  allow="microphone"
  style="border:none;width:420px;height:680px;">
</iframe>
```

Two non-negotiables:
- **`allow="microphone"`** — without it, browsers silently block the mic inside iframes
- **The token must be generated server-side** on the client's site (never in
  page JavaScript). Copy-pasteable WordPress/PHP and Node snippets live in
  `INTEGRATION.md`.

### 4.3 Local testing

`http://localhost:3000/dev/demo` is a fake client membership page that signs a
real token and embeds the widget — the full production handshake on your Mac.
(It disables itself automatically on production servers.)

---

## PART 5 — Duplicating the App for a New Client (the SaaS play)

Each client twin = one copy of the folder with five things swapped.
Total time once practised: **under 30 minutes.**

### Step 1 — Copy the master folder

```bash
cp -R ~/voice-mentor ~/twin-CLIENTNAME
cd ~/twin-CLIENTNAME
rm -rf .git node_modules knowledge_base/* views/public/images/profile.jpg
git init && npm install
```

### Step 2 — Swap the knowledge base

Drop the client's material into `knowledge_base/` — interview answers
(use `LEGACY-BLUEPRINT-INTERVIEW.md` as the question script), webinar
transcripts, Q&A docs. Any mix of `.txt`, `.md`, `.pdf`.

### Step 3 — Swap the identity

1. **Photo:** save theirs as `views/public/images/profile.jpg`
2. **Name:** in `views/widget.html`, change the `<h1>` and button text
3. **Persona:** in `server.js`, rewrite `getSystemPrompt()`'s personality
   paragraph (name, style, boundaries)

### Step 4 — Swap the voice & keys

Clone the client's voice in ElevenLabs (1–3 min of their clean audio), then
create this twin's own `.env`:

```
ANTHROPIC_API_KEY=...        # yours, or a separate key per client for billing clarity
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...      # ← the NEW client's cloned voice
SESSION_SECRET=...           # fresh: openssl rand -hex 32
```

### Step 5 — Register their website domain

Create `clients.json` from the template, with a fresh embed secret:

```bash
cp clients.example.json clients.json
openssl rand -hex 32   # → paste as embedSecret
```

```json
{
  "clientname": {
    "name": "Client Business Name",
    "embedSecret": "the-fresh-secret",
    "allowedOrigins": ["https://www.clientwebsite.com", "http://localhost:3000"]
  }
}
```

Send the client their ID + secret + the `INTEGRATION.md` guide.

### Step 6 — Test before handover (5-point checklist)

```bash
npm start
```

1. `http://localhost:3000/dev/demo` loads the widget with the right face & name
2. Typed question → reply **in the client's voice** (not robotic fallback = voice ID works)
3. Reply reflects their knowledge base (ask something only their material covers)
4. Full voice call loop works hands-free; End Call shows the transcript
5. `curl -I "http://localhost:3000/embed"` returns **401** (gate is up)

---

## Troubleshooting (every error we actually hit, and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| `pdfParse is not a function` on startup | pdf-parse v2 installed | `npm install pdf-parse@1.1.1` |
| `Cannot find module 'dotenv'` (or any package) | Dependency missing from package.json | `npm install --save <package-name>` |
| Mic never activates inside the iframe | Missing `allow="microphone"` | Add it to the iframe tag |
| Widget shows "Access unavailable" (401) | Token missing/expired/forged | Refresh host page; check embed secret matches `clients.json` |
| Widget shows 403 | Domain not registered | Add the site's origin to `allowedOrigins` |
| Robotic voice instead of cloned voice | `ELEVENLABS_VOICE_ID` missing/wrong, or ElevenLabs credit exhausted | Check `.env` and your ElevenLabs plan |
| `SESSION_SECRET missing` and exit | `.env` absent or misnamed | Must be exactly `.env` in the project root |
| Changes don't take effect | Server still running old code | `Ctrl+C`, then `npm start` again |

## Daily command cheat-sheet

```bash
cd ~/voice-mentor        # go to the project
npm start                # run the app  →  http://localhost:3000/dev/demo
# Ctrl+C stops it
git add -A && git commit -m "describe what changed"   # save a checkpoint
git log --oneline        # see all checkpoints
```
