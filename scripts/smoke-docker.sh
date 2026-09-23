#!/usr/bin/env bash
# Exercise the actual production image with disposable storage.
set -euo pipefail
image=${1:?Usage: smoke-docker.sh IMAGE}
container=$(docker run -d --read-only \
  --tmpfs /tmp:rw,nosuid,size=512m \
  --tmpfs /data:rw,nosuid,uid=65532,gid=65532,size=128m \
  -p 127.0.0.1::3000 "$image")
cleanup() {
  docker logs "$container"
  docker rm -f "$container" >/dev/null
}
trap cleanup EXIT
port=$(docker port "$container" 3000/tcp | head -1 | cut -d: -f2)
python3 - "$port" <<'PY'
import sys, time, urllib.request
base = 'http://127.0.0.1:' + sys.argv[1]
for attempt in range(60):
    try:
        with urllib.request.urlopen(base + '/healthz', timeout=2) as response:
            assert response.status == 200
        break
    except (OSError, AssertionError):
        if attempt == 59:
            raise
        time.sleep(1)
for path, expected in [
    ('/settings/pdf-templates', b'Pipa'),
    ('/public/template-editor.mjs', None),
    ('/public/template-formatter.worker.mjs', None),
    ('/public/template-author-reference.txt', b'React PDF'),
    ('/settings/pdf-templates/1/sample.pdf', b'%PDF-'),
]:
    with urllib.request.urlopen(base + path, timeout=30) as response:
        body = response.read()
        assert response.status == 200 and len(body) > 1000, path
        if expected:
            assert expected in body, path
    print('PASS', path)
PY
