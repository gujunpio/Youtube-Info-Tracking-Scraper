# 🎬 YouTube Info Tracking Scraper

A standalone web application that scrapes YouTube channel information including recent videos, publish dates, subscriber counts, and auto-detects channel language — all running in Docker with Puppeteer.

## ✨ Features

| Column | Data |
|--------|------|
| Tên kênh | Channel name |
| Channel ID | YouTube Channel ID (UC...) |
| Link kênh | Channel URL |
| Video #1–#3 | 3 most recent video URLs |
| Thời gian #1–#3 | Publish dates (relative time) |
| Ngôn ngữ | Auto-detected channel language |
| Subscribers | Subscriber count |

### Key Capabilities

- 🔄 **Batch processing** — Input multiple channel URLs, processed sequentially
- 📊 **Export to CSV/Excel** — Download results as `.csv` or `.xlsx`
- 🌍 **Multi-language detection** — Unicode script profiling + n-gram analysis (supports 50+ languages)
- 🛡️ **Anti-auto-translate** — Uses channel description (never translated by YouTube) as primary language signal
- 📡 **Real-time progress** — Server-Sent Events (SSE) for live scraping updates
- 🐳 **Docker ready** — One command to deploy

## 🚀 Quick Start

### Docker (Recommended)

```bash
docker-compose up -d --build
```

Open **http://localhost:3000** in your browser.

### Local Development

```bash
npm install
npm run dev
```

> Requires Node.js 20+ and Chromium installed locally.

## 🏗️ Architecture

```
├── server/
│   ├── index.js              # Express server (API + SSE + exports)
│   ├── scraper.js            # Puppeteer-based YouTube scraper
│   └── languageDetector.js   # Unicode script profiling + tinyld
├── public/
│   ├── index.html            # Frontend UI
│   ├── app.js                # Client-side logic
│   └── style.css             # Dark theme styling
├── Dockerfile                # Docker image with Chromium
├── docker-compose.yml        # Container orchestration
└── package.json
```

## 🌐 Language Detection Strategy

The language detector uses a **3-signal approach** to handle YouTube's auto-translation:

1. **Channel Description** (highest weight) — YouTube never auto-translates this
2. **Channel Name** (high weight) — Also never translated
3. **Video Titles** (lowest weight) — May be auto-translated by YouTube

Detection method:
- **Unicode Script Profiling**: Checks character scripts (Hangul → Korean, Devanagari → Hindi, CJK → Chinese, etc.)
- **tinyld n-gram analysis**: For Latin-script text, with guards against false positives

## 📦 Tech Stack

- **Backend**: Node.js + Express
- **Scraping**: Puppeteer + Chromium
- **Language Detection**: tinyld + custom Unicode script profiling
- **Export**: ExcelJS (XLSX), native CSV
- **Frontend**: Vanilla HTML/CSS/JS
- **Container**: Docker + dumb-init

## 🔧 Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `PUPPETEER_EXECUTABLE_PATH` | auto | Path to Chromium binary |

## 📝 License

MIT
