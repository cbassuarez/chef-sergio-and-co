"""Cycles photographs of the conservative viscous-film scroll timeline.

The saved studio supplies geometry/camera/light. A separate, explicitly reduced
physical solver supplies every liquid frame and its finite-volume ledger.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import configure_render, restore_reservoir, area, aim
from plating_thinfilm import load_film_mesh

STATIONS = [24, 72, 120, 168]
STUDIO_SOURCES = [
    'scripts/blender/create_plating_scene.py', 'scripts/blender/plating_spoon.py',
    'scripts/blender/plating_fluid.py', 'scripts/blender/plating_materials.py',
    'scripts/blender/plating_engraving.py', 'scripts/blender/plating_reservoir.py',
    'scripts/blender/plating_external.py',
]
PHYSICAL_SOURCES = ['scripts/blender/plating_thinfilm.py', 'scripts/blender/plating_thinfilm_solver.cpp',
                    'scripts/blender/prepare_plating_performance.py']
RENDER_SOURCES = ['scripts/blender/plating_surface.py', 'scripts/blender/render_thinfilm_sequence.py']


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def configure_oblique_photography(scene, states):
    """Fixed near focus: the physical route approaches through the lens plane."""
    camera = scene.camera
    camera.location = (.12, -.66, .39)
    target = Vector((-.005, -.028, .009))
    aim(camera, target)
    forward = (target - camera.location).normalized()
    ground_depth = (-camera.location).dot(forward)
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.sensor_width = 36
    camera.data.lens = ground_depth * 36 / .50
    last = states[168]
    rotation = Euler(last['rotation_euler'], 'XYZ').to_matrix()
    matrix = Matrix.Translation(last['location']) @ rotation.to_4x4()
    bowl = matrix @ Vector((0, 0, .005))
    near = Vector(last['nozzle_world'])
    near.z = 0
    focus = near.lerp(bowl, .5)
    camera.data.dof.use_dof = True
    camera.data.dof.focus_object = None
    camera.data.dof.focus_distance = (focus - camera.location).dot(forward)
    camera.data.dof.aperture_fstop = 4
    camera.data.dof.aperture_blades = 9

    # Keep the polished handle's reflection shaped for the actual closer view.
    visual = bpy.data.objects['SilverSpoon']
    vertex = min((v for v in visual.data.vertices if -.125 < v.co.y < -.115 and v.normal.z > .5),
                 key=lambda v: abs(v.co.x + .0037) + .25 * abs(v.co.y + .12))
    point = matrix @ vertex.co
    normal = (rotation @ vertex.normal).normalized()
    view = (camera.location - point).normalized()
    reflection = (2 * normal.dot(view) * normal - view).normalized()
    handle_axis = (rotation @ Vector((0, -1, 0))).normalized()
    long_axis = (handle_axis - reflection * handle_axis.dot(reflection)).normalized()
    z_axis = reflection
    x_axis = long_axis.cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis).normalized()
    strip = scene.objects['Long silver edge softbox']
    strip.location = point + reflection * .65
    strip.rotation_euler = Matrix((x_axis, y_axis, z_axis)).transposed().to_euler()
    key = scene.objects['Large warm silk key']
    key.location = (.12, -.15, .95)
    aim(key, (0, .015, 0))
    return {
        'projection': 'perspective', 'camera_location_m': list(camera.location),
        'camera_target_m': list(target), 'ground_horizontal_field_m': .50,
        'lens_mm': camera.data.lens, 'f_stop': 4,
        'fixed_focus_point_m': list(focus), 'focus_distance_m': camera.data.dof.focus_distance,
        'focus_method': 'fixed near-end focus; real Cycles aperture depth of field',
    }


def measure(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    remaining = set(bm.verts)
    components = 0
    while remaining:
        components += 1
        queue = [remaining.pop()]
        while queue:
            vertex = queue.pop()
            for edge in vertex.link_edges:
                neighbor = edge.other_vert(vertex)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
    result = {'vertices': len(bm.verts), 'faces': len(bm.faces),
              'nonmanifold_edges': sum(not edge.is_manifold for edge in bm.edges),
              'components': components, 'volume_ml': abs(bm.calc_volume(signed=True)) * 1e6,
              'bounds_world_m': {'min': [min(v.co[i] for v in bm.verts) for i in range(3)],
                                 'max': [max(v.co[i] for v in bm.verts) for i in range(3)]}}
    bm.free()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/plating-timeline/thinfilm-oblique-final')
    parser.add_argument('--film', default='output/plating-timeline/thinfilm-oblique-projected')
    parser.add_argument('--preview-frame', type=int)
    parser.add_argument('--motion-samples', type=int, default=64)
    parser.add_argument('--station-samples', type=int, default=128)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output, film = Path(args.output).resolve(), Path(args.film).resolve()
    project = Path(__file__).resolve().parents[2]
    source_hashes = {name: sha(project / name) for name in STUDIO_SOURCES + PHYSICAL_SOURCES + RENDER_SOURCES}
    studio = json.loads((output / 'scene-provenance.json').read_text())
    for name in STUDIO_SOURCES:
        if studio['source_hashes'].get(name) != source_hashes[name]: raise RuntimeError(f'Studio source changed: {name}')
    metadata = json.loads((film / 'metadata.json').read_text())
    if metadata['solver_source_sha256'] != source_hashes[PHYSICAL_SOURCES[1]]: raise RuntimeError('The physical C++ source differs from its solved dataset')
    if metadata['python_source_sha256'] != source_hashes[PHYSICAL_SOURCES[0]]: raise RuntimeError('The physical wrapper differs from its solved dataset')
    if metadata['source_plan_sha256'] != sha(film / 'reservoir-plan.json'): raise RuntimeError('The physical source ledger changed')
    bpy.ops.wm.open_mainfile(filepath=str(output / 'plating.blend'))
    scene = bpy.context.scene
    if any(obj.get('diagnostic_only') for obj in scene.objects): raise RuntimeError('Authored diagnostic sauce must not enter production photography')
    domain = bpy.data.objects['SauceLiquidDomain']
    if any(modifier.type == 'FLUID' for modifier in domain.modifiers): raise RuntimeError('This renderer requires the independent photography studio')
    domain.hide_render = True
    sauce = domain.data.materials[0]
    controls = sauce.node_tree.nodes['Plating material controls']
    material = {'roughness': .07, 'absorption_multiplier': 1.0, 'emulsion_scatter_per_m': 4,
                'roughness_variation': .01, 'transmission': .995}
    for name, value in [('Surface Roughness', .07), ('Absorption Multiplier', 1.0),
                        ('Emulsion Scatter (1/m)', 4), ('Roughness Variation', .01), ('Transmission', .995)]:
        controls.inputs[name].default_value = value
    light = area('Gentle liquid reflection silk', (0, .75, .34), (0, 0, .001), 1.5, .80, .16, (1, .97, .91))
    if hasattr(light.data, 'diffuse_factor'): light.data.diffuse_factor = 0
    reservoir = restore_reservoir(film, sauce)
    if reservoir is None: raise RuntimeError('Missing analytic reservoir plan')
    root = bpy.data.objects['SilverSpoonRoot']
    # A still render evaluates animation again. Remove the studio's baseline
    # action so the saved physical performance is the sole pose authority.
    root.animation_data_clear()
    photography = configure_oblique_photography(scene, reservoir.states)
    frames = [args.preview_frame] if args.preview_frame else list(range(24, 169, 2))
    records = []
    directory = output / 'frames'
    directory.mkdir(exist_ok=True)
    for index, frame in enumerate(frames):
        state = reservoir.states[frame]
        scene.frame_set(frame)
        root.location = state['location']
        root.rotation_euler = state['rotation_euler']
        reservoir_evidence = reservoir.apply_state(frame)
        obj = load_film_mesh(film, frame, sauce)
        geometry = measure(obj)
        expected = state['emitted_total_ml']
        if geometry['nonmanifold_edges'] or geometry['components'] != 1 or expected <= 0 or abs(geometry['volume_ml'] / expected - 1) > .01:
            raise RuntimeError(f'Frame{frame} fails connected, closed, finite-volume liquid proof: {geometry}')
        station = frame in STATIONS
        width, height, samples = (1920, 900, args.station_samples) if station or args.preview_frame else (1280, 600, args.motion_samples)
        configure_render(scene, width, height, samples)
        target = output / f'preview-{frame:04d}.png' if args.preview_frame else directory / f'{index:04d}.png'
        scene.render.filepath = str(target)
        bpy.ops.render.render(write_still=True)
        rendered_location, rendered_rotation = list(root.location), list(root.rotation_euler)
        if max(abs(a-b) for a,b in zip(rendered_location, state['location'])) > 1e-7 or max(abs(a-b) for a,b in zip(rendered_rotation, state['rotation_euler'])) > 1e-6:
            raise RuntimeError(f'Blender changed the physical spoon pose during render at frame{frame}')
        record = {'frame': frame, 'width': width, 'height': height, 'samples': samples,
                  'png_sha256': sha(target), 'geometry': geometry,
                  'film': json.loads(obj['thinfilm_provenance']), 'reservoir': reservoir_evidence,
                  'expected_emitted_volume_ml': expected, 'remaining_reservoir_volume_ml': state['volume_ml'],
                  'root_pose_matches_source': True,
                  'rendered_root_location': rendered_location, 'rendered_root_rotation_euler': rendered_rotation}
        records.append(record)
        print('THINFILM_RENDER_FRAME', index, frame, str(target), flush=True)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0: bpy.data.meshes.remove(mesh)
    for name, digest in source_hashes.items():
        if sha(project / name) != digest: raise RuntimeError(f'Source changed during photography: {name}')
    proof = {
        'pipeline': 'conservative-viscous-film', 'diagnostic_only': bool(args.preview_frame),
        'renderer': 'Blender Cycles', 'blender': bpy.app.version_string, 'units': 'meters', 'fps': 24,
        'station_frames': STATIONS, 'full_trail': True, 'source_hashes': source_hashes,
        'studio_blend_sha256': sha(output / 'plating.blend'),
        'studio_provenance_sha256': sha(output / 'scene-provenance.json'),
        'physics_metadata_sha256': sha(film / 'metadata.json'), 'physics_dataset_sha256': sha(film / 'heightfields.npz'),
        'physics_ledger_sha256': sha(film / 'volume-ledger.json'), 'reservoir_plan_sha256': sha(film / 'reservoir-plan.json'),
        'material_overrides': material,
        'liquid_reflection_silk': {'location_m': [0, .75, .34], 'power_w': 1.5, 'size_m': [.80, .16]},
        'photography': photography,
        'motion_rendering': '1280x600/64 samples between detents; native 1920x900/128 samples at the four detents',
        'frames': records,
    }
    filename = f'preview-{args.preview_frame:04d}-proof.json' if args.preview_frame else 'render-provenance.json'
    (output / filename).write_text(json.dumps(proof, indent=2, default=str) + '\n')
    if not args.preview_frame: (output / 'render-frames.json').write_text(json.dumps(frames) + '\n')


if __name__ == '__main__': main()
