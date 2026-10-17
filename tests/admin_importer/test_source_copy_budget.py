"""Portable real PNG/BIN fixtures; validation only, never loader/GPU."""
import base64
import hashlib
import struct
import tempfile
import unittest
import zlib

from test_importer import glb
from test_static_glb_policy import module, write_package

MIB = 1024 * 1024
MAXIMUM = 64 * MIB
ERROR = 'encoded.source.copy'


def png(ancillary=None):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(2)))
            + (b'' if ancillary is None else chunk(b'npAD', bytes(ancillary))) + chunk(b'IEND', b''))


def review_fixture(kind):
    root = {'asset': {'version': '2.0'}, 'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0}
    binary = png(2 * MIB) if kind == 'image-views' else bytes(2 * MIB)
    root['buffers'] = [{'byteLength': len(binary)}]
    root['bufferViews'] = [{'buffer': 0, 'byteLength': len(binary)} for _ in range(60 if kind == 'image-views' else 64)]
    if kind == 'image-views':
        root['images'] = [{'bufferView': i, 'mimeType': 'image/png'} for i in range(60)]
        root['textures'] = [{'source': i} for i in range(60)]
        root['materials'] = [{'pbrMetallicRoughness': {'baseColorTexture': {'index': i}}} for i in range(60)]
        root['accessors'] = [{'componentType': 5126, 'type': 'VEC3', 'count': 3, 'min': [0, 0, 0], 'max': [0, 0, 0]},
                             {'componentType': 5126, 'type': 'VEC2', 'count': 3}]
        root['meshes'] = [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'material': i} for i in range(60)]}]
    else:
        root['accessors'] = [{'componentType': 5126, 'type': 'VEC3', 'count': 3,
                              'sparse': {'count': 1, 'indices': {'bufferView': 2 * i, 'componentType': 5121},
                                         'values': {'bufferView': 2 * i + 1}},
                              **({'min': [0, 0, 0], 'max': [0, 0, 0]} if i == 0 else {})} for i in range(32)]
        root['meshes'] = [{'primitives': [{'attributes': {('POSITION' if i == 0 else '_A' + str(i)): i for i in range(32)}}]}]
    return root, binary


def boundary_views(total=MAXIMUM):
    binary = bytearray(MIB)
    root = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}], 'bufferViews': []}
    while total > 0:
        length = min(total, MIB)
        root['bufferViews'].append({'buffer': 0, 'byteLength': length})
        total -= length
    return root, binary


class SourceCopyBudgetTests(unittest.TestCase):
    def test_shared_image_view_repeated_records_and_different_samplers_count_again(self):
        binary = png(2 * MIB)
        root = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}],
                'bufferViews': [{'buffer': 0, 'byteLength': len(binary)}],
                'images': [{'bufferView': 0, 'mimeType': 'image/png'} for _ in range(60)],
                'samplers': [{'wrapS': 33071 if i % 2 else 10497} for i in range(60)],
                'textures': [{'source': i, 'sampler': i} for i in range(60)]}
        self.rejected_everywhere(glb(root, binary))

    def rejected_everywhere(self, data):
        with self.assertRaisesRegex(ValueError, ERROR):
            module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='copy-budget-') as directory:
            with self.assertRaisesRegex(ValueError, ERROR):
                module.load_package(write_package(directory, data), set())

    def test_image_cost_precedes_container_crc_for_views_and_data_uri(self):
        corrupt = bytearray(png())
        corrupt[-1] ^= 1
        for source in ('bufferView', 'dataURI'):
            root, binary = boundary_views(MAXIMUM - len(corrupt) * (2 if source == 'bufferView' else 1) + 1)
            if source == 'bufferView':
                binary[128:128 + len(corrupt)] = corrupt
                root['bufferViews'].append({'buffer': 0, 'byteOffset': 128, 'byteLength': len(corrupt)})
                root['images'] = [{'bufferView': len(root['bufferViews']) - 1, 'mimeType': 'image/png'}]
            else:
                root['images'] = [{'uri': 'data:image/png;base64,' + base64.b64encode(corrupt).decode()}]
            with self.subTest(source=source):
                self.rejected_everywhere(glb(root, binary))

    def accepted_everywhere(self, data):
        module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='copy-budget-') as directory:
            _, payloads, _, _ = module.load_package(write_package(directory, data), set())
            self.assertEqual(payloads['assets/model.glb'], data)

    def test_26mib_compressible_bin_remains_accepted_byte_exact(self):
        # Actual BIN bytes, not an unsupported oversized JSON generator string.
        binary = bytes(26 * MIB)
        self.accepted_everywhere(glb({'asset': {'version': '2.0'},
                                     'buffers': [{'byteLength': len(binary)}]}, binary))

    def test_unused_overlapping_view_definitions_exact_64mib_and_plus_one(self):
        root, binary = boundary_views()
        self.assertEqual(len(root['bufferViews']), 64)
        self.assertEqual(sum(view['byteLength'] for view in root['bufferViews']), MAXIMUM)
        self.accepted_everywhere(glb(root, binary))
        root['bufferViews'].append({'buffer': 0, 'byteLength': 1})
        self.rejected_everywhere(glb(root, binary))

    def test_sparse_same_and_distinct_view_indices_with_and_without_base_view(self):
        for base in (False, True):
            for shared in (False, True):
                with self.subTest(base=base, shared=shared):
                    root, binary = boundary_views()
                    root['accessors'] = [{'componentType': 5126, 'type': 'VEC3', 'count': 3,
                                          **({'bufferView': 2} if base else {}),
                                          'sparse': {'count': 1, 'indices': {'bufferView': 0, 'componentType': 5121},
                                                     'values': {'bufferView': 0 if shared else 1}}}]
                    self.accepted_everywhere(glb(root, binary))
                    root['bufferViews'].append({'buffer': 0, 'byteLength': 1})
                    self.rejected_everywhere(glb(root, binary))
                    root['accessors'][0]['sparse']['indices']['byteOffset'] = MIB + 1
                    self.rejected_everywhere(glb(root, binary))

    def test_60_image_records_sharing_exact_offset_view_at_64mib_plus_one(self):
        image = png(8)
        root, binary = boundary_views(MAXIMUM - 61 * len(image))
        binary[128:128 + len(image)] = image
        root['bufferViews'].append({'buffer': 0, 'byteOffset': 128, 'byteLength': len(image)})
        root['images'] = [{'bufferView': len(root['bufferViews']) - 1, 'mimeType': 'image/png'} for _ in range(60)]
        root['samplers'] = [{'wrapS': 33071 if i % 2 else 10497} for i in range(60)]
        root['textures'] = [{'source': i, 'sampler': i} for i in range(60)]
        self.accepted_everywhere(glb(root, binary))
        root['bufferViews'].append({'buffer': 0, 'byteLength': 1})
        self.rejected_everywhere(glb(root, binary))

    def test_repeated_data_uri_records_actual_decoded_bytes_exact_64mib_plus_one(self):
        image = png(8)
        root, binary = boundary_views(MAXIMUM - 60 * len(image))
        root['images'] = [{'uri': 'data:image/png;base64,' + base64.b64encode(image).decode()} for _ in range(60)]
        self.accepted_everywhere(glb(root, binary))
        root['images'][59] = {'uri': 'data:image/png;base64,' + base64.b64encode(png(9)).decode()}
        self.rejected_everywhere(glb(root, binary))

    def test_image_view_resolves_exact_region_of_decoded_buffer_uri(self):
        image = png()
        binary = bytearray([255] * 256)
        binary[32:32 + len(image)] = image
        root = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary),
                'uri': 'data:application/octet-stream;base64,' + base64.b64encode(binary).decode()}],
                'bufferViews': [{'buffer': 0, 'byteOffset': 32, 'byteLength': len(image)}],
                'images': [{'bufferView': 0, 'mimeType': 'image/png'}]}
        self.accepted_everywhere(glb(root))

    def test_crc_and_view_guards_remain_below_budget_including_noncore_uri(self):
        image = bytearray(png())
        image[-1] ^= 1
        root = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(image)}],
                'bufferViews': [{'buffer': 0, 'byteLength': len(image)}],
                'images': [{'bufferView': 0, 'mimeType': 'image/png'}]}
        with self.assertRaisesRegex(ValueError, 'CRC'):
            module.validate_glb(glb(root, image))
        uri = 'data:image/png;base64,' + base64.b64encode(image).decode()
        root['images'] = [{'uri': uri}]
        with self.assertRaisesRegex(ValueError, 'CRC'):
            module.validate_glb(glb(root, image))
        root['images'] = []
        root['extras'] = {'uri': uri}
        with self.assertRaisesRegex(ValueError, 'CRC'):
            module.validate_glb(glb(root, image))
        del root['extras']
        for value in (None, False, -1, 0, 0.5, len(image) + 1):
            root['bufferViews'][0]['byteLength'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'bufferView'):
                module.validate_glb(glb(root, image))

    def test_bounded_review_fixtures_reject_direct(self):
        for kind in ('sparse-views', 'image-views'):
            root, binary = review_fixture(kind)
            data = glb(root, binary)
            self.assertEqual(len(data), 2104480 if kind == 'sparse-views' else 2109976)
            self.assertEqual(hashlib.sha256(data).hexdigest(),
                             'fb0d27c3b21f51a510569339bdcc72b696cf9dba4c5d8b4c0821dad7b35d16f0' if kind == 'sparse-views'
                             else '73ff00491279ef427780a94f69f9f74a5cec6e81d8b96a5111ae07d5102fd1a4')
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, ERROR):
                module.validate_glb(data)

    def test_bounded_review_fixtures_reject_real_hash_zip_load(self):
        for kind in ('sparse-views', 'image-views'):
            root, binary = review_fixture(kind)
            with tempfile.TemporaryDirectory(prefix='copy-budget-') as directory:
                path = write_package(directory, glb(root, binary))
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, ERROR):
                    module.load_package(path, set())
