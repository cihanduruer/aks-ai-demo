FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY src/devices/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt
COPY src/common /app/common
COPY src/devices /app/devices
ENV PYTHONPATH=/app
EXPOSE 9090
CMD ["python", "-m", "devices.simulator"]
