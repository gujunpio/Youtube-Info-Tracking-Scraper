/**
 * YouTube Channel Scraper Module
 * Uses Puppeteer to scrape channel info, recent videos, and subscriber count.
 */

const puppeteer = require('puppeteer');
const https = require('https');
const { detectLanguage } = require('./languageDetector');

// Singleton browser instance
let browserInstance = null;

/**
 * Initialize (or return existing) Puppeteer browser.
 */
async function initBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  console.log('[Scraper] Launching Puppeteer browser\u2026');

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-features=site-per-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-translate',
      '--disable-crash-reporter',
      '--crash-dumps-dir=/tmp/chromium-crashpad',
      '--no-first-run',
      '--no-zygote'
    ]
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.log('[Scraper] Using system Chromium:', process.env.PUPPETEER_EXECUTABLE_PATH);
  }

  browserInstance = await puppeteer.launch(launchOptions);

  browserInstance.on('disconnected', () => {
    console.warn('[Scraper] Browser disconnected');
    browserInstance = null;
  });

  console.log('[Scraper] Browser launched successfully');
  return browserInstance;
}

/**
 * Close the singleton browser.
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch { /* ignore */ }
    browserInstance = null;
    console.log('[Scraper] Browser closed');
  }
}

/**
 * Normalize a YouTube channel URL to its /videos page.
 */
function normalizeChannelUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    let pathname = parsed.pathname.replace(/\/+$/, '');
    pathname = pathname.replace(/\/(videos|shorts|streams|about|community|featured|playlists|channels)$/, '');
    parsed.pathname = pathname + '/videos';
    return parsed.toString();
  } catch {
    if (!url.includes('/videos')) url += '/videos';
    return url;
  }
}

/**
 * Helper: Fetch video page to extract exact publish date
 */
function fetchVideoDate(url) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': 'CONSENT=YES+cb; PREF=f6=40000000&hl=en',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/<meta itemprop="datePublished" content="([^"]+)">/);
        resolve(match ? match[1] : null);
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

/**
 * Helper: Parse subscriber text into number
 */
function parseSubscribers(subText) {
  if (!subText) return 0;
  const match = subText.match(/([\d.,]+)\s*([KMBTkmbt]?)/);
  if (!match) return 0;
  let num = parseFloat(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  if (unit === 'K') num *= 1000;
  else if (unit === 'M') num *= 1000000;
  else if (unit === 'B') num *= 1000000000;
  return num;
}

/**
 * Helper: Parse duration string ("12:34" or "1:05:23") into seconds
 */
function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const cleaned = durationStr.trim();
  const parts = cleaned.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

/**
 * Helper: Format seconds into MM:SS or H:MM:SS
 */
function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return 'N/A';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Helper: Parse view count text into number
 * e.g. "1.2M views" → 1200000, "45K views" → 45000, "123,456 views" → 123456
 */
function parseViewCount(viewText) {
  if (!viewText) return 0;
  // Extract the numeric part with optional K/M/B suffix
  const match = viewText.match(/([\d.,]+)\s*([KMBkmb]?)/);
  if (!match) return 0;
  let num = parseFloat(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  if (unit === 'K') num *= 1000;
  else if (unit === 'M') num *= 1000000;
  else if (unit === 'B') num *= 1000000000;
  return Math.round(num);
}

/**
 * Helper: Format view count for display
 * e.g. 1200000 → "1.2M", 45000 → "45K", 890 → "890"
 */
function formatViewCount(views) {
  if (!views || views <= 0) return 'N/A';
  if (views >= 1000000000) return (views / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return views.toString();
}

/**
 * Helper: Parse total video count text
 * e.g. "390 videos" → 390, "1.2K videos" → 1200
 */
function parseTotalVideoCount(text) {
  if (!text) return 0;
  const match = text.match(/([\d.,]+)\s*([KMBkmb]?)/);
  if (!match) return 0;
  let num = parseFloat(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  if (unit === 'K') num *= 1000;
  else if (unit === 'M') num *= 1000000;
  else if (unit === 'B') num *= 1000000000;
  return Math.round(num);
}

/**
 * Helper: Calculate frequency and status from videos array
 */
function calculateChannelMetrics(videos) {
  if (!videos || videos.length === 0) {
    return { frequencyText: 'N/A', latestVideoDateText: 'N/A', status: 'unknown' };
  }

  const validVideos = videos
    .map(v => {
      let timestamp = null;
      if (v.exactDate) {
        timestamp = new Date(v.exactDate).getTime();
      }
      // Fallback for relative dates
      if (!timestamp && v.publishDate) {
         if (/hour|giờ|時間|시간|час|stunde|hora|heure|minute|phút|分|분|минут|segundo|second|giây/i.test(v.publishDate)) {
            timestamp = new Date().getTime(); // Today
         } else {
            // Backup parsing if exactDate fails
            const timeMatch = v.publishDate.match(/(\d+)\s*(day|week|month|year|ngày|tuần|tháng|năm|tag|woche|monat|jahr|jour|semaine|mois|an|día|semana|mes|año)/i);
            if (timeMatch) {
               const num = parseInt(timeMatch[1], 10);
               const unit = timeMatch[2].toLowerCase();
               let daysSub = 0;
               if (/day|ngày|tag|jour|día/.test(unit)) daysSub = num;
               else if (/week|tuần|woche|semaine|semana/.test(unit)) daysSub = num * 7;
               else if (/month|tháng|monat|mois|mes/.test(unit)) daysSub = num * 30;
               else if (/year|năm|jahr|an|año/.test(unit)) daysSub = num * 365;
               
               timestamp = new Date().getTime() - (daysSub * 24 * 60 * 60 * 1000);
            }
         }
      }
      return { ...v, timestamp };
    })
    .filter(v => v.timestamp !== null)
    .sort((a, b) => b.timestamp - a.timestamp); // newest first

  const N = validVideos.length;
  if (N === 0) {
    return { 
      frequencyText: 'N/A', 
      latestVideoDateText: videos[0].publishDate || 'N/A', 
      status: 'active',
      latestVideoUrl: videos[0].url || '',
      latestVideoTitle: videos[0].title || ''
    };
  }

  const latestVideo = validVideos[0];
  const now = new Date().getTime();
  
  const msInDay = 1000 * 60 * 60 * 24;
  const latestDays = Math.max(0, (now - latestVideo.timestamp) / msInDay);

  let frequencyText = 'N/A';
  let status = 'active';
  let avgGapDays = 0;

  if (N >= 2) {
    const oldestVideo = validVideos[N - 1];
    const totalDaysGap = Math.max(0, (latestVideo.timestamp - oldestVideo.timestamp) / msInDay);
    const gapsCount = N - 1;
    
    avgGapDays = totalDaysGap / gapsCount;
    
    if (avgGapDays === 0) {
      // Tránh chia cho 0 nếu các video có cùng timestamp
      avgGapDays = 0.1; 
    }

    const videosPerMonth = Math.ceil(30 / avgGapDays);
    
    if (avgGapDays < 1) {
      frequencyText = `${videosPerMonth} video/tháng (trung bình <1 ngày/video)`;
    } else {
      frequencyText = `${videosPerMonth} video/tháng (~${avgGapDays.toFixed(1)} ngày/video)`;
    }
  } else {
    frequencyText = 'N/A (Không đủ video)';
  }

  // Activity Status
  if (N >= 2) {
    // Đảm bảo kênh cần dừng ít nhất 3 ngày để coi là inactive nếu tần suất quá dày
    const threshold = Math.max(avgGapDays * 3, 3); 
    if (latestDays > threshold) {
      status = 'inactive';
    } else {
      status = 'active';
    }
  } else {
    status = 'active';
  }

  let latestVideoDateText = latestVideo.exactDate || latestVideo.publishDate || 'N/A';
  if (latestVideo.exactDate || latestDays === 0) {
    latestVideoDateText += ` (~${Math.round(latestDays)} ngày trước)`;
  }

  return {
    frequencyText,
    latestVideoDateText,
    status,
    latestVideoUrl: videos[0].url || '',
    latestVideoTitle: videos[0].title || ''
  };
}

/**
 * Scrape a single YouTube channel.
 */
async function scrapeChannel(channelUrl, seenIds = new Set()) {
  const browser = await initBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(30000);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    const targetUrl = normalizeChannelUrl(channelUrl);
    const domain = new URL(targetUrl).hostname;

    await page.setCookie({
      name: 'PREF',
      value: 'f6=40000000&hl=en',
      domain: '.' + domain.replace(/^www\./, ''),
      path: '/'
    });
    await page.setCookie({
      name: 'CONSENT',
      value: 'YES+cb',
      domain: '.' + domain.replace(/^www\./, ''),
      path: '/'
    });

    console.log('[Scraper] Navigating to:', targetUrl);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    const videoSelectors = [
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer',
      'yt-lockup-view-model'
    ];
    let selectorFound = false;
    for (const sel of videoSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 12000 });
        selectorFound = true;
        console.log('[Scraper] Found video selector:', sel);
        break;
      } catch { /* try next */ }
    }
    if (!selectorFound) {
      console.warn('[Scraper] No video element selectors matched');
    }

    await new Promise(r => setTimeout(r, 2000));

    try {
      await page.waitForSelector('#subscriber-count, #channel-name, ytd-channel-name', { timeout: 8000 });
    } catch {
      console.warn('[Scraper] Channel header not found within timeout');
    }
    await new Promise(r => setTimeout(r, 1000));

    // ---- Extract data ----
    const data = await page.evaluate(() => {
      let channelName = '';
      const nameSelectors = [
        'yt-dynamic-text-view-model h1',
        '#channel-name yt-formatted-string',
        'ytd-channel-name yt-formatted-string',
        '#text.ytd-channel-name',
        'h1'
      ];
      for (const sel of nameSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          channelName = el.textContent.trim();
          break;
        }
      }

      let subscriberCount = '';
      const subSelectors = [
        '#subscriber-count',
        'yt-formatted-string#subscriber-count',
        '#channel-header #subscriber-count',
        '#channel-header-container #subscriber-count',
        '#inner-header-container #subscriber-count',
        'ytd-c4-tabbed-header-renderer #subscriber-count'
      ];
      for (const sel of subSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim() && el.textContent.trim().match(/\d/)) {
          subscriberCount = el.textContent.trim();
          break;
        }
      }
      if (!subscriberCount) {
        const subPattern = /[\d.,]+\s*[KMBTkm]?\s*(subscribers?|người đăng ký|abonnés?|Abonnenten?|подписчик\w*|登録者|구독자|iscritti|suscriptores?)/i;
        const allEls = document.querySelectorAll('yt-formatted-string, .yt-core-attributed-string, span');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text && text.length < 60 && subPattern.test(text)) {
            subscriberCount = text;
            break;
          }
        }
      }
      if (!subscriberCount) {
        const subLinePattern = /[\d.,]+\s*[KMBTkm]?\s*(subscribers?|người đăng ký|abonnés?|Abonnenten?|подписчик|登録者|구독자)/i;
        const pageText = document.body ? document.body.innerText : '';
        const lines = pageText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && trimmed.length < 60 && subLinePattern.test(trimmed)) {
            subscriberCount = trimmed;
            break;
          }
        }
      }

      let channelDescription = '';
      const descSelectors = [
        '#channel-tagline yt-formatted-string',
        '#channel-tagline .yt-core-attributed-string',
        '#channel-tagline',
        'yt-formatted-string#channel-header-tagline',
        '#channel-header ytd-channel-tagline-renderer yt-formatted-string',
        '#channel-header ytd-channel-tagline-renderer .yt-core-attributed-string',
        'ytd-channel-tagline-renderer #channel-tagline',
        'ytd-channel-tagline-renderer .yt-core-attributed-string',
        'ytd-channel-tagline-renderer',
        'meta[property="og:description"]',
        'meta[name="description"]'
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (sel.startsWith('meta[')) {
          const content = el.getAttribute('content') || '';
          if (content && content.length > 5) {
            channelDescription = content;
            break;
          }
        } else {
          const text = el.textContent.trim();
          if (text && text.length > 3) {
            channelDescription = text;
            break;
          }
        }
      }

      let channelLink = window.location.href
        .split('?')[0]
        .replace(/\/(videos|shorts|streams|about|community|featured)\/?$/, '');

      // ── Total Video Count ─────────────────────────────────────────────
      let totalVideoCountText = '';
      // Strategy 1: Look for "XXX videos" pattern in channel header area
      const headerMeta = document.querySelectorAll(
        '#channel-header yt-formatted-string, ' +
        '#channel-header-container yt-formatted-string, ' +
        'yt-content-metadata-view-model span, ' +
        '#inner-header-container yt-formatted-string, ' +
        '.yt-content-metadata-view-model-wiz__metadata-text span, ' +
        '.yt-content-metadata-view-model-wiz__metadata-text'
      );
      const videoCountPattern = /[\d.,]+[KMBkmb]?\s*(videos?|video)/i;
      for (const el of headerMeta) {
        const text = el.textContent.trim();
        if (text && text.length < 40 && videoCountPattern.test(text)) {
          totalVideoCountText = text;
          break;
        }
      }
      // Strategy 2: Scan page text for "XXX videos" near subscriber info
      if (!totalVideoCountText) {
        const pageText = document.body ? document.body.innerText : '';
        const lines = pageText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && trimmed.length < 40 && videoCountPattern.test(trimmed)) {
            totalVideoCountText = trimmed;
            break;
          }
        }
      }

      const TIME_PATTERN = /(\d+\s*(second|minute|hour|day|week|month|year|giây|phút|giờ|ngày|tuần|tháng|năm|秒|分|時間|日|週間|ヶ月|年|초|분|시간|일|주|개월|년|секунд|минут|час|дн|недел|месяц|год|Sekunde|Minute|Stunde|Tag|Woche|Monat|Jahr|segundo|minuto|hora|día|semana|mes|año|seconde|heure|jour|semaine|mois|an)s?\s*(ago|trước|前|전|назад|her|hace|il y a|fa|geleden|sedan|temu|önce|lalu|yang lalu)?)|((streamed|Streamed|Premiered|premiered)\s+\d+\s*(second|minute|hour|day|week|month|year)s?\s*ago)/i;

      const videos = [];
      const seen = new Set();
      const lockupItems = document.querySelectorAll(
        'yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer'
      );

      for (const item of lockupItems) {
        if (videos.length >= 20) break;
        const link = item.querySelector('a[href*="watch?v="]');
        if (!link) continue;
        let href = link.href || link.getAttribute('href');
        if (!href) continue;
        const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (!idMatch) continue;
        const videoId = idMatch[1];
        if (seen.has(videoId)) continue;
        seen.add(videoId);

        const url = 'https://www.youtube.com/watch?v=' + videoId;

        let title = '';
        const titleSels = ['a#video-title', '#video-title', 'a#video-title-link', 'h3 a', 'h3', '[id*="video-title"]'];
        for (const tSel of titleSels) {
          const tEl = item.querySelector(tSel);
          if (tEl && tEl.textContent.trim()) { title = tEl.textContent.trim(); break; }
        }
        if (!title && link.title) title = link.title;
        if (!title && link.textContent.trim()) title = link.textContent.trim();
        if (!title && link.getAttribute('aria-label')) title = link.getAttribute('aria-label');

        // ── Duration from thumbnail overlay ────────────────────────────
        let duration = '';
        // Strategy 1: Direct selectors for time overlay
        const durationSels = [
          'ytd-thumbnail-overlay-time-status-renderer #text',
          'ytd-thumbnail-overlay-time-status-renderer span',
          'ytd-thumbnail-overlay-time-status-renderer',
          '.badge-shape-wiz--thumbnail-overlay .badge-shape-wiz__text',
          '.badge-shape-wiz--thumbnail-overlay',
          '[overlay-style="DEFAULT"] #text',
          '[overlay-style="DEFAULT"]'
        ];
        const DURATION_RE = /\b(\d{1,3}:\d{2}(?::\d{2})?)\b/;
        for (const dSel of durationSels) {
          const dEl = item.querySelector(dSel);
          if (dEl) {
            const dText = (dEl.textContent || '').trim();
            const dMatch = dText.match(DURATION_RE);
            if (dMatch) {
              duration = dMatch[1];
              break;
            }
          }
        }
        // Strategy 2: aria-label on time status renderer (e.g. "12 minutes, 34 seconds")
        if (!duration) {
          const ariaEl = item.querySelector(
            'ytd-thumbnail-overlay-time-status-renderer[aria-label], ' +
            '[overlay-style="DEFAULT"][aria-label]'
          );
          if (ariaEl) {
            const label = ariaEl.getAttribute('aria-label') || '';
            const hrs  = label.match(/(\d+)\s*hour/i);
            const mins = label.match(/(\d+)\s*minute/i);
            const secs = label.match(/(\d+)\s*second/i);
            let totalSec = 0;
            if (hrs)  totalSec += parseInt(hrs[1])  * 3600;
            if (mins) totalSec += parseInt(mins[1]) * 60;
            if (secs) totalSec += parseInt(secs[1]);
            if (totalSec > 0) {
              const h = Math.floor(totalSec / 3600);
              const m = Math.floor((totalSec % 3600) / 60);
              const s = totalSec % 60;
              duration = h > 0
                ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                : `${m}:${String(s).padStart(2, '0')}`;
            }
          }
        }
        // Strategy 3: Scan thumbnail area for any time-like text
        if (!duration) {
          const thumbArea = item.querySelector('ytd-thumbnail, #thumbnail, a#thumbnail');
          if (thumbArea) {
            const thumbText = (thumbArea.innerText || thumbArea.textContent || '').trim();
            const tMatch = thumbText.match(DURATION_RE);
            if (tMatch) duration = tMatch[1];
          }
        }
        // Strategy 4: Scan full item text for time pattern (last resort)
        if (!duration) {
          const fullText = item.innerText || '';
          const lines = fullText.split('\n');
          for (const line of lines) {
            const t = line.trim();
            // Only match short lines that look like a pure duration
            if (t && t.length <= 10 && DURATION_RE.test(t)) {
              const m = t.match(DURATION_RE);
              if (m) { duration = m[1]; break; }
            }
          }
        }

        // ── View count from metadata ───────────────────────────────────
        let viewCountText = '';
        const VIEW_PATTERN = /([\d.,]+[KMBkmb]?)\s*(views?|lượt xem|Aufrufe|vues?|visualizzazioni|reproducci|просмотр|再生|조회|次觀看|次观看)/i;
        const allTextEls = item.querySelectorAll(
          'span, .inline-metadata-item, #metadata-line span, ' +
          '#metadata-line yt-formatted-string, yt-formatted-string, ' +
          '.yt-lockup-metadata-view-model-wiz__metadata span, ' +
          '.yt-lockup-metadata-view-model-wiz__metadata div'
        );
        for (const el of allTextEls) {
          const text = el.textContent.trim();
          if (text && text.length < 80 && VIEW_PATTERN.test(text)) {
            const vMatch = text.match(VIEW_PATTERN);
            if (vMatch) { viewCountText = vMatch[1].trim(); break; }
          }
        }
        if (!viewCountText) {
          const innerText = item.innerText || '';
          const lines = innerText.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && trimmed.length < 80 && VIEW_PATTERN.test(trimmed)) {
              const vMatch = trimmed.match(VIEW_PATTERN);
              if (vMatch) { viewCountText = vMatch[1].trim(); break; }
            }
          }
        }

        // ── Publish date ───────────────────────────────────────────────
        let publishDate = '';
        for (const el of allTextEls) {
          const text = el.textContent.trim();
          if (text && text.length < 80 && TIME_PATTERN.test(text)) {
            const timeMatch = text.match(TIME_PATTERN);
            if (timeMatch) { publishDate = timeMatch[0].trim(); break; }
          }
        }
        if (!publishDate) {
          const innerText = item.innerText || '';
          const lines = innerText.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && trimmed.length < 80 && TIME_PATTERN.test(trimmed)) {
              const timeMatch = trimmed.match(TIME_PATTERN);
              if (timeMatch) { publishDate = timeMatch[0].trim(); break; }
            }
          }
        }

        videos.push({ url, title, publishDate, duration, viewCountText });
      }

      if (videos.length < 20) {
        const allLinks = document.querySelectorAll('a[href*="watch?v="]');
        for (const link of allLinks) {
          if (videos.length >= 20) break;
          const href = link.href || link.getAttribute('href');
          const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (!idMatch) continue;
          const videoId = idMatch[1];
          if (seen.has(videoId)) continue;
          seen.add(videoId);

          let publishDate = '';
          let duration = '';
          let viewCountText = '';
          const parent = link.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, yt-lockup-view-model');
          if (parent) {
            const innerText = parent.innerText || '';
            const lines = innerText.split('\n');
            const DURATION_RE_FB = /\b(\d{1,3}:\d{2}(?::\d{2})?)\b/;
            const VIEW_PATTERN_FB = /([\d.,]+[KMBkmb]?)\s*(views?|lượt xem|Aufrufe|vues?|visualizzazioni|reproducci|просмотр|再生|조회|次觀看|次观看)/i;
            for (const line of lines) {
              const trimmed = line.trim();
              if (!publishDate && trimmed && trimmed.length < 80 && TIME_PATTERN.test(trimmed)) {
                const timeMatch = trimmed.match(TIME_PATTERN);
                if (timeMatch) publishDate = timeMatch[0].trim();
              }
              if (!duration && trimmed && trimmed.length <= 10 && DURATION_RE_FB.test(trimmed)) {
                const dMatch = trimmed.match(DURATION_RE_FB);
                if (dMatch) duration = dMatch[1];
              }
              if (!viewCountText && trimmed && trimmed.length < 80 && VIEW_PATTERN_FB.test(trimmed)) {
                const vMatch = trimmed.match(VIEW_PATTERN_FB);
                if (vMatch) viewCountText = vMatch[1].trim();
              }
            }
          }

          videos.push({
            url: 'https://www.youtube.com/watch?v=' + videoId,
            title: link.title || link.textContent.trim() || '',
            publishDate,
            duration,
            viewCountText
          });
        }
      }

      let channelId = '';
      const urlMatch = channelLink.match(/\/(UC[a-zA-Z0-9_-]{22})/);
      if (urlMatch) {
        channelId = urlMatch[1];
      }
      if (!channelId) {
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
          const cMatch = (canonical.href || '').match(/\/(UC[a-zA-Z0-9_-]{22})/);
          if (cMatch) channelId = cMatch[1];
        }
      }

      const htmlLang = document.documentElement.lang || '';

      // Debug: log duration/views per video
      const debugInfo = videos.map((v, i) => `  [${i}] dur=${v.duration || 'MISS'} views=${v.viewCountText || 'MISS'}`);
      console.log('[Scraper-Debug] Video metrics:\n' + debugInfo.join('\n'));

      return { channelName, channelLink, channelId, subscriberCount, channelDescription, videos, htmlLang, totalVideoCountText };
    });

    // Check duplicate channel ID early to avoid fetching 20 video dates
    if (data.channelId && seenIds.has(data.channelId)) {
      throw new Error(`DUPLICATE_CHANNEL:${data.channelId}`);
    }

    if (!data.subscriberCount) {
      console.warn('[Scraper] Subscriber count not found for', data.channelName);
      const subFallback = await page.evaluate(() => {
        const el = document.querySelector('#subscriber-count');
        const info = {
          exists: !!el,
          text: el ? el.textContent.trim() : null,
          html: el ? el.outerHTML.substring(0, 200) : null
        };
        const matches = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent.trim();
          if (text && text.length < 80 && /subscri|đăng ký/i.test(text)) {
            matches.push(text);
            if (matches.length >= 5) break;
          }
        }
        info.textMatches = matches;
        return info;
      }).catch(() => null);

      if (subFallback) {
        console.log('[Scraper] Debug subscriber info:', JSON.stringify(subFallback));
        if (subFallback.text && subFallback.text.match(/\d/)) {
          data.subscriberCount = subFallback.text;
          console.log('[Scraper] Recovered subscriber count:', data.subscriberCount);
        } else if (subFallback.textMatches && subFallback.textMatches.length > 0) {
          data.subscriberCount = subFallback.textMatches[0];
          console.log('[Scraper] Recovered from text walker:', data.subscriberCount);
        }
      }
    }

    // --- Fetch exact dates for all videos ---
    console.log(`[Scraper] Fetching exact dates for ${data.videos.length} videos...`);
    const fetchPromises = data.videos.map(async (v) => {
      v.exactDate = await fetchVideoDate(v.url);
    });
    await Promise.all(fetchPromises);

    // --- Language Detection ---
    const titles = data.videos.map(v => v.title).filter(Boolean);
    let lang;

    const textsForDetection = [];
    if (data.channelDescription && data.channelDescription.length > 3) {
      for (let i = 0; i < 3; i++) textsForDetection.push(data.channelDescription);
      console.log('[Scraper] Channel desc:', data.channelDescription.substring(0, 80));
    }
    if (data.channelName) {
      for (let i = 0; i < 3; i++) textsForDetection.push(data.channelName);
    }
    textsForDetection.push(...titles);

    lang = detectLanguage(textsForDetection);

    // ── Calculate video count, avg duration, avg views ──────────────
    const totalVideoCount = parseTotalVideoCount(data.totalVideoCountText);
    const totalVideoCountDisplay = totalVideoCount > 0 ? totalVideoCount.toLocaleString() : (data.totalVideoCountText || 'N/A');

    // Average duration from up to 20 videos
    const durationsInSeconds = data.videos
      .map(v => parseDuration(v.duration))
      .filter(d => d > 0);
    const avgDurationSeconds = durationsInSeconds.length > 0
      ? durationsInSeconds.reduce((a, b) => a + b, 0) / durationsInSeconds.length
      : 0;
    const avgDurationText = formatDuration(avgDurationSeconds);

    // Average views from up to 20 videos
    const viewCounts = data.videos
      .map(v => parseViewCount(v.viewCountText))
      .filter(v => v > 0);
    const avgViews = viewCounts.length > 0
      ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length)
      : 0;
    const avgViewsText = formatViewCount(avgViews);

    console.log(
      '[Scraper] Done - Channel:', data.channelName,
      '| ID:', data.channelId || 'N/A',
      '| Subs:', data.subscriberCount || 'N/A',
      '| Total Videos:', totalVideoCountDisplay,
      '| Avg Duration:', avgDurationText,
      '| Avg Views:', avgViewsText,
      '| Videos scraped:', data.videos.length,
      '| Lang:', lang.name
    );

    // Calculate advanced metrics
    const metrics = calculateChannelMetrics(data.videos);

    const subNum = parseSubscribers(data.subscriberCount);
    const isActive = metrics.status === 'active';
    let priorityText = '';
    let priorityClass = '';

    if (!isActive && subNum < 10000) {
      priorityText = 'Ưu tiên Cao';
      priorityClass = 'priority-high';
    } else if (!isActive && subNum >= 10000) {
      priorityText = 'Ưu tiên Trung bình';
      priorityClass = 'priority-medium';
    } else if (isActive && subNum < 10000) {
      priorityText = 'Ưu tiên Thấp';
      priorityClass = 'priority-low';
    } else if (isActive && subNum >= 10000) {
      priorityText = 'Hạn chế';
      priorityClass = 'priority-limited';
    }

    return {
      channelName: data.channelName,
      channelLink: data.channelLink,
      channelId: data.channelId,
      subscriberCount: data.subscriberCount,
      totalVideoCount: totalVideoCountDisplay,
      avgDurationSeconds,
      avgDurationText,
      avgViews,
      avgViewsText,
      videos: data.videos,
      language: lang.name,
      languageCode: lang.code,
      frequencyText: metrics.frequencyText,
      latestVideoDateText: metrics.latestVideoDateText,
      status: metrics.status,
      latestVideoUrl: metrics.latestVideoUrl,
      latestVideoTitle: metrics.latestVideoTitle,
      priorityText,
      priorityClass
    };
  } catch (err) {
    console.error('[Scraper] Error scraping ' + channelUrl + ':', err.message);
    throw err;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

module.exports = { initBrowser, closeBrowser, scrapeChannel };