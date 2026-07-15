FROM python:3.11-slim

WORKDIR /app

COPY services/motion-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Wire-format schema shared with the TS packages
COPY packages/protocol/schemas/messages.json /app/protocol/messages.json
ENV PROTOCOL_SCHEMA=/app/protocol/messages.json

COPY services/motion-service/motion_service ./motion_service

ENV MOTION_SERVICE_PORT=8791 \
    MOTION_BACKEND=auto \
    MOTION_FPS=30

EXPOSE 8791
HEALTHCHECK --interval=15s --timeout=3s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8791/health')"

CMD ["python", "-m", "motion_service.server"]
