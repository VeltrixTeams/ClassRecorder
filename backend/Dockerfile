FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

ARG MODE=api
ENV MODE=${MODE}

CMD ["sh", "-c", "if [ \"$MODE\" = worker ]; then python -m app.pipeline.worker; else uvicorn app.main:app --host 0.0.0.0 --port 8000; fi"]
