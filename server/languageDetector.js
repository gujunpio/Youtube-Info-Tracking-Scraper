/**
 * Language Detector Module — v3 (CLD3-based)
 *
 * Uses Google's CLD3 (Compact Language Detector 3) — the same engine
 * Chrome/Chromium uses to detect page language for its "Translate" feature.
 *
 * Strategy:
 *  1. Load the CLD3 WASM module once (singleton).
 *  2. Detect language of EACH text individually (not concatenated).
 *  3. Use majority voting across all detections to determine the
 *     channel's primary language.
 *  4. Ignore unreliable detections (low probability or "und").
 */

const { loadModule } = require('cld3-asm');

// ── Singleton CLD3 language identifier ─────────────────────────────
let cld3Identifier = null;
let cld3Loading = null;

async function getCLD3() {
  if (cld3Identifier) return cld3Identifier;
  if (cld3Loading) return cld3Loading;

  cld3Loading = loadModule().then(factory => {
    // factory.create(minBytes, maxBytes) creates a language identifier
    // minBytes=0: detect even very short text
    // maxBytes=512: max bytes to consider per text
    cld3Identifier = factory.create(0, 512);
    console.log('[LangDetect] CLD3 WASM language identifier created successfully');
    return cld3Identifier;
  });

  return cld3Loading;
}

// ── Language name map ──────────────────────────────────────────────
const LANGUAGE_NAMES = {
  'af': 'Afrikaans', 'am': 'Amharic', 'ar': 'العربية (Arabic)',
  'az': 'Azərbaycan (Azerbaijani)', 'be': 'Беларуская (Belarusian)',
  'bg': 'Български (Bulgarian)', 'bn': 'বাংলা (Bengali)',
  'bs': 'Bosanski', 'ca': 'Català (Catalan)',
  'cs': 'Čeština (Czech)', 'cy': 'Cymraeg (Welsh)',
  'da': 'Dansk (Danish)', 'de': 'Deutsch (German)',
  'el': 'Ελληνικά (Greek)', 'en': 'English',
  'es': 'Español (Spanish)', 'et': 'Eesti (Estonian)',
  'eu': 'Euskara (Basque)', 'fa': 'فارسی (Persian)',
  'fi': 'Suomi (Finnish)', 'fr': 'Français (French)',
  'ga': 'Gaeilge (Irish)', 'gl': 'Galego (Galician)',
  'gu': 'ગુજરાતી (Gujarati)', 'ha': 'Hausa',
  'he': 'עברית (Hebrew)', 'hi': 'हिन्दी (Hindi)',
  'hr': 'Hrvatski (Croatian)', 'hu': 'Magyar (Hungarian)',
  'hy': 'Հայերեն (Armenian)', 'id': 'Bahasa Indonesia',
  'is': 'Íslenska (Icelandic)', 'it': 'Italiano (Italian)',
  'ja': '日本語 (Japanese)', 'jv': 'Basa Jawa (Javanese)',
  'ka': 'ქართული (Georgian)', 'kk': 'Қазақша (Kazakh)',
  'km': 'ខ្មែរ (Khmer)', 'kn': 'ಕನ್ನಡ (Kannada)',
  'ko': '한국어 (Korean)', 'ku': 'Kurdî (Kurdish)',
  'la': 'Latina (Latin)', 'lt': 'Lietuvių (Lithuanian)',
  'lv': 'Latviešu (Latvian)', 'mk': 'Македонски (Macedonian)',
  'ml': 'മലയാളം (Malayalam)', 'mn': 'Монгол (Mongolian)',
  'mr': 'मराठी (Marathi)', 'ms': 'Bahasa Melayu (Malay)',
  'my': 'မြန်မာ (Burmese)', 'ne': 'नेपाली (Nepali)',
  'nl': 'Nederlands (Dutch)', 'no': 'Norsk (Norwegian)',
  'nb': 'Norsk Bokmål (Norwegian)', 'nn': 'Norsk Nynorsk (Norwegian)',
  'pa': 'ਪੰਜਾਬੀ (Punjabi)', 'pl': 'Polski (Polish)',
  'pt': 'Português (Portuguese)', 'ro': 'Română (Romanian)',
  'ru': 'Русский (Russian)', 'si': 'සිංහල (Sinhala)',
  'sk': 'Slovenčina (Slovak)', 'sl': 'Slovenščina (Slovenian)',
  'so': 'Soomaali (Somali)', 'sq': 'Shqip (Albanian)',
  'sr': 'Српски (Serbian)', 'su': 'Basa Sunda (Sundanese)',
  'sv': 'Svenska (Swedish)', 'sw': 'Kiswahili (Swahili)',
  'ta': 'தமிழ் (Tamil)', 'te': 'తెలుగు (Telugu)',
  'th': 'ไทย (Thai)', 'tl': 'Filipino (Tagalog)',
  'tr': 'Türkçe (Turkish)', 'uk': 'Українська (Ukrainian)',
  'ur': 'اردو (Urdu)', 'uz': "O'zbek (Uzbek)",
  'vi': 'Tiếng Việt (Vietnamese)', 'yo': 'Yorùbá',
  'zh': '中文 (Chinese)', 'zh-Latn': '中文 (Chinese)',
  'zu': 'isiZulu (Zulu)',
  'iw': 'עברית (Hebrew)',           // CLD3 uses 'iw' for Hebrew
  'fil': 'Filipino (Tagalog)',       // CLD3 uses 'fil' for Filipino
  'jw': 'Basa Jawa (Javanese)',      // CLD3 alternate code
};

// CLD3 sometimes returns alternate codes — normalize them
const CODE_ALIASES = {
  'iw': 'he',     // Hebrew
  'fil': 'tl',    // Filipino/Tagalog
  'jw': 'jv',     // Javanese
  'nb': 'no',     // Norwegian Bokmål → Norwegian
  'nn': 'no',     // Norwegian Nynorsk → Norwegian
  'zh-Latn': 'zh' // Chinese in Latin transcription
};

/**
 * Clean text for better detection:
 * - Remove URLs, hashtags, mentions, emojis, excessive punctuation
 * - Keep only meaningful language content
 */
function cleanTextForDetection(text) {
  if (!text) return '';
  return text
    // Remove URLs
    .replace(/https?:\/\/\S+/gi, '')
    // Remove hashtags
    .replace(/#\w+/g, '')
    // Remove @mentions
    .replace(/@\w+/g, '')
    // Remove emojis (common emoji ranges)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu, '')
    // Remove pipe/bullet separators common in titles
    .replace(/[|•·▪▸►]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect the language of the given texts using CLD3 majority voting.
 *
 * @param {string[]} texts - Array of strings to analyze (e.g. video titles)
 * @returns {Promise<{ code: string, name: string }>}
 */
async function detectLanguage(texts) {
  const identifier = await getCLD3();

  // Filter and clean texts
  const cleanedTexts = texts
    .map(t => cleanTextForDetection(t))
    .filter(t => t && t.length >= 5);  // need at least 5 chars for reliable detection

  if (cleanedTexts.length === 0) {
    console.log('[LangDetect] No valid texts to analyze');
    return { code: 'unknown', name: 'Unknown' };
  }

  // Detect language of each text individually
  const votes = {};      // langCode → count
  const scores = {};     // langCode → total probability
  let totalVotes = 0;

  for (const text of cleanedTexts) {
    try {
      const result = identifier.findLanguage(text);

      if (!result || result.language === 'und') continue;
      if (!result.is_reliable && result.probability < 0.5) continue;

      let langCode = result.language;

      // Normalize alternate codes
      if (CODE_ALIASES[langCode]) {
        langCode = CODE_ALIASES[langCode];
      }

      // Weight by reliability: reliable detections count more
      const weight = result.is_reliable ? 2 : 1;

      votes[langCode] = (votes[langCode] || 0) + weight;
      scores[langCode] = (scores[langCode] || 0) + result.probability * weight;
      totalVotes += weight;
    } catch (err) {
      console.error('[LangDetect] CLD3 error on text:', err.message);
    }
  }

  if (totalVotes === 0) {
    console.log('[LangDetect] No reliable detections from CLD3');
    return { code: 'unknown', name: 'Unknown' };
  }

  // Find the language with most votes
  let bestLang = 'unknown';
  let bestVotes = 0;
  let bestScore = 0;

  for (const [lang, voteCount] of Object.entries(votes)) {
    if (voteCount > bestVotes || (voteCount === bestVotes && (scores[lang] || 0) > bestScore)) {
      bestLang = lang;
      bestVotes = voteCount;
      bestScore = scores[lang] || 0;
    }
  }

  const avgConfidence = bestScore / bestVotes;
  const name = LANGUAGE_NAMES[bestLang] || bestLang;

  // Log the voting results for debugging
  const sortedVotes = Object.entries(votes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => `${lang}=${count}`)
    .join(', ');
  console.log(`[LangDetect] CLD3 votes: [${sortedVotes}] → ${bestLang} (${name}) confidence=${avgConfidence.toFixed(3)}`);

  return { code: bestLang, name };
}

/**
 * Synchronous wrapper for backward compatibility.
 * Detects language using CLD3 but blocks until complete.
 * 
 * NOTE: This is used when the caller hasn't been updated to use async.
 * The first call may be slow due to WASM loading.
 *
 * @param {string[]} texts - Array of strings to analyze
 * @returns {{ code: string, name: string }}
 */
function detectLanguageSync(texts) {
  // Use combined text approach as synchronous fallback
  // This shouldn't be called in normal flow — async detectLanguage is preferred
  console.warn('[LangDetect] detectLanguageSync called — consider using async detectLanguage');

  const combined = texts.filter(t => t && t.trim()).join(' ').trim();
  if (!combined || combined.length < 3) {
    return { code: 'unknown', name: 'Unknown' };
  }

  // Return a promise marker — caller must await
  return { code: 'unknown', name: 'Unknown (sync fallback)' };
}

module.exports = { detectLanguage, detectLanguageSync, LANGUAGE_NAMES };
