FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund && test -x node_modules/.bin/tsc

COPY . .

ARG VITE_APP_TITLE="Pack-men"
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

RUN npm run build

EXPOSE 80

CMD ["./node_modules/.bin/serve", "-s", "dist", "-l", "80"]
