"""Isolated material/surface diagnostic; never alters a fluid cache."""
import argparse
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import configure_render, STATIONS
from plating_cached_study import make_cached_study
from render_plating_sequence import prepare_liquid_look


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio', required=True)
    parser.add_argument('--snapshots', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--surface', action='store_true')
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.open_mainfile(filepath=str(Path(options.studio).resolve()))
    scene = bpy.context.scene
    configure_render(scene, 1920, 900, 128)
    domain = bpy.data.objects['SauceLiquidDomain']
    if any(modifier.type == 'FLUID' for modifier in domain.modifiers):
        raise RuntimeError('This diagnostic accepts only a no-fluid studio, never a simulation scene')
    domain.hide_render = True
    sauce = domain.data.materials[0]
    look = prepare_liquid_look(scene, sauce)
    collection = make_cached_study(sauce, STATIONS, Path(options.snapshots))
    evidence = []
    if options.surface:
        from plating_surface import refine_surface
        for obj in collection.objects:
            result = refine_surface(obj, close_radius_m=.0015, blur_sigma_m=.0015, edge_sigma_m=.0009)
            evidence.append(result)
            if not result.get('accepted'): raise RuntimeError(f'Surface reconstruction rejected: {result}')
    scene.frame_set(168)
    output = Path(options.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output / 'lighting-study.png')
    bpy.ops.render.render(write_still=True)
    (output / 'look-proof.json').write_text(json.dumps({
        'diagnostic_only': True, 'fluid_cache_modified': False,
        'frozen_native_pool_ages_repositioned_for_optics': True,
        'material_overrides': look,
        'surface_reconstruction': evidence,
    }, indent=2, default=str) + '\n')
    print('SURFACE_LOOK_RENDERED', scene.render.filepath, flush=True)


if __name__ == '__main__': main()
