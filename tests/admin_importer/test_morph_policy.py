"""User-approved static-product GLB policy: do not invoke a loader/GPU."""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('morph_policy_importer', ROOT / 'scripts/import-admin-submissions.py')
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def glb(target_count, vertex_count=3):
    document = {
        'asset': {'version': '2.0'},
        'accessors': [{'componentType':5126,'count':vertex_count,'type':'VEC3'} for _ in range(2)],
        'meshes': [{'primitives': [{'attributes': {'POSITION':0}, 'targets':[{'POSITION':1} for _ in range(target_count)]}]}],
        'nodes': [{'mesh':0}], 'scenes':[{'nodes':[0]}], 'scene':0,
    }
    payload = json.dumps(document,separators=(',',':')).encode()
    payload += b' ' * (-len(payload)%4)
    return b'glTF'+struct.pack('<II',2,20+len(payload))+struct.pack('<I4s',len(payload),b'JSON')+payload

class MorphPolicyTests(unittest.TestCase):
    def test_uploaded_morphs_are_rejected_including_repeated_reference_expansion(self):
        for data in (glb(1),glb(256,999999)):
            with self.subTest(bytes=len(data)):
                self.assertLess(len(data),10000)
                with self.assertRaisesRegex(ValueError,'[Mm]orph|모프'):
                    module.validate_glb(data)

    def test_empty_metadata_and_real_originals_remain_valid(self):
        module.validate_glb(glb(0))
        for filename in ('jd017_e_web.glb','jd019_b_web.glb'):
            module.validate_glb((ROOT/'public/images/glb'/filename).read_bytes())
