# CUDA 12.1 + cuDNN base; SB3/PyTorch RL training on A100 GPU.
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python3

WORKDIR /app
COPY src/rl/requirements.txt /app/requirements.txt
RUN python -m pip install --upgrade pip && \
    pip install --extra-index-url https://download.pytorch.org/whl/cu121 -r /app/requirements.txt

COPY src/common /app/common
COPY src/rl /app/rl

ENV PYTHONPATH=/app
EXPOSE 9090
CMD ["python", "-m", "rl.worker"]
