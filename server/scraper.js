/**
 * YouTube Channel Scraper Module
 * Uses Puppeteer to scrape channel info, recent videos, and subscriber count.
 */

const puppeteer = require('puppeteer');
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
 * Scrape a single YouTube channel.
 */
async function scrapeChannel(channelUrl) {
  const browser = await initBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(30000);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // CRITICAL: Prevent YouTube from auto-translating video titles.
    // Setting PREF cookie with 'hl=en' alone isn't enough — YouTube uses
    // the auto-translate feature based on the user's language.
    // We set cookies to disable auto-translation and request original titles.
    const targetUrl = normalizeChannelUrl(channelUrl);
    const domain = new URL(targetUrl).hostname;

    await page.setCookie({
      name: 'PREF',
      value: 'f6=40000000&hl=en',  // f6=40000000 disables auto-translate
      domain: '.' + domain.replace(/^www\./, ''),
      path: '/'
    });
    // Also set CONSENT cookie to skip consent screen
    await page.setCookie({
      name: 'CONSENT',
      value: 'YES+cb',
      domain: '.' + domain.replace(/^www\./, ''),
      path: '/'
    });

    console.log('[Scraper] Navigating to:', targetUrl);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait for video elements to load
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

    // Wait for rendering
    await new Promise(r => setTimeout(r, 2000));

    // Wait for channel header (subscriber count lives here)
    try {
      await page.waitForSelector('#subscriber-count, #channel-name, ytd-channel-name', { timeout: 8000 });
    } catch {
      console.warn('[Scraper] Channel header not found within timeout');
    }
    await new Promise(r => setTimeout(r, 1000));

    // ---- Extract data ----
    const data = await page.evaluate(() => {
      // --- Channel name ---
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

      // --- Subscriber count ---
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
      // Fallback: search text nodes for subscriber patterns
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
      // Ultra-fallback: scan page text
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

      // --- Channel description / tagline ---
      // This text is NEVER auto-translated by YouTube, so it's the
      // most reliable signal for language detection.
      let channelDescription = '';
      const descSelectors = [
        // Tagline / short description visible on channel page
        '#channel-tagline yt-formatted-string',
        '#channel-tagline .yt-core-attributed-string',
        '#channel-tagline',
        // Channel header description
        'yt-formatted-string#channel-header-tagline',
        '#channel-header ytd-channel-tagline-renderer yt-formatted-string',
        '#channel-header ytd-channel-tagline-renderer .yt-core-attributed-string',
        // About snippet in header
        'ytd-channel-tagline-renderer #channel-tagline',
        'ytd-channel-tagline-renderer .yt-core-attributed-string',
        'ytd-channel-tagline-renderer',
        // Meta description tag (always in original language)
        'meta[property="og:description"]',
        'meta[name="description"]'
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        // For meta tags, use content attribute
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

      // --- Channel link ---
      let channelLink = window.location.href
        .split('?')[0]
        .replace(/\/(videos|shorts|streams|about|community|featured)\/?$/, '');

      // --- Time regex ---
      const TIME_PATTERN = /(\d+\s*(second|minute|hour|day|week|month|year|giây|phút|giờ|ngày|tuần|tháng|năm|秒|分|時間|日|週間|ヶ月|年|초|분|시간|일|주|개월|년|секунд|минут|час|дн|недел|месяц|год|Sekunde|Minute|Stunde|Tag|Woche|Monat|Jahr|segundo|minuto|hora|día|semana|mes|año|seconde|heure|jour|semaine|mois|an)s?\s*(ago|trước|前|전|назад|her|hace|il y a|fa|geleden|sedan|temu|önce|lalu|yang lalu)?)|((streamed|Streamed|Premiered|premiered)\s+\d+\s*(second|minute|hour|day|week|month|year)s?\s*ago)/i;

      // --- Videos ---
      const videos = [];
      const seen = new Set();

      const lockupItems = document.querySelectorAll(
        'yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer'
      );

      for (const item of lockupItems) {
        if (videos.length >= 3) break;
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

        // Title
        let title = '';
        const titleSels = ['a#video-title', '#video-title', 'a#video-title-link', 'h3 a', 'h3', '[id*="video-title"]'];
        for (const tSel of titleSels) {
          const tEl = item.querySelector(tSel);
          if (tEl && tEl.textContent.trim()) { title = tEl.textContent.trim(); break; }
        }
        if (!title && link.title) title = link.title;
        if (!title && link.textContent.trim()) title = link.textContent.trim();
        if (!title && link.getAttribute('aria-label')) title = link.getAttribute('aria-label');

        // Publish date - scan all text elements
        let publishDate = '';
        const allTextEls = item.querySelectorAll(
          'span, .inline-metadata-item, #metadata-line span, ' +
          '#metadata-line yt-formatted-string, yt-formatted-string, ' +
          '.yt-lockup-metadata-view-model-wiz__metadata span, ' +
          '.yt-lockup-metadata-view-model-wiz__metadata div'
        );
        for (const el of allTextEls) {
          const text = el.textContent.trim();
          if (text && text.length < 80 && TIME_PATTERN.test(text)) {
            const timeMatch = text.match(TIME_PATTERN);
            if (timeMatch) { publishDate = timeMatch[0].trim(); break; }
          }
        }
        // Fallback: innerText of entire item
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

        videos.push({ url, title, publishDate });
      }

      // Fallback: generic link search
      if (videos.length < 3) {
        const allLinks = document.querySelectorAll('a[href*="watch?v="]');
        for (const link of allLinks) {
          if (videos.length >= 3) break;
          const href = link.href || link.getAttribute('href');
          const idMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (!idMatch) continue;
          const videoId = idMatch[1];
          if (seen.has(videoId)) continue;
          seen.add(videoId);

          let publishDate = '';
          const parent = link.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, yt-lockup-view-model');
          if (parent) {
            const innerText = parent.innerText || '';
            const lines = innerText.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && trimmed.length < 80 && TIME_PATTERN.test(trimmed)) {
                const timeMatch = trimmed.match(TIME_PATTERN);
                if (timeMatch) { publishDate = timeMatch[0].trim(); break; }
              }
            }
          }

          videos.push({
            url: 'https://www.youtube.com/watch?v=' + videoId,
            title: link.title || link.textContent.trim() || '',
            publishDate
          });
        }
      }

      // --- Extract channel ID from URL (UC...) ---
      let channelId = '';
      const urlMatch = channelLink.match(/\/(UC[a-zA-Z0-9_-]{22})/);
      if (urlMatch) {
        channelId = urlMatch[1];
      }
      // Also try from canonical link
      if (!channelId) {
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
          const cMatch = (canonical.href || '').match(/\/(UC[a-zA-Z0-9_-]{22})/);
          if (cMatch) channelId = cMatch[1];
        }
      }

      // --- Page language from HTML lang attribute ---
      const htmlLang = document.documentElement.lang || '';

      return { channelName, channelLink, channelId, subscriberCount, channelDescription, videos, htmlLang };
    });

    // Debug: if subscriber count still empty, try one more time
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

    // Language detection — multi-signal approach:
    // Signal 1 (strongest): Channel description (NEVER auto-translated)
    // Signal 2: Channel name (NEVER auto-translated)
    // Signal 3: Video titles (may be auto-translated by YouTube)
    const titles = data.videos.map(v => v.title).filter(Boolean);
    let lang;

    // Build detection text prioritizing description (most reliable signal)
    const textsForDetection = [];

    // Channel description — highest weight (repeat 3x)
    // YouTube does NOT auto-translate channel descriptions/taglines
    if (data.channelDescription && data.channelDescription.length > 3) {
      for (let i = 0; i < 3; i++) textsForDetection.push(data.channelDescription);
      console.log('[Scraper] Channel desc:', data.channelDescription.substring(0, 80));
    }

    // Channel name — high weight (repeat 3x)
    if (data.channelName) {
      for (let i = 0; i < 3; i++) textsForDetection.push(data.channelName);
    }

    // Video titles — lowest weight (may be auto-translated)
    textsForDetection.push(...titles);

    lang = detectLanguage(textsForDetection);

    console.log(
      '[Scraper] Done - Channel:', data.channelName,
      '| ID:', data.channelId || 'N/A',
      '| Subs:', data.subscriberCount || 'N/A',
      '| Videos:', data.videos.length,
      '| Lang:', lang.name
    );
    if (titles.length > 0) {
      console.log('[Scraper] Titles:', titles.map(t => t.substring(0, 50)).join(' | '));
    }

    return {
      channelName: data.channelName,
      channelLink: data.channelLink,
      channelId: data.channelId,
      subscriberCount: data.subscriberCount,
      videos: data.videos,
      language: lang.name,
      languageCode: lang.code
    };
  } catch (err) {
    console.error('[Scraper] Error scraping ' + channelUrl + ':', err.message);
    throw err;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

module.exports = { initBrowser, closeBrowser, scrapeChannel };