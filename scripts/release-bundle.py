"""Seal CI outputs and reject incomplete, modified, or wrong-commit releases."""
import hashlib
import json
import re
import sys
from pathlib import Path

ARCHIVES = [
    'pipa-linux-x64.tar.gz', 'pipa-linux-arm64.tar.gz',
    'pipa-windows-x64.zip', 'pipa-macos-x64.tar.gz', 'pipa-macos-arm64.tar.gz',
]
PAYLOADS = ARCHIVES + ['docker-image.tar']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def process(mode, directory, commit):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Expected a full commit SHA')
    root = Path(directory)
    hashes = {}
    for name in PAYLOADS:
        path = root / name
        if not path.is_file() or path.is_symlink() or not path.stat().st_size:
            raise ValueError(f'Missing or invalid release payload: {name}')
        hashes[name] = digest(path)
    checksums = ''.join(f'{hashes[name]}  {name}\n' for name in ARCHIVES)
    manifest = {'commit': commit, 'sha256': hashes}
    if mode == 'seal':
        (root / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (root / 'SHA256SUMS.txt').write_text(checksums)
    elif mode == 'verify':
        if json.loads((root / 'release-manifest.json').read_text()) != manifest:
            raise ValueError('Release payload hashes or source commit do not match')
        if (root / 'SHA256SUMS.txt').read_text() != checksums:
            raise ValueError('Download checksums do not match')
    else:
        raise ValueError('Expected seal or verify')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit('Usage: release-bundle.py seal|verify DIRECTORY COMMIT_SHA')
    process(*sys.argv[1:])
