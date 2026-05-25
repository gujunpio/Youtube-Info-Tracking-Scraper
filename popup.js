// popup.js — auto-detects YouTube channel from current tab, scrapes on open.

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput         = document.getElementById('url-input');
  const videoCountInput  = document.getElementById('video-count');
  const scrapeBtn        = document.getElementById('scrape-btn');
  const statusBar        = document.getElementById('status-bar');
  const statusText       = document.getElementById('status-text');
  const spinner          = document.getElementById('spinner');
  const resultsContainer = document.getElementById('results-container');
  const tableBody        = document.getElementById('table-body');
  const copyBtn          = document.getElementById('copy-btn');
  const toast            = document.getElementById('toast');
  const detectedBanner   = document.getElementById('detected-banner');
  const detectedUrlText  = document.getElementById('detected-url-text');
  const notChannelBanner = document.getElementById('not-channel-banner');

  let activeTabId   = null;
  let scrapeTimeout = null;
  let autoUrl       = ''; // auto-detected URL

  // ── YouTube channel URL regex ──────────────────────────────────────────────
  const YT_CHANNEL_RE = /(https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+))/i;

  // ── 1. Detect current tab URL on popup open ────────────────────────────────
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const match = tab.url.match(YT_CHANNEL_RE);
      if (match) {
        autoUrl = match[1];
        // Show detected banner
        detectedBanner.style.display = 'flex';
        detectedUrlText.textContent  = autoUrl.replace('https://www.youtube.com', '');
        scrapeBtn.textContent = '▶ Scrape Channel';
        // Auto-start scrape
        startScrape(autoUrl);
      } else {
        // On YouTube but not a channel page
        const isYouTube = tab.url.includes('youtube.com');
        notChannelBanner.style.display = isYouTube ? 'flex' : 'none';
        scrapeBtn.textContent = '▶ Scrape';
      }
    }
  } catch (e) {
    // No tab access — manual mode
  }

  // ── 2. Manual scrape button ────────────────────────────────────────────────
  scrapeBtn.addEventListener('click', () => {
    // Priority: auto-detected URL → manual input field
    const raw = autoUrl || urlInput.value.trim();
    if (!raw) {
      showStatus('⚠️ Nhập URL channel YouTube.', false, false);
      return;
    }
    const match = raw.match(YT_CHANNEL_RE);
    if (!match) {
      showStatus('❌ URL không hợp lệ. Ví dụ: youtube.com/@mkbhd', true, false);
      return;
    }
    startScrape(match[1]);
  });

  // ── 3. Core scraping logic ────────────────────────────────────────────────
  function startScrape(baseUrl) {
    let videoCount = parseInt(videoCountInput.value, 10);
    if (isNaN(videoCount) || videoCount < 1) videoCount = 1;
    if (videoCount > 10) videoCount = 10;
    videoCountInput.value = videoCount;

    const targetUrl = baseUrl.replace(/\/(videos|shorts|streams|about|community)$/, '') + '/videos';

    setScrapingState(true);
    showStatus('⏳ Đang mở trang videos...', false, true);
    cleanup();

    // Timeout guard
    scrapeTimeout = setTimeout(() => {
      cleanup();
      setScrapingState(false);
      showStatus('❌ Timeout: YouTube tải quá lâu.', true, false);
    }, 20000);

    // Open hidden tab
    chrome.tabs.create({ url: targetUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        cleanup();
        setScrapingState(false);
        showStatus('❌ Không mở được tab: ' + chrome.runtime.lastError.message, true, false);
        return;
      }
      activeTabId = tab.id;

      const tabListener = (tabId, info) => {
        if (tabId !== activeTabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(tabListener);
        showStatus('⚙️ Đang đọc dữ liệu channel...', false, true);

        chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content.js']
        }).then(() => {
          chrome.tabs.sendMessage(activeTabId, { videoCount });
        }).catch(err => {
          cleanup();
          setScrapingState(false);
          showStatus('❌ Không inject được script: ' + err.message, true, false);
        });
      };
      chrome.tabs.onUpdated.addListener(tabListener);
    });
  }

  // ── 4. Result handler from content.js ────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!sender.tab || sender.tab.id !== activeTabId) return;
    cleanup();
    setScrapingState(false);
    hideStatus();

    if (message.error) {
      addErrorRow(message.channelLink || autoUrl || urlInput.value.trim(), message.error);
    } else {
      addRow(message.channelName, message.channelLink, message.videos);
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function cleanup() {
    if (scrapeTimeout) { clearTimeout(scrapeTimeout); scrapeTimeout = null; }
    if (activeTabId !== null) {
      chrome.tabs.remove(activeTabId).catch(() => {});
      activeTabId = null;
    }
  }

  function setScrapingState(isScraping) {
    scrapeBtn.disabled = isScraping;
  }

  function showStatus(msg, isError, showSpinner) {
    statusBar.style.display = 'flex';
    statusBar.className = isError ? 'error' : 'info';
    statusText.textContent = msg;
    spinner.style.display = showSpinner ? 'block' : 'none';
  }

  function hideStatus() {
    statusBar.style.display = 'none';
  }

  function addRow(name, link, videos) {
    resultsContainer.style.display = 'block';
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = name;

    const tdLink = document.createElement('td');
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.textContent = link;
    tdLink.appendChild(a);

    const tdVideos = document.createElement('td');
    tdVideos.style.whiteSpace = 'pre-wrap';
    tdVideos.innerHTML = videos.map(v =>
      `<a href="${v}" target="_blank">${v}</a>`
    ).join('<br>');

    tr.appendChild(tdName);
    tr.appendChild(tdLink);
    tr.appendChild(tdVideos);
    tableBody.appendChild(tr);

    tr.dataset.name   = name;
    tr.dataset.link   = link;
    tr.dataset.videos = JSON.stringify(videos);
  }

  function addErrorRow(link, error) {
    resultsContainer.style.display = 'block';
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = 'Error';
    tdName.className = 'error-row';

    const tdLink = document.createElement('td');
    tdLink.textContent = link;

    const tdErr = document.createElement('td');
    tdErr.textContent = error;
    tdErr.className = 'error-row';

    tr.appendChild(tdName);
    tr.appendChild(tdLink);
    tr.appendChild(tdErr);
    tableBody.appendChild(tr);

    tr.dataset.name   = 'Error';
    tr.dataset.link   = link;
    tr.dataset.videos = JSON.stringify([error]);
  }

  // ── Copy TSV ──────────────────────────────────────────────────────────────
  copyBtn.addEventListener('click', () => {
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    if (!rows.length) return;

    const tsv = rows.map(row => {
      const name = row.dataset.name || '';
      const link = row.dataset.link || '';
      let videos = [];
      try { videos = JSON.parse(row.dataset.videos || '[]'); } catch(_) {}
      return `${name}\t${link}\t${videos.filter(Boolean).join(' \\\\ ')}`;
    }).join('\n') + '\n';

    navigator.clipboard.writeText(tsv).then(() => {
      showToast();
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast(); } catch(e) {}
      document.body.removeChild(ta);
    });
  });

  function showToast() {
    toast.className = 'toast show';
    setTimeout(() => { toast.className = 'toast'; }, 2000);
  }
});
