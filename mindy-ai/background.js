/**
 * Mindy AI - Background Service Worker
 * Handles Gemini API calls and tab capture. API key is read from chrome.storage only.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function getSettings() {
  const { mindyApiKey, mindyModel } = await chrome.storage.local.get(['mindyApiKey', 'mindyModel']);
  return {
    apiKey: mindyApiKey || null,
    model: mindyModel || 'gemini-2.5-flash',
  };
}

function parseGeminiError(resBody, status) {
  if (status !== 429) return null;
  try {
    const data = typeof resBody === 'string' ? JSON.parse(resBody) : resBody;
    const msg = data?.error?.message || '';
    const retrySec = data?.details?.find((d) => d['@type']?.includes('RetryInfo'))?.retryDelay?.replace('s', '') || '60';
    return (
      'Quota exceeded (429). Try: 1) Switch model in the side panel (e.g. Gemini 1.5 Flash). ' +
      '2) Use a new API key from a new Google AI Studio project. 3) Wait for daily reset (Pacific midnight). ' +
      `4) Enable billing for higher limits. Retry after ~${retrySec}s.`
    );
  } catch (_) {
    return 'Rate limit (429). Try another model or wait a minute.';
  }
}

async function callGeminiText(apiKey, prompt, options = {}) {
  const model = options.model || 'gemini-2.0-flash';
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resText = await res.text();
  if (!res.ok) {
    const friendly = parseGeminiError(resText, res.status);
    throw new Error(friendly || resText || `Gemini API error: ${res.status}`);
  }
  const data = JSON.parse(resText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('No text in Gemini response');
  return text;
}

const VISION_SYSTEM_PROMPT = `You are an expert visual analyst. IGNORE all browser UI, address bars, tabs, headers, and ads. Look ONLY at the center main content. If this is a search result page, find the specific technical answer in the snippet and explain the logic behind it—not just what the text says. Analyze relationships between concepts mentioned. Do NOT describe "Google Search Interface" or the top bar. Focus on the core value and what matters to the user.`;

async function callGeminiVision(apiKey, imageDataUrl, prompt, model) {
  const m = model || 'gemini-2.0-flash';
  const url = `${GEMINI_BASE}/models/${m}:generateContent?key=${apiKey}`;
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const userPrompt = prompt || `${VISION_SYSTEM_PROMPT}\n\nAnalyze this screenshot and explain the main content.`;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: userPrompt },
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.4,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resText = await res.text();
  if (!res.ok) {
    const friendly = parseGeminiError(resText, res.status);
    throw new Error(friendly || resText || `Gemini API error: ${res.status}`);
  }
  const data = JSON.parse(resText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('No text in Gemini response');
  return text;
}

async function callGeminiVisionChat(apiKey, imageDataUrl, history, question, model) {
  const m = model || 'gemini-2.0-flash';
  const url = `${GEMINI_BASE}/models/${m}:generateContent?key=${apiKey}`;
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

  const contents = [{
    role: 'user',
    parts: [
      { text: `${VISION_SYSTEM_PROMPT}\n\nAnalyze this screenshot. Answer the user's follow-up questions based on the image.` },
      { inlineData: { mimeType, data: base64Data } },
    ],
  }];
  for (const h of history) {
    if (h.role === 'model') {
      contents.push({ role: 'model', parts: [{ text: h.parts?.[0]?.text || '' }] });
    } else if (h.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: h.parts?.[0]?.text || '' }] });
    }
  }

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resText = await res.text();
  if (!res.ok) {
    const friendly = parseGeminiError(resText, res.status);
    throw new Error(friendly || resText || `Gemini API error: ${res.status}`);
  }
  const data = JSON.parse(resText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('No text in Gemini response');
  return text;
}

// ---------- Jargon Crusher context menu ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'jargon-crusher',
    title: 'Simplify with Jargon Crusher',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'jargon-crusher' || !info.selectionText?.trim()) return;
  const text = info.selectionText.trim();
  // Store text for side panel to process - side panel makes the API call
  // (service worker can be killed mid-request, causing "Simplifying..." to hang)
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.storage.local.set({
    mindyJargonPending: text,
    mindyJargonStatus: 'thinking',
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    if (msg.type === 'get-youtube-video-time') {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: msg.tabId },
          func: () => {
            const video = document.querySelector('video');
            return video ? video.currentTime : null;
          },
        });
        return { currentTime: result?.result ?? null };
      } catch {
        return { currentTime: null };
      }
    }
    if (msg.type === 'get-youtube-info-from-tab') {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: msg.tabId },
          func: () => {
            const sel = (s) => document.querySelector(s);
            const titleEl = sel('h1.style-scope.ytd-watch-metadata') ||
              sel('h1.ytd-video-primary-info-renderer') ||
              sel('h1.title') ||
              sel('#title h1') ||
              sel('ytd-watch-metadata h1') ||
              sel('ytd-video-primary-info-renderer h1') ||
              sel('#title yt-formatted-string');
            let title = titleEl?.innerText?.trim() || null;
            if (!title) {
              const og = sel('meta[property="og:title"]');
              title = og?.getAttribute('content')?.trim() || null;
            }
            const video = sel('video');
            return { title, currentTime: video ? video.currentTime : null };
          },
        });
        return result?.result ?? { title: null, currentTime: null };
      } catch {
        return { title: null, currentTime: null };
      }
    }
    if (msg.type === 'get-youtube-transcript') {
      try {
        const tabId = msg.tabId;
        const [urlResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const html = document.documentElement.innerHTML;
            const idx = html.indexOf('captionTracks');
            if (idx === -1) return null;
            const sub = html.substring(idx, idx + 5000);
            const m = sub.match(/"baseUrl"\s*:\s*"([^"]+)"/);
            return m ? m[1].replace(/\\u0026/g, '&') : null;
          },
        });
        const baseUrl = urlResult?.result;
        if (!baseUrl) return { transcript: null };
        const url = baseUrl.includes('&') ? baseUrl + '&fmt=json3' : baseUrl + '?fmt=json3';
        const res = await fetch(url);
        const data = await res.json();
        const events = data?.events || [];
        const segments = events
          .filter((e) => e.segs?.length)
          .map((e) => ({
            start: (e.tStartMs || 0) / 1000,
            dur: (e.dDurationMs || 0) / 1000,
            text: (e.segs || []).map((s) => s.utf8 || '').join('').trim(),
          }))
          .filter((s) => s.text && s.text !== '\n');
        const fullTranscript = msg.fullTranscript;
        let result;
        if (fullTranscript) {
          result = segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
        } else {
          const fromSec = Math.max(0, (msg.currentTime || 0) - 30);
          const toSec = (msg.currentTime || 0) + 30;
          result = segments
            .filter((s) => s.start >= fromSec && s.start <= toSec)
            .map((s) => `[${s.start.toFixed(1)}s] ${s.text}`)
            .join('\n');
        }
        return { transcript: result || null };
      } catch (e) {
        return { transcript: null };
      }
    }
    if (msg.type === 'get-youtube-action-context') {
      try {
        const tabId = msg.tabId;
        const [pageResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const sel = (s) => document.querySelector(s);
            const titleEl = sel('h1.style-scope.ytd-watch-metadata') || sel('h1.ytd-video-primary-info-renderer') ||
              sel('h1.title') || sel('#title h1') || sel('#title yt-formatted-string');
            const title = titleEl?.innerText?.trim() || sel('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
            const descEl = sel('#description-inline-expander') || sel('#description') || sel('ytd-text-inline-expander');
            const description = descEl?.innerText?.trim() || '';
            const html = document.documentElement.innerHTML;
            const idx = html.indexOf('captionTracks');
            if (idx === -1) return { title, description, transcriptUrl: null };
            const sub = html.substring(idx, idx + 5000);
            const m = sub.match(/"baseUrl"\s*:\s*"([^"]+)"/);
            const transcriptUrl = m ? m[1].replace(/\\u0026/g, '&') : null;
            return { title, description, transcriptUrl };
          },
        });
        const { title, description, transcriptUrl } = pageResult?.result || {};
        let transcript = null;
        if (transcriptUrl) {
          const url = transcriptUrl.includes('&') ? transcriptUrl + '&fmt=json3' : transcriptUrl + '?fmt=json3';
          const res = await fetch(url);
          const data = await res.json();
          const events = data?.events || [];
          const segments = events
            .filter((e) => e.segs?.length)
            .map((e) => ({
              start: (e.tStartMs || 0) / 1000,
              text: (e.segs || []).map((s) => s.utf8 || '').join('').trim(),
            }))
            .filter((s) => s.text && s.text !== '\n');
          transcript = segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
        }
        return { title: title || 'Unknown', description: description || '', transcript };
      } catch (e) {
        return { title: 'Unknown', description: '', transcript: null };
      }
    }

    const { apiKey, model } = await getSettings();
    if (!apiKey) return { error: 'Set your Gemini API key in the side panel first.' };

    switch (msg.type) {
      case 'gemini-chat': {
        try {
          const text = await callGeminiText(apiKey, msg.prompt, { model, maxTokens: msg.forVoice ? 256 : 1024 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Gemini request failed' };
        }
      }

      case 'gemini-youtube': {
        const videoId = msg.videoId;
        const prompt = `You are helping a user who is watching the YouTube video with ID: ${videoId}. Based on typical video structure and common patterns, suggest exactly 3 key timestamps (format MM:SS or H:MM:SS) with short one-line summaries for each. Format your response as:
0:00 - Summary here
1:30 - Summary here
3:45 - Summary here
Only output the 3 timestamp lines, no extra explanation.`;
        try {
          const text = await callGeminiText(apiKey, prompt, { model, maxTokens: 256 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Gemini request failed' };
        }
      }

      case 'gemini-vision': {
        try {
          const text = await callGeminiVision(apiKey, msg.imageDataUrl, msg.prompt, model);
          return { text };
        } catch (e) {
          return { error: e.message || 'Gemini vision request failed' };
        }
      }

      case 'gemini-vision-chat': {
        try {
          const text = await callGeminiVisionChat(apiKey, msg.imageDataUrl, msg.history, msg.question, model);
          return { text };
        } catch (e) {
          return { error: e.message || 'Gemini vision chat failed' };
        }
      }

      case 'gemini-youtube-chat': {
        const { videoTitle, timestamp, seconds, question, transcript } = msg;
        const title = videoTitle || 'Unknown video';
        let prompt;
        if (transcript && transcript.trim()) {
          prompt = `The user is watching a video titled "${title}" at ${timestamp} (${seconds} seconds). The user asks: "${question}"

The TRANSCRIPT at this moment says:
---
${transcript.trim()}
---

Answer the question based ONLY on this video context. Use the transcript and the video title. Do NOT guess other topics. Do not assume a different video.`;
        } else {
          prompt = `The user is watching a video titled "${title}" at ${timestamp} (${seconds} seconds). The user asks: "${question}"

Answer the question based ONLY on this video context. Do NOT guess other topics. Do not assume a different video or topic.`;
        }
        try {
          const text = await callGeminiText(apiKey, prompt, { model, maxTokens: 512 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Gemini request failed' };
        }
      }

      case 'gemini-jargon': {
        try {
          const prompt = `Simplify this complex text into a 1-sentence analogy that a child can understand. Output only the analogy, nothing else:\n\n${msg.text}`;
          const text = await callGeminiText(apiKey, prompt, { model, maxTokens: 256 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Jargon Crusher failed' };
        }
      }

      case 'gemini-action-extractor': {
        try {
          const fallbackNote = msg.hasTranscript
            ? ''
            : ' (Transcript missing. Use the title and description to infer steps from the video topic.)';
          const prompt = `You are an expert project manager. Extract actionable tasks/steps that a user would actually DO—from a video tutorial, article, or document. The raw content below may contain UI noise (menus, toolbars, "File Edit View", document titles). FILTER THAT OUT. Extract ONLY from the substantive body.

BAD (never output): "Locate the transcript", "Provide the URL", "Rename the document", "Review File/Edit/View menus", "Utilize editing tools"—these are meta/UI, not real tasks.
GOOD: actual steps from the content—e.g. "Add flour to bowl", "Press the button", "Wait 5 minutes".

Rules: Format each item as "- [ ]". Chronological order for tutorials.${msg.isYouTube ? ' Input is YouTube transcript.' : ''}${fallbackNote} If no clear actions, suggest 3 concrete next steps. Output ONLY the checklist.\n\n${msg.text}`;
          const text = await callGeminiText(apiKey, prompt, { model, maxTokens: 1024 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Action Extractor failed' };
        }
      }

      case 'capture-tab': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return { error: 'No active tab' };
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          return { dataUrl };
        } catch (e) {
          return { error: e.message || 'Capture failed' };
        }
      }

      default:
        return { error: 'Unknown message type' };
    }
  };
  handle().then(sendResponse).catch((e) => sendResponse({ error: e.message }));
  return true; // keep channel open for async sendResponse
});

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
