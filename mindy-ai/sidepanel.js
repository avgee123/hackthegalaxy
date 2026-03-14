/**
 * Mindy AI - Side Panel logic
 * YouTube context, Vision, Jargon Crusher, Action Extractor
 */

const ELEMENTS = {
  apiKeyInput: document.getElementById('apiKeyInput'),
  saveApiKey: document.getElementById('saveApiKey'),
  apiKeyStatus: document.getElementById('apiKeyStatus'),
  youtubeChatInput: document.getElementById('youtubeChatInput'),
  youtubeChatSend: document.getElementById('youtubeChatSend'),
  youtubeStatus: document.getElementById('youtubeStatus'),
  youtubeResult: document.getElementById('youtubeResult'),
  captureVision: document.getElementById('captureVision'),
  visionStatus: document.getElementById('visionStatus'),
  visionResult: document.getElementById('visionResult'),
  visionChatArea: document.getElementById('visionChatArea'),
  visionChatMessages: document.getElementById('visionChatMessages'),
  visionChatInput: document.getElementById('visionChatInput'),
  visionChatSend: document.getElementById('visionChatSend'),
  modelSelect: document.getElementById('modelSelect'),
  mindyThinking: document.getElementById('mindyThinking'),
  mindyThinkingText: document.getElementById('mindyThinkingText'),
  jargonResult: document.getElementById('jargonResult'),
  jargonText: document.getElementById('jargonText'),
  blueprintFileInput: document.getElementById('blueprintFileInput'),
  blueprintUpload: document.getElementById('blueprintUpload'),
  blueprintCapture: document.getElementById('blueprintCapture'),
  blueprintStatus: document.getElementById('blueprintStatus'),
  blueprintResult: document.getElementById('blueprintResult'),
  blueprintSteps: document.getElementById('blueprintSteps'),
  blueprintRefs: document.getElementById('blueprintRefs'),
  blueprintRefsList: document.getElementById('blueprintRefsList'),
};

function showMindyThinking(text) {
  if (ELEMENTS.mindyThinking && ELEMENTS.mindyThinkingText) {
    ELEMENTS.mindyThinkingText.textContent = text;
    ELEMENTS.mindyThinking.classList.remove('hidden');
  }
}

function hideMindyThinking() {
  ELEMENTS.mindyThinking?.classList.add('hidden');
}

// ---------- Loading skeleton (shown while AI is generating) ----------
const SKELETON_HTML = `
<div class="mindy-loading-skeleton" role="status" aria-label="Loading">
  <div class="skeleton-line"></div>
  <div class="skeleton-line short"></div>
  <div class="skeleton-line medium"></div>
</div>`;
const LOADING_SKELETON_SMALL_HTML = `
<div class="mindy-loading-skeleton mindy-loading-skeleton--small" role="status" aria-label="Loading">
  <div class="skeleton-line short"></div>
  <div class="skeleton-line medium"></div>
</div>`;

function showLoadingSkeleton(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = SKELETON_HTML;
}

function appendAssistantLoadingPlaceholder(parentEl) {
  if (!parentEl) return null;
  const div = document.createElement('div');
  div.className = 'text-left text-slate-400 mindy-assistant-loading';
  div.innerHTML = SKELETON_HTML;
  parentEl.appendChild(div);
  parentEl.scrollTop = parentEl.scrollHeight;
  return div;
}

/** Converts AI response to HTML: **bold** and *italic* → formatted, no raw asterisks */
function formatAiResponse(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ---------- API Key & Model (stored in chrome.storage.local only) ----------
async function loadSettings() {
  const { mindyApiKey, mindyModel } = await chrome.storage.local.get(['mindyApiKey', 'mindyModel']);
  if (mindyApiKey) {
    ELEMENTS.apiKeyInput.placeholder = '•••••••• (saved)';
    ELEMENTS.apiKeyInput.value = '';
  }
  if (mindyModel && ELEMENTS.modelSelect) ELEMENTS.modelSelect.value = mindyModel;
}

if (ELEMENTS.modelSelect) {
  ELEMENTS.modelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ mindyModel: ELEMENTS.modelSelect.value });
  });
}

ELEMENTS.saveApiKey.addEventListener('click', async () => {
  const key = ELEMENTS.apiKeyInput.value.trim();
  if (!key) {
    showApiKeyStatus('Enter a key first.', true);
    return;
  }
  await chrome.storage.local.set({ mindyApiKey: key });
  ELEMENTS.apiKeyInput.value = '';
  ELEMENTS.apiKeyInput.placeholder = '•••••••• (saved)';
  showApiKeyStatus('API key saved locally.');
});

function showApiKeyStatus(msg, isError = false) {
  ELEMENTS.apiKeyStatus.textContent = msg;
  ELEMENTS.apiKeyStatus.classList.toggle('text-red-400', isError);
  ELEMENTS.apiKeyStatus.classList.toggle('text-slate-500', !isError);
  ELEMENTS.apiKeyStatus.classList.remove('hidden');
}

// ---------- Helpers: get active tab, send to background ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

// ---------- 1. Smart YouTube Context Chat ----------
function getYouTubeVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.replace('www.', '') !== 'youtube.com' && u.hostname !== 'youtu.be') return null;
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    return u.searchParams.get('v');
  } catch (_) {
    return null;
  }
}

function formatTimestamp(seconds) {
  if (seconds == null || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function appendYouTubeMessage(role, text) {
  const div = document.createElement('div');
  div.className = role === 'user' ? 'mindy-msg mindy-msg--user' : 'mindy-msg mindy-msg--assistant';
  div.innerHTML = role === 'assistant' ? formatAiResponse(text) : (text || '').replace(/\n/g, '<br>');
  ELEMENTS.youtubeResult.appendChild(div);
  ELEMENTS.youtubeResult.scrollTop = ELEMENTS.youtubeResult.scrollHeight;
}

function appendYouTubeLoadingPlaceholder() {
  const wrapper = document.createElement('div');
  wrapper.className = 'mindy-msg mindy-msg--loading';
  wrapper.id = 'youtubeLoadingPlaceholder';
  wrapper.innerHTML = LOADING_SKELETON_SMALL_HTML;
  ELEMENTS.youtubeResult.appendChild(wrapper);
  ELEMENTS.youtubeResult.scrollTop = ELEMENTS.youtubeResult.scrollHeight;
}

function removeYouTubeLoadingPlaceholder() {
  document.getElementById('youtubeLoadingPlaceholder')?.remove();
}

ELEMENTS.youtubeChatSend.addEventListener('click', runYoutubeChat);
ELEMENTS.youtubeChatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runYoutubeChat();
});

async function runYoutubeChat() {
  const question = ELEMENTS.youtubeChatInput?.value?.trim();
  if (!question) return;
  const tab = await getActiveTab();
  if (!tab?.id) {
    ELEMENTS.youtubeStatus.textContent = 'No active tab.';
    return;
  }
  const videoId = getYouTubeVideoId(tab?.url);
  if (!videoId) {
    ELEMENTS.youtubeStatus.textContent = 'Open a YouTube video first.';
    return;
  }
  ELEMENTS.youtubeChatInput.value = '';
  appendYouTubeMessage('user', question);
  showMindyThinking('Getting video info from page...');
  ELEMENTS.youtubeStatus.textContent = 'Getting video info...';

  // Get REAL title and currentTime: try content script first, then background executeScript fallback
  let videoTitle = null;
  let currentTime = null;
  try {
    const youtubeInfo = await chrome.tabs.sendMessage(tab.id, { type: 'get-youtube-info' });
    videoTitle = youtubeInfo?.title || null;
    currentTime = youtubeInfo?.currentTime ?? null;
  } catch (e) {
    console.warn('Mindy: Content script failed, using background fallback', e);
  }
  if (!videoTitle || currentTime == null) {
    try {
      const fallback = await sendToBackground('get-youtube-info-from-tab', { tabId: tab.id });
      if (fallback?.title) videoTitle = fallback.title;
      if (fallback?.currentTime != null) currentTime = fallback.currentTime;
    } catch (e) {
      console.warn('Mindy: Background fallback also failed', e);
    }
  }
  const timestamp = formatTimestamp(currentTime ?? 0);
  console.log('[Mindy] Sent to Gemini - videoTitle:', videoTitle, 'timestamp:', timestamp, 'currentTime:', currentTime);

  showMindyThinking(`Extracting transcript at ${timestamp}...`);
  ELEMENTS.youtubeStatus.textContent = `Extracting transcript at ${timestamp}...`;
  const transcriptRes = await sendToBackground('get-youtube-transcript', {
    tabId: tab.id,
    currentTime: currentTime ?? 0,
  });
  showMindyThinking('Sending to Mindy...');
  ELEMENTS.youtubeStatus.textContent = 'Asking Mindy...';
  appendYouTubeLoadingPlaceholder();
  try {
    const res = await sendToBackground('gemini-youtube-chat', {
      url: tab.url,
      videoTitle: videoTitle || 'Unknown',
      timestamp,
      seconds: currentTime ?? 0,
      question,
      transcript: transcriptRes?.transcript || null,
    });
    hideMindyThinking();
    removeYouTubeLoadingPlaceholder();
    if (res.error) {
      ELEMENTS.youtubeStatus.textContent = res.error;
      appendYouTubeMessage('assistant', `Error: ${res.error}`);
      return;
    }
    appendYouTubeMessage('assistant', res.text);
    ELEMENTS.youtubeStatus.textContent = 'Done.';
  } catch (e) {
    hideMindyThinking();
    removeYouTubeLoadingPlaceholder();
    ELEMENTS.youtubeStatus.textContent = e.message || 'Request failed';
    appendYouTubeMessage('assistant', `Error: ${e.message}`);
  }
}

// ---------- 2. Visual Deep-Dive (Vision + Chat) ----------
let lastVisionImage = null;
let lastVisionAnalysis = null;
let visionChatHistory = [];

function cropImage(dataUrl, topPercent = 0.15, sidePercent = 0.05) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const cropTop = Math.floor(img.height * topPercent);
      const cropLeft = Math.floor(img.width * sidePercent);
      const cropRight = Math.floor(img.width * sidePercent);
      canvas.width = img.width - cropLeft - cropRight;
      canvas.height = img.height - cropTop;
      ctx.drawImage(img, cropLeft, cropTop, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = dataUrl;
  });
}

function appendVisionMessage(role, text) {
  const div = document.createElement('div');
  div.className = role === 'user' ? 'mindy-msg mindy-msg--user' : 'mindy-msg mindy-msg--assistant';
  div.innerHTML = role === 'assistant' ? formatAiResponse(text) : (text || '').replace(/\n/g, '<br>');
  ELEMENTS.visionChatMessages?.appendChild(div);
  ELEMENTS.visionChatMessages.scrollTop = ELEMENTS.visionChatMessages.scrollHeight;
}

function appendVisionLoadingPlaceholder() {
  const div = document.createElement('div');
  div.className = 'mindy-msg mindy-msg--loading';
  div.id = 'visionLoadingPlaceholder';
  div.innerHTML = LOADING_SKELETON_SMALL_HTML;
  ELEMENTS.visionChatMessages?.appendChild(div);
  ELEMENTS.visionChatMessages.scrollTop = ELEMENTS.visionChatMessages.scrollHeight;
}

function removeVisionLoadingPlaceholder() {
  document.getElementById('visionLoadingPlaceholder')?.remove();
}

ELEMENTS.captureVision.addEventListener('click', async () => {
  ELEMENTS.visionResult.classList.add('hidden');
  ELEMENTS.visionChatArea?.classList.add('hidden');
  visionChatHistory = [];
  lastVisionImage = null;
  lastVisionAnalysis = null;
  showMindyThinking('Capturing tab...');
  ELEMENTS.visionStatus.textContent = 'Capturing tab...';
  const tab = await getActiveTab();
  if (!tab?.id) {
    hideMindyThinking();
    ELEMENTS.visionStatus.textContent = 'No active tab.';
    return;
  }
  try {
    const res = await sendToBackground('capture-tab');
    const dataUrl = res?.dataUrl;
    if (!dataUrl) {
      hideMindyThinking();
      ELEMENTS.visionStatus.textContent = res?.error || 'Could not capture screenshot.';
      return;
    }
    showMindyThinking('Cropping browser UI (top 15%, margins)...');
    ELEMENTS.visionStatus.textContent = 'Cropping browser UI...';
    let croppedUrl;
    try {
      croppedUrl = await cropImage(dataUrl, 0.15, 0.05);
    } catch {
      croppedUrl = dataUrl;
    }
    lastVisionImage = croppedUrl;
    showMindyThinking('Analyzing center content...');
    ELEMENTS.visionStatus.textContent = 'Analyzing main content...';
    showLoadingSkeleton(ELEMENTS.visionResult);
    const analysisRes = await sendToBackground('gemini-vision', { imageDataUrl: croppedUrl });
    hideMindyThinking();
    if (analysisRes.error) {
      ELEMENTS.visionStatus.textContent = analysisRes.error;
      return;
    }
    lastVisionAnalysis = analysisRes.text;
    ELEMENTS.visionResult.innerHTML = `<div class="mindy-ai-response">${formatAiResponse(analysisRes.text || '')}</div>`;
    ELEMENTS.visionResult.classList.remove('hidden');
    ELEMENTS.visionChatArea?.classList.remove('hidden');
    ELEMENTS.visionChatMessages.innerHTML = '';
    visionChatHistory = [{ role: 'model', parts: [{ text: analysisRes.text }] }];
    ELEMENTS.visionStatus.textContent = 'Done. Ask follow-up questions below.';
  } catch (e) {
    hideMindyThinking();
    ELEMENTS.visionStatus.textContent = e.message || 'Request failed';
  }
});

ELEMENTS.visionChatSend?.addEventListener('click', runVisionChat);
ELEMENTS.visionChatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runVisionChat();
});

async function runVisionChat() {
  const question = ELEMENTS.visionChatInput?.value?.trim();
  if (!question || !lastVisionImage) return;
  ELEMENTS.visionChatInput.value = '';
  appendVisionMessage('user', question);
  visionChatHistory.push({ role: 'user', parts: [{ text: question }] });
  const loadingEl = appendAssistantLoadingPlaceholder(ELEMENTS.visionChatMessages);
  showMindyThinking('Answering based on image...');
  ELEMENTS.visionStatus.textContent = 'Thinking...';
  try {
    const res = await sendToBackground('gemini-vision-chat', {
      imageDataUrl: lastVisionImage,
      history: visionChatHistory,
      question,
    });
    hideMindyThinking();
    loadingEl?.remove();
    if (res.error) {
      ELEMENTS.visionStatus.textContent = res.error;
      appendVisionMessage('assistant', `Error: ${res.error}`);
      return;
    }
    visionChatHistory.push({ role: 'model', parts: [{ text: res.text }] });
    appendVisionMessage('assistant', res.text);
    ELEMENTS.visionStatus.textContent = 'Done.';
  } catch (e) {
    hideMindyThinking();
    loadingEl?.remove();
    ELEMENTS.visionStatus.textContent = e.message || 'Request failed';
    appendVisionMessage('assistant', `Error: ${e.message}`);
  }
}

// ---------- 3. Jargon Crusher (display result from context menu) ----------
function updateJargonUI(status, result) {
  if (!ELEMENTS.jargonResult || !ELEMENTS.jargonText) return;
  if (status === 'thinking') {
    showMindyThinking('Simplifying with Jargon Crusher...');
    ELEMENTS.jargonResult.classList.remove('hidden');
    ELEMENTS.jargonText.innerHTML = LOADING_SKELETON_SMALL_HTML;
    ELEMENTS.jargonText.classList.remove('italic', 'text-slate-400');
  } else if (result) {
    hideMindyThinking();
    ELEMENTS.jargonResult.classList.remove('hidden');
    ELEMENTS.jargonText.innerHTML = formatAiResponse(result);
    ELEMENTS.jargonText.classList.toggle('text-red-400', result.startsWith('Error:'));
    ELEMENTS.jargonText.classList.toggle('text-slate-300', !result.startsWith('Error:'));
    ELEMENTS.jargonText.classList.remove('italic', 'text-slate-400');
  }
}

let jargonInProgress = false;
async function runJargonCrusher(text) {
  if (!text?.trim() || jargonInProgress) return;
  console.log('[Mindy Jargon] Starting runJargonCrusher, text length:', text?.trim().length);
  jargonInProgress = true;
  chrome.storage.local.remove(['mindyJargonPending']);
  updateJargonUI('thinking');
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Try again.')), 25000)
    );
    const res = await Promise.race([
      sendToBackground('gemini-jargon', { text: text.trim() }),
      timeout,
    ]);
    if (res?.error) {
      updateJargonUI('done', `Error: ${res.error}`);
    } else {
      updateJargonUI('done', res?.text || '');
    }
  } catch (e) {
    updateJargonUI('done', `Error: ${e.message}`);
  } finally {
    jargonInProgress = false;
  }
  chrome.storage.local.remove(['mindyJargonPending', 'mindyJargonStatus']);
}

async function checkJargonResult() {
  const { mindyJargonStatus, mindyJargonResult, mindyJargonPending } = await chrome.storage.local.get(['mindyJargonStatus', 'mindyJargonResult', 'mindyJargonPending']);
  if (mindyJargonPending && mindyJargonStatus === 'thinking') {
    runJargonCrusher(mindyJargonPending);
  } else if (mindyJargonResult) {
    updateJargonUI('done', mindyJargonResult);
    chrome.storage.local.remove(['mindyJargonResult', 'mindyJargonStatus', 'mindyJargonPending']);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.mindyJargonPending?.newValue && changes.mindyJargonStatus?.newValue === 'thinking') {
    runJargonCrusher(changes.mindyJargonPending.newValue);
  }
  if (changes.mindyJargonResult) {
    const result = changes.mindyJargonResult.newValue;
    if (result) {
      updateJargonUI('done', result);
      chrome.storage.local.remove(['mindyJargonResult', 'mindyJargonStatus', 'mindyJargonPending']);
    }
  }
});

// ---------- Format AI response: convert markdown so * and ** don't show as raw characters ----------
function formatAiResponse(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ---------- 4. Blueprint Vision (image → detailed guide) ----------
function simpleMarkdownToHtml(md) {
  if (!md || typeof md !== 'string') return '';
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="text-cyan-400 text-sm mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-cyan-400 font-semibold mt-4 mb-2">$1</h2>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-cyan-400 hover:underline">$1</a>')
    .replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/\n/g, '<br>');
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function parseBlueprintOutput(text) {
  const refsMatch = text.match(/##\s*Expert References\s*([\s\S]*?)(?=##|$)/i);
  const refsSection = refsMatch ? refsMatch[1].trim() : '';
  const stepsSection = text.replace(/##\s*Expert References\s*[\s\S]*/i, '').trim();
  const refLinks = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = linkRegex.exec(refsSection + text)) !== null) {
    if (m[2].includes('youtube.com/results') || m[2].includes('google.com/search')) {
      refLinks.push({ text: m[1], url: m[2] });
    }
  }
  if (refLinks.length === 0) {
    const altRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    while ((m = altRegex.exec(text)) !== null) refLinks.push({ text: m[1], url: m[2] });
  }
  return { steps: stepsSection, refLinks };
}

async function runBlueprintVision(imageDataUrl) {
  if (!imageDataUrl) return;
  const btnUpload = ELEMENTS.blueprintUpload;
  const btnCapture = ELEMENTS.blueprintCapture;
  if (btnUpload) btnUpload.disabled = true;
  if (btnCapture) btnCapture.disabled = true;
  showMindyThinking('Analyzing image...');
  if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = 'Analyzing...';
  showLoadingSkeleton(ELEMENTS.blueprintSteps);
  if (ELEMENTS.blueprintRefsList) ELEMENTS.blueprintRefsList.innerHTML = '';
  ELEMENTS.blueprintResult?.classList.remove('hidden');
  try {
    const res = await sendToBackground('gemini-blueprint-vision', { imageDataUrl });
    hideMindyThinking();
    if (btnUpload) btnUpload.disabled = false;
    if (btnCapture) btnCapture.disabled = false;
    if (res.error) {
      if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = res.error;
      if (ELEMENTS.blueprintSteps) ELEMENTS.blueprintSteps.innerHTML = `<p class="text-red-400 text-sm">${escapeHtml(res.error)}</p>`;
      return;
    }
    const { steps, refLinks } = parseBlueprintOutput(res.text || '');
    if (ELEMENTS.blueprintSteps) {
      ELEMENTS.blueprintSteps.innerHTML = simpleMarkdownToHtml(steps);
    }
    if (ELEMENTS.blueprintRefsList) {
      ELEMENTS.blueprintRefsList.innerHTML = refLinks.slice(0, 5).map((r) =>
        `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="block text-cyan-400 hover:underline text-sm">${escapeHtml(r.text)}</a>`
      ).join('');
    }
    ELEMENTS.blueprintResult?.classList.remove('hidden');
    if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = 'Done.';
  } catch (e) {
    hideMindyThinking();
    if (btnUpload) btnUpload.disabled = false;
    if (btnCapture) btnCapture.disabled = false;
    if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = e.message || 'Request failed';
  }
}

ELEMENTS.blueprintUpload?.addEventListener('click', () => ELEMENTS.blueprintFileInput?.click());
ELEMENTS.blueprintFileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  const r = new FileReader();
  r.onload = () => runBlueprintVision(r.result);
  r.readAsDataURL(file);
});
ELEMENTS.blueprintCapture?.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = 'No active tab.';
    return;
  }
  const res = await sendToBackground('capture-tab');
  if (res?.dataUrl) runBlueprintVision(res.dataUrl);
  else if (ELEMENTS.blueprintStatus) ELEMENTS.blueprintStatus.textContent = res?.error || 'Capture failed';
});

ELEMENTS.createGuideCard_REMOVED?.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'No active tab.';
    return;
  }
  const btn = ELEMENTS.createGuideCard;
  btn.disabled = true;
  ELEMENTS.guideCardResult?.classList.add('hidden');
  ELEMENTS.saveGuide?.classList.add('hidden');
  showMindyThinking('Getting selection...');
  if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Getting selection...';

  let selectedText = '';
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'get-selected-text' });
    selectedText = res?.text || '';
  } catch (e) {
    hideMindyThinking();
    btn.disabled = false;
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Reload the page and try again.';
    return;
  }

  if (!selectedText?.trim()) {
    hideMindyThinking();
    btn.disabled = false;
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Highlight text first, then click.';
    return;
  }

  if (selectedText.trim().length < 50) {
    hideMindyThinking();
    btn.disabled = false;
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Highlight at least 50 characters.';
    return;
  }

  showMindyThinking('Creating checklist...');
  if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Creating checklist...';
  try {
    const res = await sendToBackground('gemini-guide-card', { text: selectedText.trim() });
    hideMindyThinking();
    btn.disabled = false;
    if (res.error) {
      if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = res.error;
      return;
    }
    lastGuideCardData = { imageDataUrl: res.imageDataUrl || null, checklist: res.checklist || '' };
    if (ELEMENTS.guideCardHero) {
      ELEMENTS.guideCardHero.innerHTML = '';
      if (res.imageDataUrl) {
        const img = document.createElement('img');
        img.src = res.imageDataUrl;
        img.alt = 'Guide cover';
        img.className = 'w-full h-full object-cover';
        ELEMENTS.guideCardHero.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'text-slate-500 text-sm p-3 text-center';
        placeholder.textContent = res.imageError || 'No cover image (quota or error)';
        placeholder.title = res.imageError || '';
        ELEMENTS.guideCardHero.appendChild(placeholder);
      }
    }
    if (ELEMENTS.guideCardChecklist) {
      ELEMENTS.guideCardChecklist.innerHTML = renderChecklistAsHTML(res.checklist || '');
    }
    ELEMENTS.guideCardResult?.classList.remove('hidden');
    ELEMENTS.saveGuide?.classList.remove('hidden');
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Done.';
  } catch (e) {
    hideMindyThinking();
    btn.disabled = false;
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = e.message || 'Request failed';
  }
});

ELEMENTS.saveGuide?.addEventListener('click', () => {
  const { imageDataUrl, checklist } = lastGuideCardData;
  if (!checklist && !imageDataUrl) return;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Mindy Guide</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:24px;max-width:480px;margin:0 auto;}
img{width:100%;border-radius:8px;margin-bottom:16px;}
ul{list-style:none;padding:0;}
li{margin:8px 0;padding:8px;background:#1e293b;border-radius:6px;}
li:has(input:checked){opacity:.6;text-decoration:line-through;}
input{margin-right:8px;}</style></head><body>
${imageDataUrl ? `<img src="${imageDataUrl}" alt="Cover"/>` : ''}
<ul>${(checklist || '').split('\n').filter(l => l.trim()).map(l => {
  const m = l.match(/^[-*]\s*\[([ x])\]\s*(.+)/i);
  if (m) return `<li><input type="checkbox" ${m[1].toLowerCase() === 'x' ? 'checked' : ''} disabled/>${escapeHtml(m[2].trim())}</li>`;
  return `<li>${escapeHtml(l.trim())}</li>`;
}).join('')}</ul>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mindy-guide-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Guide Card from context menu: run when panel opens with pending text ----------
async function runGuideCardFromPending(text) {
  if (!text?.trim() || text.trim().length < 50) return;
  chrome.storage.local.remove(['mindyGuideCardPending', 'mindyGuideCardStatus']);
  const btn = ELEMENTS.createGuideCard;
  if (btn) btn.disabled = true;
  ELEMENTS.guideCardResult?.classList.add('hidden');
  ELEMENTS.saveGuide?.classList.add('hidden');
  showMindyThinking('Creating checklist...');
  if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Creating checklist...';
  try {
    const res = await sendToBackground('gemini-guide-card', { text: text.trim() });
    hideMindyThinking();
    if (btn) btn.disabled = false;
    if (res.error) {
      if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = res.error;
      return;
    }
    lastGuideCardData = { imageDataUrl: res.imageDataUrl || null, checklist: res.checklist || '' };
    if (ELEMENTS.guideCardHero) {
      ELEMENTS.guideCardHero.innerHTML = '';
      if (res.imageDataUrl) {
        const img = document.createElement('img');
        img.src = res.imageDataUrl;
        img.alt = 'Guide cover';
        img.className = 'w-full h-full object-cover';
        ELEMENTS.guideCardHero.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'text-slate-500 text-sm';
        placeholder.textContent = res.imageError || 'No cover image (quota or error)';
        ELEMENTS.guideCardHero.appendChild(placeholder);
      }
    }
    if (ELEMENTS.guideCardChecklist) {
      ELEMENTS.guideCardChecklist.innerHTML = renderChecklistAsHTML(res.checklist || '');
    }
    ELEMENTS.guideCardResult?.classList.remove('hidden');
    ELEMENTS.saveGuide?.classList.remove('hidden');
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = 'Done.';
  } catch (e) {
    hideMindyThinking();
    if (btn) btn.disabled = false;
    if (ELEMENTS.guideCardStatus) ELEMENTS.guideCardStatus.textContent = e.message || 'Request failed';
  }
}

async function checkGuideCardPending() {
  const { mindyGuideCardPending } = await chrome.storage.local.get(['mindyGuideCardPending']);
  if (mindyGuideCardPending) runGuideCardFromPending(mindyGuideCardPending);
}

// ---------- Init & visibility: re-check jargon when panel becomes visible ----------
loadSettings();
checkJargonResult();
checkGuideCardPending();
// Delayed re-checks: panel may load before storage write completes (race condition)
setTimeout(checkJargonResult, 100);
setTimeout(checkJargonResult, 500);
setTimeout(checkGuideCardPending, 100);
setTimeout(checkJargonResult, 1500);
setTimeout(checkJargonResult, 3000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkJargonResult();
    checkGuideCardPending();
  }
});
