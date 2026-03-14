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
  if (options.useGoogleSearch) {
    body.tools = [{ google_search: {} }];
  }
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

const VISION_SYSTEM_PROMPT = `Visual analyst. IGNORE browser UI, ads, headers. Focus on center content only.
Be concise: 2–3 short paragraphs max. For search results: extract the answer and logic—don't restate. Never describe the address bar. Keep response under 200 words.`;

async function callGeminiVision(apiKey, imageDataUrl, prompt, model, options = {}) {
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
      maxOutputTokens: options.maxOutputTokens ?? 1024,
      temperature: options.temperature ?? 0.4,
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

const IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

async function callGeminiImageGeneration(apiKey, prompt) {
  const url = `${GEMINI_BASE}/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {},
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resText = await res.text();
  if (!res.ok) {
    const friendly = parseGeminiError(resText, res.status);
    throw new Error(friendly || resText || `Gemini image API error: ${res.status}`);
  }
  const data = JSON.parse(resText);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }
  throw new Error('No image in Gemini response');
}

async function callGeminiVisionChat(apiKey, imageDataUrl, history, question, model) {
  const m = model || 'gemini-2.0-flash';
  const url = `${GEMINI_BASE}/models/${m}:generateContent?key=${apiKey}`;
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

  const visionChatPrompt = `Analyze this image. Answer follow-up questions.

RULES:
1. If the answer IS in the image: answer directly from what you see.
2. If the answer is NOT in the image: use Google Search to find relevant sources. Start your response with "While not explicitly shown in the image, ..." then give the answer from your research.
3. Always be clear when you're going beyond the image vs. reading from it.`;

  const contents = [{
    role: 'user',
    parts: [
      { text: visionChatPrompt },
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
    tools: [{ google_search: {} }],
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
  const text = info.selectionText?.trim();
  if (!text) return;
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  if (info.menuItemId === 'jargon-crusher') {
    await chrome.storage.local.set({
      mindyJargonPending: text,
      mindyJargonStatus: 'thinking',
    });
  }
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
          const text = await callGeminiVision(apiKey, msg.imageDataUrl, msg.prompt, model, { maxOutputTokens: 512 });
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
          const prompt = `You are a clarity expert. The user selected this text: "${msg.text}"

TASK: Explain what it means in plain language—1 or 2 short sentences. Use Google Search to find the REAL, current definition for:
- Slang, jargon, memes, internet terms
- Technical terms (coding, medicine, law, etc.)
- Acronyms and abbreviations
- Domain-specific vocabulary

Base your answer on authoritative sources and common usage. Do NOT invent definitions. If you cannot find it, say "I couldn't find a reliable definition for this."
Output ONLY the explanation, nothing else.`;
          const text = await callGeminiText(apiKey, prompt, { model, maxTokens: 512, useGoogleSearch: true });
          return { text };
        } catch (e) {
          return { error: e.message || 'Jargon Crusher failed' };
        }
      }

      case 'gemini-blueprint-vision': {
        const blueprintPrompt = `Act as a Master Specialist. Analyze this image carefully.

- If it shows a PROBLEM (broken thing, malfunction): give a detailed REPAIR GUIDE.
- If it shows a RECIPE or food: give detailed COOKING STEPS with exact temps, times, measurements.
- If it shows a PROJECT (craft, DIY, diagram): give a detailed WORKFLOW.

CRITICAL: Be EXTREMELY DETAILED. Never say "Bake it"—say "Bake at 425°F for 15 minutes, then reduce to 350°F for 45 minutes." Include specific numbers, temperatures, times, quantities, tool names.

IMPORTANT: You MUST include ALL three sections below. Do NOT truncate or stop after Diagnosis. The Step-by-Step Checklist is REQUIRED—provide at least 5-10 detailed bullet points. Always include Expert References.

Format your response in Markdown with these exact sections:

## Diagnosis/Summary
(Brief: What is in the image)

## Step-by-Step Checklist
(Detailed actionable items with bullet points. Be specific! At least 5-10 steps.)

## Expert References
Provide 3-5 clickable links. ONLY use YouTube search URLs—never direct video URLs. Format each as: [Descriptive text](https://www.youtube.com/results?search_query=encoded+search+terms). Example: [Watch: how to crimp pie crust](https://www.youtube.com/results?search_query=how+to+crimp+pie+crust+expert+tips)`;
        try {
          const text = await callGeminiVision(apiKey, msg.imageDataUrl, blueprintPrompt, model, { maxOutputTokens: 8192 });
          return { text };
        } catch (e) {
          return { error: e.message || 'Blueprint Vision failed' };
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
