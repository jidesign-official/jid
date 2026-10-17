"""Static-only new-package policy. Exhaustion probes never enter a loader/GPU."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

from test_importer import glb, package

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('static_policy_importer', ROOT / 'scripts/import-admin-submissions.py')
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def static_document():
    return {'asset': {'version': '2.0'},
            'accessors': [{'componentType': 5126, 'type': 'VEC3', 'count': 3, 'min': [0, 0, 0], 'max': [0, 0, 0]}],
            'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}],
            'nodes': [{'mesh': 0}, {'mesh': 0}], 'scenes': [{'nodes': [0, 1]}], 'scene': 0}


def animation_probe():
    document = static_document()
    document['accessors'] += [{'componentType': 5126, 'type': 'SCALAR', 'count': 999999},
                              {'componentType': 5122, 'type': 'VEC4', 'count': 999999, 'normalized': True}]
    document['animations'] = [{'samplers': [{'input': 1, 'output': 2}],
                              'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'rotation'}} for _ in range(256)]}]
    return glb(document)


def small_animation():
    document = static_document()
    binary = struct.pack('<8f', 0, 1, 0, 0, 0, 1, 0, 0)
    document['buffers'] = [{'byteLength': len(binary)}]
    document['bufferViews'] = [{'buffer': 0, 'byteLength': 8}, {'buffer': 0, 'byteOffset': 8, 'byteLength': 24}]
    document['accessors'] += [{'bufferView': 0, 'componentType': 5126, 'type': 'SCALAR', 'count': 2, 'min': [0], 'max': [1]},
                              {'bufferView': 1, 'componentType': 5126, 'type': 'VEC3', 'count': 2}]
    document['animations'] = [{'samplers': [{'input': 1, 'output': 2}],
                              'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'translation'}}]}]
    return glb(document, binary)


def write_package(directory, data):
    # Reuse existing genuine PNG and manifest builder; never use QA artifact paths.
    manifest, files = package()
    manifest['models'] = ['model']
    manifest['assets'].append({'id': 'model', 'path': 'assets/model.glb', 'name': 'model.glb',
                               'kind': 'model', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    files['assets/model.glb'] = data
    path = Path(directory) / 'jd046.zip'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('project.json', json.dumps(manifest))
        for name, payload in files.items():
            archive.writestr(name, payload)
    return path


def attribute_documents(semantic):
    base = static_document()
    primitive = {'attributes': {'POSITION': 0, semantic: 1}}
    accessors = base['accessors'] + [{'componentType': 5123 if semantic.startswith('JOINTS_') else 5126,
                                    'type': 'VEC4', 'count': 3}]
    return [
        dict(base, accessors=accessors, meshes=[{'primitives': [primitive]}]),
        dict(base, accessors=accessors, meshes=base['meshes'] + [{'primitives': [primitive]}]),
        dict(base, accessors=accessors, meshes=[{'primitives': base['meshes'][0]['primitives'] + [primitive]}]),
        dict(base, accessors=accessors, meshes=base['meshes'] + [{'primitives': [primitive]}],
             nodes=[{'mesh': 0}, {'mesh': 1}], scenes=[{'nodes': [0]}, {'nodes': [1]}]),
    ]


class StaticGlbPolicyTests(unittest.TestCase):
    def test_normalized_animation_amplification_rejected_before_loading(self):
        data = animation_probe()
        self.assertLess(len(data), 25000)
        with self.assertRaisesRegex(ValueError, '[Aa]nimation|애니메이션'):
            module.validate_glb(data)

    def test_genuine_small_animation_rejected(self):
        with self.assertRaisesRegex(ValueError, '[Aa]nimation|애니메이션'):
            module.validate_glb(small_animation())

    def test_load_package_rejects_genuine_small_animation(self):
        with tempfile.TemporaryDirectory(prefix='static-policy-') as directory:
            path = write_package(directory, small_animation())
            self.assertLess(path.stat().st_size, 5000)
            with self.assertRaisesRegex(ValueError, '[Aa]nimation|애니메이션'):
                module.load_package(path, set())

    def test_present_animation_values_rejected(self):
        for value in (None, {}, 0, False, '', [{}]):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '[Aa]nimation|애니메이션'):
                module.validate_glb(glb(dict(static_document(), animations=value)))

    def test_absent_and_empty_animation_metadata_accepted(self):
        for document in (static_document(), dict(static_document(), animations=[]), {'asset': {'version': '2.0'}, 'animations': []}):
            module.validate_glb(glb(document))

    def test_present_skin_values_and_unused_definitions_rejected(self):
        for value in (None, {}, 0, False, '', [{}], [{'joints': [0]}]):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '[Ss]kin|스켈레톤'):
                module.validate_glb(glb(dict(static_document(), skins=value)))

    def test_any_node_skin_rejected_in_unused_and_nondefault_scene_nodes(self):
        for value in (0, None, False, {}, [], '0'):
            for scenes in ([{'nodes': [0]}], [{'nodes': [0]}, {'nodes': [1]}]):
                document = dict(static_document(), nodes=[{'mesh': 0}, {'mesh': 0, 'skin': value}], scenes=scenes)
                with self.subTest(value=value, scenes=scenes), self.assertRaisesRegex(ValueError, '[Ss]kin|스켈레톤'):
                    module.validate_glb(glb(document))

    def test_load_package_rejects_skin_definitions_and_undeclared_node_skin(self):
        for document in (dict(static_document(), skins=[{'joints': [0]}]),
                         dict(static_document(), nodes=[{'mesh': 0, 'skin': 0}, {'mesh': 0}])):
            with tempfile.TemporaryDirectory(prefix='static-policy-') as directory:
                path = write_package(directory, glb(document))
                with self.assertRaisesRegex(ValueError, '[Ss]kin|스켈레톤'):
                    module.load_package(path, set())

    def test_empty_skin_and_animation_lists_with_shared_mesh_accepted(self):
        data = glb(dict(static_document(), skins=[], animations=[]))
        module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='static-policy-') as directory:
            _, payloads, _, _ = module.load_package(write_package(directory, data), set())
            self.assertEqual(payloads['assets/model.glb'], data)

    def test_node_and_mesh_weights_rejected_in_all_definitions(self):
        for value in ([0], [1], None, {}, 0, False, ''):
            base = static_document()
            for document in (
                dict(base, nodes=[{'mesh': 0}, {'mesh': 0, 'weights': value}], scenes=[{'nodes': [0]}]),
                dict(base, nodes=[{'mesh': 0}, {'mesh': 0, 'weights': value}], scenes=[{'nodes': [0]}, {'nodes': [1]}]),
                dict(base, meshes=base['meshes'] + [dict(base['meshes'][0], weights=value)]),
            ):
                with self.subTest(value=value), self.assertRaisesRegex(ValueError, '[Ww]eights|가중치'):
                    module.validate_glb(glb(document))

    def test_joint_and_weight_attributes_rejected_in_all_primitives(self):
        for semantic in ('JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_7', 'JOINTS_custom', 'WEIGHTS_'):
            for document in attribute_documents(semantic):
                with self.subTest(semantic=semantic), self.assertRaisesRegex(ValueError, 'JOINTS_|WEIGHTS_|스켈레톤'):
                    module.validate_glb(glb(document))

    def test_load_package_rejects_weight_and_joint_metadata(self):
        base = static_document()
        for document in (
            dict(base, nodes=[{'mesh': 0, 'weights': [0]}, {'mesh': 0}]),
            dict(base, meshes=[dict(base['meshes'][0], weights=[0])]),
            attribute_documents('JOINTS_0')[2], attribute_documents('WEIGHTS_0')[1],
        ):
            with tempfile.TemporaryDirectory(prefix='static-policy-') as directory:
                with self.assertRaisesRegex(ValueError, '[Ww]eights|JOINTS_|WEIGHTS_|가중치'):
                    module.load_package(write_package(directory, glb(document)), set())

    def test_empty_weights_and_targets_on_static_shared_mesh_accepted(self):
        base = static_document()
        data = glb(dict(base, animations=[], skins=[],
                        nodes=[dict(node, weights=[]) for node in base['nodes']],
                        meshes=[{'weights': [], 'primitives': [{'attributes': {'POSITION': 0, '_JOINTS_0': 0, 'COLOR_0': 0}, 'targets': []}]}]))
        module.validate_glb(data)
        with tempfile.TemporaryDirectory(prefix='static-policy-') as directory:
            _, payloads, _, _ = module.load_package(write_package(directory, data), set())
            self.assertEqual(payloads['assets/model.glb'], data)

    def test_nonempty_and_malformed_morph_targets_still_rejected_everywhere(self):
        for targets in ([{'POSITION': 0}], None, {}, 0, False):
            base = static_document()
            primitive = {'attributes': {'POSITION': 0}, 'targets': targets}
            for meshes in (base['meshes'] + [{'primitives': [primitive]}],
                           [{'primitives': base['meshes'][0]['primitives'] + [primitive]}]):
                with self.subTest(targets=targets), self.assertRaisesRegex(ValueError, '[Mm]orph|모프'):
                    module.validate_glb(glb(dict(base, meshes=meshes)))

    def test_real_static_originals_accepted_unchanged(self):
        for name in ('jd017_e_web.glb', 'jd019_b_web.glb'):
            path = ROOT / 'public/images/glb' / name
            before = path.read_bytes()
            module.validate_glb(before)
            self.assertEqual(path.read_bytes(), before)
