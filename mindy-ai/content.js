/**
 * Mindy AI - Content Script
 * Page text extraction, YouTube info.
 */

(function () {
  // ---------- Page text extraction (for optional context) ----------
  function getPageText() {
    const clone = document.body.cloneNode(true);
    const removeSelectors = [
      'script', 'style', 'nav', 'footer', 'iframe', 'header',
      '[role="navigation"]', '[role="banner"]', '[role="menubar"]', '[role="toolbar"]',
      '.toolbar', '.menu-bar', '[class*="menubar"]', '[class*="toolbar"]',
    ];
    removeSelectors.forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      } catch (_) {}
    });
    return clone.innerText?.replace(/\s+/g, ' ').trim().slice(0, 15000) || '';
  }

  // Expose for background/sidepanel if needed later
  window.__mindyPageText = getPageText;

  function getYouTubeInfo() {
    const getTitle = () => {
      const h1 = document.querySelector('h1.style-scope.ytd-watch-metadata') ||
        document.querySelector('h1.ytd-video-primary-info-renderer') ||
        document.querySelector('h1.title') ||
        document.querySelector('#title h1') ||
        document.querySelector('ytd-watch-metadata h1') ||
        document.querySelector('ytd-video-primary-info-renderer h1');
      if (h1) return h1.innerText?.trim() || null;
      const yt = document.querySelector('#title yt-formatted-string') ||
        document.querySelector('h1 yt-formatted-string');
      if (yt) return yt.innerText?.trim() || null;
      const og = document.querySelector('meta[property="og:title"]');
      return og?.content?.trim() || null;
    };
    const video = document.querySelector('video');
    return { title: getTitle(), currentTime: video ? video.currentTime : null };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'get-youtube-info') {
      try {
        sendResponse(getYouTubeInfo());
      } catch (e) {
        sendResponse({ title: null, currentTime: null });
      }
      return true;
    }
    if (msg.type === 'get-page-text') {
      try {
        sendResponse({ text: getPageText() });
      } catch (e) {
        sendResponse({ text: '' });
      }
      return true;
    }
    if (msg.type === 'get-selected-text') {
      try {
        const text = window.getSelection?.()?.toString?.()?.trim() || '';
        sendResponse({ text });
      } catch (e) {
        sendResponse({ text: '' });
      }
      return true;
    }
    if (msg.type === 'youtube-seek') {
      const video = document.querySelector('video');
      if (video && typeof msg.seconds === 'number') {
        video.currentTime = msg.seconds;
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return true;
    }
    return false;
  });
})();
