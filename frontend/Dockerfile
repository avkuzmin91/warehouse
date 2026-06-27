FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_APP_TITLE="Pack-men"
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

RUN npm run build

EXPOSE 80

CMD ["./node_modules/.bin/serve", "-s", "dist", "-l", "80"]
