"""Triangle topology and reference work budgets; never invoke a loader/GPU."""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from test_importer import glb, QA
from test_static_glb_policy import module, write_package

LIMIT = 64 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[2]


def document(count=3, kind='VEC3', component=5126):
    return {'asset': {'version': '2.0'},
            'accessors': [{'componentType': component, 'type': kind, 'count': count}],
            'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}],
            'nodes': [{'mesh': 0}], 'scenes': [{'nodes': [0]}], 'scene': 0}


def probe(mode=4):
    root = document(999999)
    root['meshes'][0]['primitives'] = [
        {'mode': mode, 'attributes': {'POSITION': 0, f'_STATIC_{i}': 0}} for i in range(256)]
    return glb(root)


def small_topology(mode):
    root = document(4)
    binary = struct.pack('<12f', 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0)
    root['buffers'] = [{'byteLength': len(binary)}]
    root['bufferViews'] = [{'buffer': 0, 'byteLength': len(binary)}]
    root['accessors'][0].update(bufferView=0, min=[0, 0, 0], max=[1, 1, 0])
    root['meshes'][0]['primitives'][0]['mode'] = mode
    return glb(root, binary)


class TriangleBudgetTests(unittest.TestCase):
    def test_strip_and_fan_conversion_probe_rejected_before_loading(self):
        for mode in (5, 6):
            data = probe(mode)
            self.assertLess(len(data), 25000)
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'TRIANGLES'):
                module.validate_glb(data)

    def test_present_modes_rejected_in_all_definitions(self):
        for mode in (0, 1, 2, 3, 5, 6, None, False, True, '4', 4.0, 4.5, -1, 7, {}, []):
            base = document()
            bad = {'mode': mode, 'attributes': {'POSITION': 0}}
            for meshes in ([{'primitives': [bad]}],
                           [{'primitives': base['meshes'][0]['primitives'] + [bad]}],
                           base['meshes'] + [{'primitives': [bad]}]):
                with self.subTest(mode=mode, meshes=meshes), self.assertRaisesRegex(ValueError, 'TRIANGLES'):
                    module.validate_glb(glb(dict(base, meshes=meshes)))

    def test_default4_and_explicit4_shared_static_meshes_accepted(self):
        for mode in (None, 4):
            root = document()
            if mode is not None:
                root['meshes'][0]['primitives'][0]['mode'] = mode
            root['nodes'].append({'mesh': 0})
            root['scenes'].append({'nodes': [0, 1]})
            module.validate_glb(glb(root))

    def test_raw_float_mode_tokens_in_later_unused_and_nondefault_primitives(self):
        for token in ('4.0', '4e0', '4.00000000000000001'):
            for placement in ('first', 'later', 'unused', 'nondefault'):
                root = document()
                bad = {'mode': 'RAW_MODE', 'attributes': {'POSITION': 0}}
                if placement == 'first':
                    root['meshes'][0]['primitives'] = [bad]
                elif placement == 'later':
                    root['meshes'][0]['primitives'].append(bad)
                else:
                    root['meshes'].append({'primitives': [bad]})
                    if placement == 'nondefault':
                        root['nodes'].append({'mesh': 1})
                        root['scenes'].append({'nodes': [1]})
                payload = json.dumps(root).replace('"RAW_MODE"', token).replace('"mode":', '"m\\u006fde":').encode()
                payload += b' ' * (-len(payload) % 4)
                data = struct.pack('<4sII', b'glTF', 2, 20 + len(payload)) + struct.pack('<I4s', len(payload), b'JSON') + payload
                with self.subTest(token=token, placement=placement), self.assertRaisesRegex(ValueError, 'TRIANGLES'):
                    module.validate_glb(data)

    def test_mode4_repeated_accessor_unique_attribute_probe_rejected_at_entrypoints(self):
        data = probe(4)
        self.assertLess(len(data), 25000)
        with self.assertRaisesRegex(ValueError, 'referenced geometry'):
            module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='triangle-') as directory:
            with self.assertRaisesRegex(ValueError, 'referenced geometry'):
                module.load_package(write_package(directory, data), set())

    def test_custom_aliases_and_index_references_exact_boundary_and_one_element_over(self):
        for indices in (False, True):
            root = document(LIMIT // 8, 'SCALAR', 5121)
            for field in ('nodes', 'scenes', 'scene'):
                root.pop(field)
            primitive: dict = {'attributes': {'POSITION': 0}}
            if indices:
                primitive['indices'] = 0
            else:
                primitive['attributes']['_ALIAS'] = 0
            root['meshes'][0]['primitives'] = [primitive]
            module.validate_glb(glb(root))
            root['accessors'].append({'componentType': 5123, 'type': 'SCALAR', 'count': 1})
            root['meshes'][0]['primitives'].append({'attributes': {'_ONE_MORE': 1}})
            with self.subTest(indices=indices), self.assertRaisesRegex(ValueError, 'referenced geometry'):
                module.validate_glb(glb(root))

    def test_unused_mesh_definitions_sum_shared_accessor_references(self):
        root = document(LIMIT // 8, 'SCALAR')
        for field in ('nodes', 'scenes', 'scene'):
            root.pop(field)
        root['meshes'] *= 2
        module.validate_glb(glb(root))
        root['meshes'].append(root['meshes'][0])
        with self.assertRaisesRegex(ValueError, 'referenced geometry'):
            module.validate_glb(glb(root))

    def test_all_type_components_and_component_byte_floor(self):
        for kind, components in (('SCALAR', 1), ('VEC2', 2), ('VEC3', 3), ('VEC4', 4),
                                 ('MAT2', 4), ('MAT3', 9), ('MAT4', 16)):
            for component in (5120, 5121, 5122, 5123, 5125, 5126):
                root = document(LIMIT // (components * 4 * 2), kind, component)
                for field in ('nodes', 'scenes', 'scene'):
                    root.pop(field)
                root['meshes'][0]['primitives'][0]['attributes']['_ALIAS'] = 0
                module.validate_glb(glb(root))
                root['accessors'][0]['count'] += 1
                with self.subTest(kind=kind, component=component), self.assertRaisesRegex(ValueError, 'referenced geometry'):
                    module.validate_glb(glb(root))

    def test_node_scene_unused_tree_and_memoized_subtree_multipliers(self):
        base = document(999999)
        nodes = [{'mesh': 0} for _ in range(7)]
        cases = {
            'shared mesh nodes': dict(base, nodes=nodes, scenes=[{'nodes': list(range(7))}]),
            'shared root across scenes': dict(base, scenes=[{'nodes': [0]} for _ in range(7)]),
            'nondefault scene': dict(base, nodes=nodes, scenes=[{'nodes': []}, {'nodes': list(range(7))}]),
            'unused trees': dict(base, nodes=nodes, scenes=[{'nodes': []}]),
            'no scenes': {key: value for key, value in dict(base, nodes=nodes).items() if key not in ('scenes', 'scene')},
            'empty scenes': {key: value for key, value in dict(base, nodes=nodes, scenes=[]).items() if key != 'scene'},
            'memoized reverse subtree': dict(base, nodes=nodes + [{'children': list(range(7))}], scenes=[{'nodes': [7]}]),
        }
        for name, root in cases.items():
            data = glb(root)
            self.assertLess(len(data), 5000)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'referenced geometry'):
                module.validate_glb(data)
            with tempfile.TemporaryDirectory(prefix='triangle-') as directory:
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'referenced geometry'):
                    module.load_package(write_package(directory, data), set())

    def test_expansion_exact_boundary_no_definition_double_charge_and_four_byte_excess(self):
        for placement in ('scene', 'unused tree', 'unused mesh'):
            root = document(LIMIT // 8, 'SCALAR')
            root['nodes'].append({'mesh': 0})
            root['scenes'][0]['nodes'].append(1)
            module.validate_glb(glb(root))
            root['accessors'].append({'componentType': 5121, 'type': 'SCALAR', 'count': 1})
            root['meshes'].append({'primitives': [{'attributes': {'_EXTRA': 1}}]})
            if placement != 'unused mesh':
                root['nodes'].append({'mesh': 1})
                if placement == 'scene':
                    root['scenes'].append({'nodes': [2]})
            with self.subTest(placement=placement), self.assertRaisesRegex(ValueError, 'referenced geometry'):
                module.validate_glb(glb(root))

    def test_small_real_strip_and_fan_rejected_directly_and_in_zip(self):
        for mode in (5, 6):
            data = small_topology(mode)
            self.assertLess(len(data), 1000)
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'TRIANGLES'):
                module.validate_glb(data)
            with tempfile.TemporaryDirectory(prefix='triangle-') as directory:
                with self.assertRaisesRegex(ValueError, 'TRIANGLES'):
                    module.load_package(write_package(directory, data), set())

    def test_small_shared_static_default4_and_explicit4_zip_preserve_bytes(self):
        for mode in (None, 4):
            root = document()
            if mode is not None:
                root['meshes'][0]['primitives'][0]['mode'] = mode
            root['meshes'][0]['primitives'][0]['attributes']['_CUSTOM'] = 0
            root['meshes'][0]['primitives'][0]['targets'] = []
            root['nodes'].append({'mesh': 0})
            root['scenes'].append({'nodes': [0, 1]})
            data = glb(root)
            module.validate_glb(data)
            with tempfile.TemporaryDirectory(prefix='triangle-') as directory:
                _, payloads, _, _ = module.load_package(write_package(directory, data), set())
                self.assertEqual(payloads['assets/model.glb'], data)

    def test_real_originals_remain_read_only_through_all_entrypoints(self):
        for name in ('jd017_e_web.glb', 'jd019_b_web.glb'):
            path = ROOT / 'public/images/glb' / name
            before = path.read_bytes()
            module.validate_glb(before)
            with tempfile.TemporaryDirectory(prefix='triangle-') as directory:
                _, payloads, _, _ = module.load_package(write_package(directory, before), set())
                self.assertEqual(payloads['assets/model.glb'], before)
            self.assertEqual(path.read_bytes(), before)

    @unittest.skipUnless((QA / 'browser-packages').is_dir(), 'External browser QA artifacts are absent in this checkout')
    def test_six_browser_qa_packages_remain_read_only(self):
        paths = [QA / 'browser-packages' / project / f'{project_id}.zip'
                 for project in ('chromium', 'Mobile-Chrome', 'Mobile-Safari') for project_id in ('jd996', 'jd997')]
        self.assertEqual(len(paths), 6)
        for path in paths:
            before = path.read_bytes()
            digest = hashlib.sha256(before).hexdigest()
            manifest, payloads, assets, returned = module.load_package(path, set(), digest)
            self.assertEqual(manifest['project']['id'], path.stem)
            self.assertEqual(returned, digest)
            for asset in assets.values():
                self.assertEqual(hashlib.sha256(payloads[asset['path']]).hexdigest(), asset['sha256'])
            self.assertEqual(path.read_bytes(), before)
