// content.js — injected programmatically by popup.js after the tab finishes loading.
// popup.js sends { videoCount } via chrome.tabs.sendMessage after injection.

chrome.runtime.onMessage.addListener((message) => {
  if (typeof message.videoCount !== 'number') return;

  const videoCount = Math.max(1, Math.min(10, message.videoCount));

  // Wait 3000ms for YouTube SPA to fully render the video list
  setTimeout(scrapeAndSend, 3000);

  function scrapeAndSend() {
    try {
      // ── Channel Name ────────────────────────────────────────────────────────
      let channelName = '';

      const h1Dynamic = document.querySelector('yt-dynamic-text-view-model h1');
      if (h1Dynamic && h1Dynamic.innerText.trim()) {
        channelName = h1Dynamic.innerText.trim();
      }
      if (!channelName) {
        const anyH1 = document.querySelector('h1');
        if (anyH1 && anyH1.innerText.trim()) channelName = anyH1.innerText.trim();
      }
      if (!channelName) {
        const oldEl = document.querySelector(
          '#channel-name yt-formatted-string, yt-formatted-string#text.style-scope.ytd-channel-name, #channel-name'
        );
        if (oldEl && oldEl.innerText.trim()) channelName = oldEl.innerText.trim();
      }

      // ── Channel Link ────────────────────────────────────────────────────────
      let channelLink = window.location.href.split('?')[0];
      if (channelLink.endsWith('/videos')) channelLink = channelLink.slice(0, -7);

      // ── Video Links ─────────────────────────────────────────────────────────
      // New layout (yt-lockup-view-model cards)
      let videoEls = document.querySelectorAll('a.ytLockupMetadataViewModelTitle');
      // Old layout: ytd-rich-item-renderer
      if (!videoEls || videoEls.length === 0) {
        videoEls = document.querySelectorAll('ytd-rich-item-renderer a#video-title-link');
      }
      // Old layout: ytd-grid-video-renderer
      if (!videoEls || videoEls.length === 0) {
        videoEls = document.querySelectorAll('ytd-grid-video-renderer a#thumbnail');
      }
      // Generic fallback: any watch?v= link, de-duplicated
      if (!videoEls || videoEls.length === 0) {
        const allWatch = document.querySelectorAll('[href*="watch?v="]');
        const seen = new Set();
        const deduped = [];
        allWatch.forEach(el => {
          const h = el.getAttribute('href');
          if (h && !seen.has(h)) { seen.add(h); deduped.push(el); }
        });
        videoEls = deduped;
      }

      // ── Guard checks ────────────────────────────────────────────────────────
      if (!channelName) {
        chrome.runtime.sendMessage({ error: 'Could not find channel name.', channelLink });
        return;
      }
      if (!videoEls || videoEls.length === 0) {
        chrome.runtime.sendMessage({ error: 'Could not find video links. YouTube DOM may have changed.', channelLink });
        return;
      }

      // ── Build video URL list ─────────────────────────────────────────────────
      const videos = [];
      for (let i = 0; i < Math.min(videoCount, videoEls.length); i++) {
        let href = videoEls[i].getAttribute('href');
        if (!href) continue;
        if (href.startsWith('/')) href = 'https://www.youtube.com' + href;
        try {
          const url = new URL(href);
          const v = url.searchParams.get('v');
          if (v) href = `https://www.youtube.com/watch?v=${v}`;
        } catch(e) { /* keep as-is */ }
        videos.push(href);
      }

      if (videos.length === 0) {
        chrome.runtime.sendMessage({ error: 'Could not extract video hrefs.', channelLink });
        return;
      }

      chrome.runtime.sendMessage({ channelName, channelLink, videos });

    } catch (err) {
      let channelLink = window.location.href.split('?')[0];
      if (channelLink.endsWith('/videos')) channelLink = channelLink.slice(0, -7);
      chrome.runtime.sendMessage({ error: 'Unexpected error: ' + err.message, channelLink });
    }
  }
});
