"""Stdlib-only black-box importer tests; fixtures never touch real submissions."""
import copy
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

# Loading the importer for fault injection must not write a real scripts/__pycache__.
sys.dont_write_bytecode = True

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/import-admin-submissions.py"
QA = Path("/mnt/hermes/backups/jid-admin-20261016T132643Z")


def png(width=1, height=1):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00\xff")) + chunk(b"IEND", b""))


def glb(document=None, binary=None):
    data = json.dumps(document or {"asset": {"version": "2.0"}}, separators=(",", ":")).encode()
    data += b" " * (-len(data) % 4)
    chunks = struct.pack("<I4s", len(data), b"JSON") + data
    if binary is not None:
        binary += b"\x00" * (-len(binary) % 4)
        chunks += struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks


def package(project_id="jd046"):
    image = png()
    manifest = {
        "schemaVersion": 1,
        "project": {"id": project_id, "title": "Example", "category": "Product", "thumbnail": "asset-1"},
        "blocks": [{"id": "block-1", "type": "images", "columns": 1,
                    "images": [{"assetId": "asset-1", "alt": "Red", "caption": ""}]}],
        "models": [],
        "assets": [{"id": "asset-1", "path": "assets/asset-1.png", "name": "original.png", "kind": "image",
                    "sha256": hashlib.sha256(image).hexdigest(), "bytes": len(image), "width": 1, "height": 1}],
    }
    return manifest, {"assets/asset-1.png": image}


class ImporterTests(unittest.TestCase):
    def setUp(self):
        base = os.environ.get("TMPDIR") or os.environ.get("RUNNER_TEMP") or str(QA)
        self.temp = tempfile.TemporaryDirectory(prefix="importer-", dir=base)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        legacy = self.root / "public/images/portfolio"
        legacy.mkdir(parents=True)
        self.legacy = legacy / "portfolio_data.json"
        self.legacy.write_text(json.dumps([{"id": "jd001", "folder": "jd001"}]))
        (legacy / "unchanged.bin").write_bytes(b"legacy-original\x00")
        (self.root / "admin-submissions").mkdir()

    def write_package(self, manifest, files, name=None, entries=None):
        path = self.root / "admin-submissions" / (name or manifest["project"]["id"] + ".zip")
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("project.json", json.dumps(manifest, ensure_ascii=False))
            for entry, data in (entries if entries is not None else files.items()):
                archive.writestr(entry, data)
        return path

    def run_importer(self, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn("error:", result.stderr.lower(), result.stderr)
        return result

    def registry(self):
        return json.loads((self.root / ".generated/admin-projects.json").read_text())

    def test_rejects_invalid_manifest_without_publishing(self):
        mutations = {
            "hash": lambda m: m["assets"][0].update(sha256="0" * 64),
            "length": lambda m: m["assets"][0].update(bytes=999),
            "bool-version": lambda m: m.update(schemaVersion=True),
            "bool-size": lambda m: m["assets"][0].update(bytes=True),
            "bool-columns": lambda m: m["blocks"][0].update(columns=True),
            "columns-zero": lambda m: m["blocks"][0].update(columns=0),
            "columns-five": lambda m: m["blocks"][0].update(columns=5),
            "empty-images": lambda m: m["blocks"][0].update(images=[]),
            "thirteen-images": lambda m: m["blocks"][0].update(images=m["blocks"][0]["images"] * 13),
            "missing-alt": lambda m: m["blocks"][0]["images"][0].pop("alt"),
            "long-alt": lambda m: m["blocks"][0]["images"][0].update(alt="x" * 301),
            "long-caption": lambda m: m["blocks"][0]["images"][0].update(caption="x" * 501),
            "blank-title": lambda m: m["project"].update(title="  "),
            "long-title": lambda m: m["project"].update(title="x" * 201),
            "unknown-category": lambda m: m["project"].update(category="Other"),
            "invalid-id": lambda m: m["project"].update(id="../../evil"),
            "non-ascii-id": lambda m: m["project"].update(id="jd０４６"),
            "bad-block-id": lambda m: m["blocks"][0].update(id="../bad"),
            "bad-asset-id": lambda m: m["assets"][0].update(id="../bad"),
            "missing-thumbnail": lambda m: m["project"].update(thumbnail="missing"),
            "missing-image": lambda m: m["blocks"][0]["images"][0].update(assetId="missing"),
            "unknown-field": lambda m: m.update(html="<script/>"),
            "unknown-block": lambda m: m["blocks"][0].update(type="html"),
            "duplicate-blocks": lambda m: m["blocks"].append(copy.deepcopy(m["blocks"][0])),
            "duplicate-assets": lambda m: m["assets"].append(copy.deepcopy(m["assets"][0])),
            "too-many-blocks": lambda m: m.update(blocks=[{"id": f"b{i}", "type": "divider"} for i in range(101)]),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                manifest, files = package()
                mutate(manifest)
                self.write_package(manifest, files, name="jd046.zip")
                self.run_importer(success=False)
                self.assertFalse((self.root / ".generated").exists())
                self.assertFalse((self.root / "public/_admin_media").exists())

    def test_mixed_blocks_and_near_text_boundaries(self):
        manifest, files = package()
        manifest["project"].update(title="x" * 200, category="UX/UI")
        manifest["blocks"][0].update(columns=4, images=manifest["blocks"][0]["images"] * 12)
        manifest["blocks"][0]["images"][0].update(alt="a" * 300, caption="c" * 500)
        second = copy.deepcopy(manifest["assets"][0])
        second.update(id="asset-2", path="assets/second.png")
        manifest["assets"].append(second)
        files[second["path"]] = files["assets/asset-1.png"]
        manifest["blocks"] += [
            {"id": "second-images", "type": "images", "columns": 2,
             "images": [{"assetId": "asset-2", "alt": "", "caption": ""}]},
            {"id": "h2", "type": "heading", "level": 2, "text": "h" * 200},
            {"id": "h3", "type": "heading", "level": 3, "text": "<b>Plain text, never HTML</b>"},
            {"id": "p", "type": "paragraph", "text": "한" * 10000},
            {"id": "s", "type": "spacer", "size": "medium"},
            {"id": "d", "type": "divider"},
        ]
        self.write_package(manifest, files)
        self.run_importer()
        blocks = self.registry()["projects"][0]["blocks"]
        self.assertEqual(len(blocks[0]["images"]), 12)
        self.assertEqual(blocks[2:], manifest["blocks"][2:])
        self.assertEqual(blocks[1]["images"][0]["width"], 1)

    def test_unsafe_zip_members_are_rejected(self):
        for unsafe in ('../escape.png', '/absolute.png', 'assets/../escape.png', 'assets\\escape.png',
                       'assets//double.png', 'assets/./dot.png', 'assets/a%2fb.png', 'assets/inside.zip',
                       'assets/', 'extra.txt', 'C:/drive.png'):
            with self.subTest(member=unsafe):
                manifest, files = package()
                self.write_package(manifest, files, entries=list(files.items()) + [(unsafe, b'extra')])
                self.run_importer(success=False)
                self.assertFalse((self.root / 'public/_admin_media').exists())

    def test_duplicate_zip_members_and_symlinks_are_rejected(self):
        import warnings
        import stat
        for mode in ('asset', 'manifest', 'symlink'):
            with self.subTest(mode=mode):
                manifest, files = package()
                path = self.write_package(manifest, files)
                with warnings.catch_warnings(), zipfile.ZipFile(path, 'a') as archive:
                    warnings.simplefilter('ignore', UserWarning)
                    if mode == 'asset':
                        archive.writestr('assets/asset-1.png', files['assets/asset-1.png'])
                    elif mode == 'manifest':
                        archive.writestr('project.json', json.dumps(manifest))
                    else:
                        info = zipfile.ZipInfo('assets/link.png')
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        archive.writestr(info, 'outside')
                self.run_importer(success=False)

    def test_json_duplicate_keys_nonfinite_and_bools_are_rejected(self):
        manifest, files = package()
        original = json.dumps(manifest)
        variants = [original.replace('"schemaVersion": 1', '"schemaVersion": 2, "schemaVersion": 1'),
                    original.replace('"width": 1', '"width": NaN'),
                    original.replace('"width": 1', '"width": Infinity'),
                    original.replace('"width": 1', '"width": 1e999'),
                    original.replace('"width": 1', '"width": true'),
                    original.replace('"width": 1', '"width": 1.0'),
                    original.replace('"title": "Example"', '"title": "Example", "title": "Duplicate"')]
        for index, value in enumerate(variants):
            with self.subTest(index=index):
                path = self.root / 'admin-submissions/jd046.zip'
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('project.json', value)
                    for name, data in files.items():
                        archive.writestr(name, data)
                self.run_importer(success=False)

    def test_canonical_package_filename_and_legacy_collisions(self):
        for project_id, filename in [('jd046', 'wrong.zip'), ('jd046', 'jd046.ZIP'),
                                     ('jd046', 'jd046_a.zip'), ('jd001', 'jd001.zip')]:
            with self.subTest(id=project_id, filename=filename):
                manifest, files = package(project_id)
                path = self.write_package(manifest, files, name=filename)
                self.run_importer(success=False)
                path.unlink()
        manifest, files = package('jd046_a')
        self.write_package(manifest, files)
        self.run_importer()
        self.assertEqual(self.registry()['projects'][0]['id'], 'jd046_a')

    def test_legacy_metadata_missing_or_corrupt_fails_closed(self):
        for content in (b'{}', b'[{}]', b'[{"id":"jd001","id":"jd002"}]', b'not json', None):
            with self.subTest(content=content):
                if content is None:
                    self.legacy.unlink()
                else:
                    self.legacy.write_bytes(content)
                self.run_importer(success=False)

    def test_extra_unreferenced_or_missing_assets_rejected(self):
        for mode in ('extra-file', 'unreferenced', 'missing', 'too-many-assets'):
            with self.subTest(mode=mode):
                manifest, files = package()
                if mode == 'extra-file':
                    files['assets/unreferenced.png'] = png()
                elif mode == 'unreferenced':
                    asset = copy.deepcopy(manifest['assets'][0])
                    asset.update(id='unused', path='assets/unused.png')
                    manifest['assets'].append(asset)
                    files[asset['path']] = png()
                elif mode == 'missing':
                    files.clear()
                else:
                    for i in range(60):
                        asset = copy.deepcopy(manifest['assets'][0])
                        asset.update(id=f'a{i}', path=f'assets/a{i}.png')
                        manifest['assets'].append(asset)
                        files[asset['path']] = png()
                self.write_package(manifest, files)
                self.run_importer(success=False)

    def test_zip_size_and_uncompressed_limits(self):
        manifest, files = package()
        path = self.write_package(manifest, files)
        with path.open('ab') as handle:
            handle.truncate(25 * 1024 * 1024 + 1)
        self.run_importer(success=False)
        path = self.write_package(manifest, files)
        # Highly compressible input must be rejected using central-directory lengths before inflation.
        with zipfile.ZipFile(path, 'a', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('assets/bomb.png', b'\x00' * (50 * 1024 * 1024))
        self.run_importer(success=False)

    def add_model(self, manifest, files, data=None, asset_id='model-1'):
        data = glb() if data is None else data
        path = f'assets/{asset_id}.glb'
        manifest['models'].append(asset_id)
        manifest['assets'].append({'id': asset_id, 'path': path, 'name': 'model.glb', 'kind': 'model',
                                   'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        files[path] = data

    def test_fix2_geometry_rejects_gpu_instancing(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix2_geometry_importer', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        extension = 'EXT_mesh_gpu_instancing'
        for declaration in ('extensionsUsed', 'extensionsRequired', 'node'):
            document = {'asset': {'version': '2.0'},
                        'accessors': [{'componentType': 5126, 'type': 'VEC3', 'count': 1_000_000}],
                        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}],
                        'nodes': [{'mesh': 0, **({'extensions': {extension: {'attributes': {'TRANSLATION': 0}}}}
                                               if declaration == 'node' else {})}] * 100}
            if declaration != 'node':
                document[declaration] = [extension]
            data = glb(document)
            self.assertLess(len(data), 20_000)
            with self.subTest(declaration=declaration), self.assertRaisesRegex(ValueError, 'unsupported|instancing'):
                module.validate_glb(data)

    def test_fix2_geometry_expansion_and_graph(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix2_graph_importer', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def document(nodes=2, primitives=1):
            return {'asset': {'version': '2.0'},
                    'accessors': [{'componentType': 5126, 'type': 'VEC3', 'count': 3}],
                    'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}] * primitives}],
                    'nodes': [{'mesh': 0} for _ in range(nodes)],
                    'scenes': [{'nodes': list(range(nodes))}]}

        probe = glb(document(1000, 1000))
        self.assertLess(len(probe), 60_000)
        with self.assertRaisesRegex(ValueError, '4096|expansion'):
            module.validate_glb(probe)
        base = document(1, 1000)
        for value in (
            dict(base, scenes=[{'nodes': [0]}] * 5),
            dict(base, scenes=[], nodes=[{'mesh': 0}] * 5),
            dict(base, scenes=[], nodes=[], meshes=base['meshes'] * 5),
            dict(document(0), nodes=[{}] * 4097),
            dict(document(0), nodes=[{}], scenes=[{'nodes': [0]}] * 4097),
            dict(document(0), meshes=document(0)['meshes'] * 1025),
            dict(document(0), nodes=[{}] * 2049, scenes=[{'nodes': list(range(2049))}] * 2),
            dict(document(1, 3000), meshes=document(1, 3000)['meshes'] + document(0, 1097)['meshes']),
        ):
            with self.subTest(budget=True), self.assertRaisesRegex(ValueError, '4096|1024|expansion'):
                module.validate_glb(glb(value))
        base = document()
        no_scenes = copy.deepcopy(base)
        no_scenes.pop('scenes')
        for value in (base, dict(base, scene=0), dict(base, scenes=[{'nodes': [0, 1]}] * 2),
                      {'asset': base['asset']}, no_scenes):
            module.validate_glb(glb(value))
        # Preserve the old maximum-count fixtures, now correctly rejected by
        # the independent aggregate metadata policy instead of silently waived.
        for value in (document(4096), document(1, 4096),
                      dict(document(1, 2048), scenes=[{'nodes': [0]}] * 2)):
            with self.subTest(metadata_budget=True), self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.validate_glb(glb(value))

        for reference in (True, False, None, -1, 0.5, '0', 99):
            for value in (
                dict(base, scene=reference),
                dict(base, nodes=[{'mesh': reference}]),
                dict(base, nodes=[{'children': [reference]}, {}]),
                dict(base, scenes=[{'nodes': [reference]}]),
                dict(base, meshes=[{'primitives': [{'attributes': {'POSITION': reference}}]}]),
                dict(base, meshes=[{'primitives': [{'attributes': {'POSITION': 0}, 'indices': reference}]}]),
                dict(base, meshes=[{'primitives': [{'attributes': {'POSITION': 0}, 'targets': [{'POSITION': reference}]}]}]),
            ):
                with self.subTest(reference=reference), self.assertRaisesRegex(ValueError, 'reference'):
                    module.validate_glb(glb(value))
        for nodes in ([{'children': [0]}], [{'children': [1]}, {'children': [0]}],
                      [{}, {'children': [2]}, {'children': [1]}],
                      [{'children': [1, 1]}, {}], [{'children': [2]}, {'children': [2]}, {}]):
            with self.subTest(nodes=nodes), self.assertRaisesRegex(ValueError, 'graph'):
                module.validate_glb(glb(dict(base, nodes=nodes, scenes=[])))
        for value in (dict(base, nodes=[{'children': [1]}, {}], scenes=[{'nodes': [1]}]),
                      dict(base, scenes=[{'nodes': [0, 0]}])):
            with self.assertRaisesRegex(ValueError, 'graph'):
                module.validate_glb(glb(value))
        for reverse in (False, True):
            for depth in (64, 65):
                nodes = []
                for i in range(depth):
                    child = i - 1 if reverse else i + 1
                    nodes.append({'children': [child]} if 0 <= child < depth else {})
                data = glb(dict(document(0), nodes=nodes, scenes=[]))
                if depth == 64:
                    module.validate_glb(data)
                else:
                    with self.subTest(reverse=reverse), self.assertRaisesRegex(ValueError, 'depth|64'):
                        module.validate_glb(data)
        for value in (
            dict(base, nodes=None), dict(base, meshes={}), dict(base, scenes=None),
            dict(base, nodes=[None]), dict(base, scenes=[None]), dict(base, meshes=[None]),
            dict(base, nodes=[{'children': None}]), dict(base, scenes=[{'nodes': None}]),
            dict(base, meshes=[{'primitives': None}]), dict(base, meshes=[{'primitives': []}]),
            dict(base, meshes=[{'primitives': [None]}]),
            dict(base, meshes=[{'primitives': [{'attributes': None}]}]),
        ):
            with self.subTest(malformed=True), self.assertRaises(ValueError):
                module.validate_glb(glb(value))

    def test_fix1_security_accessor_allocations_and_layout(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix1_security_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        base = {'componentType': 5126, 'type': 'VEC3', 'count': 1}
        for change in ({'count': 1_000_000_000}, {'count': 0}, {'count': True}, {'count': 1.5},
                       {'componentType': 999}, {'type': 'BAD'}, {'byteOffset': 1}, {'bufferView': 0}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_glb(glb({'asset': {'version': '2.0'}, 'accessors': [dict(base, **change)]}))
        document = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 16}],
                    'bufferViews': [{'buffer': 0, 'byteLength': 16}], 'accessors': [dict(base, bufferView=0)]}
        module.validate_glb(glb(document, bytes(16)))
        for change in ({'byteOffset': 2}, {'count': 2}):
            bad = copy.deepcopy(document)
            bad['accessors'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_glb(glb(bad, bytes(16)))
        for stride in (2, 10, 256):
            bad = copy.deepcopy(document)
            bad['bufferViews'][0]['byteStride'] = stride
            with self.subTest(stride=stride), self.assertRaises(ValueError):
                module.validate_glb(glb(bad, bytes(16)))
        with self.assertRaises(ValueError):
            module.validate_glb(glb({'asset': {'version': '2.0'}, 'accessors': [dict(base, count=1_000_000)] * 6}))

    def test_fix1_security_sparse_accessor_bounds(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix1_sparse_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        sparse = {'count': 1, 'indices': {'bufferView': 0, 'componentType': 5121}, 'values': {'bufferView': 1}}
        def model(value, binary=bytes(32)):
            return glb({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 32}],
                        'bufferViews': [{'buffer': 0, 'byteLength': 4}, {'buffer': 0, 'byteOffset': 4, 'byteLength': 28}],
                        'accessors': [{'componentType': 5126, 'type': 'VEC3', 'count': 2, 'sparse': value}]}, binary)
        module.validate_glb(model(sparse))
        for change in ({'count': 3}, {'indices': {'bufferView': 0, 'componentType': 5126}},
                       {'values': {'bufferView': 1, 'byteOffset': 20}}, {'count': 2}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_glb(model(dict(sparse, **change)))
        with self.assertRaises(ValueError):
            module.validate_glb(model(sparse, bytes([2]) + bytes(31)))

    def test_fix1_security_embedded_texture_validation(self):
        import base64
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix1_images_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        def model(data, mime='image/png', count=1, uri=False):
            binary = bytes(4) + data
            binary += bytes(-len(binary) % 4)
            buffer = {'byteLength': len(binary)}
            if uri:
                buffer['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binary).decode()
            return glb({'asset': {'version': '2.0'}, 'buffers': [buffer],
                        'bufferViews': [{'buffer': 0, 'byteOffset': 4, 'byteLength': len(data)}],
                        'images': [{'bufferView': 0, 'mimeType': mime}] * count}, None if uri else binary)
        for uri in (False, True):
            module.validate_glb(model(png(), uri=uri))
            for data in (b'abcd', png()[:24], png(9000, 1), png(100000, 100000)):
                with self.subTest(uri=uri, size=len(data)), self.assertRaises(ValueError):
                    module.validate_glb(model(data, uri=uri))
        for data in (model(png(), mime='image/jpeg'), model(png(), count=61), model(png(2000, 1000), count=21)):
            with self.assertRaises(ValueError):
                module.validate_glb(data)

    def test_fix1_security_real_preview_models(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix1_original_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in ('jd017_e_web.glb', 'jd019_b_web.glb'):
            module.validate_glb((REPO / 'public/images/glb' / name).read_bytes())

    def test_fix1_security_json_preparse_budgets(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('fix1_json_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for value in (b'[' * 65 + b'null' + b']' * 65, b'[' + b'null,' * 100000 + b'null]'):
            with self.assertRaises(ValueError):
                module.strict_json(value)
        module.strict_json(b'[' * 64 + b'null' + b']' * 64)
        manifest, files = package()
        path = self.write_package(manifest, files)
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('project.json', b' ' * (1024 * 1024) + b'{}')
        with self.assertRaisesRegex(ValueError, 'project.json'):
            module.preflight_packages([path])

    def test_embedded_glb_is_valid_and_preserved(self):
        manifest, files = package()
        image = png()
        model = glb({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(image)}],
                     'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(image)}],
                     'images': [{'bufferView': 0, 'mimeType': 'image/png'}]}, image)
        self.add_model(manifest, files, model)
        self.write_package(manifest, files)
        self.run_importer()
        urls = self.registry()['projects'][0]['models']
        self.assertEqual(len(urls), 1)
        self.assertEqual((self.root / 'public' / urls[0].lstrip('/')).read_bytes(), model)

    def test_glb_structural_corruption_rejected(self):
        base = glb()
        variants = {
            'magic': b'nope' + base[4:],
            'version': base[:4] + struct.pack('<I', 1) + base[8:],
            'length': base[:8] + struct.pack('<I', len(base) + 4) + base[12:],
            'truncated': base[:-1],
            'first-chunk': base[:16] + b'BIN\x00' + base[20:],
            'chunk-length': base[:12] + struct.pack('<I', 4000) + base[16:],
            'unaligned': base[:12] + struct.pack('<I', 3) + base[16:],
            'invalid-json': base[:20] + b'x' * (len(base) - 20),
            'duplicate-json-keys': glb({'asset': {'version': '2.0'}}).replace(b'"version":"2.0"', b'"version":false'),
            'missing-asset': glb({'scenes': []}),
            'buffer-without-bin': glb({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 4}]}),
            'bool-buffer-length': glb({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': True}]}, b'abcd'),
        }
        for label, data in variants.items():
            with self.subTest(label=label):
                manifest, files = package()
                self.add_model(manifest, files, data)
                self.write_package(manifest, files)
                self.run_importer(success=False)

    def test_external_uris_and_decoder_requirements_rejected(self):
        documents = []
        for uri in ('https://evil.invalid/a.bin', '//evil.invalid/a', '../external.bin', 'data:application/octet-stream;base64,AAAA'):
            documents.append({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 4, 'uri': uri}]})
            documents.append({'asset': {'version': '2.0'}, 'images': [{'uri': uri}]})
        for decoder in ('KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'):
            documents += [
                {'asset': {'version': '2.0'}, 'extensionsRequired': [decoder]},
                {'asset': {'version': '2.0'}, 'extensionsUsed': [decoder]},
                {'asset': {'version': '2.0'}, 'meshes': [{'primitives': [{'extensions': {decoder: {}}}]}]},
            ]
        for index, document in enumerate(documents):
            with self.subTest(index=index):
                manifest, files = package()
                self.add_model(manifest, files, glb(document))
                self.write_package(manifest, files)
                self.run_importer(success=False)

    def test_model_count_uniqueness_and_kind(self):
        for mode in ('five', 'duplicate', 'image-as-model', 'model-as-thumbnail'):
            with self.subTest(mode=mode):
                manifest, files = package()
                self.add_model(manifest, files)
                if mode == 'five':
                    for i in range(4):
                        self.add_model(manifest, files, asset_id=f'm{i}')
                elif mode == 'duplicate':
                    manifest['models'].append('model-1')
                elif mode == 'image-as-model':
                    manifest['models'] = ['asset-1']
                else:
                    manifest['project']['thumbnail'] = 'model-1'
                self.write_package(manifest, files)
                self.run_importer(success=False)
        manifest, files = package()
        for i in range(4):
            self.add_model(manifest, files, asset_id=f'm{i}')
        self.write_package(manifest, files)
        self.run_importer()
        self.assertEqual(len(self.registry()['projects'][0]['models']), 4)

    def test_image_magic_dimensions_and_pixel_boundaries(self):
        for label, data, width, height in [
            ('bad-magic', b'not an image', 1, 1), ('truncated', png()[:24], 1, 1),
            ('dimensions-lie', png(), 2, 1), ('too-wide', png(8193, 1), 8193, 1),
            ('too-many-pixels', png(8000, 5001), 8000, 5001),
            ('zero-width', png(0, 1), 0, 1), ('png-crc', png()[:-1] + b'X', 1, 1),
            ('wrong-extension', glb(), 1, 1),
        ]:
            with self.subTest(label=label):
                manifest, files = package()
                files['assets/asset-1.png'] = data
                manifest['assets'][0].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), width=width, height=height)
                self.write_package(manifest, files)
                self.run_importer(success=False)
        for width, height in ((8192, 1), (8000, 5000)):
            manifest, files = package()
            data = png(width, height)
            files['assets/asset-1.png'] = data
            manifest['assets'][0].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), width=width, height=height)
            self.write_package(manifest, files)
            self.run_importer()
            self.assertEqual(self.registry()['projects'][0]['blocks'][0]['images'][0]['width'], width)

    def snapshot_outputs(self):
        result = {}
        for prefix in ('.generated', 'public/_admin_media'):
            parent = self.root / prefix
            for path in sorted(parent.rglob('*')) if parent.exists() else []:
                if path.is_file() and not path.is_symlink():
                    result[str(path.relative_to(self.root))] = path.read_bytes()
        return result

    def test_replacement_removal_and_idempotent_cleanup(self):
        manifest, files = package()
        first = self.write_package(manifest, files)
        second_manifest, second_files = package('jd047')
        second = self.write_package(second_manifest, second_files)
        self.run_importer()
        initial = self.snapshot_outputs()
        self.run_importer()
        self.assertEqual(self.snapshot_outputs(), initial)
        old_url = self.registry()['projects'][0]['image']
        manifest['project']['title'] = 'Updated'
        self.write_package(manifest, files)
        second.unlink()
        self.run_importer()
        self.assertEqual([p['title'] for p in self.registry()['projects']], ['Updated'])
        self.assertFalse((self.root / 'public' / old_url.lstrip('/')).exists())
        self.assertFalse((self.root / 'public/_admin_media/jd047').exists())
        first.unlink()
        self.run_importer()
        self.assertEqual(self.registry(), {'schemaVersion': 1, 'projects': []})
        self.assertFalse((self.root / 'public/_admin_media/jd046').exists())

    def test_all_packages_validate_before_any_outputs_change(self):
        manifest, files = package()
        self.write_package(manifest, files)
        self.run_importer()
        before = self.snapshot_outputs()
        manifest['project']['title'] = 'Must not publish'
        self.write_package(manifest, files)
        invalid, invalid_files = package('jd047')
        invalid['assets'][0]['sha256'] = '0' * 64
        self.write_package(invalid, invalid_files)
        self.run_importer(success=False)
        self.assertEqual(self.snapshot_outputs(), before)
        self.assertFalse((self.root / 'public/_admin_media/jd047').exists())

    def test_reserved_directories_require_ownership_marker(self):
        for prefix in ('.generated', 'public/_admin_media'):
            with self.subTest(prefix=prefix):
                directory = self.root / prefix
                directory.mkdir()
                sentinel = directory / 'mine.txt'
                sentinel.write_bytes(b'do not delete')
                try:
                    self.run_importer(success=False)
                    self.assertEqual(sentinel.read_bytes(), b'do not delete')
                finally:
                    self.clear_fixture_outputs()

    def clear_fixture_outputs(self):
        import shutil
        for prefix in ('.generated', 'public/_admin_media'):
            directory = self.root / prefix
            if directory.is_symlink():
                directory.unlink()
            elif directory.exists():
                shutil.rmtree(directory)

    def test_filesystem_symlinks_fail_closed(self):
        manifest, files = package()
        path = self.write_package(manifest, files)
        original = path.read_bytes()
        outside = self.root / 'outside'
        outside.mkdir()
        external = outside / 'package.zip'
        external.write_bytes(original)
        for prefix in ('admin-submissions/jd046.zip', '.generated', 'public/_admin_media'):
            with self.subTest(prefix=prefix):
                target = self.root / prefix
                if target.exists():
                    target.unlink()
                target.symlink_to(external if prefix.endswith('.zip') else outside)
                try:
                    self.run_importer(success=False)
                    self.assertEqual(external.read_bytes(), original)
                    self.assertEqual(sorted(p.name for p in outside.iterdir()), ['package.zip'])
                finally:
                    if target.is_symlink():
                        target.unlink()
                    self.clear_fixture_outputs()
                    for extra in outside.iterdir():
                        if extra != external and extra.is_file():
                            extra.unlink()
        self.write_package(manifest, files)
        submissions = self.root / 'admin-submissions'
        moved = self.root / 'saved-submissions'
        submissions.rename(moved)
        submissions.symlink_to(moved, target_is_directory=True)
        self.run_importer(success=False)

    def test_nested_output_symlink_rejected_without_following(self):
        manifest, files = package()
        self.write_package(manifest, files)
        self.run_importer()
        sentinel = self.root / 'outside.bin'
        sentinel.write_bytes(b'never touch')
        target = self.root / 'public/_admin_media/evil'
        target.symlink_to(sentinel)
        before = self.snapshot_outputs()
        self.run_importer(success=False)
        self.assertTrue(target.is_symlink())
        self.assertEqual(sentinel.read_bytes(), b'never touch')
        self.assertEqual(self.snapshot_outputs(), before)

    def test_registry_commit_io_failure_rolls_back_both_outputs(self):
        import importlib.util
        from unittest.mock import patch
        manifest, files = package()
        self.write_package(manifest, files)
        self.run_importer()
        before = self.snapshot_outputs()
        manifest['project']['title'] = 'Updated'
        self.write_package(manifest, files)
        spec = importlib.util.spec_from_file_location('admin_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original_replace = os.replace
        failed = False

        def replace(source, target):
            nonlocal failed
            if Path(target) == self.root / '.generated' and Path(source).name == 'next' and not failed:
                failed = True
                raise OSError('simulated registry rename failure')
            return original_replace(source, target)

        with patch('os.replace', replace):
            with self.assertRaisesRegex(OSError, 'simulated'):
                module.import_packages(self.root)
        self.assertTrue(failed, 'Failure injection did not reach the atomic registry commit')
        self.assertEqual(self.snapshot_outputs(), before)
        self.assertFalse(any(p.name.startswith('.admin-importer-') for p in self.root.iterdir()))

    def test_dishonest_zip_sizes_cannot_hide_decompression_bomb(self):
        manifest, files = package()
        original = files['assets/asset-1.png']
        path = self.write_package(manifest, files)
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('project.json', json.dumps(manifest))
            archive.writestr('assets/asset-1.png', original + b'\x00' * (50 * 1024 * 1024))
        with zipfile.ZipFile(path) as archive:
            local = archive.getinfo('assets/asset-1.png').header_offset
        raw = bytearray(path.read_bytes())
        central = raw.rfind(b'PK\x01\x02')
        crc = zlib.crc32(original)
        struct.pack_into('<I', raw, local + 14, crc)
        struct.pack_into('<I', raw, local + 22, len(original))
        struct.pack_into('<I', raw, central + 16, crc)
        struct.pack_into('<I', raw, central + 24, len(original))
        path.write_bytes(raw)
        self.run_importer(success=False)
        self.assertFalse((self.root / '.generated').exists())

    def test_encrypted_or_mismatched_local_headers_rejected(self):
        for mode in ('encrypted', 'local-encrypted', 'different-method', 'wrong-local-size'):
            with self.subTest(mode=mode):
                manifest, files = package()
                path = self.write_package(manifest, files)
                with zipfile.ZipFile(path) as archive:
                    offset = archive.getinfo('assets/asset-1.png').header_offset
                raw = bytearray(path.read_bytes())
                central = raw.rfind(b'PK\x01\x02')
                if mode in ('encrypted', 'local-encrypted'):
                    flags = struct.unpack_from('<H', raw, offset + 6)[0]
                    struct.pack_into('<H', raw, offset + 6, flags | 1)
                    if mode == 'encrypted':
                        struct.pack_into('<H', raw, central + 8, flags | 1)
                elif mode == 'different-method':
                    struct.pack_into('<H', raw, offset + 8, 0)
                else:
                    struct.pack_into('<I', raw, offset + 22, 999)
                path.write_bytes(raw)
                self.run_importer(success=False)

    def test_sixty_assets_and_one_hundred_blocks_are_accepted(self):
        manifest, files = package()
        for index in range(1, 60):
            asset = copy.deepcopy(manifest['assets'][0])
            asset.update(id=f'a{index}', path=f'assets/a{index}.png')
            manifest['assets'].append(asset)
            files[asset['path']] = png()
            manifest['blocks'].append({'id': f'b{index}', 'type': 'images', 'columns': index % 4 + 1,
                                       'images': [{'assetId': asset['id'], 'alt': '', 'caption': ''}]})
        manifest['blocks'] += [{'id': f'd{index}', 'type': 'divider'} for index in range(40)]
        self.write_package(manifest, files)
        self.run_importer()
        self.assertEqual(len(self.registry()['projects'][0]['blocks']), 100)
        self.assertEqual(len(list((self.root / 'public/_admin_media').rglob('*.png'))), 60)

    def test_real_jpeg_and_webp_signatures_dimensions_and_bytes(self):
        import base64
        fixtures = {
            'jpg': '/9j//gAPTGF2YzYzLjEuMTAxAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAE0AAQEAAAAAAAAAAAAAAAAAAAAGAQEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAABAAEDARIAAhIAAxIA/9oADAMBAAIRAxEAPwCLEmN/H//Z',
            'webp': 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=',
        }
        for extension, encoded in fixtures.items():
            with self.subTest(extension=extension):
                data = base64.b64decode(encoded)
                manifest, files = package()
                asset = manifest['assets'][0]
                asset.update(path=f'assets/renamed.{extension}', bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                self.write_package(manifest, {asset['path']: data})
                self.run_importer()
                project = self.registry()['projects'][0]
                self.assertEqual((self.root / 'public' / project['image'].lstrip('/')).read_bytes(), data)
                self.assertEqual(project['blocks'][0]['images'][0]['width'], 1)

    def test_supported_bounded_data_uris_are_allowed(self):
        import base64
        data_uri = 'data:image/png;base64,' + base64.b64encode(png()).decode('ascii')
        document = {'asset': {'version': '2.0'},
                    'buffers': [{'byteLength': 3, 'uri': 'data:application/octet-stream;base64,AAAA'}],
                    'images': [{'uri': data_uri}]}
        manifest, files = package()
        self.add_model(manifest, files, glb(document))
        self.write_package(manifest, files)
        self.run_importer()
        self.assertEqual(len(self.registry()['projects'][0]['models']), 1)

    def test_unsafe_or_malformed_data_uris_rejected(self):
        uris = ('data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PGgxLz4=',
                'data:image/png;base64,%%%%', 'data:image/png,not-base64',
                'data:image/png;base64,AAAA', 'data:application/octet-stream;base64,AAAA===')
        for uri in uris:
            with self.subTest(uri=uri):
                manifest, files = package()
                self.add_model(manifest, files, glb({'asset': {'version': '2.0'}, 'images': [{'uri': uri}]}))
                self.write_package(manifest, files)
                self.run_importer(success=False)

    def test_aggregate_budget_checked_before_decompression(self):
        import importlib.util
        manifest, files = package()
        # The first package would fail image validation if it were inflated too early.
        files['assets/asset-1.png'] = b'not-png'
        manifest['assets'][0].update(bytes=7, sha256=hashlib.sha256(b'not-png').hexdigest())
        first_path = self.write_package(manifest, files)
        second, second_files = package('jd047')
        second_path = self.write_package(second, second_files)
        spec = importlib.util.spec_from_file_location('aggregate_admin_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # Scale the budget down, not the real ZIP parser or I/O, to avoid a 1 GB fixture.
        totals = []
        for path in (first_path, second_path):
            with zipfile.ZipFile(path) as archive:
                totals.append(sum(entry.file_size for entry in archive.infolist()))
        module.MAX_TOTAL = sum(totals) - 1
        self.assertGreaterEqual(module.MAX_TOTAL, max(totals))
        with self.assertRaisesRegex(ValueError, 'aggregate|Aggregate'):
            module.import_packages(self.root)
        self.assertFalse((self.root / '.generated').exists())
        self.assertFalse((self.root / 'public/_admin_media').exists())

    def test_failed_rollback_retains_marked_original_backup(self):
        import importlib.util
        from unittest.mock import patch
        manifest, files = package()
        self.write_package(manifest, files)
        self.run_importer()
        old_image = self.registry()['projects'][0]['image']
        manifest['project']['title'] = 'Updated'
        self.write_package(manifest, files)
        spec = importlib.util.spec_from_file_location('rollback_admin_importer', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original_replace, original_remove = os.replace, module.shutil.rmtree
        media = self.root / 'public/_admin_media'

        def replace(source, target):
            if Path(source) == self.root / '.generated':
                raise OSError('simulated registry backup failure')
            return original_replace(source, target)

        def remove(target, *args, **kwargs):
            if Path(target) == media:
                raise OSError('simulated rollback cleanup failure')
            return original_remove(target, *args, **kwargs)

        messages = io.StringIO()
        with patch('os.replace', replace), patch.object(module.shutil, 'rmtree', remove), contextlib.redirect_stderr(messages):
            with self.assertRaises(OSError):
                module.import_packages(self.root)
        self.assertIn('recovery backup retained', messages.getvalue())
        backups = list((self.root / 'public').glob('.admin-importer-*/previous'))
        self.assertEqual(len(backups), 1, 'Original bytes must survive failed rollback')
        relative = old_image.removeprefix('/_admin_media/')
        self.assertEqual((backups[0] / relative).read_bytes(), files['assets/asset-1.png'])
        # A later successful build must not accidentally publish a retained backup from public/.
        result = self.run_importer(success=False)
        self.assertIn('recovery', result.stderr.lower())

    def test_excessive_json_nesting_gets_clean_error(self):
        manifest, files = package()
        path = self.root / 'admin-submissions/jd046.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('project.json', '[' * 2000 + '0' + ']' * 2000)
            for name, data in files.items():
                archive.writestr(name, data)
        result = self.run_importer(success=False)
        self.assertNotIn('Traceback', result.stderr)
        self.assertFalse((self.root / '.generated').exists())

    def test_corrupt_deflate_stream_fails_cleanly(self):
        manifest, files = package()
        path = self.write_package(manifest, files)
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo('assets/asset-1.png')
        raw = bytearray(path.read_bytes())
        name_length, extra_length = struct.unpack_from('<HH', raw, info.header_offset + 26)
        start = info.header_offset + 30 + name_length + extra_length
        raw[start] = (raw[start] & ~6) | 6  # DEFLATE reserved BTYPE 3.
        path.write_bytes(raw)
        result = self.run_importer(success=False)
        self.assertNotIn('Traceback', result.stderr)
        self.assertFalse((self.root / '.generated').exists())

    def test_minimal_png_preserves_bytes_and_emits_contract(self):
        manifest, files = package()
        path = self.write_package(manifest, files)
        legacy_before = self.legacy.read_bytes()
        self.run_importer()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        url = f"/_admin_media/jd046/{digest[:16]}/asset-1.png"
        self.assertEqual(self.registry(), {"schemaVersion": 1, "projects": [{
            "id": "jd046", "folder": "jd046", "title": "Example", "category": "Product", "image": url,
            "blocks": [{"id": "block-1", "type": "images", "columns": 1,
                        "images": [{"src": url, "width": 1, "height": 1, "alt": "Red", "caption": ""}]}],
            "models": [], "packageSha256": digest,
        }]})
        self.assertEqual((self.root / "public" / url.lstrip("/")).read_bytes(), files["assets/asset-1.png"])
        self.assertEqual(self.legacy.read_bytes(), legacy_before)
        self.assertEqual((self.legacy.parent / "unchanged.bin").read_bytes(), b"legacy-original\x00")


if __name__ == "__main__":
    unittest.main()
