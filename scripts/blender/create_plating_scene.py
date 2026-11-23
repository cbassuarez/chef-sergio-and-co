"""Physical plating study: Blender 4.5, Cycles/Metal, hybrid viscous pour.

Run with Blender --background --python scripts/blender/create_plating_scene.py -- ...
The lighting study is explicitly a material/composition diagnostic, not a fluid
render. Production frames must be rendered from a baked liquid cache.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plating_spoon import create_spoon, inner_bowl_floor_z
from plating_fluid import setup_liquid, bake_evidence
from plating_materials import create_materials
from plating_reservoir import plan_reservoir, create_reservoir_mesh

STATIONS = [-.192, -.096, 0, .096]
KEYS = [
    (1, 0, .015, 0), (12, 0, .015, 0), (17, 0, .245, 0), (24, 0, .245, 0),
    (29, 0, .205, 0), (61, 1, .205, 0), (66, 1, .27, 0), (72, 1, .27, 0),
    (77, 1, .225, 0), (109, 2, .225, 0), (114, 2, .295, 0), (120, 2, .295, 0),
    (125, 2, .245, 0), (157, 3, .245, 0), (162, 3, .32, 0), (168, 3, .32, 0),
    (174, 3, .015, 0), (180, 3, .015, .035),
]

def srgb(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)

def principled(name, color, roughness, metallic=0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*srgb(color), 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    return material, shader

def aim(object, point):
    object.rotation_euler = (Vector(point) - object.location).to_track_quat('-Z', 'Y').to_euler()

def area(name, location, point, power, size, size_y, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'RECTANGLE'
    data.energy = power
    data.size = size
    data.size_y = size_y
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, point)
    return obj

def configure_render(scene, width, height, samples, gpu=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = .009
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 8
    scene.cycles.transmission_bounces = 10
    scene.cycles.volume_bounces = 2
    scene.cycles.sample_clamp_indirect = 5
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    # Keep real ray-traced contact/shadows while the webpage supplies the
    # background. There is no rectangular studio backdrop to blend by eye.
    scene.render.film_transparent = True
    scene.render.fps = 24
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 12
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    scene.view_settings.exposure = .25
    if gpu:
        preferences = bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type = 'METAL'
        preferences.get_devices()
        for device in preferences.devices:
            device.use = device.type == 'METAL'
        scene.cycles.device = 'GPU'
    scene.render.use_persistent_data = True

def pose(root, lip, frame):
    a, b = KEYS[0], KEYS[-1]
    for first, second in zip(KEYS, KEYS[1:]):
        if first[0] <= frame <= second[0]:
            a, b = first, second
            break
    q = max(0, min(1, (frame - a[0]) / max(1, b[0] - a[0])))
    q = q * q * (3 - 2 * q)
    station = a[1] + (b[1] - a[1]) * q
    index = min(2, int(station))
    x = STATIONS[index] + (STATIONS[index + 1] - STATIONS[index]) * (station - index)
    tilt = a[2] + (b[2] - a[2]) * q
    lift = a[3] + (b[3] - a[3]) * q
    yaw = math.pi - .55
    y = lip.y * math.cos(tilt) + lip.z * math.sin(tilt)
    z = -lip.y * math.sin(tilt) + lip.z * math.cos(tilt)
    root.location = (x + math.sin(yaw) * y, -math.cos(yaw) * y, max(.0008, .002 - z) + lift)
    root.rotation_euler = (-tilt, 0, yaw)

def recover_spoon():
    """Recover analytic profile metadata without altering a loaded fluid cache."""
    root = bpy.data.objects['SilverSpoonRoot']
    scale = float(root['model_scale_baked'])
    return {
        'root': root, 'visual': bpy.data.objects['SilverSpoon'],
        'collider': bpy.data.objects['SilverSpoonCollision'], 'scale': scale,
        'spout_local': (0, .552 * scale, .152 * scale),
        'fill_center': (0, .012 * scale, .072 * scale),
        'bowl_radii_m': (.34 * scale, .49 * scale),
        'inner_floor_fn': lambda x, y: inner_bowl_floor_z(x, y, scale),
    }

def restore_reservoir(output, sauce):
    """Recreate only the analytic render mesh; no Fluid RNA is assigned."""
    plan_path = output / 'reservoir-plan.json'
    if not plan_path.exists(): return None
    old = bpy.data.objects.get('HydrostaticSauceReservoir')
    if old: bpy.data.objects.remove(old, do_unlink=True)
    plan = json.loads(plan_path.read_text())
    return create_reservoir_mesh(recover_spoon(), sauce, plan['states'])

def build(output, resolution, frame_end, width, height, samples, study_only=False, full_cup=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.gravity = (0, 0, -9.81)
    scene.frame_start = 1
    scene.frame_end = frame_end
    configure_render(scene, width, height, samples)
    silver, porcelain, sauce = create_materials()

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -.02))
    surface = bpy.context.object
    surface.name = 'PorcelainSurface'
    surface.dimensions = (2.4, 1.4, .04)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    surface.data.materials.append(porcelain)
    surface.is_shadow_catcher = True
    # The site is a matte cream canvas. A glazed catcher also reflects the
    # studio flags and would composite a grey studio rectangle onto the page.
    # Keep physical contact/transmission shadows, without that backdrop image.
    page_surface = bpy.data.materials.new('Matte cream page - physical shadow catcher')
    page_surface.use_nodes = True
    page_surface.node_tree.nodes.clear()
    diffuse = page_surface.node_tree.nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.inputs['Color'].default_value = (*srgb('#fcfaf5'), 1)
    diffuse.inputs['Roughness'].default_value = .3
    page_output = page_surface.node_tree.nodes.new('ShaderNodeOutputMaterial')
    page_surface.node_tree.links.new(diffuse.outputs['BSDF'], page_output.inputs['Surface'])
    surface.data.materials.clear()
    surface.data.materials.append(page_surface)

    spoon = create_spoon(silver, scale=.07)
    from plating_engraving import create_engraving
    engraving = create_engraving(spoon, silver)
    root = spoon['root']
    lip = Vector(spoon.get('spout_local', (0, .03857, .01064)))
    poses = []
    for frame in range(1, frame_end + 1):
        pose(root, lip, frame)
        poses.append({'frame': frame, 'location': list(root.location), 'rotation_euler': list(root.rotation_euler)})
        root.keyframe_insert('location', frame=frame)
        root.keyframe_insert('rotation_euler', frame=frame)
    for fcurve in root.animation_data.action.fcurves:
        for key in fcurve.keyframe_points: key.interpolation = 'LINEAR'
    scene.frame_set(1)
    output.mkdir(parents=True, exist_ok=True)
    reservoir = None
    if study_only:
        proxy_mesh = bpy.data.meshes.new('No fluid: lighting study')
        proxy = bpy.data.objects.new('SauceLiquidDomain', proxy_mesh)
        scene.collection.objects.link(proxy)
        simulation = {'domain': proxy, 'metadata': {'method': 'DIAGNOSTIC GEOMETRY ONLY, no simulated liquid'}}
    elif full_cup:
        simulation = setup_liquid(scene, spoon, str(output / 'cache'), resolution=resolution, frame_end=frame_end)
    else:
        from plating_external import setup_external_liquid
        plan = plan_reservoir(spoon, poses, fps=24, initial_volume_ml=8, nu_m2_s=1e-3)
        (output / 'reservoir-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
        reservoir = create_reservoir_mesh(spoon, sauce, plan['states'])
        simulation = setup_external_liquid(scene, spoon, plan, str(output / 'cache'), resolution=resolution, frame_end=frame_end)
    domain = simulation['domain']
    domain.name = 'SauceLiquidDomain'
    domain.data.materials.clear()
    domain.data.materials.append(sauce)

    world = bpy.data.worlds.new('Quiet studio world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .2
    environment_path = Path(__file__).resolve().parents[2] / 'output/plating-timeline/blender-assets/studio_small_09_4k.exr'
    if environment_path.exists():
        environment = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
        environment.image = bpy.data.images.load(str(environment_path), check_existing=True)
        coordinates = world.node_tree.nodes.new('ShaderNodeTexCoord')
        mapping = world.node_tree.nodes.new('ShaderNodeMapping')
        mapping.inputs['Rotation'].default_value[2] = math.radians(95)
        world.node_tree.links.new(coordinates.outputs['Normal'], mapping.inputs['Vector'])
        world.node_tree.links.new(mapping.outputs['Vector'], environment.inputs['Vector'])
        world.node_tree.links.new(environment.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
    else:
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (.52, .50, .46, 1)
    scene.world = world
    area('Large warm silk key', (-.20, -.12, .95), (0, -.015, 0), 30, .80, .65, (1, .94, .85))
    strip = area('Narrow silver reflection strip', (.34, .30, .53), (.08, -.03, .005), 8, .055, .65, (.93, .96, 1))
    if hasattr(strip.data, 'diffuse_factor'): strip.data.diffuse_factor = 0
    area('Gentle porcelain fill', (.08, -.42, .58), (0, 0, 0), 2, .55, .38)
    # Place a long, narrow softbox at the handle's actual mirror direction.
    # Its small angular width lights one crowned edge, leaving adjacent dark
    # reflection visible instead of bleaching the whole silver handle.
    handle_vertex = min(
        (vertex for vertex in spoon['visual'].data.vertices if -.125 < vertex.co.y < -.115 and vertex.normal.z > .5),
        key=lambda vertex: abs(vertex.co.x + .0037) + .25 * abs(vertex.co.y + .12),
    )
    optical_pose = SimpleNamespace()
    pose(optical_pose, lip, 168)
    optical_rotation = Euler(optical_pose.rotation_euler, 'XYZ').to_matrix()
    optical_matrix = Matrix.Translation(optical_pose.location) @ optical_rotation.to_4x4()
    handle_point = optical_matrix @ handle_vertex.co
    normal = (optical_rotation @ handle_vertex.normal).normalized()
    view = (Vector((0, -1.8, .70)) - handle_point).normalized()
    reflection = (2 * normal.dot(view) * normal - view).normalized()
    handle_axis = (optical_rotation @ Vector((0, -1, 0))).normalized()
    long_axis = (handle_axis - reflection * handle_axis.dot(reflection)).normalized()
    highlight = area('Long silver edge softbox', handle_point + reflection * .65, handle_point, 16, .055, .8)
    if hasattr(highlight.data, 'diffuse_factor'): highlight.data.diffuse_factor = 0
    # Blender area lights emit along LOCAL -Z; +Z points away from the spoon.
    z_axis = reflection
    x_axis = long_axis.cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis).normalized()
    highlight.rotation_euler = Matrix((x_axis, y_axis, z_axis)).transposed().to_euler()
    black, shader = principled('Studio black negative fill', '#070707', .8)
    for name, location, dimensions in [
        ('Tall dark reflection flag', (.34, -.12, .17), (.12, .02, .34)),
        ('Slim bowl negative fill', (-.12, .24, .14), (.25, .02, .28)),
    ]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        flag = bpy.context.object
        flag.name = name
        flag.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        flag.data.materials.append(black)
        flag.visible_camera = False
        flag.visible_shadow = False
        flag.visible_diffuse = False
        flag.visible_transmission = False

    data = bpy.data.cameras.new('Fixed product photography camera')
    camera = bpy.data.objects.new('Fixed product photography camera', data)
    scene.collection.objects.link(camera)
    camera.location = (0, -1.8, .70)
    aim(camera, (0, .05, .014))
    data.type = 'PERSP'
    data.sensor_fit = 'HORIZONTAL'
    data.sensor_width = 36
    forward = (Vector((0, .05, .014)) - camera.location).normalized()
    floor_depth = (-camera.location).dot(forward)
    data.lens = floor_depth * data.sensor_width / .48
    data.dof.use_dof = True
    data.dof.focus_distance = floor_depth + .075
    data.dof.aperture_fstop = 16
    data.dof.aperture_blades = 9
    data.clip_start = .001
    data.clip_end = 20
    scene.camera = camera
    scene.frame_set(1)
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'plating.blend'))
    metadata = {
        'method': 'Blender Cycles, diagnostic optical study' if study_only else ('Blender Cycles, finite full-cup Mantaflow study' if full_cup else 'Blender Cycles, analytic hydrostatic reservoir + external Mantaflow viscous pour'),
        'blender': bpy.app.version_string, 'units': 'meters', 'gravity': 9.81,
        'stations_m': STATIONS, 'camera_width_m': .48, 'camera_projection': 'perspective', 'lens_mm': data.lens, 'f_stop': 16, 'fps': 24,
        'frame_end': frame_end, 'settled_frames': [24, 72, 120, 180],
        'resolution': resolution, 'simulation': simulation.get('metadata', {}),
        'source_scripts': ['scripts/blender/create_plating_scene.py', 'scripts/blender/plating_spoon.py', 'scripts/blender/plating_fluid.py', 'scripts/blender/plating_materials.py', 'scripts/blender/plating_engraving.py', 'scripts/blender/plating_reservoir.py', 'scripts/blender/plating_external.py'],
        'engraving': engraving,
        'study_only': study_only, 'hybrid': not study_only and not full_cup,
        'environment': {'title': 'Studio Small 09', 'author': 'Sergej Majboroda', 'source': 'https://polyhaven.com/a/studio_small_09', 'license': 'CC0'},
    }
    if reservoir: metadata['reservoir'] = plan['provenance']
    project = Path(__file__).resolve().parents[2]
    metadata['source_hashes'] = {name: hashlib.sha256((project / name).read_bytes()).hexdigest()
                                 for name in metadata['source_scripts'] if (project / name).exists()}
    (output / 'scene-provenance.json').write_text(json.dumps(metadata, indent=2, default=str) + '\n')
    print('PLATING_SCENE_READY', json.dumps(metadata, default=str), flush=True)
    return scene, domain, reservoir

def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/plating-timeline/blender')
    parser.add_argument('--resolution', type=int, default=352)
    parser.add_argument('--frames', type=int, default=180)
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=900)
    parser.add_argument('--samples', type=int, default=128)
    parser.add_argument('--load', action='store_true')
    parser.add_argument('--lighting-study', action='store_true')
    parser.add_argument('--native-study', help='Read-only frozen native pool snapshots, diagnostic composition only')
    parser.add_argument('--engraving-macro', action='store_true', help='Additional diagnostic close-up of the real handle geometry')
    parser.add_argument('--full-cup', action='store_true', help='Legacy diagnostic moving-cup solver; not the production hybrid')
    parser.add_argument('--bake', action='store_true')
    parser.add_argument('--render-frame', type=int)
    parser.add_argument('--render-sequence', action='store_true')
    parser.add_argument('--step', type=int, default=2)
    options = parser.parse_args(args)
    output = Path(options.output).resolve()
    if options.load:
        bpy.ops.wm.open_mainfile(filepath=str(output / 'plating.blend'))
        scene = bpy.context.scene
        configure_render(scene, options.width, options.height, options.samples)
        domain = bpy.data.objects['SauceLiquidDomain']
        reservoir = restore_reservoir(output, domain.data.materials[0])
    else:
        scene, domain, reservoir = build(output, options.resolution, options.frames, options.width, options.height, options.samples, options.lighting_study, options.full_cup)

    if options.lighting_study:
        domain.hide_render = True
        sauce = domain.data.materials[0]
        if options.native_study:
            from plating_cached_study import make_cached_study
            make_cached_study(sauce, STATIONS, Path(options.native_study))
        else:
            from plating_sauce_study import make_sauce_study
            make_sauce_study(sauce, STATIONS)
        scene.frame_set(168)
        scene.render.filepath = str(output / 'lighting-study.png')
        bpy.ops.render.render(write_still=True)
        print('LIGHTING_STUDY_RENDERED_NOT_SIMULATION', scene.render.filepath, flush=True)
        if options.engraving_macro:
            spoon = recover_spoon()
            bpy.context.view_layer.update()
            target = spoon['root'].matrix_world @ Vector((0, -.157, .014))
            scene.camera.location = target + Vector((.018, -.105, .215))
            aim(scene.camera, target)
            scene.camera.data.lens = 130
            scene.camera.data.dof.focus_distance = (scene.camera.location - target).length
            scene.camera.data.dof.aperture_fstop = 13
            scene.view_settings.exposure -= .8
            scene.render.resolution_x = 1400
            scene.render.resolution_y = 1100
            scene.render.filepath = str(output / 'engraving-macro.png')
            bpy.ops.render.render(write_still=True)
            print('ENGRAVING_MACRO_RENDERED', scene.render.filepath, flush=True)
        return

    if options.bake:
        bpy.context.view_layer.objects.active = domain
        bpy.ops.object.select_all(action='DESELECT')
        domain.select_set(True)
        scene.frame_set(scene.frame_start)
        print('PLATING_BAKE_DATA_START', flush=True)
        result = bpy.ops.fluid.bake_data()
        data_proof = bake_evidence(domain)
        expected = set(range(scene.frame_start, scene.frame_end + 1))
        if result != {'FINISHED'} or not expected.issubset(set(data_proof.get('cache', {}).get('data', {}).get('frames', []))):
            raise RuntimeError('Liquid data bake was cancelled or incomplete; refusing to mesh or render it.')
        print('PLATING_BAKE_MESH_START', flush=True)
        result = bpy.ops.fluid.bake_mesh()
        if result != {'FINISHED'}:
            raise RuntimeError('Liquid mesh bake did not finish; refusing to render it.')
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'plating.blend'))
        evidence = bake_evidence(domain, sample_frames=[frame for frame in [1, 24, 48, 72, 120, 168, 180] if frame <= scene.frame_end])
        (output / 'bake-evidence.json').write_text(json.dumps(evidence, indent=2, default=str) + '\n')
        print('PLATING_BAKE_COMPLETE', flush=True)

    settings = next(modifier.domain_settings for modifier in domain.modifiers if modifier.type == 'FLUID')
    if options.render_frame is not None or options.render_sequence:
        actual = bake_evidence(domain)
        if not settings.has_cache_baked_data or not settings.has_cache_baked_mesh or not actual.get('complete_cache_frame_coverage'):
            raise RuntimeError('Production renders require an actually baked liquid data AND mesh cache.')
    if options.render_frame is not None:
        scene.frame_set(options.render_frame)
        if reservoir: reservoir.apply_state(options.render_frame)
        scene.render.filepath = str(output / f'physics-frame-{options.render_frame:04d}.png')
        bpy.ops.render.render(write_still=True)
        print('PHYSICS_FRAME_RENDERED', scene.render.filepath, flush=True)
    if options.render_sequence:
        proof = bake_evidence(domain, sample_frames=[1, 24, 72, 120, 180])
        initial = proof['finite_initial_volume_ml']
        samples = {item['frame']: item for item in proof['geometry_samples']}
        first = samples[1]['volume_ml']
        for frame in [24, 72, 120, 180]:
            sample = samples[frame]
            if sample['nonmanifold_edges'] or sample['volume_ml'] <= 0 or (not reservoir and (sample['volume_ml'] < .75 * initial or sample['volume_ml'] < .75 * first or sample['volume_ml'] > 2 * initial)):
                raise RuntimeError(f'Frame {frame} fails liquid surface/volume retention; refusing a production sequence.')
        (output / 'bake-evidence.json').write_text(json.dumps(proof, indent=2, default=str) + '\n')
        directory = output / 'frames'
        directory.mkdir(exist_ok=True)
        frames = list(range(24, scene.frame_end + 1, options.step))
        if frames[-1] != scene.frame_end: frames.append(scene.frame_end)
        for number, frame in enumerate(frames):
            scene.frame_set(frame)
            if reservoir: reservoir.apply_state(frame)
            scene.render.filepath = str(directory / f'{number:04d}.png')
            if not Path(scene.render.filepath).exists(): bpy.ops.render.render(write_still=True)
            print('PLATING_FRAME', number, frame, scene.render.filepath, flush=True)
        (output / 'render-frames.json').write_text(json.dumps(frames) + '\n')

if __name__ == '__main__':
    main()
