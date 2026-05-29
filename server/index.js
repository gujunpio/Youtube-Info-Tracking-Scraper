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
  const seenChannelIds = new Set();

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
      const result = await scrapeChannel(channels[i], seenChannelIds);
      if (result.channelId) {
        seenChannelIds.add(result.channelId);
      }
      results.push(result);
      sendEvent({ type: 'result', data: result });
    } catch (err) {
      console.error(`[Server] Scrape failed for ${channels[i]}:`, err.message);
      
      let msg = err.message;
      if (msg && msg.startsWith('DUPLICATE_CHANNEL:')) {
        const dupId = msg.split(':')[1];
        msg = `Bỏ qua (Trùng lặp kênh: ${dupId})`;
      }
      
      sendEvent({
        type: 'error',
        channel: channels[i],
        message: msg
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
    'Số video',
    'Thời lượng TB',
    'Lượt xem TB',
    'Ngôn ngữ',
    'Subscribers',
    'Tần suất đăng',
    'Video mới nhất',
    'Thời gian đăng mới nhất',
    'Trạng thái',
    'Mức độ ưu tiên'
  ];

  // BOM for UTF-8 Excel compatibility
  let csv = '\uFEFF' + headers.join(',') + '\n';

  results.forEach((r) => {
    const row = [
      `"${(r.channelName || '').replace(/"/g, '""')}"`,
      r.channelId || '',
      r.channelLink || '',
      `"${(r.totalVideoCount || 'N/A').replace(/"/g, '""')}"`,
      `"${(r.avgDurationText || 'N/A').replace(/"/g, '""')}"`,
      `"${(r.avgViewsText || 'N/A').replace(/"/g, '""')}"`,
      `"${(r.language || 'Unknown').replace(/"/g, '""')}"`,
      `"${(r.subscriberCount || 'N/A').replace(/"/g, '""')}"`,
      `"${(r.frequencyText || '').replace(/"/g, '""')}"`,
      r.latestVideoUrl || '',
      `"${(r.latestVideoDateText || '').replace(/"/g, '""')}"`,
      r.status === 'active' ? 'Hoạt động' : 'Dừng hoạt động',
      `"${(r.priorityText || 'N/A').replace(/"/g, '""')}"`
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
      { header: 'Số video', key: 'totalVideoCount', width: 15 },
      { header: 'Thời lượng TB', key: 'avgDuration', width: 15 },
      { header: 'Lượt xem TB', key: 'avgViews', width: 15 },
      { header: 'Ngôn ngữ', key: 'language', width: 15 },
      { header: 'Subscribers', key: 'subscribers', width: 20 },
      { header: 'Tần suất đăng', key: 'frequency', width: 35 },
      { header: 'Video mới nhất', key: 'latestVideo', width: 45 },
      { header: 'Thời gian đăng', key: 'latestDate', width: 30 },
      { header: 'Trạng thái', key: 'status', width: 20 },
      { header: 'Mức độ ưu tiên', key: 'priority', width: 25 }
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
      const row = sheet.addRow({
        channelName: r.channelName || '',
        channelId: r.channelId || '',
        channelLink: r.channelLink || '',
        totalVideoCount: r.totalVideoCount || 'N/A',
        avgDuration: r.avgDurationText || 'N/A',
        avgViews: r.avgViewsText || 'N/A',
        language: r.language || 'Unknown',
        subscribers: r.subscriberCount || 'N/A',
        frequency: r.frequencyText || '',
        latestVideo: r.latestVideoUrl || '',
        latestDate: r.latestVideoDateText || '',
        status: r.status === 'active' ? 'Hoạt động' : 'Dừng hoạt động',
        priority: r.priorityText || 'N/A'
      });

      const statusCell = row.getCell('status');
      if (r.status === 'active') {
        statusCell.font = { color: { argb: 'FF00C853' }, bold: true };
      } else {
        statusCell.font = { color: { argb: 'FFFF1744' }, bold: true };
      }

      const priorityCell = row.getCell('priority');
      if (r.priorityClass === 'priority-high') {
        priorityCell.font = { color: { argb: 'FF00C853' }, bold: true };
      } else if (r.priorityClass === 'priority-medium') {
        priorityCell.font = { color: { argb: 'FFFF9100' }, bold: true };
      } else if (r.priorityClass === 'priority-low') {
        priorityCell.font = { color: { argb: 'FF00B0FF' }, bold: true };
      } else if (r.priorityClass === 'priority-limited') {
        priorityCell.font = { color: { argb: 'FF9E9E9E' }, bold: true };
      }
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
