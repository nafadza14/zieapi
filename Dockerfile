FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production PORT=8787 ZIE_DATA_FILE=/data/zieapi.json
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "src/index.js"]
