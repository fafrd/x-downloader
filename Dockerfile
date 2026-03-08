FROM node:20-slim

# Install Python, pip, and gallery-dl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg \
    && pip3 install --break-system-packages gallery-dl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8080

CMD ["node", "backend/server.js"]
