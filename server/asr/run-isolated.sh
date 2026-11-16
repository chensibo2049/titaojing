#!/bin/sh
# Run on quan2 only after uploading the reviewed service sources and verified model data.
set -eu
BASE=/opt/openpodium-asr-20261117
test "$(hostname)" = s187-151
test -f "$BASE/secrets/access.sha256"
printf '%s  %s\n' \
  3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec "$BASE/models/model.int8.onnx" \
  4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa "$BASE/models/tokens.txt" | sha256sum -c -
docker run -d --name openpodium-asr-20261117 --restart=no \
  --cpus=1 --memory=768m --memory-swap=768m --pids-limit=48 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --log-driver=none --ulimit nofile=128:128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --publish 127.0.0.1:8766:8766 \
  --mount type=bind,src="$BASE/app",dst=/app,readonly \
  --mount type=bind,src="$BASE/models",dst=/models,readonly \
  --mount type=bind,src="$BASE/secrets/access.sha256",dst=/run/secrets/access.sha256,readonly \
  --env ASR_ORIGIN=https://openpodium.chensibo.cn \
  openpodium-asr:20261117
