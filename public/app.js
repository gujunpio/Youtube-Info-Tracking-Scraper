// ============================================================
// YT Channel Scraper — Frontend Application
// ============================================================

// === DOM Elements ===
const channelInput = document.getElementById('channelInput');
const channelCount = document.getElementById('channelCount');
const scrapeBtn = document.getElementById('scrapeBtn');
const clearBtn = document.getElementById('clearBtn');
const progressSection = document.getElementById('progressSection');
const progressTitle = document.getElementById('progressTitle');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressCounter = document.getElementById('progressCounter');
const resultsSection = document.getElementById('resultsSection');
const statsBar = document.getElementById('statsBar');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const resultsBody = document.getElementById('resultsBody');
const toastContainer = document.getElementById('toastContainer');

// Stores all scraped results for export
let allResults = [];

// ============================================================
// Channel Count Auto-Update
// ============================================================
channelInput.addEventListener('input', () => {
  const urls = parseChannelUrls();
  channelCount.textContent = urls.length;
  // Enable scrape button only when there are valid URLs
  scrapeBtn.disabled = urls.length === 0;
});

// ============================================================
// Parse Channel URLs from textarea
// ============================================================
function parseChannelUrls() {
  const text = channelInput.value.trim();
  if (!text) return [];
  const rawUrls = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && isValidYoutubeChannel(line));
  return [...new Set(rawUrls)];
}

/**
 * Validates whether a URL is a recognized YouTube channel format.
 * Supports: /@handle, /channel/ID, /c/name, /user/name
 */
function isValidYoutubeChannel(url) {
  return /^https?:\/\/(www\.)?youtube\.com\/((@[\w.-]+)|(channel\/[\w-]+)|(c\/[\w.-]+)|(user\/[\w.-]+))/i.test(url);
}

// ============================================================
// Clear Button
// ============================================================
clearBtn.addEventListener('click', () => {
  channelInput.value = '';
  channelCount.textContent = '0';
  scrapeBtn.disabled = true;
  progressSection.style.display = 'none';
  resultsSection.style.display = 'none';
  resultsBody.innerHTML = '';
  allResults = [];
  showToast('Đã xóa tất cả', 'info');
});

// ============================================================
// Scrape Button — Main flow
// ============================================================
scrapeBtn.addEventListener('click', startScrape);

async function startScrape() {
  const channels = parseChannelUrls();
  if (channels.length === 0) {
    showToast('Vui lòng nhập ít nhất 1 link kênh YouTube hợp lệ', 'error');
    return;
  }

  // Reset state
  allResults = [];
  let successCount = 0;
  let errorCount = 0;
  resultsBody.innerHTML = '';

  // Show progress, hide results initially
  progressSection.style.display = 'block';
  resultsSection.style.display = 'none';
  scrapeBtn.disabled = true;
  scrapeBtn.classList.add('loading');

  // Scroll to progress section smoothly
  progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Initialize progress UI
  updateProgress(0, channels.length, 'Đang khởi tạo...');

  try {
    // POST channel list to the server; response is SSE-style streaming
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read streamed SSE events
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split buffer into complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep any incomplete line in the buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'progress':
                updateProgress(
                  event.current - 1,
                  event.total,
                  `Đang scrape: ${event.channel}`
                );
                break;

              case 'result':
                successCount++;
                allResults.push(event.data);
                addResultRow(event.data, allResults.length);
                updateProgress(
                  successCount + errorCount,
                  channels.length,
                  `Hoàn thành: ${event.data.channelName}`
                );
                // Reveal results section as soon as first result arrives
                resultsSection.style.display = 'block';
                break;

              case 'error':
                errorCount++;
                showToast(`Lỗi: ${event.channel} - ${event.message}`, 'error');
                updateProgress(
                  successCount + errorCount,
                  channels.length,
                  `Lỗi: ${event.channel}`
                );
                break;

              case 'done':
                updateProgress(channels.length, channels.length, 'Hoàn tất!');
                finalizeProgress(successCount, errorCount);
                break;
            }

            // Keep stats bar up-to-date after every event
            updateStats(successCount, errorCount, channels.length);
          } catch (parseErr) {
            // Silently skip malformed SSE events
          }
        }
      }
    }
  } catch (err) {
    showToast(`Lỗi kết nối: ${err.message}`, 'error');
    finalizeProgress(successCount, errorCount);
  } finally {
    scrapeBtn.disabled = false;
    scrapeBtn.classList.remove('loading');

    if (allResults.length > 0) {
      resultsSection.style.display = 'block';
      showToast(`Hoàn tất! ${successCount} kênh thành công`, 'success');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// ============================================================
// Progress UI helpers
// ============================================================
function updateProgress(current, total, text) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = text;
  progressCounter.textContent = `${current}/${total} kênh`;
}

/**
 * Called when scraping finishes (success or error).
 * Stops animation, updates title, resets state after delay.
 */
function finalizeProgress(successCount, errorCount) {
  // Stop shimmer animation, switch bar to solid green
  progressBar.classList.add('done');

  // Update title & counter badge
  if (errorCount === 0) {
    progressTitle.textContent = '✅ Hoàn tất!';
  } else if (successCount === 0) {
    progressTitle.textContent = '❌ Thất bại';
  } else {
    progressTitle.textContent = `✅ Hoàn tất (${errorCount} lỗi)`;
  }
  progressCounter.classList.add('done');

  // Auto-hide progress section after 3 seconds
  setTimeout(() => {
    progressSection.style.opacity = '0';
    progressSection.style.transition = 'opacity 0.6s ease';
    setTimeout(() => {
      progressSection.style.display = 'none';
      progressSection.style.opacity = '';
      progressSection.style.transition = '';
      // Reset for next run
      progressBar.classList.remove('done');
      progressCounter.classList.remove('done');
      progressTitle.textContent = '⏳ Đang xử lý';
    }, 650);
  }, 3000);
}

function updateStats(success, errors, total) {
  statsBar.innerHTML = `
    <span class="stat-success">✅ Thành công: ${success}</span>
    <span class="stat-error">❌ Thất bại: ${errors}</span>
    <span class="stat-total">📊 Tổng: ${total}</span>
  `;
}

// ============================================================
// Add a result row to the table
// ============================================================
function addResultRow(result, index) {
  const tr = document.createElement('tr');
  tr.style.animation = `fadeIn 0.4s ease ${index * 0.05}s both`;

  const v = result.videos || [];

  tr.innerHTML = `
    <td class="row-index">${index}</td>
    <td class="channel-name">${escapeHtml(result.channelName || 'N/A')}</td>
    <td class="channel-id">${escapeHtml(result.channelId || 'N/A')}</td>
    <td>${renderLink(result.channelLink)}</td>
    <td class="vcount-cell"><span class="vcount-badge">${escapeHtml(result.totalVideoCount || 'N/A')}</span></td>
    <td class="duration-cell"><span class="duration-badge">${escapeHtml(result.avgDurationText || 'N/A')}</span></td>
    <td class="avgviews-cell"><span class="avgviews-badge">${escapeHtml(result.avgViewsText || 'N/A')}</span></td>
    <td class="lang-cell"><span class="lang-badge">${escapeHtml(result.language || 'Unknown')}</span></td>
    <td class="subs-cell"><span class="subs-badge">${escapeHtml(result.subscriberCount || 'N/A')}</span></td>
    <td class="freq-cell">${escapeHtml(result.frequencyText || 'N/A')}</td>
    <td class="temp-cell">${renderVideoLink({ url: result.latestVideoUrl, title: result.latestVideoTitle })}</td>
    <td class="date-cell temp-cell">${escapeHtml(result.latestVideoDateText || 'N/A')}</td>
    <td class="status-cell temp-cell">
      <span class="status-badge ${result.status === 'active' ? 'status-active' : 'status-inactive'}">
        ${result.status === 'active' ? 'Kênh đang hoạt động' : 'Kênh dừng hoạt động'}
      </span>
    </td>
    <td class="priority-cell temp-cell">
      <span class="priority-badge ${result.priorityClass || ''}">
        ${escapeHtml(result.priorityText || 'N/A')}
      </span>
    </td>
  `;

  resultsBody.appendChild(tr);
}

/**
 * Renders a channel link cell.
 */
function renderLink(url) {
  if (!url) return 'N/A';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${truncateUrl(url)}</a>`;
}

/**
 * Renders a video link cell with a title tooltip.
 */
function renderVideoLink(video) {
  if (!video?.url) return 'N/A';
  const title = video.title ? ` title="${escapeHtml(video.title)}"` : '';
  return `<a href="${escapeHtml(video.url)}" target="_blank" rel="noopener"${title}>${truncateUrl(video.url)}</a>`;
}

// ============================================================
// Export — CSV
// ============================================================
exportCsvBtn.addEventListener('click', async () => {
  if (allResults.length === 0) {
    showToast('Không có dữ liệu để xuất', 'error');
    return;
  }

  try {
    const response = await fetch('/api/export/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: allResults })
    });

    if (!response.ok) throw new Error(`Export failed: ${response.status}`);

    const blob = await response.blob();
    downloadBlob(blob, 'youtube_channels.csv');
    showToast('Đã xuất file CSV thành công!', 'success');
  } catch (err) {
    showToast(`Lỗi xuất CSV: ${err.message}`, 'error');
  }
});

// ============================================================
// Export — Excel
// ============================================================
exportExcelBtn.addEventListener('click', async () => {
  if (allResults.length === 0) {
    showToast('Không có dữ liệu để xuất', 'error');
    return;
  }

  try {
    const response = await fetch('/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: allResults })
    });

    if (!response.ok) throw new Error(`Export failed: ${response.status}`);

    const blob = await response.blob();
    downloadBlob(blob, 'youtube_channels.xlsx');
    showToast('Đã xuất file Excel thành công!', 'success');
  } catch (err) {
    showToast(`Lỗi xuất Excel: ${err.message}`, 'error');
  }
});

// ============================================================
// Helper Functions
// ============================================================

/**
 * Triggers a browser download from a Blob.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Escapes HTML entities to prevent XSS.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Truncates a URL for display while keeping it readable.
 */
function truncateUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 30) {
      path = path.slice(0, 27) + '...';
    }
    return u.hostname + path;
  } catch {
    return url.length > 40 ? url.slice(0, 37) + '...' : url;
  }
}

/**
 * Displays a toast notification.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Toast style variant
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Trigger slide-in animation on next frame
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 4000);
}

// ============================================================
// Initialize
// ============================================================
scrapeBtn.disabled = true;

// ============================================================
// THEME TOGGLE LOGIC
// ============================================================
// SVG outline icons for theme toggle (tránh lỗi encoding emoji)
const ICON_SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const themeToggleBtn = document.getElementById('theme-toggle');
if (themeToggleBtn) {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    themeToggleBtn.innerHTML = ICON_SUN;
    themeToggleBtn.title = 'Chuyển sang chế độ Tối';
  } else {
    themeToggleBtn.innerHTML = ICON_MOON;
    themeToggleBtn.title = 'Chuyển sang chế độ Sáng';
  }

  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      themeToggleBtn.innerHTML = ICON_SUN;
      themeToggleBtn.title = 'Chuyển sang chế độ Tối';
    } else {
      localStorage.setItem('theme', 'dark');
      themeToggleBtn.innerHTML = ICON_MOON;
      themeToggleBtn.title = 'Chuyển sang chế độ Sáng';
    }
  });
}
