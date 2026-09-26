FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd --system --uid 10001 research && mkdir /app/storage && chown research /app/storage
USER research
ENV PORT=8000 STORAGE_DIR=/app/storage PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
