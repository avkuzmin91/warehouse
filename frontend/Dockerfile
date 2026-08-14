FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund && test -x node_modules/.bin/tsc

COPY . .

ARG VITE_APP_TITLE="Pack-men"
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
