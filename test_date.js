const https = require('https');

https.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const match = data.match(/<meta itemprop="datePublished" content="([^"]+)">/);
    console.log('Date published:', match ? match[1] : 'Not found');
  });
});
