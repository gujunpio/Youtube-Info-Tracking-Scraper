FROM node:20-slim

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-khmeros \
    fonts-kacst \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium (skip downloading bundled Chromium)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY server/ ./server/
COPY public/ ./public/

# Create non-root user for security
RUN groupadd -r scraper && useradd -r -g scraper -G audio,video scraper \
    && mkdir -p /home/scraper/.cache /home/scraper/.local /tmp/chromium-crashpad \
    && chown -R scraper:scraper /home/scraper /app /tmp/chromium-crashpad

USER scraper

EXPOSE 3000

# Use dumb-init to properly handle signals (SIGTERM, SIGINT)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
