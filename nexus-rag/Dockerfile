# Stage 1: Builder
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies if strictly necessary
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Create venv and install dependencies
RUN python -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install dependencies (CPU version of torch)
RUN pip install --no-cache-dir -r requirements.txt --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple

# Selective cleanup to avoid breaking dependencies like numpy
RUN find /app/venv -name "__pycache__" -type d -exec rm -rf {} + && \
    rm -rf /app/venv/lib/python3.11/site-packages/pip && \
    rm -rf /app/venv/lib/python3.11/site-packages/setuptools && \
    rm -rf /app/venv/lib/python3.11/site-packages/triton

# Stage 2: Runtime
FROM python:3.11-slim

WORKDIR /app

# Copy virtual env from builder
COPY --from=builder /app/venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Copy application code
COPY . .

# Expose port
# Expose port
EXPOSE 8000

# Run the app
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
