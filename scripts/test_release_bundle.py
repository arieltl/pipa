import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('release-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class ReleaseBundleTest(unittest.TestCase):
    def test_rejects_wrong_commit_tampered_and_missing_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in bundle.PAYLOADS:
                (root / name).write_bytes(b'tested output')
            commit = 'a' * 40
            bundle.process('seal', root, commit)
            bundle.process('verify', root, commit)
            with self.assertRaises(ValueError):
                bundle.process('verify', root, 'b' * 40)
            (root / 'docker-image.tar').write_bytes(b'changed image')
            with self.assertRaises(ValueError):
                bundle.process('verify', root, commit)
            (root / 'docker-image.tar').unlink()
            with self.assertRaises(ValueError):
                bundle.process('verify', root, commit)

    def test_rejects_changed_download_checksums(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in bundle.PAYLOADS:
                (root / name).write_bytes(b'tested output')
            bundle.process('seal', root, 'a' * 40)
            (root / 'SHA256SUMS.txt').write_text('invalid')
            with self.assertRaises(ValueError):
                bundle.process('verify', root, 'a' * 40)
