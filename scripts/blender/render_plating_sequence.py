"""Render the baked hybrid pour with an explicitly recorded liquid surfacer.

The Mantaflow cache is read-only. Native liquid surfaces are copied into an
independent render object; the analytic spoon reservoir uses its saved ledger.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import configure_render, restore_reservoir, area
from plating_fluid import bake_evidence
from plating_surface import refine_surface


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_liquid_look(scene, sauce):
    controls = sauce.node_tree.nodes['Plating material controls']
    controls.inputs['Surface Roughness'].default_value = .07
    controls.inputs['Absorption Multiplier'].default_value = 1.0
    controls.inputs['Emulsion Scatter (1/m)'].default_value = 4
    controls.inputs['Roughness Variation'].default_value = .01
    controls.inputs['Transmission'].default_value = .995
    old = scene.objects.get('Broad liquid reflection silk')
    if old: bpy.data.objects.remove(old, do_unlink=True)
    light = area('Broad liquid reflection silk', (0, .90, .33), (0, 0, .001), 3, .80, .16, (1, .97, .91))
    if hasattr(light.data, 'diffuse_factor'): light.data.diffuse_factor = 0
    return {'roughness': .07, 'absorption_multiplier': 1.0,
            'emulsion_scatter_per_m': 4, 'roughness_variation': .01, 'transmission': .995,
            'liquid_reflection_silk': {'location_m': [0, .90, .33], 'power_w': 3, 'size_m': [.80, .16]}}


def geometry(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    result = {'vertices': len(bm.verts), 'faces': len(bm.faces),
              'nonmanifold_edges': sum(not edge.is_manifold for edge in bm.edges),
              'volume_ml': abs(bm.calc_volume(signed=True)) * 1e6}
    bm.free()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/plating-timeline/blender-final')
    parser.add_argument('--samples', type=int, default=96)
    parser.add_argument('--step', type=int, default=2)
    parser.add_argument('--preview-frame', type=int)
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output = Path(options.output).resolve()
    project = Path(__file__).resolve().parents[2]
    bpy.ops.wm.open_mainfile(filepath=str(output / 'plating.blend'))
    scene = bpy.context.scene
    domain = bpy.data.objects['SauceLiquidDomain']
    proof = bake_evidence(domain)
    if not proof['complete_cache_frame_coverage']:
        raise RuntimeError('Refusing to render an incomplete physical liquid cache')
    configure_render(scene, 1920, 900, options.samples)
    sauce = domain.data.materials[0]
    look = prepare_liquid_look(scene, sauce)
    reservoir = restore_reservoir(output, sauce)
    if reservoir is None: raise RuntimeError('The hybrid reservoir ledger is missing')
    domain.hide_render = True
    source_files = ['scripts/blender/render_plating_sequence.py', 'scripts/blender/plating_surface.py']
    source_hashes = {name: sha(project / name) for name in source_files}
    scene_provenance = json.loads((output / 'scene-provenance.json').read_text())
    if scene_provenance.get('study_only'): raise RuntimeError('Diagnostic geometry cannot be rendered as a production sequence')
    for name, digest in scene_provenance['source_hashes'].items():
        if sha(project / name) != digest: raise RuntimeError(f'Baked scene source changed: {name}')
    frames = [options.preview_frame] if options.preview_frame else list(range(24, 181, options.step))
    if not options.preview_frame and frames[-1] != 180: frames.append(180)
    records = []
    directory = output / 'frames'
    directory.mkdir(exist_ok=True)
    for number, frame in enumerate(frames):
        scene.frame_set(frame)
        reservoir_evidence = reservoir.apply_state(frame)
        evaluated = domain.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=bpy.context.evaluated_depsgraph_get())
        mesh.transform(domain.matrix_world)
        mesh.update()
        native = geometry(mesh)
        if native['nonmanifold_edges'] or native['volume_ml'] <= 0: raise RuntimeError(f'Native frame{frame} has invalid liquid geometry')
        obj = bpy.data.objects.new('ReconstructedLiquidRenderSurface', mesh)
        scene.collection.objects.link(obj)
        mesh.materials.clear()
        mesh.materials.append(sauce)
        original_mesh = mesh
        surface = refine_surface(obj, max_height_m=.015, close_radius_m=.0015, blur_sigma_m=.0015, edge_sigma_m=.0009)
        if not surface.get('accepted'): raise RuntimeError(f'Frame{frame} surface reconstruction rejected: {surface}')
        if original_mesh != obj.data and original_mesh.users == 0: bpy.data.meshes.remove(original_mesh)
        final = geometry(obj.data)
        if final['nonmanifold_edges'] or final['volume_ml'] <= 0: raise RuntimeError(f'Reconstructed frame{frame} has invalid liquid geometry')
        record = {'frame': frame, 'native': native, 'render_surface': final,
                  'surface_reconstruction': surface, 'reservoir': reservoir_evidence}
        records.append(record)
        target = output / f'preview-{frame:04d}.png' if options.preview_frame else directory / f'{number:04d}.png'
        scene.render.filepath = str(target)
        bpy.ops.render.render(write_still=True)
        print('PLATING_RENDER_FRAME', number, frame, str(target), flush=True)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0: bpy.data.meshes.remove(mesh)
    for name, digest in source_hashes.items():
        if sha(project / name) != digest: raise RuntimeError(f'Render source changed during rendering: {name}')
    render_provenance = {
        'kind': 'baked-hybrid-liquid-with-render-surface-reconstruction',
        'diagnostic_only': bool(options.preview_frame),
        'fluid_cache_modified': False, 'source_hashes': source_hashes,
        'scene_provenance_sha256': sha(output / 'scene-provenance.json'),
        'bake_evidence_sha256': sha(output / 'bake-evidence.json'),
        'material_overrides': look,
        'samples': options.samples, 'frames': records,
    }
    sidecar = f'preview-{options.preview_frame:04d}-proof.json' if options.preview_frame else 'render-provenance.json'
    (output / sidecar).write_text(json.dumps(render_provenance, indent=2, default=str) + '\n')
    if not options.preview_frame:
        (output / 'render-frames.json').write_text(json.dumps(frames) + '\n')


if __name__ == '__main__': main()
