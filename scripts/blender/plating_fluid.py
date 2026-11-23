"""Finite-volume Mantaflow sauce setup for Blender 4.5.3 LTS.

This module configures physics; it never bakes or renders. All geometry uses
metres with Z up. The only liquid source is a closed GEOMETRY initial volume
inside the real spoon collider. There is no inflow, scripted liquid trail, or
per-frame replacement of the simulated surface.

Usage, after the caller has created and animated the spoon::

    simulation = setup_liquid(scene, spoon_data, cache_dir, 352, 180)
    simulation['domain'].data.materials.append(sauce_material)
    bpy.context.view_layer.objects.active = simulation['domain']
    simulation['domain'].select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.fluid.bake_data()
    bpy.ops.fluid.bake_mesh()

The caller owns those bake operators and their running time. Use a distinct
cache directory for every resolution/settings revision. Modular cache files
are not deleted, replaced, or resumed by this module.
"""

from __future__ import annotations

import json
import math
import re
import time
from pathlib import Path
from typing import Any, Callable

import bmesh
import bpy


# The macro composition retains a real 22 cm spoon and a 28.8 cm sauce journey.
# Dry parts of the spoon handle may extend beyond the liquid-only domain.
STATIONS_X_M = (-0.192, -0.096, 0.0, 0.096)
DOMAIN_MIN_M = (-0.240, -0.035, -0.004)
DOMAIN_MAX_M = (0.160, 0.080, 0.055)
KINEMATIC_VISCOSITY_M2_S = 2.0e-4
SURFACE_TENSION_GRID_UNITS = 0.1
FRACTIONS_DISTANCE_CELLS = 0.15
DISK_BUDGET_BYTES = 2 * 1024**3
SOLVER_SOURCE_BASE = "https://github.com/blender/blender/blob/v4.5.3/"
SOLVER_REFERENCES = {
    "diffusion_step": SOLVER_SOURCE_BASE + "intern/mantaflow/intern/strings/liquid_script.h#L299-L314",
    "physical_viscosity_scaling": SOLVER_SOURCE_BASE + "intern/mantaflow/intern/strings/fluid_script.h#L125-L130",
    "independent_solver_switches": SOLVER_SOURCE_BASE + "intern/mantaflow/intern/MANTA_main.cpp#L56-L60",
}


def _collection(scene: bpy.types.Scene, name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    scene.collection.children.link(collection)
    return collection


def _mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    # Volume signs and obstacle interiors depend on consistent closed normals.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def _box(
    name: str,
    minimum: tuple[float, float, float],
    maximum: tuple[float, float, float],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    # Coordinates are baked into the mesh: no unapplied domain scale.
    x0, y0, z0 = minimum
    x1, y1, z1 = maximum
    vertices = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
        (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return _mesh_object(name, vertices, faces, collection)


def _source_volume(
    spoon_data: dict[str, Any],
    collection: bpy.types.Collection,
) -> tuple[bpy.types.Object, dict[str, Any]]:
    """Closed bowl-shaped finite fill with a genuinely flat free surface.

    The lower surface samples the same analytic interior as the actual spoon;
    it is not a sphere protruding through its walls. The radial footprint is
    clipped where the floor approaches the fill level, preserving a closed
    mesh and keeping every initial liquid vertex inside the bowl.
    """
    floor_fn: Callable[[float, float], float | None] = spoon_data.get("inner_floor_fn")
    if not callable(floor_fn):
        raise ValueError("spoon_data must provide its real inner_floor_fn(x_m, y_m)")
    radii = spoon_data.get("bowl_radii_m", spoon_data.get("bowl_radii"))
    if not radii or len(radii) != 2:
        raise ValueError("spoon_data must provide bowl_radii_m in root-local metres")
    scale_factor = float(spoon_data.get("scale", 0.07)) / 0.07
    level = float(spoon_data.get("liquid_level_m", 0.0082 * scale_factor))
    clearance = float(spoon_data.get("liquid_bottom_clearance_m", 0.0005 * scale_factor))
    extent = float(spoon_data.get("liquid_footprint_fraction", 0.8))
    if not 0.1 <= extent <= 0.95:
        raise ValueError("liquid_footprint_fraction must stay between .1 and .95")
    centre = spoon_data.get("fill_center", (0.0, 0.0, 0.0))
    cx, cy = float(centre[0]), float(centre[1])
    rx, ry = float(radii[0]) * extent, float(radii[1]) * extent
    centre_floor = floor_fn(cx, cy)
    if centre_floor is None or level <= centre_floor + clearance:
        raise ValueError("The finite fill level must be above the bowl's interior floor")

    sectors, rings = 96, 18
    edge_depth = min(0.0002 * scale_factor, (level - centre_floor - clearance) * 0.05)
    limits = []
    for sector in range(sectors):
        angle = sector / sectors * math.tau
        dx, dy = rx * math.cos(angle), ry * math.sin(angle)

        def fits(r: float) -> bool:
            floor = floor_fn(cx + dx * r, cy + dy * r)
            return floor is not None and floor + clearance <= level - edge_depth

        if fits(1.0):
            limits.append(1.0)
        else:
            low, high = 0.0, 1.0
            for _ in range(22):
                middle = (low + high) * 0.5
                if fits(middle):
                    low = middle
                else:
                    high = middle
            limits.append(low)
    if min(limits) < 0.05:
        raise ValueError("The requested fill plane has no useful interior footprint")

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    def surface(top: bool) -> tuple[int, list[list[int]]]:
        centre_index = len(vertices)
        vertices.append((cx, cy, level if top else centre_floor + clearance))
        ring_indices = []
        for ring in range(1, rings + 1):
            rr = ring / rings
            indices = []
            for sector in range(sectors):
                angle = sector / sectors * math.tau
                radial = rr * limits[sector]
                x = cx + rx * math.cos(angle) * radial
                y = cy + ry * math.sin(angle) * radial
                floor = floor_fn(x, y)
                if floor is None:
                    raise RuntimeError("Finite fill escaped the spoon interior")
                indices.append(len(vertices))
                vertices.append((x, y, level if top else floor + clearance))
            ring_indices.append(indices)
        for sector in range(sectors):
            nxt = (sector + 1) % sectors
            face = (centre_index, ring_indices[0][sector], ring_indices[0][nxt])
            faces.append(face if top else tuple(reversed(face)))
        for previous, current in zip(ring_indices, ring_indices[1:]):
            for sector in range(sectors):
                nxt = (sector + 1) % sectors
                face = (previous[sector], current[sector], current[nxt], previous[nxt])
                faces.append(face if top else tuple(reversed(face)))
        return centre_index, ring_indices

    _, bottom = surface(False)
    _, top = surface(True)
    for sector in range(sectors):
        nxt = (sector + 1) % sectors
        faces.append((bottom[-1][sector], bottom[-1][nxt], top[-1][nxt], top[-1][sector]))
    source = _mesh_object("SauceFiniteInitialFill", vertices, faces, collection)
    source.parent = spoon_data["root"]
    source.hide_render = True
    source.display_type = "WIRE"
    # Keep the source in the evaluated viewport dependency graph for baking.
    source.hide_viewport = False
    source.hide_set(False)
    bm = bmesh.new()
    bm.from_mesh(source.data)
    nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
    volume_m3 = abs(bm.calc_volume(signed=True))
    bm.free()
    if nonmanifold or volume_m3 <= 0:
        raise RuntimeError(f"Initial fill is not a closed positive volume: {nonmanifold} open edges")
    source["source_mechanism"] = "GEOMETRY: one finite initial spoonful, no replenishment"
    source["initial_volume_m3"] = volume_m3
    source["initial_volume_ml"] = volume_m3 * 1_000_000
    return source, {
        "source_mechanism": "finite_GEOMETRY_initial_volume",
        "initial_volume_m3": volume_m3,
        "initial_volume_ml": volume_m3 * 1_000_000,
        "fill_plane_local_z_m": level,
        "bottom_clearance_m": clearance,
        "footprint_fraction": extent,
        "source_nonmanifold_edges": nonmanifold,
        "maximum_central_depth_m": level - centre_floor - clearance,
    }


def _collision(obj: bpy.types.Object, margin_cells: float) -> bpy.types.Modifier:
    existing = next((modifier for modifier in obj.modifiers if modifier.type == "FLUID"), None)
    if existing and existing.fluid_type != "EFFECTOR":
        raise ValueError(f"{obj.name} already has a non-effector fluid modifier")
    modifier = existing or obj.modifiers.new("Mantaflow physical collision", "FLUID")
    modifier.fluid_type = "EFFECTOR"
    settings = modifier.effector_settings
    settings.effector_type = "COLLISION"
    settings.use_effector = True
    settings.use_plane_init = False
    settings.surface_distance = margin_cells
    settings.subframes = 4
    obj.hide_viewport = False
    obj.hide_set(False)
    return modifier


def setup_liquid(
    scene: bpy.types.Scene,
    spoon_data: dict[str, Any],
    cache_dir: str | Path,
    resolution: int = 352,
    frame_end: int = 180,
) -> dict[str, Any]:
    """Configure an actual viscous-liquid simulation, without executing it.

    ``spoon_data`` comes from ``plating_spoon.create_spoon``. Its metre-space
    root must animate the visual spoon and the closed collision proxy together.
    Optional source overrides are ``liquid_level_m``,
    ``liquid_bottom_clearance_m`` and ``liquid_footprint_fraction``. A caller can
    provide ``porcelain`` explicitly; otherwise ``PorcelainSurface`` is used.

    At resolution 352 the .40 m domain gives ~1.14 mm voxels, within .4% of
    the former .58 m / 512-cell setup. A 192-cell
    preview can establish gross pouring behavior but cannot validate a 2 mm
    film. Physical kinematic viscosity is specified through Diffusion; the
    separate high-viscosity solver's dimensionless Strength is deliberately
    disabled so it does not silently add a second, uncalibrated viscosity.
    """
    if not 32 <= int(resolution) <= 1024:
        raise ValueError("resolution must be between 32 and 1024")
    if int(frame_end) < 1:
        raise ValueError("frame_end must be positive")
    for key in ("root", "collider"):
        if key not in spoon_data:
            raise ValueError(f"spoon_data is missing {key}")
    if any(abs(float(value) - 1.0) > 1e-6 for value in spoon_data["root"].scale):
        raise ValueError("Spoon root scale must be applied; geometry must already use metres")

    cache_path = Path(cache_dir).expanduser().resolve()
    cache_path.mkdir(parents=True, exist_ok=True)
    preexisting_cache = any(cache_path.iterdir())
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene.use_gravity = True
    scene.gravity = (0.0, 0.0, -9.81)
    scene.frame_start = 1
    scene.frame_end = int(frame_end)

    dimensions = tuple(DOMAIN_MAX_M[i] - DOMAIN_MIN_M[i] for i in range(3))
    voxel = max(dimensions) / int(resolution)
    spoon_margin = float(spoon_data.get("liquid_collision_margin_cells", 0.35))
    physics = _collection(scene, "Plating Physics")
    flows = _collection(scene, "Plating Liquid Sources")
    effectors = _collection(scene, "Plating Liquid Effectors")
    source_spec = dict(spoon_data)
    # Start above the collision sampling margin; otherwise the first solver
    # frame silently removes part of a source that overlaps the inflated bowl.
    source_spec.setdefault(
        "liquid_bottom_clearance_m",
        max(0.0005, voxel * (spoon_margin + FRACTIONS_DISTANCE_CELLS + 0.08)),
    )
    source, source_info = _source_volume(source_spec, flows)
    source_modifier = source.modifiers.new("Finite initial liquid, no inflow", "FLUID")
    source_modifier.fluid_type = "FLOW"
    flow = source_modifier.flow_settings
    flow.flow_type = "LIQUID"
    flow.flow_behavior = "GEOMETRY"
    flow.flow_source = "MESH"
    flow.use_plane_init = False
    flow.surface_distance = 0.0
    flow.volume_density = 1.0
    flow.use_initial_velocity = False
    flow.subframes = 4

    collider = spoon_data["collider"]
    if collider.name not in effectors.objects:
        effectors.objects.link(collider)
    spoon_modifier = _collision(collider, spoon_margin)
    ground = spoon_data.get("porcelain") or scene.objects.get("PorcelainSurface")
    ground_proxy_created = ground is None
    if ground is None:
        ground = _box(
            "PorcelainLiquidCollision",
            (DOMAIN_MIN_M[0] - 0.025, DOMAIN_MIN_M[1] - 0.025, -0.02),
            (DOMAIN_MAX_M[0] + 0.025, DOMAIN_MAX_M[1] + 0.025, 0.0),
            effectors,
        )
        ground.hide_render = True
        ground.display_type = "WIRE"
    elif ground.name not in effectors.objects:
        effectors.objects.link(ground)
    if ground.type != "MESH":
        raise ValueError("Porcelain collision must be a mesh with its upper surface at Z=0")
    ground_modifier = _collision(ground, 0.0)

    domain = _box("SauceLiquidDomain", DOMAIN_MIN_M, DOMAIN_MAX_M, physics)
    domain.display_type = "WIRE"
    modifier = domain.modifiers.new("Mantaflow viscous finite sauce", "FLUID")
    modifier.fluid_type = "DOMAIN"
    settings = modifier.domain_settings
    settings.domain_type = "LIQUID"
    # Set Modular before any frame evaluation; Replay would start simulation
    # while the parent is still assembling and inspecting its scene.
    settings.cache_type = "MODULAR"
    settings.cache_directory = str(cache_path)
    settings.cache_frame_start = 1
    settings.cache_frame_end = int(frame_end)
    settings.cache_frame_offset = 0
    settings.cache_resumable = False
    settings.cache_data_format = "OPENVDB"
    settings.openvdb_cache_compress_type = "BLOSC"
    # Dynamic enum values in Blender 4.5.3 differ from static RNA documentation:
    # BOBJECT is the compressed .bobj.gz liquid surface; UNI caches particles.
    settings.cache_mesh_format = "BOBJECT"
    settings.cache_particle_format = "UNI"
    settings.resolution_max = int(resolution)
    settings.time_scale = 1.0
    settings.simulation_method = "APIC"
    settings.flip_ratio = 0.75  # Stored for a deliberate switch to FLIP; unused by APIC.
    settings.use_adaptive_timesteps = True
    settings.timesteps_min = 2
    settings.timesteps_max = 8
    settings.cfl_condition = 2.0
    settings.particle_number = 2
    settings.particle_min = 8
    settings.particle_max = 16
    settings.particle_randomness = 0.05
    settings.particle_radius = 1.0
    settings.particle_band_width = 3.0
    settings.use_fractions = True
    settings.fractions_distance = FRACTIONS_DISTANCE_CELLS
    settings.fractions_threshold = 0.05
    settings.delete_in_obstacle = False
    settings.use_diffusion = True
    settings.viscosity_base = 2.0
    settings.viscosity_exponent = 4
    # A modest grid coefficient retains a meniscus without enforcing the
    # uncalibrated, bead-forming value 1.0 on a millimetre-scale thin film.
    settings.surface_tension = SURFACE_TENSION_GRID_UNITS  # Not SI N/m.
    settings.use_viscosity = False
    settings.use_mesh = True
    settings.mesh_scale = 2
    settings.mesh_generator = "IMPROVED"
    settings.mesh_particle_radius = 1.6
    settings.mesh_smoothen_pos = 1
    settings.mesh_smoothen_neg = 1
    settings.use_speed_vectors = False
    settings.use_spray_particles = False
    settings.use_bubble_particles = False
    settings.use_foam_particles = False
    settings.use_tracer_particles = False
    for side in ("front", "back", "left", "right", "top"):
        setattr(settings, "use_collision_border_" + side, False)
    settings.use_collision_border_bottom = True
    # Keep the simulation independent of any unrelated future flow/effector.
    if hasattr(settings, "fluid_group"):
        settings.fluid_group = flows
    if hasattr(settings, "effector_group"):
        settings.effector_group = effectors
    for polygon in domain.data.polygons:
        polygon.use_smooth = True

    approximate_grid = tuple(math.ceil(length / voxel) for length in dimensions)
    previous_voxel = 0.58 / 512
    previous_grid = (512, math.ceil(0.12 / previous_voxel), math.ceil(0.075 / previous_voxel))
    fps = scene.render.fps / scene.render.fps_base
    notes = [
        "Actual Mantaflow APIC liquid with gravity, collisions, diffusion viscosity, and surface tension.",
        "Finite initial GEOMETRY volume only; no continuous replenishment and no authored liquid trail.",
        "The spoon must begin near level for 12-18 frames before controlled tilts; a finite spoonful may empty before the last station.",
        "Only baked data and mesh establish pouring behavior; setup validation does not validate a simulated result.",
        "The final .40 m domain at 352 cells has ~1.136 mm voxels versus ~1.133 mm for the former .58 m/512 setup (.313% coarser spacing).",
        "Spatial spacing is nearly unchanged, but the smaller bounds and min2/max8/CFL2 temporal settings require fresh bake validation; identical trajectories or accuracy are not claimed.",
        "The domain retains 35 mm negative-Y space for pooling rather than clipping a larger first pour at the proposed 15 mm boundary.",
        "The spoon's source and wet bowl fit the authored motion envelope; escaped droplets can still cross open borders, so baked volume loss must be inspected.",
        "A 192-cell preview cannot resolve the target ~2 mm sauce film; inspect the 352-cell final-domain bake before accepting thin-film behavior.",
        "Kinematic viscosity is 2e-4 m^2/s via Diffusion: Blender 4.5.3 runs cgSolveDiffusion independently of the optional high-viscosity applyViscosity step.",
        "This is a Newtonian viscous approximation; no measured shear-thinning rheology is claimed.",
        "Surface tension .1 uses Mantaflow grid units, not N/m. It needs calibration from a final-resolution bake; it is not a measured sauce property.",
        "Fractional obstacle distance .15 cell reduces the visible air gap at porcelain relative to Blender's .5-cell default.",
        "A .35-cell spoon collision margin leaves room at the final pose's millimetre-scale lip gap; the closed proxy itself is ~2.3 mm thick.",
        "Compressed OpenVDB data, UNI particles, .bobj.gz mesh; no secondary particles, resumable checkpoints, or velocity-vector cache.",
        "The 2 GiB cache allocation is a budget, not a prediction. Measure cache growth after the first 24-48 baked frames before extending.",
        "Use bake_evidence(domain, sample_frames=[...]) after baking to inspect actual cache coverage and evaluated liquid volume; flags alone are insufficient.",
    ]
    if preexisting_cache:
        notes.append("Cache directory was nonempty at setup. No files were removed; use a fresh path when settings change.")
    metadata = {
        "solver": "Mantaflow APIC",
        "gravity_m_s2": [0.0, 0.0, -9.81],
        "kinematic_viscosity_m2_s": KINEMATIC_VISCOSITY_M2_S,
        "high_viscosity_solver": False,
        "surface_tension_grid_units": SURFACE_TENSION_GRID_UNITS,
        "surface_tension_calibrated_from_bake": False,
        "viscosity_equation": "alpha = (nu / longest_domain_side_m^2) * timestep_s * resolution^2 = nu * timestep_s / voxel_m^2",
        "solver_source_references": SOLVER_REFERENCES,
        "domain_min_m": DOMAIN_MIN_M,
        "domain_max_m": DOMAIN_MAX_M,
        "stations_x_m": STATIONS_X_M,
        "resolution": int(resolution),
        "approximate_grid": approximate_grid,
        "voxel_size_m": voxel,
        "spatial_comparison": {
            "previous_domain_dimensions_m": (0.58, 0.12, 0.075),
            "previous_resolution": 512,
            "previous_approximate_grid": previous_grid,
            "previous_voxel_m": previous_voxel,
            "voxel_spacing_change_fraction": voxel / previous_voxel - 1.0,
            "approximate_cell_count_change_fraction": math.prod(approximate_grid) / math.prod(previous_grid) - 1.0,
            "trajectory_equivalence_verified": False,
        },
        "temporal_settings": {
            "adaptive": True,
            "timesteps_min": 2,
            "timesteps_max": 8,
            "cfl": 2.0,
            "source_subframes": 4,
            "collider_subframes": 4,
        },
        "spoon_collision_margin_cells": spoon_margin,
        "spoon_collision_margin_m": spoon_margin * voxel,
        "fractions_distance_cells": FRACTIONS_DISTANCE_CELLS,
        "fractions_distance_m": FRACTIONS_DISTANCE_CELLS * voxel,
        "frame_start": 1,
        "frame_end": int(frame_end),
        "fps": fps,
        "duration_seconds": int(frame_end) / fps,
        "cache_type": "MODULAR",
        "cache_directory": str(cache_path),
        "cache_budget_bytes": DISK_BUDGET_BYTES,
        "cache_resumable": False,
        "cache_preexisting": preexisting_cache,
        "setup_unix_time": time.time(),
        "ground_proxy_created": ground_proxy_created,
        **source_info,
        "notes": notes,
    }
    domain["plating_physics"] = json.dumps(metadata, sort_keys=True)
    domain["source_mechanism"] = source_info["source_mechanism"]
    domain["initial_volume_ml"] = source_info["initial_volume_ml"]
    return {
        "domain": domain,
        "domain_modifier": modifier,
        "domain_settings": settings,
        "source": source,
        "source_modifier": source_modifier,
        "source_settings": flow,
        "spoon_collider": collider,
        "spoon_effector_modifier": spoon_modifier,
        "porcelain": ground,
        "porcelain_effector_modifier": ground_modifier,
        "physics_collection": physics,
        "flow_collection": flows,
        "effector_collection": effectors,
        "metadata": metadata,
        "notes": notes,
    }


def bake_evidence(
    simulation_or_domain: dict[str, Any] | bpy.types.Object,
    sample_frames: tuple[int, ...] | list[int] = (),
) -> dict[str, Any]:
    """Inspect baked files and optional evaluated liquid geometry; never bake.

    With no ``sample_frames`` this only reads settings and cache directory
    metadata. Geometry inspection is allowed only after BOTH baked-cache flags
    are true and the requested frame has an actual cached mesh file. It loads
    the existing baked mesh on CPU, measures its world-space closed volume,
    and restores the original scene frame. It does not render or start a job.

    The returned object is JSON-serializable and can be saved by the caller as
    ``bake-evidence.json``. Volume is meshed-surface evidence, not an exact FLIP
    particle-mass measurement; resampling and meshing introduce error.
    """
    domain = simulation_or_domain["domain"] if isinstance(simulation_or_domain, dict) else simulation_or_domain
    modifier = next((item for item in domain.modifiers if item.type == "FLUID" and item.fluid_type == "DOMAIN"), None)
    if modifier is None:
        raise ValueError("bake_evidence requires a Mantaflow domain")
    settings = modifier.domain_settings
    scene = bpy.context.scene
    metadata = json.loads(domain.get("plating_physics", "{}"))
    directory = Path(bpy.path.abspath(settings.cache_directory)).resolve()
    pattern = re.compile(r"[_-](\d{4,})(?:\.(?:bobj\.gz|vdb|uni|obj|gz))$", re.IGNORECASE)
    categories: dict[str, dict[str, Any]] = {
        key: {"count": 0, "bytes": 0, "frames": []} for key in ("data", "mesh", "particles", "config", "other")
    }
    frame_sets = {key: set() for key in categories}
    total_bytes = 0
    stale_files = []
    setup_time = float(metadata.get("setup_unix_time", 0))
    if directory.is_dir():
        for file in directory.rglob("*"):
            if not file.is_file():
                continue
            relative = file.relative_to(directory)
            first = relative.parts[0]
            category = first if first in categories else "other"
            size = file.stat().st_size
            categories[category]["count"] += 1
            categories[category]["bytes"] += size
            total_bytes += size
            match = pattern.search(file.name)
            if match:
                frame_sets[category].add(int(match.group(1)))
            if setup_time and file.stat().st_mtime < setup_time - 1:
                stale_files.append(str(relative))
    for key, data in categories.items():
        data["frames"] = sorted(frame_sets[key])

    expected = set(range(settings.cache_frame_start, settings.cache_frame_end + 1))
    missing_data = sorted(expected - frame_sets["data"])
    missing_mesh = sorted(expected - frame_sets["mesh"])
    has_data = bool(settings.has_cache_baked_data)
    has_mesh = bool(settings.has_cache_baked_mesh)
    warnings = []
    if not has_data or not has_mesh:
        warnings.append("Both data and mesh bake flags must be true before production rendering.")
    if missing_data or missing_mesh:
        warnings.append("Cache files do not cover the configured full frame interval.")
    if stale_files:
        warnings.append("Some cache files predate this physics setup; use a fresh cache or verify an intentional loaded bake.")
    if total_bytes > DISK_BUDGET_BYTES:
        warnings.append("Cache exceeds the 2 GiB allocation.")
    samples = []
    requested = sorted(set(int(frame) for frame in sample_frames))
    original_frame = scene.frame_current
    if requested and not (has_data and has_mesh):
        warnings.append("Geometry sampling skipped because a complete baked data-and-mesh state was not confirmed.")
    elif requested:
        try:
            for frame in requested:
                if frame not in frame_sets["mesh"]:
                    warnings.append(f"Geometry frame {frame} skipped: cached mesh file is missing.")
                    continue
                scene.frame_set(frame)
                evaluated = domain.evaluated_get(bpy.context.evaluated_depsgraph_get())
                mesh = evaluated.to_mesh()
                try:
                    bm = bmesh.new()
                    bm.from_mesh(mesh)
                    bm.transform(domain.matrix_world)
                    nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
                    volume_m3 = abs(bm.calc_volume(signed=True)) if bm.faces else 0.0
                    vertices = len(bm.verts)
                    faces = len(bm.faces)
                    if vertices:
                        minimum = [min(vertex.co[axis] for vertex in bm.verts) for axis in range(3)]
                        maximum = [max(vertex.co[axis] for vertex in bm.verts) for axis in range(3)]
                    else:
                        minimum = maximum = None
                    # Connected surface islands expose fragmentation without
                    # prejudging whether an individual drop is physically valid.
                    remaining = set(bm.verts)
                    islands = 0
                    while remaining:
                        islands += 1
                        pending = [remaining.pop()]
                        while pending:
                            vertex = pending.pop()
                            for edge in vertex.link_edges:
                                neighbor = edge.other_vert(vertex)
                                if neighbor in remaining:
                                    remaining.remove(neighbor)
                                    pending.append(neighbor)
                    bm.free()
                    initial = float(metadata.get("initial_volume_m3", 0))
                    ratio = volume_m3 / initial if initial else None
                    sample = {
                        "frame": frame,
                        "vertices": vertices,
                        "faces": faces,
                        "nonmanifold_edges": nonmanifold,
                        "surface_islands": islands,
                        "volume_m3": volume_m3,
                        "volume_ml": volume_m3 * 1_000_000,
                        "meshed_volume_ratio_to_initial": ratio,
                        "bounds_world_m": {"min": minimum, "max": maximum},
                    }
                    samples.append(sample)
                    if volume_m3 <= 0 or not faces:
                        warnings.append(f"Frame {frame} has no positive simulated liquid surface volume.")
                    if nonmanifold:
                        warnings.append(f"Frame {frame} has {nonmanifold} nonmanifold surface edges; closed-volume measurement is provisional.")
                    if ratio is not None and (ratio < 0.4 or ratio > 1.6):
                        warnings.append(f"Frame {frame} meshed volume is {ratio:.3f} of the finite initial fill; inspect resampling, obstacle overlap, meshing inflation, or outflow loss.")
                finally:
                    evaluated.to_mesh_clear()
        finally:
            scene.frame_set(original_frame)
    complete = has_data and has_mesh and not missing_data and not missing_mesh
    return {
        "version": 1,
        "blender": bpy.app.version_string,
        "solver": metadata.get("solver", "Mantaflow"),
        "has_cache_baked_data": has_data,
        "has_cache_baked_mesh": has_mesh,
        "complete_cache_frame_coverage": complete,
        "frame_start": settings.cache_frame_start,
        "frame_end": settings.cache_frame_end,
        "cache_directory": str(directory),
        "cache": categories,
        "missing_data_frames": missing_data,
        "missing_mesh_frames": missing_mesh,
        "cache_bytes": total_bytes,
        "cache_budget_bytes": DISK_BUDGET_BYTES,
        "within_cache_budget": total_bytes <= DISK_BUDGET_BYTES,
        "cache_files_predating_setup": stale_files,
        "finite_initial_volume_ml": float(metadata.get("initial_volume_ml", 0)),
        "geometry_samples": samples,
        "kinematic_viscosity_m2_s": float(settings.viscosity_base * 10 ** (-settings.viscosity_exponent)),
        "use_diffusion": bool(settings.use_diffusion),
        "use_high_viscosity_solver": bool(settings.use_viscosity),
        "surface_tension_grid_units": float(settings.surface_tension),
        "solver_source_references": SOLVER_REFERENCES,
        "warnings": warnings,
    }
