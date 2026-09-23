FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 VOICE_ROUTER_HOST=0.0.0.0 VOICE_ROUTER_STATIC_DIR=/app/frontend/dist VOICE_ROUTER_DATASET_DIR=/app/data/voice_router_dataset
WORKDIR /app
COPY pyproject.toml ./
COPY backend/ ./backend/
RUN pip install --no-cache-dir .
COPY data/voice_router_dataset/ ./data/voice_router_dataset/
COPY --from=frontend /app/frontend/dist/ ./frontend/dist/
RUN useradd --system --uid 10001 --gid nogroup voice-router && chown -R voice-router:nogroup /app
USER voice-router
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=2).read()'
CMD ["python", "-m", "voice_router.server"]
