"""Texture resource work: genuine images, validation only, never loader/GPU."""
import base64
import json
import struct
import tempfile
import unittest
import zlib

from test_importer import glb
from test_static_glb_policy import module, write_package


def png(width=1, height=1):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes((width + 1) * height))) + chunk(b'IEND', b''))


def image(width=1, height=1):
    return {'uri': 'data:image/png;base64,' + base64.b64encode(png(width, height)).decode()}


def document(width=1, height=1, count=1):
    return {'asset': {'version': '2.0'}, 'images': [image(width, height)],
            'textures': [{'source': 0} for _ in range(count)]}


def amplification():
    root = document(4096, 4096, 108)
    root['samplers'] = [{'magFilter': mag, 'minFilter': minimum, 'wrapS': s, 'wrapT': t}
                        for mag in (9728, 9729) for minimum in (9728, 9729, 9984, 9985, 9986, 9987)
                        for s in (33071, 33648, 10497) for t in (33071, 33648, 10497)]
    for index, texture in enumerate(root['textures']):
        texture['sampler'] = index
    root['accessors'] = [{'componentType': 5126, 'type': 'VEC3', 'count': 3},
                         {'componentType': 5126, 'type': 'VEC2', 'count': 3}]
    root['materials'] = [{'pbrMetallicRoughness': {'baseColorTexture': {'index': i}}} for i in range(108)]
    root['meshes'] = [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'material': i} for i in range(108)]}]
    root['nodes'] = [{'mesh': 0}]
    root['scenes'] = [{'nodes': [0]}]
    root['scene'] = 0
    return glb(root)


class TextureBudgetTests(unittest.TestCase):
    def test_texture_integer_fields_reject_float_tokens_not_extras(self):
        def raw_glb(root, token):
            payload = json.dumps(root).replace('"RAW"', token).encode()
            payload += b' ' * (-len(payload) % 4)
            return struct.pack('<4sII', b'glTF', 2, 20 + len(payload)) + struct.pack('<I4s', len(payload), b'JSON') + payload
        for token in ('0.0', '0e0', '0.00000000000000001'):
            for field in ('source', 'sampler', 'alternate'):
                root = document()
                root['samplers'] = [{}]
                if field == 'alternate':
                    root['textures'][0]['extensions'] = {'EXT_texture_webp': {'source': 'RAW'}}
                else:
                    root['textures'][0][field] = 'RAW'
                with self.subTest(token=token, field=field), self.assertRaisesRegex(ValueError, 'texture|sampler'):
                    module.validate_glb(raw_glb(root, token))
        for field in ('magFilter', 'minFilter', 'wrapS', 'wrapT'):
            root = document()
            root['samplers'] = [{field: 'RAW'}]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'sampler'):
                module.validate_glb(raw_glb(root, ('10497' if field.startswith('wrap') else '9729') + '.0'))
        root = document()
        root['extras'] = {'source': 0.5, 'samplers': [{'magFilter': 1.5}]}
        root['textures'][0]['extras'] = {'source': 0.5, 'sampler': 1.5}
        root['samplers'] = [{'extras': {'minFilter': 1.5}}]
        root['textures[].source'] = 0.5
        module.validate_glb(glb(root))

    def test_exact_40m_and_minimum_two_unit_excess_repeated_definitions(self):
        for repeated in (False, True):
            root = document(2500, 4000, 2) if repeated else document(5000, 4000)
            data = glb(root)
            module.validate_glb(data)
            with tempfile.TemporaryDirectory(prefix='texture-fix1-') as directory:
                module.load_package(write_package(directory, data), set())
            root['images'].append(image())
            root['textures'].append({'source': 1})
            with self.subTest(repeated=repeated), self.assertRaisesRegex(ValueError, 'texture.*processing'):
                module.validate_glb(glb(root))  # 40,000,002, smallest possible excess.

    def test_4k_repeated_definitions_count_again_even_with_same_sampler(self):
        root = document(4096, 4096)
        root['samplers'] = [{}]
        root['textures'][0]['sampler'] = 0
        module.validate_glb(glb(root))
        root['textures'].append({'source': 0, 'sampler': 0})
        with self.assertRaisesRegex(ValueError, 'texture.*processing'):
            module.validate_glb(glb(root))

    def test_extension_only_and_fallback_candidates_count_even_undeclared(self):
        for extension in ('EXT_texture_webp', 'EXT_texture_avif'):
            root = document()
            root['textures'][0] = {'extensions': {extension: {'source': 0}}}
            data = glb(root)
            module.validate_glb(data)
            with tempfile.TemporaryDirectory(prefix='texture-fix1-') as directory:
                module.load_package(write_package(directory, data), set())
            root['images'].append(image(4096, 4096))
            for fallback, alternate in ((0, 1), (1, 0)):
                root['textures'] = [{'source': fallback, 'extensions': {extension: {'source': alternate}}} for _ in range(2)]
                with self.subTest(extension=extension, fallback=fallback), self.assertRaisesRegex(ValueError, 'texture.*processing'):
                    module.validate_glb(glb(root))

    def test_all_alternate_and_fallback_source_references_are_strict(self):
        for extension in ('EXT_texture_webp', 'EXT_texture_avif'):
            for bad in (None, False, True, '0', -1, 1, 0.5, {}, []):
                for fallback in (False, True):
                    root = document()
                    root['textures'][0] = {'source': bad if fallback else 0,
                                           'extensions': {extension: {'source': 0 if fallback else bad}}}
                    with self.subTest(extension=extension, bad=bad, fallback=fallback), self.assertRaisesRegex(ValueError, 'source'):
                        module.validate_glb(glb(root))
            for bad in (None, False, True, '', 0, [], {}):
                root = document()
                root['textures'][0]['extensions'] = {extension: bad}
                with self.subTest(extension=extension, bad=bad), self.assertRaisesRegex(ValueError, 'texture|source'):
                    module.validate_glb(glb(root))

    def test_three_potential_source_slots_sum_without_deduplication(self):
        root = document(2500, 4000)
        root['textures'][0]['extensions'] = {'EXT_texture_webp': {'source': 0}}
        module.validate_glb(glb(root))  # 2 × (10M + 10M) = 40M.
        root['images'].append(image())
        root['textures'][0]['extensions']['EXT_texture_avif'] = {'source': 1}
        with self.assertRaisesRegex(ValueError, 'texture.*processing'):
            module.validate_glb(glb(root))

    def test_one_pixel_texture_and_unused_sampler_128_limits(self):
        for field in ('textures', 'samplers'):
            root = document()
            root[field] = [{'source': 0} if field == 'textures' else {} for _ in range(128)]
            module.validate_glb(glb(root))
            root[field].append({'source': 0} if field == 'textures' else {})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, '128'):
                module.validate_glb(glb(root))

    def test_containers_and_strict_source_sampler_references(self):
        for field in ('textures', 'samplers'):
            for bad in (None, False, True, '', 0, {}, [None], [[]], [False], ['0']):
                root = document()
                root[field] = bad
                with self.subTest(field=field, bad=bad), self.assertRaisesRegex(ValueError, 'texture|sampler'):
                    module.validate_glb(glb(root))
        for field in ('source', 'sampler'):
            for bad in (None, False, True, '0', -1, 1, 0.5, {}, []):
                root = document()
                root['samplers'] = [{}]
                root['textures'][0][field] = bad
                with self.subTest(field=field, bad=bad), self.assertRaisesRegex(ValueError, 'source|sampler'):
                    module.validate_glb(glb(root))
        root = document()
        del root['textures'][0]['source']
        with self.assertRaisesRegex(ValueError, 'source'):
            module.validate_glb(glb(root))

    def test_valid_sampler_combinations_defaults_and_small_shared_texture_zip(self):
        root = document(1, 1, 108)
        root['samplers'] = [{'magFilter': mag, 'minFilter': minimum, 'wrapS': s, 'wrapT': t}
                            for mag in (9728, 9729) for minimum in (9728, 9729, 9984, 9985, 9986, 9987)
                            for s in (33071, 33648, 10497) for t in (33071, 33648, 10497)]
        for index, texture in enumerate(root['textures']):
            texture['sampler'] = index
        root['samplers'].append({})
        root['textures'] += [{'source': 0, 'sampler': 108}, {'source': 0}, {'source': 0}]
        data = glb(root)
        module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='texture-fix1-') as directory:
            _, payloads, _, _ = module.load_package(write_package(directory, data), set())
            self.assertEqual(payloads['assets/model.glb'], data)

    def test_sampler_enums_reject_coercion_and_invalid_values_even_when_unused(self):
        for field in ('magFilter', 'minFilter', 'wrapS', 'wrapT'):
            for bad in (None, False, True, '9728', 0, -1, 9728.5, {}, [], 9984 if field == 'magFilter' else 9999):
                root = document()
                root['samplers'] = [{field: bad}]
                with self.subTest(field=field, bad=bad), self.assertRaisesRegex(ValueError, 'sampler'):
                    module.validate_glb(glb(root))

    def test_108_valid_sampler_4k_amplification_rejected_at_entrypoints(self):
        data = amplification()
        self.assertLess(len(data), 150000)
        with self.assertRaisesRegex(ValueError, 'texture.*processing'):
            module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='texture-fix1-') as directory:
            with self.assertRaisesRegex(ValueError, 'texture.*processing'):
                module.load_package(write_package(directory, data), set())
