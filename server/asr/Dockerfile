FROM python:3.11-slim@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
RUN pip install --no-cache-dir --only-binary=:all: sherpa-onnx==1.12.40 numpy==2.2.6
WORKDIR /app
COPY service.py worker.py /app/
USER 65534:65534
EXPOSE 8766
CMD ["python", "-I", "/app/service.py"]
