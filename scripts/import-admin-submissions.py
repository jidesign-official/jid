#!/usr/bin/env python3
"""Import offline portfolio packages using only Python's standard library."""
import argparse
import base64
import binascii
import hashlib
import io
import json
import math
import os
import shutil
import tempfile
import stat
import struct
import zlib
from pathlib import Path
import sys
import re
import zipfile

MAX_PACKAGE = 25 * 1024 * 1024
MAX_UNCOMPRESSED = 50 * 1024 * 1024
MAX_TOTAL = 1_000_000_000
PROJECT_ID = re.compile(r"jd[0-9]{3}(?:_[a-z]+)?\Z")
ITEM_ID = re.compile(r"[a-zA-Z0-9_-]{1,80}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def shape(value, keys, label):
    require(type(value) is dict and set(value) == set(keys.split()), f"Invalid {label} fields")


def integer(value, minimum, maximum, label):
    require(type(value) is int and minimum <= value <= maximum, f"Invalid {label}")


def text(value, maximum, label, nonblank=False):
    require(type(value) is str and len(value) <= maximum, f"Invalid {label}")
    require(not nonblank or bool(value.strip()), f"Blank {label}")
    require(not any(0xD800 <= ord(c) <= 0xDFFF or ord(c) < 32 and c not in '\n\r\t' for c in value), f"Invalid {label} characters")


def item_id(value):
    require(type(value) is str and ITEM_ID.fullmatch(value) is not None, "Invalid asset/block ID")


def validate_manifest(package, payloads):
    shape(package, "schemaVersion project blocks models assets", "package")
    integer(package['schemaVersion'], 1, 1, 'schemaVersion')
    project = package['project']
    shape(project, "id title category thumbnail", "project")
    require(type(project['id']) is str and PROJECT_ID.fullmatch(project['id']) is not None, 'Invalid project ID')
    text(project['title'], 200, 'title', nonblank=True)
    require(project['category'] in ('Product', 'UX/UI'), 'Invalid category')
    require(type(package['assets']) is list and 1 <= len(package['assets']) <= 60, 'Invalid asset count')
    assets = {}
    for asset in package['assets']:
        require(type(asset) is dict and asset.get('kind') in ('image', 'model'), 'Invalid asset kind')
        fields = 'id path name kind sha256 bytes' + (' width height' if asset['kind'] == 'image' else '')
        shape(asset, fields, 'asset')
        item_id(asset['id'])
        require(asset['id'] not in assets, 'Duplicate asset ID')
        assets[asset['id']] = asset
        text(asset['name'], 10000, 'asset name')
        require(type(asset['path']) is str and asset['path'] in payloads, 'Missing asset file')
        integer(asset['bytes'], 1, MAX_UNCOMPRESSED, 'asset bytes')
        require(type(asset['sha256']) is str and re.fullmatch('[0-9a-f]{64}', asset['sha256']) is not None, 'Invalid SHA-256')
        data = payloads[asset['path']]
        require(len(data) == asset['bytes'], 'Asset byte length mismatch')
        require(hashlib.sha256(data).hexdigest() == asset['sha256'], 'Asset SHA-256 mismatch')
        if asset['kind'] == 'image':
            integer(asset['width'], 1, 8192, 'image width')
            integer(asset['height'], 1, 8192, 'image height')
            require(asset['width'] * asset['height'] <= 40_000_000, 'Image pixel limit exceeded')
            require(image_dimensions(data, Path(asset['path']).suffix.lower()) == (asset['width'], asset['height']), 'Image dimensions mismatch')
        else:
            require(Path(asset['path']).suffix.lower() == '.glb', 'Model extension must be GLB')
            validate_glb(data)
    require(type(package['models']) is list and len(package['models']) <= 4, 'Invalid model count')
    referenced = set()

    def reference(asset_id, kind):
        item_id(asset_id)
        require(asset_id in assets and assets[asset_id]['kind'] == kind, f'Missing {kind} asset')
        referenced.add(asset_id)

    reference(project['thumbnail'], 'image')
    for asset_id in package['models']:
        reference(asset_id, 'model')
    require(len(set(package['models'])) == len(package['models']), 'Duplicate model reference')
    require(type(package['blocks']) is list and len(package['blocks']) <= 100, 'Invalid block count')
    ids = set()
    for block in package['blocks']:
        require(type(block) is dict, 'Invalid block')
        item_id(block.get('id'))
        require(block['id'] not in ids, 'Duplicate block ID')
        ids.add(block['id'])
        kind = block.get('type')
        if kind == 'images':
            shape(block, 'id type columns images', 'image block')
            integer(block['columns'], 1, 4, 'image columns')
            require(type(block['images']) is list and 1 <= len(block['images']) <= 12, 'Invalid image count')
            for image in block['images']:
                shape(image, 'assetId alt caption', 'image reference')
                reference(image['assetId'], 'image')
                text(image['alt'], 300, 'image alt')
                text(image['caption'], 500, 'image caption')
        elif kind == 'heading':
            shape(block, 'id type level text', 'heading')
            integer(block['level'], 2, 3, 'heading level')
            text(block['text'], 200, 'heading text')
        elif kind == 'paragraph':
            shape(block, 'id type text', 'paragraph')
            text(block['text'], 10000, 'paragraph text')
        elif kind == 'spacer':
            shape(block, 'id type size', 'spacer')
            require(block['size'] in ('small', 'medium', 'large'), 'Invalid spacer size')
        elif kind == 'divider':
            shape(block, 'id type', 'divider')
        else:
            raise ValueError('Unknown block type')
    require(referenced == set(assets), 'Unreferenced assets')
    require(len({asset['path'] for asset in assets.values()}) == len(assets), 'Duplicate asset path')
    return assets


def image_dimensions(data, suffix):
    """Inspect container signatures/dimensions, without allocating decoded pixels."""
    if suffix == '.png':
        require(data.startswith(b'\x89PNG\r\n\x1a\n'), 'Invalid PNG signature')
        offset, dimensions, seen_data = 8, None, False
        while offset < len(data):
            require(offset + 12 <= len(data), 'Truncated PNG chunk')
            length = struct.unpack_from('>I', data, offset)[0]
            kind = data[offset + 4:offset + 8]
            end = offset + 12 + length
            require(end <= len(data), 'Truncated PNG payload')
            body = data[offset + 8:end - 4]
            crc = struct.unpack_from('>I', data, end - 4)[0]
            require(zlib.crc32(kind + body) == crc, 'PNG CRC mismatch')
            if dimensions is None:
                require(kind == b'IHDR' and length == 13, 'Missing PNG IHDR')
                width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
                allowed = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
                require(color in allowed and depth in allowed[color] and compression == 0 and filtering == 0 and interlace in (0, 1), 'Invalid PNG IHDR')
                dimensions = (width, height)
            elif kind == b'IHDR':
                raise ValueError('Duplicate PNG IHDR')
            if kind == b'IDAT':
                seen_data = True
            if kind == b'IEND':
                require(length == 0 and end == len(data) and seen_data, 'Invalid PNG IEND')
                return dimensions
            offset = end
        raise ValueError('Missing PNG IEND')
    if suffix in ('.jpg', '.jpeg'):
        require(data.startswith(b'\xff\xd8') and data.endswith(b'\xff\xd9'), 'Invalid JPEG signature')
        offset, dimensions = 2, None
        sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while offset < len(data) - 2:
            require(data[offset] == 255, 'Invalid JPEG marker')
            while offset < len(data) and data[offset] == 255:
                offset += 1
            require(offset < len(data), 'Truncated JPEG marker')
            marker = data[offset]
            offset += 1
            require(marker not in (0, 0xD8, 0xD9), 'Unexpected JPEG marker')
            if marker == 1 or 0xD0 <= marker <= 0xD7:
                continue
            require(offset + 2 <= len(data), 'Truncated JPEG segment')
            length = struct.unpack_from('>H', data, offset)[0]
            require(length >= 2 and offset + length <= len(data) - 2, 'Invalid JPEG segment length')
            if marker in sof:
                require(length >= 8, 'Truncated JPEG SOF')
                height, width = struct.unpack_from('>HH', data, offset + 3)
                components = data[offset + 7]
                require(components > 0 and length == 8 + 3 * components, 'Invalid JPEG SOF')
                require(dimensions is None or dimensions == (width, height), 'Conflicting JPEG dimensions')
                dimensions = (width, height)
            if marker == 0xDA:
                require(dimensions is not None and offset + length < len(data) - 2, 'JPEG has no image data')
                return dimensions
            offset += length
        raise ValueError('JPEG has no scan')
    if suffix == '.webp':
        require(len(data) >= 20 and data[:4] == b'RIFF' and data[8:12] == b'WEBP', 'Invalid WebP signature')
        require(struct.unpack_from('<I', data, 4)[0] + 8 == len(data), 'WebP RIFF length mismatch')
        offset, canvas, dimensions, frames = 12, None, None, False
        while offset < len(data):
            require(offset + 8 <= len(data), 'Truncated WebP chunk')
            kind, length = struct.unpack_from('<4sI', data, offset)
            end = offset + 8 + length
            require(end + (length % 2) <= len(data), 'Truncated WebP payload')
            body = data[offset + 8:end]
            if kind == b'VP8X':
                require(canvas is None and length == 10 and offset == 12, 'Invalid WebP extended header')
                canvas = (1 + int.from_bytes(body[4:7], 'little'), 1 + int.from_bytes(body[7:10], 'little'))
            elif kind == b'VP8 ':
                require(dimensions is None and length >= 10 and not body[0] & 1 and body[3:6] == b'\x9d\x01\x2a', 'Invalid WebP VP8 frame')
                width, height = struct.unpack_from('<HH', body, 6)
                dimensions = (width & 0x3FFF, height & 0x3FFF)
                frames = True
            elif kind == b'VP8L':
                require(dimensions is None and length >= 5 and body[0] == 0x2F, 'Invalid WebP lossless frame')
                bits = int.from_bytes(body[1:5], 'little')
                require(bits >> 29 == 0, 'Unsupported WebP version')
                dimensions = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
                frames = True
            elif kind == b'ANMF':
                require(canvas is not None and length >= 16, 'Invalid animated WebP frame')
                frames = True
            offset = end + length % 2
        require(frames and (canvas is not None or dimensions is not None), 'WebP has no image frame')
        require(canvas is None or dimensions is None or canvas == dimensions, 'WebP canvas dimensions mismatch')
        return canvas or dimensions
    raise ValueError('Image extension must be PNG/JPEG/WebP')


def data_uri(value, *, validate_image=True):
    require(type(value) is str, 'GLB URI must be text')
    require(len(value) <= 4 * ((MAX_UNCOMPRESSED + 2) // 3) + 64, 'GLB data URI exceeds limit')
    match = re.fullmatch(r'data:(image/(?:png|jpeg|webp)|application/octet-stream);base64,([A-Za-z0-9+/]*={0,2})', value)
    require(match is not None, 'External or unsupported GLB URI')
    mime, encoded = match.groups()
    decoded = base64.b64decode(encoded, validate=True)
    require(0 < len(decoded) <= MAX_UNCOMPRESSED and base64.b64encode(decoded).decode('ascii') == encoded,
            'Invalid or oversized GLB base64 data')
    if validate_image:
        validate_data_uri_image(mime, decoded)
    return mime, decoded


def validate_data_uri_image(mime, decoded):
    if mime.startswith('image/'):
        width, height = image_dimensions(decoded, {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}[mime])
        integer(width, 1, 8192, 'GLB image width')
        integer(height, 1, 8192, 'GLB image height')
        require(width * height <= 40_000_000, 'GLB image pixel limit exceeded')


MAX_GEOMETRY = 64 * 1024 * 1024
MAX_REFERENCED_GEOMETRY = 64 * 1024 * 1024


def validate_accessors(document, views, buffers):
    """Bound loader allocations, including zero-fill, interleaving and sparse copies."""
    accessors = document.get('accessors', [])
    require(type(accessors) is list, 'Invalid GLB accessors')
    components = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    layouts = {'SCALAR': (1, 1), 'VEC2': (1, 2), 'VEC3': (1, 3), 'VEC4': (1, 4),
               'MAT2': (2, 2), 'MAT3': (3, 3), 'MAT4': (4, 4)}
    budget = 0
    reference_costs = []

    def region(index, offset, count, element, alignment, stride_allowed=False):
        integer(index, 0, len(views) - 1, 'GLB accessor bufferView')
        view = views[index]
        integer(offset, 0, view['byteLength'], 'GLB accessor offset')
        require(offset % alignment == 0 and (view.get('byteOffset', 0) + offset) % alignment == 0,
                'Misaligned GLB accessor')
        stride = view.get('byteStride', element)
        require(stride_allowed or 'byteStride' not in view, 'Strided GLB sparse data')
        require(stride >= element and stride % alignment == 0, 'Invalid GLB accessor stride')
        require(offset + (count - 1) * stride + element <= view['byteLength'], 'GLB accessor exceeds bufferView')
        start = view.get('byteOffset', 0) + offset
        return buffers[view['buffer']], start

    for accessor in accessors:
        require(type(accessor) is dict, 'Invalid GLB accessor')
        component, kind, count = accessor.get('componentType'), accessor.get('type'), accessor.get('count')
        require(type(component) is int and component in components and type(kind) is str and kind in layouts,
                'Invalid GLB accessor component/type')
        integer(count, 1, MAX_GEOMETRY // 4, 'GLB accessor count')
        size = components[component]
        columns, rows = layouts[kind]
        alignment = max(size, 4) if columns > 1 else size
        element = columns * ((rows * size + alignment - 1) // alignment * alignment)
        reference_cost = count * columns * rows * max(size, 4)
        budget += reference_cost
        require(budget <= MAX_GEOMETRY, 'GLB decoded geometry exceeds 64 MiB')
        if 'normalized' in accessor:
            require(type(accessor['normalized']) is bool and (not accessor['normalized'] or component in (5120, 5121, 5122, 5123)),
                    'Invalid GLB accessor normalized')
        offset = accessor.get('byteOffset', 0)
        if 'bufferView' in accessor:
            region(accessor['bufferView'], offset, count, element, alignment, True)
            budget += views[accessor['bufferView']]['byteLength']
        else:
            integer(offset, 0, 0, 'GLB zero-filled accessor offset')
        if 'sparse' in accessor:
            sparse = accessor['sparse']
            require(type(sparse) is dict, 'Invalid GLB sparse accessor')
            n = sparse.get('count')
            integer(n, 1, count, 'GLB sparse count')
            indices, values = sparse.get('indices'), sparse.get('values')
            require(type(indices) is dict and type(values) is dict, 'Invalid GLB sparse sources')
            c = indices.get('componentType')
            require(type(c) is int and c in (5121, 5123, 5125), 'Invalid GLB sparse index component')
            index_size = components[c]
            raw, start = region(indices.get('bufferView'), indices.get('byteOffset', 0), n, index_size, index_size)
            region(values.get('bufferView'), values.get('byteOffset', 0), n, element, alignment)
            budget += n * (element + index_size)
            require(budget <= MAX_GEOMETRY, 'GLB decoded geometry exceeds 64 MiB')
            previous = -1
            for i in range(n):
                index = int.from_bytes(raw[start + i * index_size:start + (i + 1) * index_size], 'little')
                require(previous < index < count, 'GLB sparse indices must be increasing and in range')
                previous = index
        require(budget <= MAX_GEOMETRY, 'GLB decoded geometry exceeds 64 MiB')
        reference_costs.append(reference_cost)
    return reference_costs


def validate_glb_graph(document, accessor_costs):
    """Bound Object3D/mesh expansion without constructing any loader objects."""
    maximum = 4096

    def add_work(total, cost):
        require(cost <= MAX_REFERENCED_GEOMETRY - total,
                'GLB referenced geometry processing exceeds 64 MiB; simplify the model or reduce repeated mesh / scene references')
        return total + cost
    for field in ('animations', 'skins'):
        if field in document:
            require(type(document[field]) is list and not document[field],
                    f'Animations / skins ({field}) are not supported in newly uploaded static product GLBs')

    def empty_weights(value):
        if 'weights' in value:
            require(type(value['weights']) is list and not value['weights'],
                    'Only empty weights arrays are supported in newly uploaded static product GLBs')

    def records(value, label, limit):
        require(type(value) is list and len(value) <= limit, f'GLB {label} limit {limit}')
        require(all(type(item) is dict for item in value), f'Invalid GLB {label}')
        return value

    def reference(value, length):
        integer(value, 0, length - 1, 'GLB reference')

    def references(value, length):
        require(type(value) is list, 'Invalid GLB graph reference list')
        for index in value:
            reference(index, length)
        return value

    meshes = records(document.get('meshes', []), 'meshes', 1024)
    nodes = records(document.get('nodes', []), 'nodes', maximum)
    scenes = records(document.get('scenes', []), 'scenes', maximum)
    accessor_count = len(accessor_costs)
    primitive_counts, defined_primitives = [], 0
    mesh_costs, defined_work = [], 0
    for mesh in meshes:
        empty_weights(mesh)
        primitives = records(mesh.get('primitives'), 'primitives', maximum)
        require(bool(primitives), 'Invalid GLB mesh primitives')
        defined_primitives += len(primitives)
        require(defined_primitives <= maximum, 'GLB primitive definitions exceed 4096')
        mesh_work = 0
        for primitive in primitives:
            if 'mode' in primitive:
                require(type(primitive['mode']) is int and primitive['mode'] == 4,
                        'Newly uploaded GLBs support TRIANGLES (mode 4) only; export triangles instead of strip / fan')
            attributes = primitive.get('attributes')
            require(type(attributes) is dict, 'Invalid GLB primitive attributes')
            require(not any(semantic.startswith(('JOINTS_', 'WEIGHTS_')) for semantic in attributes),
                    'JOINTS_ / WEIGHTS_ attributes are not supported in newly uploaded static product GLBs')
            for index in attributes.values():
                reference(index, accessor_count)
                defined_work = add_work(defined_work, accessor_costs[index])
                mesh_work = add_work(mesh_work, accessor_costs[index])
            if 'indices' in primitive:
                reference(primitive['indices'], accessor_count)
                cost = accessor_costs[primitive['indices']]
                defined_work = add_work(defined_work, cost)
                mesh_work = add_work(mesh_work, cost)
            if 'targets' in primitive:
                targets = records(primitive['targets'], 'morph targets', maximum)
                for target in targets:
                    for index in target.values():
                        reference(index, accessor_count)
                require(not targets, 'Morph targets are not supported in newly uploaded product GLBs')
        primitive_counts.append(len(primitives))
        mesh_costs.append(mesh_work)
    parents, children, used_meshes = [0] * len(nodes), [], set()
    for node in nodes:
        empty_weights(node)
        require('skin' not in node, 'Node skin is not supported in newly uploaded static product GLBs')
        if 'mesh' in node:
            reference(node['mesh'], len(meshes))
            used_meshes.add(node['mesh'])
        child_list = references(node.get('children', []), len(nodes))
        for child in child_list:
            parents[child] += 1
            require(parents[child] == 1, 'GLB graph repeated child / multiple parents')
        children.append(child_list)
    states, stats = [0] * len(nodes), [(0, 0, 0, 0)] * len(nodes)

    def visit(index, depth):
        require(depth <= 64, 'GLB graph depth exceeds 64')
        require(states[index] != 1, 'GLB graph cycle')
        if states[index] == 2:
            return stats[index]
        states[index] = 1
        count, height = 1, 1
        primitives = primitive_counts[nodes[index]['mesh']] if 'mesh' in nodes[index] else 0
        work = mesh_costs[nodes[index]['mesh']] if 'mesh' in nodes[index] else 0
        for child in children[index]:
            child_count, child_primitives, child_height, child_work = visit(child, depth + 1)
            count += child_count
            primitives += child_primitives
            work = add_work(work, child_work)
            height = max(height, child_height + 1)
            require(count <= maximum and primitives <= maximum, 'GLB expansion exceeds 4096')
            require(height <= 64, 'GLB graph depth exceeds 64')
        states[index] = 2
        stats[index] = (count, primitives, height, work)
        return stats[index]

    for index in range(len(nodes)):
        visit(index, 1)
    if 'scene' in document:
        reference(document['scene'], len(scenes))
    expanded_nodes = 0
    # Charge unused mesh definitions too, without double-charging active definitions.
    expanded_primitives = sum(count for index, count in enumerate(primitive_counts) if index not in used_meshes)
    # Definition work is a separate bound; charge only unused definitions here.
    expanded_work = 0
    for index, cost in enumerate(mesh_costs):
        if index not in used_meshes:
            expanded_work = add_work(expanded_work, cost)
    scene_roots = set()

    def charge(index):
        nonlocal expanded_nodes, expanded_primitives, expanded_work
        expanded_work = add_work(expanded_work, stats[index][3])
        expanded_nodes += stats[index][0]
        expanded_primitives += stats[index][1]
        require(expanded_nodes <= maximum and expanded_primitives <= maximum,
                'GLB expansion exceeds 4096 nodes / mesh primitives')

    for scene in scenes:
        unique = set()
        for index in references(scene.get('nodes', []), len(nodes)):
            require(parents[index] == 0 and index not in unique,
                    'GLB graph scene roots must be unique and parentless')
            unique.add(index)
            scene_roots.add(index)
            charge(index)  # Every scene instance, not only the default scene.
    # Every unused tree counts once; missing scenes remain valid metadata.
    for index in range(len(nodes)):
        if parents[index] == 0 and index not in scene_roots:
            charge(index)
    return (len(nodes), defined_primitives, len(scenes), expanded_nodes, expanded_primitives)


def validate_glb_textures(document, image_pixels):
    """Independent base-level processing metric, not total GPU memory."""
    textures = document.get('textures', [])
    samplers = document.get('samplers', [])
    require(type(textures) is list and len(textures) <= 128, 'GLB textures limit 128')
    require(type(samplers) is list and len(samplers) <= 128, 'GLB samplers limit 128')
    enums = {'magFilter': (9728, 9729), 'minFilter': (9728, 9729, 9984, 9985, 9986, 9987),
             'wrapS': (33071, 33648, 10497), 'wrapT': (33071, 33648, 10497)}
    for sampler in samplers:
        require(type(sampler) is dict, 'Invalid GLB sampler')
        for field, allowed in enums.items():
            if field in sampler:
                require(type(sampler[field]) is int and sampler[field] in allowed, f'Invalid GLB sampler {field}')
    work = 0
    for texture in textures:
        require(type(texture) is dict, 'Invalid GLB texture')
        if 'sampler' in texture:
            integer(texture['sampler'], 0, len(samplers) - 1, 'GLB texture sampler reference')
        sources = [texture['source']] if 'source' in texture else []
        if 'extensions' in texture:
            extensions = texture['extensions']
            require(type(extensions) is dict, 'Invalid GLB texture extensions')
            for name in ('EXT_texture_webp', 'EXT_texture_avif'):
                if name in extensions:
                    alternate = extensions[name]
                    require(type(alternate) is dict, 'Invalid GLB texture source extension')
                    sources.append(alternate.get('source'))
        require(bool(sources), 'GLB texture source is required')
        for source in sources:
            integer(source, 0, len(image_pixels) - 1, 'GLB texture source reference')
            # Sum every source slot (even aliases) and every definition. Factor two
            # covers the current uncustomized Three loader's color-space variants.
            work += 2 * image_pixels[source]
            require(work <= 40_000_000,
                    'GLB texture processing exceeds 40,000,000 base-level pixel units; reduce repeated texture definitions or image dimensions')


def validate_glb_metadata(document, source_bytes, graph, image_defs):
    """Conservative source-derived copy work; no loader objects or mutations."""
    materials = document.get('materials', [])
    require(type(materials) is list and all(type(item) is dict for item in materials),
            'GLB materials must be an array of records')
    maximum = 64 * 1024 * 1024
    message = 'GLB metadata processing exceeds 64 MiB; reduce extras / extensions / names or repeated mesh / scene / material references'
    require(0 < source_bytes <= maximum, message)
    max_clones, clones = maximum // source_bytes, 1

    def charge(count, factor):
        nonlocal clones
        # Check remaining/division BEFORE multiplication, without expansion.
        require(count <= (max_clones - clones) // factor, message)
        clones += count * factor

    for count in graph:
        charge(count, 4)
    charge(len(materials) + 1, 9)  # <=8 TRIANGLES material variants + base/default.
    charge(len(document.get('textures', [])), 4)
    charge(image_defs, 1)
    pending = list(materials)
    while pending:
        value = pending.pop()
        if type(value) is list:
            pending.extend(value)
        elif type(value) is dict:
            for key, child in value.items():
                # Unknown extensions/extras count too, irrespective of refs.
                # Metallic/roughness assigns one textureInfo to TWO material maps.
                if key.endswith('Texture'):
                    charge(2 if key == 'metallicRoughnessTexture' else 1, 2)
                pending.append(child)


def validate_glb(data):
    require(len(data) >= 20, 'Truncated GLB')
    magic, version, declared = struct.unpack_from('<4sII', data)
    require(magic == b'glTF' and version == 2 and declared == len(data), 'Invalid GLB header')
    offset, document, binary, chunks = 12, None, None, 0
    metadata_bytes = []
    while offset < len(data):
        require(offset + 8 <= len(data), 'Truncated GLB chunk header')
        length, kind = struct.unpack_from('<I4s', data, offset)
        end = offset + 8 + length
        require(length % 4 == 0 and end <= len(data), 'Invalid GLB chunk length')
        require(chunks != 0 or kind == b'JSON', 'GLB first chunk must be JSON')
        body = data[offset + 8:end]
        if kind == b'JSON':
            require(chunks == 0, 'Duplicate GLB JSON chunk')
            document = strict_json(body, metadata_bytes.append)
        elif kind == b'BIN\x00':
            require(binary is None and chunks == 1, 'Duplicate or misplaced GLB BIN chunk')
            binary = body
        offset, chunks = end, chunks + 1
    require(type(document) is dict and type(document.get('asset')) is dict and document['asset'].get('version') == '2.0', 'Invalid GLB JSON asset/version')
    require(document['asset'].get('minVersion', '2.0') == '2.0', 'Unsupported GLB minimum version')
    forbidden = {'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'EXT_mesh_gpu_instancing'}
    pending, embedded = [document], {}
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            if 'uri' in node:
                uri = node['uri']
                require(type(uri) is str, 'GLB URI must be text')
                if uri not in embedded:
                    # Decode/validate exact bytes now; container work follows
                    # the combined source-copy preflight below.
                    embedded[uri] = data_uri(uri, validate_image=False)
            for key in ('extensionsUsed', 'extensionsRequired'):
                if key in node:
                    require(type(node[key]) is list and all(type(value) is str for value in node[key]), 'Invalid GLB extension list')
                    require(not forbidden.intersection(node[key]), 'GLB requires unsupported decoder')
            if 'extensions' in node:
                require(type(node['extensions']) is dict, 'Invalid GLB extensions')
                require(not forbidden.intersection(node['extensions']), 'GLB uses unsupported decoder')
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)
    buffers = document.get('buffers', [])
    require(type(buffers) is list, 'Invalid GLB buffers')
    lengths, buffer_data, uses_binary = [], [], False
    for index, buffer in enumerate(buffers):
        require(type(buffer) is dict, 'Invalid GLB buffer')
        length = buffer.get('byteLength')
        integer(length, 1, MAX_UNCOMPRESSED, 'GLB buffer byteLength')
        if 'uri' in buffer:
            mime, decoded = embedded[buffer['uri']]
            require(mime == 'application/octet-stream' and len(decoded) == length, 'GLB data buffer length/MIME mismatch')
        else:
            require(index == 0 and binary is not None and length <= len(binary) <= length + 3, 'GLB BIN/buffer length mismatch')
            uses_binary = True
        lengths.append(length)
        buffer_data.append(decoded if 'uri' in buffer else binary[:length])
    require(binary is None or uses_binary, 'Unreferenced GLB BIN chunk')
    # Independent source-copy work, counting all definitions before sparse reads.
    source_copy_remaining = 64 * 1024 * 1024

    def charge_source_copy(length):
        nonlocal source_copy_remaining
        require(length <= source_copy_remaining,
                'GLB encoded-source-copy processing exceeds 64 MiB; reduce bufferView / image source bytes or repeated definitions')
        source_copy_remaining -= length

    views = document.get('bufferViews', [])
    require(type(views) is list, 'Invalid GLB bufferViews')
    for view in views:
        require(type(view) is dict, 'Invalid GLB bufferView')
        integer(view.get('buffer'), 0, len(lengths) - 1, 'GLB bufferView buffer')
        buffer_length = lengths[view['buffer']]
        integer(view.get('byteLength'), 1, buffer_length, 'GLB bufferView length')
        integer(view.get('byteOffset', 0), 0, buffer_length - view['byteLength'], 'GLB bufferView offset')
        if 'byteStride' in view:
            integer(view['byteStride'], 4, 252, 'GLB bufferView stride')
            require(view['byteStride'] % 4 == 0, 'Invalid GLB bufferView stride alignment')
        charge_source_copy(view['byteLength'])
    images = document.get('images', [])
    require(type(images) is list and len(images) <= 60, 'GLB images exceed 60')
    resolved_images = []
    for image in images:
        require(type(image) is dict, 'Invalid GLB image')
        if 'uri' in image:
            mime, decoded = embedded[image['uri']]
            require(mime in ('image/png', 'image/jpeg', 'image/webp') and 'bufferView' not in image,
                    'Unsupported GLB image URI or ambiguous source')
            require('mimeType' not in image or image['mimeType'] == mime, 'GLB image MIME mismatch')
        else:
            integer(image.get('bufferView'), 0, len(views) - 1, 'GLB image bufferView')
            require(image.get('mimeType') in ('image/png', 'image/jpeg', 'image/webp'), 'Unsupported embedded GLB image')
            mime = image['mimeType']
            view = views[image['bufferView']]
            start = view.get('byteOffset', 0)
            decoded = memoryview(buffer_data[view['buffer']])[start:start + view['byteLength']]
        # Per record, not per distinct source: no URI/view/cache deduplication.
        charge_source_copy(len(decoded))
        resolved_images.append((mime, decoded))
    accessor_costs = validate_accessors(document, views, buffer_data)
    graph = validate_glb_graph(document, accessor_costs)
    # Retain validation of image URIs anywhere in JSON, not only core images.
    for mime, decoded in embedded.values():
        validate_data_uri_image(mime, decoded)
    texture_pixels = 0
    image_pixels = []
    for mime, source in resolved_images:
        decoded = bytes(source) if isinstance(source, memoryview) else source
        width, height = image_dimensions(decoded, {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}[mime])
        integer(width, 1, 8192, 'GLB image width')
        integer(height, 1, 8192, 'GLB image height')
        image_pixels.append(width * height)
        texture_pixels += width * height
        require(texture_pixels <= 40_000_000, 'GLB aggregate embedded texture pixels exceed 40MP')
    validate_glb_textures(document, image_pixels)
    validate_glb_metadata(document, metadata_bytes[0], graph, len(images))


def strict_json(data, on_metadata_bytes=None):
    # Scan before json.loads allocates objects or recurses. Strings are single
    # tokens, so braces in quoted text cannot consume the nesting budget.
    source = data.decode('utf-8')
    depth = 0
    stack, metadata_bytes = [], 0
    tokens = re.finditer(r'"(?:[^"\\]|\\.)*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null', source)
    for count, match in enumerate(tokens, 1):
        require(count <= 200_000, 'JSON token limit exceeded')
        token = match.group()
        if on_metadata_bytes is not None:
            # Frame: [structural role, object?, expecting key?, decoded key].
            # Roles: root=0, asset=11, buffers[]=12/13, images[]=14/15;
            # -1 includes ALL unrelated metadata and lookalike path names.
            top = stack[-1] if stack else None
            role = top[0] if top else -1
            excluded_string = (token.startswith('"') and top and top[1] and not top[2]
                               and ((role == 11 and top[3] == 'generator')
                                    or (role in (13, 15) and top[3] == 'uri')))
            metadata_bytes += 2 if excluded_string else len(token.encode('utf-8'))
            if re.match(r'-?\d', token):
                metadata_bytes += 32  # Finite-double stringify growth, JS/Python parity.
            if token in ('{', '['):
                child_role = -1
                if not stack and token == '{':
                    child_role = 0
                elif role == 0 and token == '{' and top[3] == 'asset':
                    child_role = 11
                elif role == 0 and token == '[' and top[3] in ('buffers', 'images'):
                    child_role = 12 if top[3] == 'buffers' else 14
                elif role in (12, 14) and not top[1] and token == '{':
                    child_role = role + 1
                stack.append([child_role, token == '{', True, None])
            elif token in ('}', ']'):
                if stack:
                    stack.pop()
            elif top and top[1]:
                if token == ',':
                    top[2] = True
                elif token == ':':
                    top[2] = False
                elif token.startswith('"') and top[2]:
                    top[3] = json.loads(token)
        if token in ('{', '['):
            depth += 1
            require(depth <= 64, 'JSON nesting exceeds 64')
        elif token in ('}', ']'):
            depth -= 1

    if on_metadata_bytes is not None:
        on_metadata_bytes(metadata_bytes)

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result

    def finite(value):
        number = float(value)
        require(math.isfinite(number), 'Nonfinite JSON number')
        return number

    def constant(value):
        raise ValueError(f'Invalid JSON constant: {value}')

    return json.loads(source, object_pairs_hook=pairs, parse_float=finite, parse_constant=constant)


def safe_asset_path(value):
    require(type(value) is str and value.startswith('assets/'), 'Asset must be below assets/')
    parts = value.split('/')
    require(all(part not in ('', '.', '..') and re.fullmatch(r'[a-zA-Z0-9_.-]+', part) is not None for part in parts), 'Unsafe ZIP path')
    require(Path(value).suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.glb'), 'Unsupported asset extension')


def read_zip(path):
    require(path.is_file() and not path.is_symlink(), 'Package is not a regular file')
    require(path.stat().st_size <= MAX_PACKAGE, 'ZIP exceeds 25 MiB')
    with path.open('rb') as handle:
        raw = handle.read(MAX_PACKAGE + 1)
    require(len(raw) <= MAX_PACKAGE, 'ZIP exceeds 25 MiB')
    return raw


def zip_entries(archive):
    entries = archive.infolist()
    require(1 <= len(entries) <= 61, 'Too many ZIP entries')
    require(sum(info.file_size for info in entries) <= MAX_UNCOMPRESSED, 'Uncompressed ZIP exceeds 50 MiB')
    names, offsets = set(), set()
    for info in entries:
        name = info.filename
        require(name == info.orig_filename and name.casefold() not in names, 'Duplicate or NUL ZIP filename')
        require(info.header_offset not in offsets, 'Duplicate ZIP local entry')
        offsets.add(info.header_offset)
        names.add(name.casefold())
        require(not info.is_dir() and not (info.external_attr & 0x10), 'Directory ZIP entry')
        mode = stat.S_IFMT(info.external_attr >> 16)
        require(mode in (0, stat.S_IFREG), 'Symlink or special ZIP entry')
        require(not info.flag_bits & (1 | 32 | 64), 'Encrypted or patched ZIP entry')
        require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'Unsupported ZIP compression')
        if name == 'project.json':
            require(info.file_size <= 1024 * 1024, 'project.json exceeds 1 MiB')
        else:
            safe_asset_path(name)
    require('project.json' in {info.filename for info in entries}, 'Missing project.json')
    return entries


def bounded_member(archive, info, raw):
    # ZipFile.read() trusts declared file_size and can silently truncate an
    # oversized DEFLATE stream with a matching prefix CRC. Bound the real
    # decompressor and require its true EOF instead, without private zipfile APIs.
    with archive.open(info):
        pass  # stdlib validates local names, extra fields, and overlapping entries.
    offset = info.header_offset
    require(offset >= 0 and offset + 30 <= len(raw), 'Truncated local ZIP header')
    flags, method = struct.unpack_from('<HH', raw, offset + 6)
    require(flags == info.flag_bits and not flags & (1 | 32 | 64), 'ZIP flag mismatch or encryption')
    require(method == info.compress_type, 'ZIP compression method mismatch')
    crc, compressed_length, length = struct.unpack_from('<III', raw, offset + 14)
    if not flags & 8:
        require(crc == info.CRC, 'ZIP local CRC mismatch')
        require(compressed_length in (info.compress_size, 0xFFFFFFFF) and length in (info.file_size, 0xFFFFFFFF), 'ZIP local size mismatch')
    name_length, extra_length = struct.unpack_from('<HH', raw, offset + 26)
    start = offset + 30 + name_length + extra_length
    end = start + info.compress_size
    require(end <= len(raw), 'Truncated compressed ZIP data')
    compressed = raw[start:end]
    if method == zipfile.ZIP_STORED:
        require(info.compress_size == info.file_size, 'Stored ZIP length mismatch')
        data = compressed
    else:
        decoder = zlib.decompressobj(-15)
        data = decoder.decompress(compressed, info.file_size + 1)
        require(decoder.eof and not decoder.unconsumed_tail and not decoder.unused_data,
                'DEFLATE length exceeds declared size or invalid stream')
    require(len(data) == info.file_size and zlib.crc32(data) == info.CRC, 'ZIP length/CRC mismatch')
    return data


def preflight_packages(paths):
    snapshots, total = [], 0
    for path in paths:
        raw = read_zip(path)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            total += sum(info.file_size for info in zip_entries(archive))
        require(total <= MAX_TOTAL, 'Aggregate uncompressed packages exceed 1,000,000,000 bytes')
        snapshots.append((path, hashlib.sha256(raw).hexdigest()))
    return snapshots


def load_package(path, legacy_ids, expected_hash=None):
    raw = read_zip(path)
    digest = hashlib.sha256(raw).hexdigest()
    require(expected_hash is None or digest == expected_hash, 'Package changed after preflight')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = zip_entries(archive)
        payloads = {info.filename: bounded_member(archive, info, raw) for info in entries}
        package = strict_json(payloads.pop('project.json'))
    assets = validate_manifest(package, payloads)
    project_id = package['project']['id']
    require(path.name == project_id + '.zip', 'Filename must be <project.id>.zip')
    require(project_id not in legacy_ids, f'Legacy project collision: {project_id}')
    require(set(payloads) == {asset['path'] for asset in assets.values()}, 'Unreferenced ZIP files')
    return package, payloads, assets, digest


def legacy_ids(root):
    path = root / 'public/images/portfolio/portfolio_data.json'
    require(path.is_file() and not path.is_symlink(), 'Missing regular legacy metadata')
    data = strict_json(path.read_bytes())
    require(type(data) is list and bool(data), 'Invalid legacy metadata list')
    ids = set()
    for project in data:
        require(type(project) is dict, 'Invalid legacy metadata project')
        project_id = project.get('id')
        require(type(project_id) is str and PROJECT_ID.fullmatch(project_id) is not None, 'Invalid legacy metadata ID')
        require(project_id not in ids, 'Duplicate legacy metadata ID')
        ids.add(project_id)
    return ids


OWNER_FILE = '.admin-importer-owned'
OWNER_BYTES = b'jid-admin-importer-v1\n'


def check_path(root, relative):
    current = root
    require(current.is_dir() and not current.is_symlink(), 'Root must be a real directory')
    for part in Path(relative).parts:
        current = current / part
        require(not current.is_symlink(), f'Symlink path rejected: {current}')
    return current


def check_owned(path, registry=False):
    require(not path.is_symlink(), f'Symlink generated directory: {path}')
    if not path.exists():
        return
    require(path.is_dir(), f'Reserved output is not a directory: {path}')
    marker = path / OWNER_FILE
    require(marker.is_file() and not marker.is_symlink() and marker.read_bytes() == OWNER_BYTES,
            f'Reserved directory is not importer-owned: {path}')
    for directory, directories, files in os.walk(path, followlinks=False):
        for name in directories + files:
            child = Path(directory) / name
            require(not child.is_symlink(), f'Symlink in generated tree: {child}')
            mode = child.lstat().st_mode
            require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), f'Special file in generated tree: {child}')
    if registry:
        require({entry.name for entry in path.iterdir()} <= {OWNER_FILE, 'admin-projects.json'},
                'Unexpected files in reserved .generated directory')


def resolve_project(package, payloads, assets, digest, media):
    project = package['project']
    urls = {}
    for asset_id, asset in assets.items():
        # Never use an uploaded filename as a destination path; IDs are validated ASCII.
        name = asset_id + Path(asset['path']).suffix.lower()
        relative = f"{project['id']}/{digest[:16]}/{name}"
        target = media / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as handle:
            handle.write(payloads[asset['path']])
        urls[asset_id] = '/_admin_media/' + relative
    blocks = []
    for block in package['blocks']:
        resolved = dict(block)
        if block['type'] == 'images':
            resolved['images'] = [{
                'src': urls[image['assetId']], 'width': assets[image['assetId']]['width'],
                'height': assets[image['assetId']]['height'], 'alt': image['alt'], 'caption': image['caption'],
            } for image in block['images']]
        blocks.append(resolved)
    return {
        'id': project['id'], 'folder': project['id'], 'title': project['title'], 'category': project['category'],
        'image': urls[project['thumbnail']], 'blocks': blocks,
        'models': [urls[asset_id] for asset_id in package['models']], 'packageSha256': digest,
    }


def publish_outputs(media, generated, media_work, registry_work):
    """Commit directory renames, registry last; roll back ordinary I/O failures.

    The two reserved paths cannot be renamed in a single filesystem operation.
    A build must only read them after this CLI exits successfully. A machine crash
    between renames can leave backups, which are deliberately never auto-deleted.
    """
    check_owned(media)
    check_owned(generated, registry=True)
    installed, backups = [], []
    try:
        for target, work in ((media, media_work), (generated, registry_work)):
            previous = work / 'previous'
            if target.exists():
                os.replace(target, previous)
                backups.append((target, previous))
            os.replace(work / 'next', target)
            installed.append(target)
    except BaseException:
        for target in reversed(installed):
            check_owned(target, registry=target == generated)
            shutil.rmtree(target)
        for target, previous in reversed(backups):
            os.replace(previous, target)
        raise


def import_packages(root):
    root = Path(root).absolute()
    media = check_path(root, 'public/_admin_media')
    generated = check_path(root, '.generated')
    submissions = check_path(root, 'admin-submissions')
    check_path(root, 'public/images/portfolio/portfolio_data.json')
    check_owned(media)
    check_owned(generated, registry=True)
    for parent in (root, media.parent):
        residues = sorted(parent.glob('.admin-importer-*'))
        require(not residues, f'Pending importer recovery/staging directory: {residues[0] if residues else parent}')
    protected = legacy_ids(root)
    require(not submissions.exists() or submissions.is_dir(), 'Submissions must be a directory')
    paths = []
    for path in sorted(submissions.iterdir()) if submissions.exists() else []:
        require(not path.is_symlink(), 'Symlink submission')
        if path.suffix.lower() == '.zip':
            paths.append(path)
    snapshots = preflight_packages(paths)
    # Staging beside each destination guarantees same-filesystem atomic renames.
    # Explicit dirs avoid tempfile's system /tmp fallback (also on Actions).
    media_work = Path(tempfile.mkdtemp(prefix='.admin-importer-', dir=media.parent))
    registry_work = None
    committed = False
    try:
        registry_work = Path(tempfile.mkdtemp(prefix='.admin-importer-', dir=root))
        media_next, registry_next = media_work / 'next', registry_work / 'next'
        for directory in (media_next, registry_next):
            directory.mkdir()
            (directory / OWNER_FILE).write_bytes(OWNER_BYTES)
        projects, ids = [], set()
        for path, expected_hash in snapshots:
            package, payloads, assets, digest = load_package(path, protected, expected_hash)
            require(package['project']['id'] not in ids, 'Duplicate project ID')
            ids.add(package['project']['id'])
            projects.append(resolve_project(package, payloads, assets, digest, media_next))
        registry = {'schemaVersion': 1, 'projects': projects}
        (registry_next / 'admin-projects.json').write_text(
            json.dumps(registry, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n', encoding='utf-8')
        publish_outputs(media, generated, media_work, registry_work)
        committed = True
    finally:
        # If rollback itself failed, preserve original marked backups for recovery.
        for work in (media_work, registry_work):
            if work is not None and work.exists():
                previous = work / 'previous'
                if previous.exists() and not committed:
                    print(f'error: recovery backup retained at {previous}', file=sys.stderr)
                else:
                    shutil.rmtree(work)
    return len(projects)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    try:
        count = import_packages(args.root)
    except (OSError, ValueError, KeyError, RecursionError, zipfile.BadZipFile, zlib.error, struct.error, binascii.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Imported {count} admin project(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
