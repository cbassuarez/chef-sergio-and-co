"""Full-trail visual check for the conservative viscous-film approximation."""
import argparse
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import configure_render, restore_reservoir, area
from plating_thinfilm import load_film_mesh


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio', default='output/plating-timeline/blender-look-v11/plating.blend')
    parser.add_argument('--film', default='output/plating-timeline/thinfilm')
    parser.add_argument('--reservoir', default='output/plating-timeline/blender-final')
    parser.add_argument('--output', default='output/plating-timeline/blender-look-whole-film')
    parser.add_argument('--frame', type=int, default=168)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.studio).resolve()))
    scene = bpy.context.scene
    configure_render(scene, 1920, 900, 128)
    domain = bpy.data.objects['SauceLiquidDomain']
    if any(modifier.type == 'FLUID' for modifier in domain.modifiers):
        raise RuntimeError('Use a no-fluid photography studio for this independent model')
    domain.hide_render = True
    sauce = domain.data.materials[0]
    controls = sauce.node_tree.nodes['Plating material controls']
    controls.inputs['Surface Roughness'].default_value = .07
    controls.inputs['Absorption Multiplier'].default_value = 1.0
    controls.inputs['Emulsion Scatter (1/m)'].default_value = 4
    controls.inputs['Roughness Variation'].default_value = .01
    controls.inputs['Transmission'].default_value = .995
    light = area('Gentle liquid reflection silk', (0, .90, .23), (0, 0, .001), 1.5, .80, .16, (1, .97, .91))
    if hasattr(light.data, 'diffuse_factor'): light.data.diffuse_factor = 0
    film = load_film_mesh(Path(args.film), args.frame, sauce)
    reservoir = restore_reservoir(Path(args.reservoir).resolve(), sauce)
    scene.frame_set(args.frame)
    state = reservoir.states[args.frame]
    root = bpy.data.objects['SilverSpoonRoot']
    root.location = state['location']
    root.rotation_euler = state['rotation_euler']
    reservoir_evidence = reservoir.apply_state(args.frame)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output / 'whole-trail.png')
    bpy.ops.render.render(write_still=True)
    (output / 'look-proof.json').write_text(json.dumps({
        'diagnostic_only': True, 'full_trail': True, 'frame': args.frame,
        'reservoir': reservoir_evidence, 'material': {'roughness': .07, 'absorption_multiplier': 1.0, 'scatter_per_m': 4},
    }, indent=2, default=str) + '\n')
    print('WHOLE_TRAIL_RENDERED', scene.render.filepath, flush=True)


if __name__ == '__main__': main()
