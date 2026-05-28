FROM python:3.11-slim

WORKDIR /app

ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x /app/docker-start.sh

EXPOSE 8000

CMD ["/app/docker-start.sh"]
