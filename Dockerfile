FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production PORT=8787 APIZIE_DATA_FILE=/data/apizie.json
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "src/index.js"]
