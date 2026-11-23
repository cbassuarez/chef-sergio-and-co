"""Author a restrained spoon performance, then re-solve its actual discharge.

This does not draw or perturb a liquid outline. It changes the spoon's rigid
trajectory, solves the hydrostatic reservoir against that new orientation,
and feeds the resulting finite flow and nozzle path into the gravity/viscous
thin-film solver. Original scenes, caches and baseline datasets stay intact.
Run in Blender's CPU-only background process; no scene render is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS'):
    os.environ[key] = '1'

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_plating_scene import pose
from plating_spoon import create_spoon
from plating_reservoir import plan_reservoir
from plating_thinfilm import solve, load_film_mesh


DETENTS = (24, 72, 120, 168)


def _smooth(value):
    q = min(1.0, max(0.0, value))
    return q * q * (3 - 2 * q)


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _station_x(s, anchors):
    """Monotone C1 cubic through four physical route anchors, not film edits."""
    secants = [(anchors[i + 1] - anchors[i]) * 3 for i in range(3)]
    tangents = [secants[0], 2 * secants[0] * secants[1] / (secants[0] + secants[1]),
                2 * secants[1] * secants[2] / (secants[1] + secants[2]), secants[2]]
    segment = min(2, int(s * 3))
    q = s * 3 - segment
    return ((2 * q ** 3 - 3 * q ** 2 + 1) * anchors[segment]
            + (q ** 3 - 2 * q ** 2 + q) * tangents[segment] / 3
            + (-2 * q ** 3 + 3 * q ** 2) * anchors[segment + 1]
            + (q ** 3 - q ** 2) * tangents[segment + 1] / 3)


def prepare(output_dir, route='oblique', station_x=None):
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'reservoir-plan.json').exists():
        raise ValueError('Use a new performance output directory; do not overwrite a prior performance')
    if station_x is not None and (len(station_x) != 4 or not all(math.isfinite(value) for value in station_x)
                                  or any(b <= a for a, b in zip(station_x, station_x[1:]))):
        raise ValueError('Need four finite increasing physical X station anchors')
    material = bpy.data.materials.new('CPU performance geometry proof only')
    spoon = create_spoon(material, scale=0.07)
    root = spoon['root']
    lip = Vector(spoon['spout_local'])
    poses = []
    samples = []
    max_z_error = 0.0
    for frame in range(1, 181):
        pose(root, lip, frame)
        baseline_location = root.location.copy()
        baseline_rotation = root.rotation_euler.copy()
        baseline_lip = baseline_location + baseline_rotation.to_matrix() @ lip
        route_s = min(1.0, max(0.0, (baseline_lip.x + 0.192) / 0.288))
        t = (frame - 1) / 24
        fade = _smooth((frame - 12) / 6) * (1 - _smooth((frame - 168) / 6))
        # Small smooth zeroes retain all four exact X station anchors while
        # allowing gentle lateral hand motion through the travelling passages.
        anchor_gate = math.sin(math.pi * (frame - 24) / 48) ** 2
        dx = fade * anchor_gate * (0.0003 * math.sin(4.9 * t) + 0.00015 * math.sin(11.1 * t))
        dy = fade * (0.0008 * math.sin(3.2 * t) + 0.00035 * math.sin(8.3 * t))
        pitch = fade * (0.006 * math.sin(4.7 * t) + 0.004 * math.sin(9.4 * t))
        roll = fade * 0.009 * math.sin(3.4 * t)
        yaw = fade * 0.014 * math.sin(2.5 * t)
        yaw_bias = -0.80 * (1 - _smooth(route_s) ** 2) if route == 'oblique' else 0.0
        rotation = Euler((baseline_rotation.x + pitch, baseline_rotation.y + roll,
                          baseline_rotation.z + yaw + yaw_bias), 'XYZ')
        route_y = 0.070 - 0.115 * route_s + 0.020 * math.sin(math.pi * route_s) if route == 'oblique' else baseline_lip.y
        route_x = _station_x(route_s, station_x) if station_x is not None else baseline_lip.x
        desired_lip = Vector((route_x + dx, route_y + dy, baseline_lip.z))
        location = desired_lip - rotation.to_matrix() @ lip
        root.location = location
        root.rotation_euler = rotation
        actual_lip = root.location + root.rotation_euler.to_matrix() @ lip
        max_z_error = max(max_z_error, abs(actual_lip.z - baseline_lip.z))
        poses.append({'frame': frame, 'location': list(root.location),
                      'rotation_euler': list(root.rotation_euler)})
        samples.append({'frame': frame, 'time_s': t, 'fade': fade,
                        'route_s': route_s, 'route_y_m': route_y, 'nominal_route_x_m': route_x,
                        'baseline_nozzle_world': list(baseline_lip),
                        'desired_nozzle_world': list(desired_lip), 'actual_nozzle_world': list(actual_lip),
                        'translation_xy_m': [dx, dy],
                        'rotation_delta_xyz_rad': [pitch, roll, yaw + yaw_bias],
                        'route_yaw_bias_rad': yaw_bias})
    source_dir = Path(__file__).resolve().parent
    performance = {
        'method': 'authored low-amplitude multisine rigid spoon performance, followed by a new hydraulic and plate-film solve',
        'authored_spoon_motion': True, 'authored_liquid_outline': False,
        'description': 'Restrained repeatable hand gesture; finite discharge responds to actual changed spoon orientation.',
        'route': route,
        'route_parameters': {
            's': 'clamp((baselineLipX+.192)/.288,0,1)',
            'y_m': '.070-.115*s+.020*sin(pi*s)' if route == 'oblique' else 'baseline nozzle Y',
            'far_start_y_m': 0.070 if route == 'oblique' else 0.0,
            'near_finish_y_m': -0.045 if route == 'oblique' else 0.0,
            'bow_m': 0.020 if route == 'oblique' else 0.0,
            'station_x_m': list(station_x) if station_x is not None else [-0.192, -0.096, 0.0, 0.096],
            'x_mapping': 'monotone C1 cubic through physical station anchors' if station_x is not None else 'baseline physical nozzle X',
            'camera_projection_compensation': station_x is not None,
            'yaw_bias_rad': '-.80*(1-smoothstep(route_s)^2)' if route == 'oblique' else '0',
            'yaw_purpose': 'Rotate the far handle mostly rightward, returning smoothly to the existing near pose.',
            'spoon_trajectory_authored': True, 'liquid_outline_authored': False,
        },
        'fade_frames': {'in': [12, 18], 'out': [168, 174]},
        'translation_x_m': 'fade*sin(pi*(frame-24)/48)^2*(.0003*sin(4.9*t)+.00015*sin(11.1*t))',
        'translation_y_m': 'fade*(.0008*sin(3.2*t)+.00035*sin(8.3*t))',
        'pitch_rad': 'fade*(.006*sin(4.7*t)+.004*sin(9.4*t))',
        'roll_rad': 'fade*.009*sin(3.4*t)', 'yaw_rad': 'fade*.014*sin(2.5*t)',
        'outlet_z': 'held to the baseline physical lip height by location = desiredLipWorld - Rnew*localLip',
        'detent_frames': list(DETENTS), 'detent_x_anchor_exact': True,
        'maximum_outlet_z_error_m': max_z_error,
        'maximum_abs_x_motion_m': max(abs(sample['translation_xy_m'][0]) for sample in samples),
        'maximum_abs_y_motion_m': max(abs(sample['translation_xy_m'][1]) for sample in samples),
        'baseline_pose_source': str(source_dir / 'create_plating_scene.py'),
        'baseline_pose_source_sha256': _sha(source_dir / 'create_plating_scene.py'),
        'spoon_source_sha256': _sha(source_dir / 'plating_spoon.py'),
        'hydraulic_source_sha256': _sha(source_dir / 'plating_reservoir.py'),
        'performance_source_sha256': _sha(Path(__file__)),
        'original_cache_or_dataset_modified': False,
    }
    detent_errors = {}
    for sample in samples:
        if sample['frame'] in DETENTS:
            detent_errors[str(sample['frame'])] = abs(sample['actual_nozzle_world'][0] - sample['nominal_route_x_m'])
    performance['detent_outlet_x_errors_m'] = detent_errors
    performance['detent_route_samples'] = [
        {'frame': sample['frame'], 's': sample['route_s'],
         'nominal_y_m': sample['route_y_m'], 'nozzle_world': sample['actual_nozzle_world']}
        for sample in samples if sample['frame'] in DETENTS
    ]
    if max_z_error > 1e-7 or max(detent_errors.values()) > 1e-7:
        raise RuntimeError('Performance compensation lost the baseline nozzle Z or X detent anchors')
    started = time.perf_counter()
    plan = plan_reservoir(spoon, poses, fps=24, initial_volume_ml=8,
                          nu_m2_s=0.001, spout_width_m=0.012, substeps=4)
    performance['hydraulic_replan_seconds'] = time.perf_counter() - started
    plan['provenance']['spoon_performance'] = performance
    (output / 'reservoir-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    (output / 'performance-poses.json').write_text(json.dumps({'poses': poses, 'samples': samples,
                                                             'provenance': performance}, indent=2) + '\n')
    print('PLATING_PERFORMANCE_PREPARED', json.dumps({
        'output': str(output), 'emitted_ml': plan['provenance']['emitted_volume_ml'],
        'remaining_ml': plan['provenance']['remaining_volume_ml'], 'performance': performance,
    }, sort_keys=True), flush=True)
    return plan, material


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/plating-timeline/thinfilm-oblique')
    parser.add_argument('--route', choices=('straight', 'oblique'), default='oblique')
    parser.add_argument('--station-x', type=float, nargs=4,
                        help='Optional physical X anchors derived from the approved camera projection')
    parser.add_argument('--prepare-only', action='store_true')
    options = parser.parse_args(args)
    output = Path(options.output).resolve()
    plan, material = prepare(output, route=options.route, station_x=options.station_x)
    if not options.prepare_only:
        metadata = solve(output / 'reservoir-plan.json', output)
        obj = load_film_mesh(output, 168, material)
        mesh_proof = json.loads(obj['thinfilm_provenance'])
        if mesh_proof['mesh_connected_components'] != 1 or mesh_proof['non_manifold_edges']:
            raise RuntimeError('The performance must produce one connected closed complete trail at frame 168')
        combined = metadata['measured_final_volume_ml'] + plan['provenance']['remaining_volume_ml']
        if abs(combined - 8) > 1e-8:
            raise RuntimeError('Performance reservoir and plate film do not conserve the initial 8ml')
        proof = {'initial_ml': 8.0, 'combined_final_ml': combined,
                 'route': options.route, 'route_parameters': plan['provenance']['spoon_performance']['route_parameters'],
                 'authored_spoon_performance': True, 'authored_liquid_outline': False,
                 'frame_168_mesh': mesh_proof,
                 'minimum_cross_trail_height_m': metadata['frame_168_minimum_cross_trail_height_m'],
                 'physics_model': metadata['model'], 'full_3d_Navier_Stokes': False}
        (output / 'performance-validation.json').write_text(json.dumps(proof, indent=2) + '\n')
        print('PLATING_PERFORMANCE_VALIDATED', json.dumps(proof, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
