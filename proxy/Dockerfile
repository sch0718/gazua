FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.json ./
RUN echo '{"private":true,"type":"module"}' > package.json \
 && npm install --no-audit --no-fund --no-package-lock --ignore-scripts typescript@5 @types/node@22
COPY src ./src
COPY node ./node
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
RUN echo '{"type":"module"}' > package.json
USER node
EXPOSE 8787
CMD ["node", "dist/node/server.js"]
