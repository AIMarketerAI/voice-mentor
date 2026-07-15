# AI MARK TWIN - PROJECT BACKUP & PROGRESS CHECKPOINT

**Date:** 15 July 2026 · **Workspace:** `~/voice-mentor` (git repository, 2 commits)
**Legend:** ✅ BUILT & tested — working code in this repo · 🔜 PLANNED — agreed direction, not yet implemented

---

## 1. Executive Summary & Naming

| Item | Value | Status |
|---|---|---|
| Frontend branding | **"AI Mark"** (widget currently displays "Voice Mentor" — rename pending) | 🔜 |
| Target domain | **marklaxton.ai** (currently runs on `http://localhost:3000`) | 🔜 |
| Working title / repo | `voice-mentor` | ✅ |

**Core architecture (✅ BUILT):** a clean, dependency-free widget served inside an
`<iframe>`, embedded on a business client's membership-gated page. Subscribers who
are already logged into the host site get instant access — **zero double-logins,
zero external branding, zero magic links.** When a subscription is cancelled, the
host site's membership plugin revokes the page and the widget disappears with it.

**Tech stack (✅):** Node.js 26 · Express 5 · Anthropic SDK (model `claude-opus-4-8`)
· `jsonwebtoken` · browser-native speech recognition & synthesis (free tier).

**Repository layout:**

```
voice-mentor/
├── server.js              # Express backend: /embed gate, /api/chat, /dev/demo
├── views/widget.html      # The embeddable card widget (UI + call loop)
├── views/demo-host.html   # Fake client membership page for local testing
├── clients.json           # Client registry: secrets + allowed domains (git-ignored)
├── clients.example.json   # Committed template for the above
├── .env                   # ANTHROPIC_API_KEY, SESSION_SECRET (git-ignored)
├── INTEGRATION.md         # Step-by-step guide for business clients
└── BLUEPRINT.md           # This document
```

---

## 2. UI & Interaction Architecture

### Widget layout

Current build (✅) is a 340px-wide rounded card. Target spec (🔜) is a **9:16
vertical card**; same element order either way:

1. **Top:** circular profile photo — currently a placeholder SVG avatar; to be
   replaced with a professional portrait of Mark Laxton (🔜)
2. **Header:** bold name — will read **"AI Mark"** (🔜; currently "Voice Mentor")
3. **Subtext:** "Ask a question by typing or speaking." (✅)
4. **Input:** text field with microphone icon inside (mic dictates into the box) (✅)
5. **Green call button** — will read **"Call AI Mark"** (🔜; currently "📞 Call")
6. **Red "End Call" button** — appears only during an active call (✅)

No secondary branding, no dashboards, no menus. (✅)

### Continuous voice-to-voice loop (✅ BUILT)

```
[Call pressed] → LISTEN (mic open, hands-free)
      → user pauses → PROCESS (send full conversation to backend → Claude)
      → SPEAK (reply read aloud)
      → LISTEN again … repeats until
[End Call pressed] → transcript of the whole conversation rendered
                     in a copyable text box
```

- No Send button, no per-turn mic taps — an open phone line until End Call. ✅
- Typed questions work at any time, with or without an active call. ✅
- On error (expired session, API hiccup) the widget shows a friendly status
  message and reopens the mic rather than dying. ✅

---

## 3. Security & Embedding Strategy

**Design decision on record:** the outline phrase "no-token embedding" is *not*
what was built, on purpose. Page gating alone cannot stop a subscriber copying
the iframe URL to another site. The build uses an **invisible token handshake** —
"no-login" for the user, but never "no-token":

### The three-layer gate (✅ BUILT & attack-tested)

1. **Signed JWT handshake** — the host site's server signs a short-lived token
   (5-min expiry, HS256, per-client secret) into the iframe URL. Our `/embed`
   endpoint verifies signature + expiry, then issues a 2-hour session token that
   must accompany every AI request. The subscriber sees none of this.
2. **Domain whitelisting** — `/embed` checks the HTTP `Referer` origin against
   the client's registered domains in `clients.json`. Wrong site → HTTP 403.
3. **CSP `frame-ancestors`** — response header listing only approved origins;
   the browser itself refuses to render the widget anywhere else. This is the
   backstop for cases where Referer is stripped.

**Verified by test (✅):** no token → 401 · forged token → 401 · valid token on
unregistered domain → 403 · API call without session → 401 · legitimate path → 200 + reply.

**Host-site compatibility (🔜 to document per-platform):** WordPress (PHP snippet
written — see INTEGRATION.md), Webflow and GoHighLevel (need serverless token
endpoint since they can't run PHP; pattern designed, not yet written).

**Cancellation flow (✅ by design):** Stripe/ThriveCart → membership plugin
revokes page → widget inaccessible. No code needed on our side.

---

## 4. Current Backend & Planned Voice/Knowledge Configuration

### Environment variables

| Variable | Purpose | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API access (the AI brain) | ✅ configured |
| `SESSION_SECRET` | Signs widget session tokens | ✅ configured |
| `ELEVENLABS_API_KEY` | Premium voice cloning/synthesis | 🔜 reserved, not yet used |
| `ELEVENLABS_VOICE_ID` | Mark's cloned voice | 🔜 reserved, not yet used |

### Voice upgrade path (🔜 PLANNED)

Current voice is the browser's built-in speech synthesis (free, robotic).
The widget code has a single marked `SWAP POINT` function (`speak()` in
`views/widget.html`); the upgrade is: backend endpoint calls ElevenLabs with
`ELEVENLABS_VOICE_ID` (a clone of Mark's voice) → streams audio to the widget →
played via an `<audio>` element. Estimated cost ~6–15¢ per conversation-minute.

### Knowledge / personality (🔜 PLANNED — "Legacy Blueprint" RAG)

- **Static knowledge base:** Mark's origin story, brand tone guide, and 80+
  curated Q&As. Approach for v1 of this feature: inject directly into the system
  prompt (simple, no infrastructure). Graduate to true RAG (embeddings +
  retrieval) only if the corpus outgrows the context window or costs demand it.
- **Dynamic intake:** separate per-user intake form whose answers are injected
  into that user's session context, so AI Mark personalizes from turn one.
- Current system prompt (✅): generic warm-mentor persona in `server.js`
  (`SYSTEM_PROMPT` constant) — the single place personality lives today.

---

## Open items before first paying client

1. **Deploy** to a real host with HTTPS at marklaxton.ai (nothing works for
   clients until this happens)
2. **Rename** widget branding to AI Mark + add real portrait photo
3. **Per-client usage caps / rate limiting** — all conversations currently bill
   the owner's Anthropic key without limits
4. **ElevenLabs voice integration** (swap point ready)
5. **Legacy Blueprint content** — write and wire in the persona/Q&A corpus
6. **Serverless token snippets** for Webflow / GoHighLevel clients
