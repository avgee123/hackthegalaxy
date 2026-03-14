# Mindy AI – Chrome Extension (Manifest V3)

AI assistant with **YouTube key timestamps**, **vision** (explain screenshots), and **Jargon Crusher**.

## Architecture

| Part | Role |
|------|------|
| **Background service worker** (`background.js`) | Talks to Google Gemini API; captures visible tab as image. |
| **Side panel** (`sidepanel.html` + `sidepanel.js`) | UI: API key, voice, YouTube, vision. Uses Web Speech API (STT + TTS). |
| **Content script** (`content.js` + `content.css`) | Page text extraction, YouTube info, seek. |

## Where to Put Your Gemini API Key (Safe Practice)

**Do not hardcode the API key in the extension code.**

1. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open the Mindy AI side panel (click the extension icon).
3. Enter the key in the **“Gemini API Key”** field and click **“Save key”**.

The key is stored only in **Chrome’s local storage** for your profile (`chrome.storage.local`). It never appears in the extension’s source files and is not sent anywhere except to `generativelanguage.googleapis.com` when you use Mindy.

- Optional: use a **restricted** API key in Google Cloud Console so the key only works for the Generative Language API and from your browser / IP if needed.

### If you see "429 – Quota exceeded"

The extension will show a short message and suggest:

1. **Switch model** – In the side panel, use the **Model** dropdown and try **Gemini 1.5 Flash** or **Gemini 1.5 Pro**. Each model has its own free-tier quota.
2. **New API key / new project** – Create a new key at [Google AI Studio](https://aistudio.google.com/apikey). A new project gets fresh free-tier quota.
3. **Wait for reset** – Daily limits reset at **midnight Pacific Time**.
4. **Enable billing** – In Google Cloud Console, enable billing for higher limits ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)).

## Install (Developer)

1. Open `chrome://extensions/`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `mindy-ai` folder.

## Features

1. **Call Mindy (Voice)** – Hold the mic button, speak; transcript is sent to Gemini and the reply is read aloud via the Synthesis API.
2. **YouTube key timestamps** – On a YouTube video tab, click “Get 3 key timestamps”; Gemini suggests 3 timestamps with short summaries. Click a timestamp to seek (if the page has the video element).
3. **Explain this page (screenshot)** – Captures the visible tab and sends the image to Gemini 2.0 Flash to explain diagrams or photos.

## Files

- `manifest.json` – Permissions: `sidePanel`, `activeTab`, `storage`, `scripting`; `host_permissions` for Gemini and `<all_urls>`.
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css` – Side panel UI (Tailwind via CDN).
- `background.js` – Gemini text/vision and tab capture.
- `content.js` / `content.css` – Page text helper, YouTube seek.

## Permissions

- **sidePanel** – Side panel UI.
- **activeTab** – Capture visible tab and access current tab URL.
- **storage** – Store API key in `chrome.storage.local`.
- **scripting** – (Reserved for any future injection.)
- **host_permissions** – `https://generativelanguage.googleapis.com/*`, `<all_urls>` for content script and capture.
