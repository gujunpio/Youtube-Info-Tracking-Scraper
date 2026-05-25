// channel_button.js — v2
// Injects a "📊 Scrape" button near the channel name on YouTube channel pages.
// Uses aggressive multi-strategy detection with retry loop.

(function () {
  'use strict';

  const BUTTON_ID  = 'yt-scraper-inject-btn';
  const PANEL_ID   = 'yt-scraper-float-panel';
  const MARKER_CLS = 'yt-scraper-injected';

  // ── Is this a channel page? ───────────────────────────────────────────────
  function isChannelPage() {
    return /^\/((@|channel\/|c\/|user\/)[\w.-]+)(\/|$)/i.test(location.pathname);
  }

  // ── Find a stable element to attach our button near ──────────────────────
  // Returns { anchor: Element, mode: 'after' | 'append' }
  function findAnchor() {
    // 1. Channel title h1 inside yt-dynamic-text-view-model (new layout)
    const h1Dynamic = document.querySelector('yt-dynamic-text-view-model h1');
    if (h1Dynamic) {
      // Go up to a flex row ancestor so we can append there
      let el = h1Dynamic;
      for (let i = 0; i < 5; i++) {
        el = el.parentElement;
        if (!el) break;
        const cs = getComputedStyle(el);
        if (cs.display === 'flex' || cs.display === 'grid') {
          return { anchor: el, mode: 'append' };
        }
      }
      // Fallback: insert after h1 container
      return { anchor: h1Dynamic.parentElement || h1Dynamic, mode: 'after' };
    }

    // 2. #channel-name (older layout)
    const chName = document.querySelector('#channel-name');
    if (chName) return { anchor: chName, mode: 'after' };

    // 3. ytd-channel-name element
    const ytdChName = document.querySelector('ytd-channel-name');
    if (ytdChName) return { anchor: ytdChName, mode: 'after' };

    // 4. Any h1 on a channel page
    const anyH1 = document.querySelector('h1');
    if (anyH1) return { anchor: anyH1.parentElement || anyH1, mode: 'after' };

    // 5. Inner header container
    const innerHeader = document.querySelector('#inner-header-container');
    if (innerHeader) return { anchor: innerHeader, mode: 'append' };

    // 6. Subscribe button parent
    const subBtn = document.querySelector(
      '#subscribe-button, ytd-subscribe-button-renderer, yt-subscribe-button-view-model'
    );
    if (subBtn && subBtn.parentElement) {
      return { anchor: subBtn.parentElement, mode: 'append' };
    }

    return null;
  }

  // ── Inject the button ─────────────────────────────────────────────────────
  function injectButton() {
    if (!isChannelPage()) return false;
    if (document.getElementById(BUTTON_ID)) return true; // already there

    const found = findAnchor();
    if (!found) return false;

    const { anchor, mode } = found;

    // Make sure anchor is not already marked
    if (anchor.classList.contains(MARKER_CLS)) return true;
    anchor.classList.add(MARKER_CLS);

    ensureStyles();

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.textContent = '📊 Scrape';
    btn.title = 'YT Channel Scraper — lấy dữ liệu channel này';

    if (mode === 'after') {
      anchor.insertAdjacentElement('afterend', btn);
    } else {
      anchor.appendChild(btn);
    }

    btn.addEventListener('click', onScrapeButtonClick);
    return true;
  }

  // ── Button click → toggle panel ───────────────────────────────────────────
  function onScrapeButtonClick() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }

    const panel = buildPanel();
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('#ytsp-header'));

    panel.querySelector('#ytsp-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#ytsp-run').addEventListener('click', () => {
      const count = Math.max(1, Math.min(10, parseInt(panel.querySelector('#ytsp-count').value, 10) || 3));
      runScrape(count, panel);
    });
    panel.querySelector('#ytsp-copy').addEventListener('click', () => copyTsv(panel));

    // Auto-start scraping with default count
    const defaultCount = 3;
    panel.querySelector('#ytsp-count').value = defaultCount;
    runScrape(defaultCount, panel);
  }

  // ── Build floating panel HTML ─────────────────────────────────────────────
  function buildPanel() {
    const div = document.createElement('div');
    div.id = PANEL_ID;
    div.innerHTML = `
      <div id="ytsp-header">
        <span id="ytsp-title">📊 YT Channel Scraper</span>
        <button id="ytsp-close" title="Đóng">✕</button>
      </div>
      <div id="ytsp-body">
        <div id="ytsp-options">
          <label for="ytsp-count">Số video:</label>
          <input type="number" id="ytsp-count" min="1" max="10" value="3">
          <button id="ytsp-run">▶ Scrape</button>
        </div>
        <div id="ytsp-status"></div>
        <div id="ytsp-spinner" style="display:none"></div>
        <div id="ytsp-results" style="display:none">
          <table id="ytsp-table">
            <thead><tr><th>Channel</th><th>Link</th><th>Videos</th></tr></thead>
            <tbody id="ytsp-tbody"></tbody>
          </table>
          <button id="ytsp-copy">📋 Copy TSV</button>
        </div>
        <div id="ytsp-toast">✅ Copied!</div>
      </div>`;
    return div;
  }

  // ── Draggable panel ───────────────────────────────────────────────────────
  function makeDraggable(panel, handle) {
    let ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      if (e.target.id === 'ytsp-close') return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      panel.style.right = 'auto';
      const move = ev => {
        panel.style.left = (ev.clientX - ox) + 'px';
        panel.style.top  = (ev.clientY - oy) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ── Scraping ──────────────────────────────────────────────────────────────
  let activeTabId   = null;
  let scrapeTimeout = null;
  let msgListener   = null;

  function runScrape(videoCount, panel) {
    const runBtn  = panel.querySelector('#ytsp-run');
    const spinner = panel.querySelector('#ytsp-spinner');
    const status  = panel.querySelector('#ytsp-status');
    const results = panel.querySelector('#ytsp-results');

    // Derive channel URL
    const m = location.href.match(
      /(https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+))/i
    );
    if (!m) {
      setStatus(status, '❌ Không thể xác định URL channel.', true);
      return;
    }
    const targetUrl = m[1] + '/videos';

    // Reset UI
    runBtn.disabled = true;
    spinner.style.display = 'block';
    results.style.display  = 'none';
    setStatus(status, '⏳ Đang tải trang videos...', false);

    killPreviousScrape();

    // Register message listener for result from content.js
    if (msgListener) chrome.runtime.onMessage.removeListener(msgListener);
    msgListener = (message, sender) => {
      if (sender.tab && sender.tab.id === activeTabId) {
        killPreviousScrape();
        runBtn.disabled = false;
        spinner.style.display = 'none';
        chrome.runtime.onMessage.removeListener(msgListener);
        msgListener = null;

        if (message.error) {
          setStatus(status, '❌ ' + message.error, true);
        } else {
          setStatus(status, '', false);
          addRow(results, panel.querySelector('#ytsp-tbody'), message.channelName, message.channelLink, message.videos);
        }
      }
    };
    chrome.runtime.onMessage.addListener(msgListener);

    // Open invisible tab
    chrome.tabs.create({ url: targetUrl, active: false }, tab => {
      if (chrome.runtime.lastError) {
        setStatus(status, '❌ Không thể mở tab: ' + chrome.runtime.lastError.message, true);
        runBtn.disabled = false;
        spinner.style.display = 'none';
        return;
      }
      activeTabId = tab.id;

      scrapeTimeout = setTimeout(() => {
        killPreviousScrape();
        runBtn.disabled = false;
        spinner.style.display = 'none';
        setStatus(status, '❌ Timeout: YouTube tải quá lâu.', true);
      }, 20000);

      const tabListener = (tabId, info) => {
        if (tabId !== activeTabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(tabListener);
        setStatus(status, '⚙️ Đang scrape dữ liệu...', false);
        chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content.js']
        }).then(() => {
          chrome.tabs.sendMessage(activeTabId, { videoCount });
        }).catch(err => {
          killPreviousScrape();
          runBtn.disabled = false;
          spinner.style.display = 'none';
          setStatus(status, '❌ Inject lỗi: ' + err.message, true);
        });
      };
      chrome.tabs.onUpdated.addListener(tabListener);
    });
  }

  function killPreviousScrape() {
    if (scrapeTimeout) { clearTimeout(scrapeTimeout); scrapeTimeout = null; }
    if (activeTabId !== null) {
      chrome.tabs.remove(activeTabId).catch(() => {});
      activeTabId = null;
    }
  }

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.style.color = isError ? '#ff5252' : '#aaa';
    el.style.display = text ? 'block' : 'none';
  }

  function addRow(resultsDiv, tbody, name, link, videos) {
    resultsDiv.style.display = 'block';
    const tr = document.createElement('tr');
    tr.dataset.name   = name;
    tr.dataset.link   = link;
    tr.dataset.videos = JSON.stringify(videos);

    const tdN = document.createElement('td');
    tdN.textContent = name;

    const tdL = document.createElement('td');
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.textContent = link;
    tdL.appendChild(a);

    const tdV = document.createElement('td');
    tdV.style.whiteSpace = 'pre-wrap';
    tdV.innerHTML = videos.map(v =>
      `<a href="${v}" target="_blank">${v}</a>`
    ).join('<br>');

    tr.append(tdN, tdL, tdV);
    tbody.appendChild(tr);
  }

  // ── Copy TSV ──────────────────────────────────────────────────────────────
  function copyTsv(panel) {
    const rows = Array.from(panel.querySelectorAll('#ytsp-tbody tr'));
    if (!rows.length) return;
    const tsv = rows.map(r => {
      let vids = [];
      try { vids = JSON.parse(r.dataset.videos || '[]'); } catch(_) {}
      return `${r.dataset.name}\t${r.dataset.link}\t${vids.filter(Boolean).join(' \\\\ ')}`;
    }).join('\n') + '\n';

    navigator.clipboard.writeText(tsv).then(() => showToast(panel))
      .catch(() => {
        const ta = document.createElement('textarea');
        ta.value = tsv;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(panel);
      });
  }

  function showToast(panel) {
    const t = panel.querySelector('#ytsp-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('yt-scraper-style')) return;
    const s = document.createElement('style');
    s.id = 'yt-scraper-style';
    s.textContent = `
      /* ── Trigger button ── */
      #${BUTTON_ID} {
        display: inline-flex;
        align-items: center;
        padding: 0 14px;
        height: 32px;
        margin-left: 10px;
        border: none;
        border-radius: 16px;
        background: linear-gradient(135deg, #3ea6ff 0%, #7c6ff7 100%);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        font-family: "Roboto", "YouTube Sans", sans-serif;
        letter-spacing: 0.4px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        vertical-align: middle;
        box-shadow: 0 2px 10px rgba(62,166,255,0.45);
        transition: filter .15s, transform .15s, box-shadow .15s;
        position: relative;
        z-index: 9999;
      }
      #${BUTTON_ID}:hover {
        filter: brightness(1.18);
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(62,166,255,0.6);
      }
      #${BUTTON_ID}:active { transform: translateY(0); filter: brightness(0.95); }

      /* ── Floating panel ── */
      #${PANEL_ID} {
        position: fixed !important;
        top: 80px !important;
        right: 24px !important;
        width: 480px;
        max-height: 80vh;
        overflow-y: auto;
        background: #0f0f0f;
        border: 1px solid #2a2a2a;
        border-radius: 14px;
        box-shadow: 0 12px 48px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.05);
        z-index: 2147483647 !important;
        font-family: "Roboto","YouTube Sans",sans-serif;
        font-size: 13px;
        color: #e0e0e0;
        animation: ytsp-in .2s cubic-bezier(.22,1,.36,1);
      }
      @keyframes ytsp-in {
        from { opacity:0; transform: translateY(-8px) scale(.97); }
        to   { opacity:1; transform: translateY(0)   scale(1);    }
      }

      #ytsp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 16px;
        background: linear-gradient(90deg,#1a1a2e,#16213e);
        border-radius: 14px 14px 0 0;
        cursor: move;
        user-select: none;
        border-bottom: 1px solid #222;
      }
      #ytsp-title { font-size:14px; font-weight:700; color:#fff; letter-spacing:.3px; }
      #ytsp-close {
        background: transparent; border: none; color: #777;
        font-size: 16px; cursor: pointer; padding: 2px 7px;
        border-radius: 4px; line-height: 1;
        transition: color .15s, background .15s;
      }
      #ytsp-close:hover { color:#fff; background:rgba(255,255,255,.08); }

      #ytsp-body { padding: 14px 16px 18px; }

      #ytsp-options {
        display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
      }
      #ytsp-options label { color:#aaa; font-size:13px; white-space:nowrap; }
      #ytsp-count {
        width:58px; padding:5px 8px;
        border:1px solid #333; border-radius:6px;
        background:#1a1a1a; color:#fff; font-size:13px;
        text-align:center; outline:none;
      }
      #ytsp-count:focus { border-color:#3ea6ff; }

      #ytsp-run {
        padding: 6px 18px; border: none; border-radius: 16px;
        background: linear-gradient(135deg,#3ea6ff,#7c6ff7);
        color:#fff; font-size:13px; font-weight:700; cursor:pointer;
        box-shadow: 0 2px 8px rgba(62,166,255,.35);
        transition: filter .15s, transform .15s;
      }
      #ytsp-run:hover  { filter:brightness(1.15); transform:translateY(-1px); }
      #ytsp-run:active { transform:translateY(0); }
      #ytsp-run:disabled { background:#333; color:#555; cursor:not-allowed; box-shadow:none; filter:none; transform:none; }

      #ytsp-status { font-size:12px; margin-bottom:8px; display:none; }

      #ytsp-spinner {
        width:22px; height:22px;
        border:2px solid #2a2a2a; border-top:2px solid #3ea6ff;
        border-radius:50%;
        animation:ytsp-spin .8s linear infinite;
        margin:4px auto 10px;
      }
      @keyframes ytsp-spin { to { transform:rotate(360deg); } }

      #ytsp-table {
        width:100%; border-collapse:collapse;
        font-size:12px; margin-bottom:10px;
      }
      #ytsp-table th, #ytsp-table td {
        border:1px solid #252525; padding:6px 8px;
        text-align:left; word-break:break-all; vertical-align:top;
      }
      #ytsp-table th {
        background:#1a1a1a; color:#fff;
        font-size:11px; text-transform:uppercase; letter-spacing:.5px;
      }
      #ytsp-table tr:nth-child(even) { background:#111; }
      #ytsp-table a { color:#3ea6ff; text-decoration:none; }
      #ytsp-table a:hover { text-decoration:underline; }

      #ytsp-copy {
        width:100%; padding:8px; border:none; border-radius:8px;
        background:linear-gradient(135deg,#2ba640,#1a7a2e);
        color:#fff; font-size:13px; font-weight:700; cursor:pointer;
        box-shadow: 0 2px 8px rgba(43,166,64,.35);
        transition: filter .15s, transform .15s;
      }
      #ytsp-copy:hover  { filter:brightness(1.15); transform:translateY(-1px); }

      #ytsp-toast {
        display:none; position:sticky; bottom:0; left:50%;
        transform:translateX(-50%);
        background:#111; border:1px solid #3ea6ff; color:#3ea6ff;
        padding:5px 14px; border-radius:20px;
        font-size:12px; font-weight:600;
        text-align:center; white-space:nowrap;
        margin-top:8px;
        animation:ytsp-in .2s ease;
      }
      #ytsp-toast.show { display:block; }
    `;
    document.head.appendChild(s);
  }

  // ── Main retry loop ───────────────────────────────────────────────────────
  let injected = false;
  let lastPath = location.pathname;
  let retryCount = 0;

  function tryInject() {
    if (!isChannelPage()) { injected = false; return; }
    if (injected && document.getElementById(BUTTON_ID)) return;

    injected = injectButton();
    if (!injected && retryCount < 40) {
      retryCount++;
    }
  }

  // Poll every 500ms for up to 20s after page load / navigation
  const pollInterval = setInterval(tryInject, 500);

  // React to YouTube SPA navigation
  const navObserver = new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      injected = false;
      retryCount = 0;
      // Remove stale elements
      document.getElementById(BUTTON_ID)?.remove();
      document.getElementById(PANEL_ID)?.remove();
      document.querySelectorAll('.' + MARKER_CLS).forEach(el => el.classList.remove(MARKER_CLS));
    }
    tryInject();
  });

  navObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Initial attempt
  tryInject();
})();
