/**
 * Language Detector Module — v2 (Script-Aware)
 *
 * Strategy:
 *  1. Analyse the Unicode script profile of the combined text.
 *  2. If a non-Latin script dominates (>20% of letters), map it
 *     directly to the language. This is highly reliable.
 *  3. For Latin-script text, use `tinyld` but REJECT impossible
 *     results (e.g. tinyld claiming Latin text is Hindi).
 *  4. Fallback: if tinyld is unsure, default to English for Latin text.
 */

const { detect } = require('tinyld');

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
  'zh': '中文 (Chinese)', 'zu': 'isiZulu (Zulu)'
};

// Languages that use Latin script — tinyld results MUST be in this
// set when the input text is predominantly Latin.
const LATIN_SCRIPT_LANGUAGES = new Set([
  'af', 'az', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'en', 'es', 'et',
  'eu', 'fi', 'fr', 'ga', 'gl', 'ha', 'hr', 'hu', 'id', 'is', 'it',
  'jv', 'ku', 'la', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'ro',
  'sk', 'sl', 'so', 'sq', 'su', 'sv', 'sw', 'tl', 'tr', 'uz', 'vi',
  'yo', 'zu'
]);

// ── Unicode script profiling ──────────────────────────────────────
function getScriptProfile(text) {
  const counts = {
    latin: 0,
    devanagari: 0,   // Hindi, Marathi, Nepali, Sanskrit
    arabic: 0,        // Arabic, Urdu, Persian
    cyrillic: 0,      // Russian, Ukrainian, Bulgarian, Serbian
    cjk: 0,           // Chinese
    hangul: 0,         // Korean
    kana: 0,           // Japanese (Hiragana + Katakana)
    thai: 0,
    bengali: 0,
    tamil: 0,
    telugu: 0,
    kannada: 0,
    malayalam: 0,
    gujarati: 0,
    gurmukhi: 0,       // Punjabi
    georgian: 0,
    armenian: 0,
    hebrew: 0,
    myanmar: 0,
    khmer: 0,
    sinhala: 0,
    greek: 0,
    ethiopic: 0,       // Amharic
  };

  let letterCount = 0;

  for (const char of text) {
    const c = char.codePointAt(0);
    // Skip spaces, digits, punctuation
    if (c <= 0x40) continue;

    // Latin (Basic + Extended)
    if ((c >= 0x0041 && c <= 0x024F) || (c >= 0x1E00 && c <= 0x1EFF)) {
      counts.latin++; letterCount++;
    }
    // Devanagari
    else if (c >= 0x0900 && c <= 0x097F) { counts.devanagari++; letterCount++; }
    // Bengali
    else if (c >= 0x0980 && c <= 0x09FF) { counts.bengali++; letterCount++; }
    // Gurmukhi (Punjabi)
    else if (c >= 0x0A00 && c <= 0x0A7F) { counts.gurmukhi++; letterCount++; }
    // Gujarati
    else if (c >= 0x0A80 && c <= 0x0AFF) { counts.gujarati++; letterCount++; }
    // Tamil
    else if (c >= 0x0B80 && c <= 0x0BFF) { counts.tamil++; letterCount++; }
    // Telugu
    else if (c >= 0x0C00 && c <= 0x0C7F) { counts.telugu++; letterCount++; }
    // Kannada
    else if (c >= 0x0C80 && c <= 0x0CFF) { counts.kannada++; letterCount++; }
    // Malayalam
    else if (c >= 0x0D00 && c <= 0x0D7F) { counts.malayalam++; letterCount++; }
    // Sinhala
    else if (c >= 0x0D80 && c <= 0x0DFF) { counts.sinhala++; letterCount++; }
    // Thai
    else if (c >= 0x0E01 && c <= 0x0E5B) { counts.thai++; letterCount++; }
    // Myanmar (Burmese)
    else if (c >= 0x1000 && c <= 0x109F) { counts.myanmar++; letterCount++; }
    // Georgian
    else if (c >= 0x10A0 && c <= 0x10FF) { counts.georgian++; letterCount++; }
    // Ethiopic (Amharic)
    else if (c >= 0x1200 && c <= 0x137F) { counts.ethiopic++; letterCount++; }
    // Khmer
    else if (c >= 0x1780 && c <= 0x17FF) { counts.khmer++; letterCount++; }
    // Greek
    else if (c >= 0x0370 && c <= 0x03FF) { counts.greek++; letterCount++; }
    // Cyrillic
    else if (c >= 0x0400 && c <= 0x04FF) { counts.cyrillic++; letterCount++; }
    // Armenian
    else if (c >= 0x0530 && c <= 0x058F) { counts.armenian++; letterCount++; }
    // Hebrew
    else if (c >= 0x0590 && c <= 0x05FF) { counts.hebrew++; letterCount++; }
    // Arabic (+ Urdu, Persian)
    else if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0xFB50 && c <= 0xFDFF)) {
      counts.arabic++; letterCount++;
    }
    // Hiragana
    else if (c >= 0x3040 && c <= 0x309F) { counts.kana++; letterCount++; }
    // Katakana
    else if (c >= 0x30A0 && c <= 0x30FF) { counts.kana++; letterCount++; }
    // CJK Unified Ideographs
    else if (c >= 0x4E00 && c <= 0x9FFF) { counts.cjk++; letterCount++; }
    // Hangul
    else if (c >= 0xAC00 && c <= 0xD7AF) { counts.hangul++; letterCount++; }
    // Other non-ASCII letters
    else if (c > 0x7F) { letterCount++; }
  }

  return { counts, letterCount };
}

// ── Script → language mapping (for non-Latin dominant scripts) ──
const SCRIPT_LANGUAGE_MAP = {
  devanagari: { code: 'hi', name: 'हिन्दी (Hindi)' },
  arabic:     { code: 'ar', name: 'العربية (Arabic)' },
  cyrillic:   { code: 'ru', name: 'Русский (Russian)' },
  cjk:        { code: 'zh', name: '中文 (Chinese)' },
  hangul:     { code: 'ko', name: '한국어 (Korean)' },
  kana:       { code: 'ja', name: '日本語 (Japanese)' },
  thai:       { code: 'th', name: 'ไทย (Thai)' },
  bengali:    { code: 'bn', name: 'বাংলা (Bengali)' },
  tamil:      { code: 'ta', name: 'தமிழ் (Tamil)' },
  telugu:     { code: 'te', name: 'తెలుగు (Telugu)' },
  kannada:    { code: 'kn', name: 'ಕನ್ನಡ (Kannada)' },
  malayalam:  { code: 'ml', name: 'മലയാളം (Malayalam)' },
  gujarati:   { code: 'gu', name: 'ગુજરાતી (Gujarati)' },
  gurmukhi:   { code: 'pa', name: 'ਪੰਜਾਬੀ (Punjabi)' },
  georgian:   { code: 'ka', name: 'ქართული (Georgian)' },
  armenian:   { code: 'hy', name: 'Հայերեն (Armenian)' },
  hebrew:     { code: 'he', name: 'עברית (Hebrew)' },
  myanmar:    { code: 'my', name: 'မြန်မာ (Burmese)' },
  khmer:      { code: 'km', name: 'ខ្មែរ (Khmer)' },
  sinhala:    { code: 'si', name: 'සිංහල (Sinhala)' },
  greek:      { code: 'el', name: 'Ελληνικά (Greek)' },
  ethiopic:   { code: 'am', name: 'Amharic' },
};

// ── Main detection function ───────────────────────────────────────

/**
 * Detect the language of the given texts (e.g. video titles).
 *
 * @param {string[]} texts - Array of strings to analyze
 * @returns {{ code: string, name: string }}
 */
function detectLanguage(texts) {
  const combined = texts.filter(t => t && t.trim()).join(' ').trim();

  if (!combined || combined.length < 3) {
    return { code: 'unknown', name: 'Unknown' };
  }

  // Step 1: Script-profile analysis
  const { counts, letterCount } = getScriptProfile(combined);

  if (letterCount === 0) {
    return { code: 'unknown', name: 'Unknown' };
  }

  // Step 2: Check for dominant non-Latin scripts (threshold: 20%)
  const threshold = 0.20;
  for (const [script, langInfo] of Object.entries(SCRIPT_LANGUAGE_MAP)) {
    if ((counts[script] || 0) / letterCount >= threshold) {
      console.log(`[LangDetect] Script "${script}" dominant (${counts[script]}/${letterCount}) → ${langInfo.name}`);
      return langInfo;
    }
  }

  // Step 3: Text is predominantly Latin – use tinyld but validate
  const latinRatio = counts.latin / letterCount;

  if (latinRatio >= 0.70) {
    try {
      const langCode = detect(combined);

      // GUARD: if tinyld returns a non-Latin-script language for
      // text that is >70% Latin characters, that's a false positive.
      if (!LATIN_SCRIPT_LANGUAGES.has(langCode)) {
        console.log(`[LangDetect] tinyld returned "${langCode}" for Latin text – overriding to English`);
        return { code: 'en', name: 'English' };
      }

      const name = LANGUAGE_NAMES[langCode] || langCode;
      console.log(`[LangDetect] tinyld → ${langCode} (${name}) [Latin text, valid]`);
      return { code: langCode, name };
    } catch (err) {
      console.error('[LangDetect] tinyld failed:', err.message);
      return { code: 'en', name: 'English' };
    }
  }

  // Step 4: Mixed or ambiguous – try tinyld as-is
  try {
    const langCode = detect(combined);
    const name = LANGUAGE_NAMES[langCode] || langCode;
    console.log(`[LangDetect] tinyld (mixed) → ${langCode} (${name})`);
    return { code: langCode, name };
  } catch {
    return { code: 'unknown', name: 'Unknown' };
  }
}

module.exports = { detectLanguage, LANGUAGE_NAMES };
