"""Metadata-copy work: portable JSON/real PNG, validator-only, never loader/GPU."""
import base64
import copy
import json
import re
import struct
import tempfile
import unittest

from test_importer import glb
from test_static_glb_policy import module, static_document, write_package
from test_texture_budget import image

MAXIMUM = 64 * 1024 * 1024


def accounting_bytes(root):
    # Independent test oracle, no production accounting helper.
    view = copy.deepcopy(root)
    if type(view.get('asset', {}).get('generator')) is str:
        view['asset']['generator'] = ''
    for field in ('images', 'buffers'):
        for item in view.get(field, []):
            if type(item.get('uri')) is str:
                item['uri'] = ''
    source = json.dumps(view, ensure_ascii=False, separators=(',', ':'))
    numbers = sum(1 for match in re.finditer(r'"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?', source)
                  if re.match(r'-?\d', match.group()))
    return len(source.encode()) + 32 * numbers


def at_boundary(root, clones):
    root.setdefault('extras', {})['payload'] = ''
    root['extras']['payload'] = 'x' * (MAXIMUM // clones - accounting_bytes(root))
    assert accounting_bytes(root) == MAXIMUM // clones
    return root


def static():
    root = static_document()
    root['nodes'] = [{'mesh': 0}]
    root['scenes'] = [{'nodes': [0]}]
    return root


def raw_glb(source):
    data = source.encode()
    data += b' ' * (-len(data) % 4)
    return struct.pack('<4sII', b'glTF', 2, 20 + len(data)) + struct.pack('<I4s', len(data), b'JSON') + data


def amplification(kind):
    root = static_document()
    payload = 'x' * (1024 * 1024)
    if kind.startswith('mesh'):
        root['meshes'][0]['extras' if kind == 'mesh-extras' else 'extensions'] = (
            {'payload': payload} if kind == 'mesh-extras' else {'UNKNOWN_retained': {'payload': payload}})
        root['nodes'] = [{'mesh': 0} for _ in range(4096)]
        root['scenes'] = [{'nodes': list(range(4096))}]
    else:
        root['nodes'] = [{'mesh': 0}]
        root['scenes'] = [{'nodes': [0]}]
        root['images'] = [dict(image(), extras={'payload': payload})]
        root['textures'] = [{'source': 0}]
        if kind == 'image-transform':
            root['extensionsUsed'] = ['KHR_texture_transform']
        info = {'index': 0, **({'texCoord': 1} if kind == 'image-texCoord' else {
            'extensions': {'KHR_texture_transform': {'offset': [0.25, 0]}}})}
        root['materials'] = [{'pbrMetallicRoughness': {'baseColorTexture': info}} for _ in range(1024)]
        root['meshes'][0]['primitives'] = [{'attributes': {'POSITION': 0}, 'material': i} for i in range(1024)]
    return root


class MetadataBudgetTests(unittest.TestCase):
    def test_b1_b2_rejected_by_validator_before_loader(self):
        for kind in ('mesh-extras', 'mesh-unknown-extension', 'image-texCoord', 'image-transform'):
            data = glb(amplification(kind))
            self.assertLess(len(data), 1300000)
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'metadata.*(?:work|processing)'):
                module.validate_glb(data)

    def test_b1_b2_rejected_by_real_hash_zip_load_package(self):
        for kind in ('mesh-extras', 'mesh-unknown-extension', 'image-texCoord', 'image-transform'):
            with tempfile.TemporaryDirectory(prefix='metadata-fix2-') as directory:
                path = write_package(directory, glb(amplification(kind)))
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'metadata.*(?:work|processing)'):
                    module.load_package(path, set())

    def accepted_everywhere(self, data):
        module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='metadata-fix2-') as directory:
            path = write_package(directory, data)
            _, payloads, _, _ = module.load_package(path, set())
            self.assertEqual(payloads['assets/model.glb'], data)

    def test_exact_64mib_and_next_representable_16_work_bytes(self):
        root = at_boundary({'asset': {'version': '2.0'}, 'images': [image(), image()], 'textures': [{'source': 0}]}, 16)
        self.assertEqual(accounting_bytes(root) * 16, MAXIMUM)
        self.accepted_everywhere(glb(root))
        root['extras']['payload'] += 'x'
        self.assertEqual(accounting_bytes(root) * 16, MAXIMUM + 16)
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(glb(root))
        with tempfile.TemporaryDirectory(prefix='metadata-fix2-') as directory:
            with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.load_package(write_package(directory, glb(root)), set())

    def test_utf8_source_escape_spelling_and_numeric_allowance(self):
        root = at_boundary({'asset': {'version': '2.0'}}, 10)
        module.validate_glb(glb(root))
        root['extras']['payload'] = '한' + root['extras']['payload'][1:]
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(raw_glb(json.dumps(root, ensure_ascii=False)))
        root = at_boundary({'asset': {'version': '2.0'}, 'extras': {'value': 1e20}}, 10)
        module.validate_glb(glb(root))
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(raw_glb(json.dumps(root).replace('"version"', '"vers\\u0069on"')))

    def test_exact_core_string_exclusions_preserve_parser_supported_generator_and_data(self):
        root = static()
        # Match the browser fixture; oversized literal JSON strings are a
        # pre-existing browser-scanner limitation, unlike large BIN chunks.
        root['asset']['generator'] = 'g' * (64 * 1024)
        root['nodes'] = [{'mesh': 0} for _ in range(128)]
        root['scenes'] = [{'nodes': list(range(128))}]
        root['buffers'] = [{'byteLength': 64, 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(64)).decode()}]
        root['images'] = [image()]
        self.accepted_everywhere(glb(root))
        root['asset']['extras'] = {'generator': root['asset'].pop('generator')}
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(glb(root))

    def test_names_extras_extensions_alias_paths_are_never_excluded(self):
        for location in ('name', 'extras', 'extension', 'asset.extra.generator', 'buffer.extras.uri',
                         'image.extras.uri', 'asset.generator-key', 'images[].uri-key'):
            root, payload = static(), 'x' * (3 * 1024 * 1024)
            if location == 'name':
                root['nodes'][0]['name'] = payload
            elif location == 'extras':
                root['meshes'][0]['extras'] = {'payload': payload}
            elif location == 'extension':
                root['meshes'][0]['extensions'] = {'ALIAS': {'name': payload}}
            elif location == 'asset.extra.generator':
                root['asset']['extras'] = {'generator': payload}
            elif location in ('buffer.extras.uri', 'image.extras.uri'):
                record = {'byteLength': 1, 'uri': 'data:application/octet-stream;base64,AA=='} if location == 'buffer.extras.uri' else image()
                record['extras'] = {'uri': 'data:application/octet-stream;base64,AAAA'}
                root['buffers' if location == 'buffer.extras.uri' else 'images'] = [record]
                at_boundary(root, 30 if location == 'buffer.extras.uri' else 31)
                module.validate_glb(glb(root))
                record['extras']['uri'] = 'data:application/octet-stream;base64,AAAAAAAA'
            else:
                root['asset.generator' if location == 'asset.generator-key' else 'images[].uri'] = payload
            with self.subTest(location=location), self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.validate_glb(glb(root))

    def test_nonstring_generator_nested_core_like_objects_retained(self):
        for root in (
            {'asset': {'version': '2.0', 'generator': {'name': 'x' * (7 * 1024 * 1024)}}},
            {'asset': {'version': '2.0'}, 'extras': {'asset': {'generator': 'x' * (7 * 1024 * 1024)}}},
            at_boundary({'asset': {'version': '2.0'}, 'extensions': {'UNKNOWN': {'images': [{'uri': 'data:application/octet-stream;base64,AAAAAAAA'}]}}}, 10),
        ):
            if 'extensions' in root:
                root['extras']['payload'] += 'x'
            with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.validate_glb(glb(root))

    def test_all_scenes_unused_trees_and_mesh_definitions_count(self):
        root = static()
        root['images'] = [image(), image()]
        at_boundary(root, 32)
        module.validate_glb(glb(root))
        root['scenes'].append({'nodes': [0]})
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(glb(root))
        for variant, clones in (('unused-tree', 38), ('unused-mesh', 26), ('no-scenes', 18)):
            root = static()
            del root['scene']
            if variant == 'unused-tree':
                root['nodes'].append({'mesh': 0})
                root['scenes'] = []
            elif variant == 'unused-mesh':
                root['meshes'].append({'primitives': [{'attributes': {'POSITION': 0}}]})
                root['nodes'], root['scenes'] = [], []
            else:
                del root['nodes'], root['scenes']
            at_boundary(root, clones)
            module.validate_glb(glb(root))
            root['extras']['payload'] += 'x'
            with self.subTest(variant=variant), self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.validate_glb(glb(root))

    def test_nine_material_variants_each_plus_implicit_default(self):
        root = at_boundary({'asset': {'version': '2.0'}, 'materials': [{}]}, 19)
        module.validate_glb(glb(root))
        root['extras']['payload'] += 'x'
        with self.assertRaisesRegex(ValueError, 'metadata.*processing'):
            module.validate_glb(glb(root))

    def test_assignment_opportunities_in_every_unknown_nested_material_object(self):
        for key, opportunities in (('baseColorTexture', 1), ('metallicRoughnessTexture', 2), ('UNKNOWN_Texture', 1)):
            root = {'asset': {'version': '2.0'}, 'materials': [{'extensions': {'UNKNOWN': [{key: {
                'index': 99, 'texCoord': 1, 'extensions': {'KHR_texture_transform': {'offset': [0, 0]}}}}]}}]}
            at_boundary(root, 19 + 2 * opportunities)
            module.validate_glb(glb(root))
            root['extras']['payload'] += 'x'
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'metadata.*processing'):
                module.validate_glb(glb(root))

    def test_all_material_definitions_are_record_arrays_even_unused(self):
        for materials in (None, False, 0, '', {}, [None], [[]], [False], ['name']):
            with self.subTest(materials=materials), self.assertRaisesRegex(ValueError, 'materials'):
                module.validate_glb(glb({'asset': {'version': '2.0'}, 'materials': materials}))

    def test_small_defaults_and_unknown_metadata_accepted_unchanged(self):
        for root in ({'asset': {'version': '2.0'}}, dict(static(), materials=[], textures=[], images=[],
                     extras={'name': 'small 한글 😀', 'generator': 'retained'}, extensions={'UNKNOWN': {'payload': [True, None, 1e20]}})):
            self.accepted_everywhere(glb(root))
