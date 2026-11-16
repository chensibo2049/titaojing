#!/usr/bin/env bash
# 手动制品部署；只上传 dist，不配置 nginx、证书或 CI 凭据。
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:-quan2}"
if [[ "$HOST" != quan2 ]]; then
  printf '本项目只允许 SSH 别名 quan2\n' >&2
  exit 1
fi
node scripts/检查无3D构建.mjs dist
BUILD_ID="$(node -p 'JSON.parse(require("fs").readFileSync("dist/version.json", "utf8")).buildId')"
[[ "$BUILD_ID" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{8}$ ]]
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$BUILD_ID"
BASE=/opt/static-sites/openpodium
MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT
python3 -I - "$PWD/dist" "$MANIFEST" <<'PY'
from pathlib import Path
import hashlib, sys
root = Path(sys.argv[1])
with open(sys.argv[2], 'w') as out:
    for p in sorted(root.rglob('*')):
        if p.is_file():
            out.write(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.relative_to(root).as_posix() + '\n')
PY
ssh "$HOST" "set -eu; mkdir -p '$BASE/releases' '$BASE/manifests'; mkdir '$BASE/releases/$RELEASE'"
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -cf - . | ssh "$HOST" "tar --no-same-owner -xf - -C '$BASE/releases/$RELEASE'"
scp "$MANIFEST" "$HOST:$BASE/manifests/$RELEASE.sha256"
ssh "$HOST" bash -s -- "$BASE" "$RELEASE" <<'REMOTE'
set -euo pipefail
BASE="$1"
RELEASE="$2"
cd "$BASE/releases/$RELEASE"
sha256sum --check "$BASE/manifests/$RELEASE.sha256"
python3 - "$BASE/manifests/$RELEASE.sha256" <<'PY'
from pathlib import Path
import sys
expected = {line.rstrip('\n').split('  ', 1)[1] for line in Path(sys.argv[1]).read_text().splitlines()}
actual = {p.as_posix()[2:] if p.as_posix().startswith('./') else p.as_posix() for p in Path('.').rglob('*') if p.is_file()}
if actual != expected or any(p.is_symlink() for p in Path('.').rglob('*')):
    raise SystemExit('文件列表与制品清单不一致，拒绝切换')
print('文件列表与制品清单完全一致')
PY
find . -type d -exec chmod 755 {} +
find . -type f -exec chmod 644 {} +
cd "$BASE"
# 保留旧版本软链，切换内容不需要 reload nginx。
if [[ -e current && ! -L current ]]; then
  printf 'current 不是软链，拒绝覆盖\n' >&2
  exit 1
fi
if [[ -L current ]]; then
  OLD="$(readlink current)"
  [[ "$OLD" == releases/* && -d "$OLD" ]]
  ln -s "$OLD" "previous.$RELEASE"
  mv -Tf "previous.$RELEASE" previous
fi
ln -s "releases/$RELEASE" "current.$RELEASE"
mv -Tf "current.$RELEASE" current
printf 'ACTIVE=%s\n' "$(readlink current)"
REMOTE
printf '已切换 %s：%s（需另行完成 HTTPS 健康验收）\n' "$HOST" "$RELEASE"
