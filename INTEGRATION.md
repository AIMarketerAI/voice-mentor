# Embedding Voice Mentor on Your Website

Voice Mentor appears as a small card on any page of your site. Your members
use it instantly — **no second login, no external branding, no leaving your
site.** Access is controlled entirely by *your* membership system: if a page
is visible to a member, the widget works; if their subscription lapses and
they lose the page, the widget is gone with it.

## How the security works (30-second version)

1. We give you a secret key (your **embed secret**). Keep it on your server —
   never in page HTML or JavaScript.
2. When a member opens your gated page, your server uses the secret to sign a
   short-lived access token (a JWT, valid for 5 minutes).
3. The token goes inside the iframe address. Our server checks the signature,
   the expiry, **and that the page embedding it is on your registered domain.**
4. If someone copies the iframe code elsewhere, it fails three ways: the token
   expires in minutes, the domain check rejects it, and the browser itself
   refuses to render the frame on unregistered sites.

## Step 1 — Registration (one time)

Send us:
- Your website's domain(s), e.g. `https://www.riversidecoaching.com`
- We'll send back your **Client ID** and **Embed Secret**.

## Step 2 — Generate the token on your gated page

The token must be generated **server-side** (PHP, Node, etc.), never in
browser JavaScript — otherwise your secret would be visible to anyone.

### WordPress (PHP) — no plugins required

Add this to your theme's `functions.php`, then put `[voice_mentor]` on any
membership-protected page:

```php
function voice_mentor_widget() {
    $client_id = 'YOUR_CLIENT_ID';
    $secret    = 'YOUR_EMBED_SECRET'; // better: store in wp-config.php

    // Build a JWT by hand (HS256) — ~15 lines, no libraries needed
    $b64 = fn($d) => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
    $header  = $b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = $b64(json_encode([
        'clientId' => $client_id,
        'iat' => time(),
        'exp' => time() + 300, // valid for 5 minutes
    ]));
    $sig   = $b64(hash_hmac('sha256', "$header.$payload", $secret, true));
    $token = "$header.$payload.$sig";

    return '<iframe
        src="https://voicementor.example.com/embed?token=' . esc_attr($token) . '"
        allow="microphone"
        style="border:none;width:400px;height:560px;"
    ></iframe>';
}
add_shortcode('voice_mentor', 'voice_mentor_widget');
```

### Node.js / Express

```js
const jwt = require("jsonwebtoken");

app.get("/members/mentor", requireActiveSubscription, (req, res) => {
  const token = jwt.sign({ clientId: "YOUR_CLIENT_ID" },
    process.env.VOICE_MENTOR_SECRET, { expiresIn: "5m" });
  res.render("mentor-page", {
    iframeSrc: `https://voicementor.example.com/embed?token=${token}`,
  });
});
```

## Step 3 — The iframe rules

- **`allow="microphone"` is mandatory** — without it the browser silently
  blocks voice inside iframes.
- Recommended size: `width:400px; height:560px`.
- The page hosting the iframe must be behind your membership gate. That's
  the entire cancellation story: Stripe/ThriveCart webhook → membership
  plugin revokes the page → widget inaccessible.

## FAQ

**What if a member shares the page URL?** Your membership plugin already
blocks non-members from the page — same as any protected content.

**What if someone copies the iframe HTML?** The token inside expires within
5 minutes, and even a fresh one only works when embedded on your registered
domain.

**Does the widget set cookies or track members?** No. The session lives in
the page's memory and vanishes when the tab closes.
