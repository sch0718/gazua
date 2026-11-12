FROM node:22-alpine AS build
WORKDIR /app
RUN echo '{"private":true,"type":"module"}' > package.json \
 && npm install --no-audit --no-fund --no-package-lock --ignore-scripts esbuild@0.25.12
COPY proxy/build.mjs ./proxy/build.mjs
COPY proxy/src ./proxy/src
COPY proxy/node ./proxy/node
COPY src ./src
RUN node proxy/build.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/proxy/dist ./dist
RUN echo '{"type":"module"}' > package.json
USER node
EXPOSE 8787
CMD ["node", "dist/node/server.js"]
