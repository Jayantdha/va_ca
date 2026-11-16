FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js adapters.js index.js admin.js ./
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/va_ca.db UPLOAD_DIR=/data/uploads TRUST_PROXY=1
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node","index.js"]
