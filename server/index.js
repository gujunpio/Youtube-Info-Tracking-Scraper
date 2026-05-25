/**
 * YouTube Channel Scraper – Express Server
 *
 * Endpoints:
 *   POST /api/scrape   – Accepts { channels: [...] }, streams progress via SSE
 *   POST /api/export/csv   – Accepts { results: [...] }, returns CSV download
 *   POST /api/export/excel – Accepts { results: [...] }, returns XLSX download
 *
 * Static files are served from the /public directory.
 */

const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const { initBrowser, closeBrowser, scrapeChannel } = require('./scraper');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// CORS – allow any origin (fine for a local tool)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Body parser – 10 MB limit for large export payloads
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// POST /api/scrape – SSE-streamed scraping
// ---------------------------------------------------------------------------
app.post('/api/scrape', async (req, res) => {
  const { channels } = req.body;

  if (!channels || !Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of channel URLs.' });
  }

  // ---------- SSE headers ----------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  /** Helper to push a single SSE data frame */
  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // ---------- Sequential processing ----------
  const results = [];

  for (let i = 0; i < channels.length; i++) {
    // Stop if the client disconnected
    if (req.socket.destroyed) break;

    sendEvent({
      type: 'progress',
      current: i + 1,
      total: channels.length,
      channel: channels[i]
    });

    try {
      const result = await scrapeChannel(channels[i]);
      results.push(result);
      sendEvent({ type: 'result', data: result });
    } catch (err) {
      console.error(`[Server] Scrape failed for ${channels[i]}:`, err.message);
      sendEvent({
        type: 'error',
        channel: channels[i],
        message: err.message
      });
    }

    // Small delay between channels to avoid rate-limiting
    if (i < channels.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  sendEvent({ type: 'done', results });
  res.end();
});

// ---------------------------------------------------------------------------
// POST /api/export/csv
// ---------------------------------------------------------------------------
app.post('/api/export/csv', (req, res) => {
  const { results } = req.body;

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Please provide a results array.' });
  }

  const headers = [
    'Tên kênh',
    'Channel ID',
    'Link kênh',
    'Video #1',
    'Video #2',
    'Video #3',
    'Thời gian #1',
    'Thời gian #2',
    'Thời gian #3',
    'Ngôn ngữ',
    'Subscribers'
  ];

  // BOM for UTF-8 Excel compatibility
  let csv = '\uFEFF' + headers.join(',') + '\n';

  results.forEach((r) => {
    const row = [
      `"${(r.channelName || '').replace(/"/g, '""')}"`,
      r.channelId || '',
      r.channelLink || '',
      r.videos?.[0]?.url || '',
      r.videos?.[1]?.url || '',
      r.videos?.[2]?.url || '',
      `"${(r.videos?.[0]?.publishDate || '').replace(/"/g, '""')}"`,
      `"${(r.videos?.[1]?.publishDate || '').replace(/"/g, '""')}"`,
      `"${(r.videos?.[2]?.publishDate || '').replace(/"/g, '""')}"`,
      `"${(r.language || 'Unknown').replace(/"/g, '""')}"`,
      `"${(r.subscriberCount || 'N/A').replace(/"/g, '""')}"`
    ];
    csv += row.join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=youtube_channels.csv');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// POST /api/export/excel
// ---------------------------------------------------------------------------
app.post('/api/export/excel', async (req, res) => {
  const { results } = req.body;

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Please provide a results array.' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('YouTube Channels');

    // Column definitions
    sheet.columns = [
      { header: 'Tên kênh', key: 'channelName', width: 25 },
      { header: 'Channel ID', key: 'channelId', width: 28 },
      { header: 'Link kênh', key: 'channelLink', width: 35 },
      { header: 'Video gần nhất #1', key: 'video1', width: 40 },
      { header: 'Video gần nhất #2', key: 'video2', width: 40 },
      { header: 'Video gần nhất #3', key: 'video3', width: 40 },
      { header: 'Thời gian đăng #1', key: 'time1', width: 20 },
      { header: 'Thời gian đăng #2', key: 'time2', width: 20 },
      { header: 'Thời gian đăng #3', key: 'time3', width: 20 },
      { header: 'Ngôn ngữ', key: 'language', width: 15 },
      { header: 'Subscribers', key: 'subscribers', width: 20 }
    ];

    // Style the header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1a1a2e' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Populate data rows
    results.forEach((r) => {
      sheet.addRow({
        channelName: r.channelName || '',
        channelId: r.channelId || '',
        channelLink: r.channelLink || '',
        video1: r.videos?.[0]?.url || '',
        video2: r.videos?.[1]?.url || '',
        video3: r.videos?.[2]?.url || '',
        time1: r.videos?.[0]?.publishDate || '',
        time2: r.videos?.[1]?.publishDate || '',
        time3: r.videos?.[2]?.publishDate || '',
        language: r.language || 'Unknown',
        subscribers: r.subscriberCount || 'N/A'
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=youtube_channels.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Server] Excel export error:', err.message);
    res.status(500).json({ error: 'Failed to generate Excel file.' });
  }
});

// ---------------------------------------------------------------------------
// Global error-handling middleware
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start server & graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`\n🚀  YouTube Channel Scraper running at  http://localhost:${PORT}\n`);
});

// Pre-launch the browser so the first scrape is faster
initBrowser().catch((err) =>
  console.error('[Server] Failed to pre-launch browser:', err.message)
);

// Graceful shutdown – close Puppeteer browser
const shutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received – shutting down…`);
  await closeBrowser();
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server.close hangs
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
