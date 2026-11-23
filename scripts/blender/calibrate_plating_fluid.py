"""Bounded CPU-only static-spoon Mantaflow calibration in a NEW empty scene.

Run one case per fresh Blender process, never by opening a study .blend::

  Blender --background --factory-startup --threads 8 --python this.py -- --case A

Case A uses particle radius 1, narrow band 3, and mesh radius 2. Case B changes
only particle radius/band to 1.4/12. Case C repeats A with the spoon collision
proxy visible to render dependency evaluation. No rendering or GPU setup is
performed. Existing experiment/cache directories are never reused or reset.
"""

from __future__ import annotations

import argparse
from array import array
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plating_fluid as fluid
from plating_spoon import create_spoon
from create_plating_scene import pose


def _fresh_directory(base: Path) -> Path:
    directory = base
    number = 1
    while directory.exists():
        directory = base.with_name(base.name + f"-{number}")
        number += 1
    directory.mkdir(parents=True)
    return directory


def _cache_files(directory: Path, category: str) -> list[Path]:
    return sorted((directory / category).glob("*"))


def _grid_report(file: Path) -> dict:
    volume = bpy.data.volumes.new("NEW coupon cache metadata")
    try:
        volume.filepath = str(file)
        if not volume.grids.load():
            return {"error": volume.grids.error_message}
        grids = [{"name": grid.name, "type": grid.data_type, "matrix_object": [list(row) for row in grid.matrix_object]} for grid in volume.grids]
    finally:
        bpy.data.volumes.remove(volume)
    return {"grids": grids}


def _sdf_samples(file: Path, names: list[str], points: dict[str, tuple], domain_min: tuple, voxel: float) -> dict:
    try:
        import openvdb
    except ImportError:
        return {"available": False, "reason": "Python OpenVDB binding unavailable"}
    output = {}
    for name in names:
        lower = name.lower()
        if not any(term in lower for term in ("phi", "obstacle", "levelset")):
            continue
        try:
            grid = openvdb.read(str(file), name)
            accessor = grid.getConstAccessor()
            sampled = {}
            for label, point in points.items():
                index = tuple(round((point[i] - domain_min[i]) / voxel) for i in range(3))
                neighborhood = [float(accessor.getValue((index[0] + dx, index[1] + dy, index[2] + dz))) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)]
                sampled[label] = {"world_m": list(point), "nearest_index": index, "value": float(accessor.getValue(index)), "neighbor_min": min(neighborhood), "neighbor_max": max(neighborhood), "negative_neighbors": sum(value < 0 for value in neighborhood)}
            output[name] = sampled
        except Exception as error:
            output[name] = {"error": str(error)}
    return {"available": bool(output), "samples": output, "note": "Nearest voxel and 3x3x3 neighborhood; half-cell coordinate conventions remain a sampling uncertainty."}


def _particle_counts(domain, scene, frames) -> list[dict]:
    counts = []
    for frame in frames:
        scene.frame_set(frame)
        evaluated = domain.evaluated_get(bpy.context.evaluated_depsgraph_get())
        systems = []
        for system in evaluated.particle_systems:
            count = len(system.particles)
            velocities = array("f", [0.0]) * (count * 3)
            if count:
                system.particles.foreach_get("velocity", velocities)
            speeds = [math.sqrt(sum(velocities[index + axis] ** 2 for axis in range(3))) for index in range(0, count * 3, 3)]
            states = [particle.alive_state for particle in system.particles]
            state_counts = dict(Counter(states))
            alive_speeds = [speed for speed, state in zip(speeds, states) if state == "ALIVE"]
            systems.append({"name": system.name, "kind": system.settings.type, "count": count, "alive_states": state_counts, "alive_count": state_counts.get("ALIVE", 0), "max_alive_reported_speed": max(alive_speeds, default=0.0), "max_reported_particle_speed": max(speeds, default=0.0), "mean_reported_particle_speed": sum(speeds) / count if count else 0.0})
        counts.append({"frame": frame, "systems": systems, "available": any(item["count"] for item in systems)})
    return counts


def _scalar_volumes(directory, frames, voxel):
    import openvdb
    result = []
    for frame in frames:
        file = directory / f"fluid_data_{frame:04d}.vdb"
        flags = openvdb.read(str(file), "flags")
        phi = openvdb.read(str(file), "phi")
        fluid_cells = sum(value.count for value in flags.iterOnValues() if int(value.value) & 1 and not int(value.value) & 2)
        negative_phi_cells = sum(value.count for value in phi.iterOnValues() if float(value.value) < 0)
        result.append({"frame": frame, "fluid_flag_cells": fluid_cells, "fluid_flag_volume_ml": fluid_cells * voxel**3 * 1_000_000, "negative_phi_cells": negative_phi_cells, "negative_phi_volume_ml": negative_phi_cells * voxel**3 * 1_000_000})
    return result


def _native_mesh_components(directory, frames, longest_domain_side):
    """Measure native baked connected components without changing Fluid RNA.

    Mantaflow's native .bobj mesh is normalized by the longest domain side.
    The scale is cross-checked against evaluated geometry in each report.
    Counting islands alone treats a coherent pool with a few tiny drops as a
    failure; their actual share of the volume is the relevant evidence.
    """
    result = []
    for frame in frames:
        file = directory / f"fluid_mesh_{frame:04d}.bobj.gz"
        data = gzip.decompress(file.read_bytes())
        count, = struct.unpack_from("<i", data)
        offset = 4
        vertices = [struct.unpack_from("<fff", data, offset + index * 12) for index in range(count)]
        offset += count * 12
        normals, = struct.unpack_from("<i", data, offset)
        offset += 4 + normals * 12
        triangles, = struct.unpack_from("<i", data, offset)
        offset += 4
        faces = [struct.unpack_from("<iii", data, offset + index * 12) for index in range(triangles)]
        parents = list(range(count))

        def root(index):
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index

        for face in faces:
            first = root(face[0])
            for index in face[1:]:
                parents[root(index)] = first
        signed = {}
        for a, b, c in faces:
            x, y, z = vertices[a]
            u, v, w = vertices[b]
            i, j, k = vertices[c]
            volume = (x * (v * k - w * j) - y * (u * k - w * i) + z * (u * j - v * i)) / 6
            component = root(a)
            signed[component] = signed.get(component, 0.0) + volume
        scale = longest_domain_side**3 * 1_000_000
        volumes = sorted((abs(value) * scale for value in signed.values()), reverse=True)
        total = sum(volumes)
        result.append({"frame": frame, "surface_islands": len(volumes), "native_total_ml": total,
                       "largest_component_ml": volumes[0] if volumes else 0,
                       "largest_component_volume_fraction": volumes[0] / total if total else 0,
                       "other_components_total_ml": sum(volumes[1:]),
                       "largest_twelve_component_volumes_ml": volumes[:12]})
    return result


def _inflow_activity(directory, frames):
    import openvdb
    result = []
    for frame in frames:
        grid = openvdb.read(str(directory / f"fluid_data_{frame:04d}.vdb"), "phi_inflow")
        result.append({"frame": frame, "negative_inflow_cells": sum(value.count for value in grid.iterOnValues() if float(value.value) < 0)})
    return result


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=tuple("ABCDEFGHIJKL"), default="A")
    parser.add_argument("--output")
    parser.add_argument("--frames", type=int, default=12)
    options = parser.parse_args(arguments)
    case = options.case
    frame_end = options.frames
    if frame_end < 12 or frame_end > 48:
        raise ValueError("The bounded coupon supports 12 through 48 frames")
    sample_frames = sorted(set([1, 6, 12] + [frame for frame in (24, 36, 48) if frame <= frame_end] + [frame_end]))
    output = _fresh_directory(Path(options.output or f"output/plating-timeline/blender-fluid-coupon-{case}").resolve())
    print("COUPON_OUTPUT", str(output), flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    silver = bpy.data.materials.new("CPU calibration silver — not rendered")
    spoon = create_spoon(silver, scale=0.07)
    pose(spoon["root"], Vector(spoon["spout_local"]), 1)
    # Evaluate the fixed transforms before any fluid modifier is introduced.
    bpy.context.view_layer.update()
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.name = "PorcelainSurface"
    ground.dimensions = (1.0, 1.0, 0.04)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    spoon["porcelain"] = ground
    fluid.DOMAIN_MIN_M = (-0.24, -0.035, -0.004)
    fluid.DOMAIN_MAX_M = (-0.10, 0.080, 0.055)
    simulation = fluid.setup_liquid(scene, spoon, output / "cache", resolution=124, frame_end=frame_end)
    domain, settings = simulation["domain"], simulation["domain_settings"]
    external_source = case in ("J", "K", "L")
    flat_source = case in ("K", "L")
    nozzle_geometry = None
    if external_source:
        # This is a diagnostic of a finite emission window, NOT a closed
        # spoonful. Everything is still a fresh empty-scene cache. Remove the
        # cup effector and initial fill entirely before evaluating/baking.
        old_source = simulation["source"]
        flow_collection = old_source.users_collection[0]
        bpy.data.objects.remove(old_source, do_unlink=True)
        spoon["collider"].modifiers.clear()
        voxel = 0.14 / 124
        nozzle_radius = 2.5 * voxel if flat_source else 0.003
        half_depth = max(0.0013, 1.15 * voxel) if flat_source else nozzle_radius
        nominal_lip = Vector((-0.17, 0.02, 0.002))
        direction = Vector((-math.sin(0.65), -math.cos(0.65), -0.18)).normalized()
        center = nominal_lip + direction * (0.8 * nozzle_radius)
        center.z = max(nominal_lip.z + 0.003 / 2, half_depth + 0.25 * voxel)
        if case == "J":
            center = Vector((-0.17, 0.02, 0.008))
        velocity = direction * (1e-6 / (0.012 * 0.003)) if flat_source else Vector((0.0, 0.0, -0.02))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0, location=center)
        nozzle = bpy.context.object
        nozzle.name = "FiniteWindowExternalNozzle"
        nozzle.scale = (nozzle_radius, nozzle_radius, half_depth)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for collection in list(nozzle.users_collection):
            collection.objects.unlink(nozzle)
        flow_collection.objects.link(nozzle)
        nozzle.hide_render = True
        modifier = nozzle.modifiers.new("Actual finite-window liquid emission", "FLUID")
        modifier.fluid_type = "FLOW"
        flow = modifier.flow_settings
        flow.flow_type = "LIQUID"
        flow.flow_behavior = "INFLOW"
        flow.flow_source = "MESH"
        flow.use_plane_init = False
        flow.surface_distance = 0.0
        flow.volume_density = 1.0
        flow.use_initial_velocity = True
        flow.velocity_coord = velocity
        flow.subframes = 4
        for frame, enabled in ((1, True), (6, True), (7, False), (frame_end, False)):
            flow.use_inflow = enabled
            flow.keyframe_insert(data_path="use_inflow", frame=frame)
        if nozzle.animation_data and nozzle.animation_data.action:
            # Boolean properties normally evaluate discretely; make that
            # explicit for Blender versions exposing legacy action curves.
            for curve in getattr(nozzle.animation_data.action, "fcurves", ()):
                for key in curve.keyframe_points:
                    key.interpolation = "CONSTANT"
        simulation["source"] = nozzle
        simulation["source_modifier"] = modifier
        simulation["source_settings"] = flow
        simulation["metadata"]["source_mechanism"] = "finite_window_external_INFLOW_frames_1_through_6"
        simulation["metadata"]["initial_volume_ml"] = 0.0
        simulation["metadata"]["initial_volume_m3"] = 0.0
        domain["initial_volume_ml"] = 0.0
        domain["source_mechanism"] = simulation["metadata"]["source_mechanism"]
        domain["plating_physics"] = json.dumps(simulation["metadata"], sort_keys=True)
        nozzle_geometry = {"radius_xy_m": nozzle_radius, "half_depth_z_m": half_depth,
                           "center_m": list(center), "velocity_m_s": list(velocity),
                           "nominal_lip_m": list(nominal_lip) if flat_source else None,
                           "head_m": 0.003 if flat_source else None,
                           "flow_target_ml_s": 1.0 if flat_source else None,
                           "emission_frames_inclusive": [1, 6], "fully_closed_reservoir_mass": False}
    # These RNA writes are safe ONLY because this is a brand-new empty cache.
    high_steps = case in ("E", "F", "G", "H", "I", "J", "K", "L")
    settings.timesteps_min = 2 if case == "L" else (8 if high_steps else 1)
    settings.timesteps_max = 32 if high_steps else 4
    settings.cfl_condition = 1 if high_steps else 2
    settings.surface_tension = 0.0 if case == "D" else 0.1
    settings.particle_radius = 1.4 if case == "B" else 1.0
    settings.particle_band_width = 12 if case in ("B", "F", "G", "I", "J", "K", "L") else 3
    if flat_source:
        settings.viscosity_base = 1.0
        settings.viscosity_exponent = 3
    if case == "G":
        settings.simulation_method = "FLIP"
        settings.flip_ratio = 0.05
    if case == "H":
        settings.use_fractions = False
    if case == "I":
        settings.use_diffusion = False
        settings.use_viscosity = True
        settings.viscosity_value = 0.05
    settings.mesh_particle_radius = 2.0
    settings.cache_resumable = True
    settings.export_manta_script = True
    spoon["collider"].hide_render = case != "C"
    bpy.context.view_layer.update()
    scene.frame_set(1)
    bpy.context.view_layer.objects.active = domain
    bpy.ops.object.select_all(action="DESELECT")
    domain.select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "calibration.blend"))
    configuration = {
        "case": case, "diagnostic_only": True, "new_empty_scene": True,
        "static_spoon": not external_source, "no_animation": not external_source and spoon["root"].animation_data is None,
        "source_mechanism": simulation["metadata"]["source_mechanism"],
        "spoon_effector_enabled": not external_source,
        "external_source": nozzle_geometry,
        "domain_min_m": fluid.DOMAIN_MIN_M, "domain_max_m": fluid.DOMAIN_MAX_M,
        "resolution": 124, "voxel_m": 0.14 / 124, "frame_end": frame_end,
        "particle_radius": settings.particle_radius, "particle_band_width": settings.particle_band_width,
        "mesh_particle_radius": settings.mesh_particle_radius,
        "collider_hide_render": spoon["collider"].hide_render,
        "cache_resumable": settings.cache_resumable,
        "export_manta_script": settings.export_manta_script,
        "viscosity_mode": "high-viscosity-stress" if settings.use_viscosity else "kinematic-diffusion",
        "kinematic_viscosity_m2_s": settings.viscosity_base * 10**(-settings.viscosity_exponent) if settings.use_diffusion else None,
        "high_viscosity_strength": settings.viscosity_value if settings.use_viscosity else None,
        "use_diffusion": settings.use_diffusion, "use_high_viscosity_solver": settings.use_viscosity,
        "simulation_method": settings.simulation_method, "flip_ratio": settings.flip_ratio,
        "use_fractions": settings.use_fractions, "fractions_distance": settings.fractions_distance,
        "min_steps": settings.timesteps_min, "max_steps": settings.timesteps_max, "cfl": settings.cfl_condition,
        "surface_tension_grid_units": settings.surface_tension,
        "initial_volume_ml": simulation["metadata"]["initial_volume_ml"],
        "root_location": list(spoon["root"].location), "root_rotation": list(spoon["root"].rotation_euler),
    }
    (output / "configuration.json").write_text(json.dumps(configuration, indent=2) + "\n")
    print("COUPON_CONFIG", json.dumps(configuration), flush=True)
    started = time.monotonic()
    print("COUPON_DATA_START", case, flush=True)
    data_result = bpy.ops.fluid.bake_data()
    data_seconds = time.monotonic() - started
    data_files = _cache_files(output / "cache", "data")
    expected = [output / "cache" / "data" / f"fluid_data_{frame:04d}.vdb" for frame in range(1, frame_end + 1)]
    if "FINISHED" not in data_result or any(not file.is_file() for file in expected):
        raise RuntimeError(f"Coupon {case} data prefix is incomplete; no meshing or validity claim")
    print("COUPON_DATA_COMPLETE", case, data_seconds, len(data_files), flush=True)
    grids = _grid_report(expected[0])
    root_matrix = spoon["root"].matrix_world
    points = {
        "bowl_wall_center": tuple(root_matrix @ Vector((0, 0, 0.0006))),
        "liquid_center": tuple(root_matrix @ Vector((0, 0, 0.006))),
        "above_bowl": tuple(root_matrix @ Vector((0, 0, 0.025))),
        "ground_below_bowl": (float(spoon["root"].location.x), float(spoon["root"].location.y), -0.0015),
    }
    sdf = _sdf_samples(expected[0], [item["name"] for item in grids.get("grids", [])], points, fluid.DOMAIN_MIN_M, configuration["voxel_m"])
    print("COUPON_SDF", json.dumps({"case": case, "metadata": grids, "samples": sdf}), flush=True)
    mesh_start = time.monotonic()
    print("COUPON_MESH_START", case, flush=True)
    mesh_result = bpy.ops.fluid.bake_mesh()
    mesh_seconds = time.monotonic() - mesh_start
    if "FINISHED" not in mesh_result:
        raise RuntimeError(f"Coupon {case} native meshing did not finish")
    evidence = fluid.bake_evidence(domain, sample_frames=sample_frames)
    particle_counts = _particle_counts(domain, scene, sample_frames)
    scalar_volumes = _scalar_volumes(output / "cache" / "data", sample_frames, configuration["voxel_m"])
    components = _native_mesh_components(output / "cache" / "mesh", sample_frames, 0.14)
    inflow_activity = _inflow_activity(output / "cache" / "data", range(1, frame_end + 1)) if external_source else None
    samples = evidence["geometry_samples"]
    if len(samples) != len(sample_frames):
        raise RuntimeError("All requested actual baked geometry samples are required")
    first, last = samples[0], samples[-1]
    retention = last["volume_ml"] / first["volume_ml"] if first["volume_ml"] else 0
    ratio = last["volume_ml"] / configuration["initial_volume_ml"] if configuration["initial_volume_ml"] else None
    emitted_end = samples[1]
    post_emission_retention = last["volume_ml"] / emitted_end["volume_ml"] if emitted_end["volume_ml"] else 0
    overshoot = None
    cohesion_failed = components[-1]["largest_component_volume_fraction"] < 0.95 if external_source else None
    if external_source:
        source_top = nozzle_geometry["center_m"][2] + nozzle_geometry["half_depth_z_m"]
        maximum_baked_z = max(sample["bounds_world_m"]["max"][2] for sample in samples)
        # A fixed source with downward velocity should not launch droplets
        # centimetres upward. Allow two voxels for native mesh reconstruction.
        overshoot = {"source_top_m": source_top, "maximum_baked_z_m": maximum_baked_z,
                     "allowed_reconstruction_margin_m": 2 * configuration["voxel_m"],
                     "failed": maximum_baked_z > source_top + 2 * configuration["voxel_m"]}
    bad = (ratio < 0.75 or retention < 0.75 or last["surface_islands"] > 12) if not external_source else cohesion_failed or overshoot["failed"]
    result = {
        "configuration": configuration, "data_seconds": data_seconds, "mesh_seconds": mesh_seconds,
        "total_seconds": time.monotonic() - started, "frame12_to_frame1_meshed_volume": retention,
        "frame12_to_initial_volume": ratio, "static_case_failed": bad if not external_source else None,
        "diagnostic_failed": bad, "external_pool_cohesion_failed": cohesion_failed,
        "fixed_downward_nozzle_overshoot": overshoot,
        "frame12_to_frame6_meshed_volume": post_emission_retention,
        "mesh_samples": samples, "particle_counts": particle_counts,
        "scalar_grid_volumes": scalar_volumes,
        "native_mesh_components": components, "actual_cached_inflow_activity": inflow_activity,
        "cohesion_is_not_mass_conservation": True,
        "initial_cache_grids": grids, "initial_sdf_samples": sdf,
        "bake_evidence": evidence,
    }
    (output / "calibration-report.json").write_text(json.dumps(result, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "calibration.blend"))
    # A compact result is emitted immediately so the owner can decide whether
    # to authorize another bounded case without waiting for a long render.
    print("COUPON_RESULT", json.dumps({"case": case, "output": str(output), "failed": bad, "data_seconds": data_seconds, "mesh_seconds": mesh_seconds, "retention": retention, "initial_ratio": ratio, "samples": samples, "particle_counts": particle_counts}), flush=True)


if __name__ == "__main__":
    main()
