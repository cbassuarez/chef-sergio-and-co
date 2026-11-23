"""Actual Mantaflow plate/jet solver driven by a quasi-static reservoir plan.

The reservoir is a separate analytic approximation. This module simulates the
discharged liquid, gravity and porcelain contact; it does not simulate liquid
inside the moving spoon. INFLOW geometry is a numerically resolved nozzle,
not an authored trail. The reservoir's exact ledger is NOT evidence of the
CFD source's emitted volume: that requires independent cache calibration.

Only configures a NEW scene/cache. The caller owns data and mesh bake ops.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector

from plating_fluid import _box, _collection, _collision


DOMAIN_MIN_M = (-0.240, -0.060, -0.004)
DOMAIN_MAX_M = (0.160, 0.060, 0.014)
DEFAULT_KINEMATIC_VISCOSITY_M2_S = 1e-3


def setup_external_liquid(
    scene: bpy.types.Scene,
    spoon_data: dict[str, Any],
    reservoir_plan: dict[str, Any],
    cache_dir: str | Path,
    resolution: int = 352,
    frame_end: int = 180,
) -> dict[str, Any]:
    """Configure finite planned discharge and actual external liquid physics.

    ``states`` must contain every frame, with world-metre ``nozzle_world``,
    ``nozzle_velocity_world_m_s`` and preceding-interval ``flow_ml_s``. A flat
    ellipsoid resolves the outlet above the plate. Its depth approximates one
    frame's target volume, with a lower rasterization limit. Neither that
    geometric volume nor the target Q guarantees the actual injected volume.
    """
    if not 32 <= int(resolution) <= 1024 or int(frame_end) < 1:
        raise ValueError("Need resolution32–1024 and a positive frame_end")
    states = reservoir_plan.get("states", [])
    by_frame = {int(state["frame"]): state for state in states}
    if any(frame not in by_frame for frame in range(1, int(frame_end) + 1)):
        raise ValueError("Reservoir plan must contain every simulation frame")
    cache = Path(cache_dir).expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    if any(cache.iterdir()):
        raise ValueError("External liquid setup requires a NEW empty cache")
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.use_gravity = True
    scene.gravity = (0.0, 0.0, -9.81)
    scene.frame_start = 1
    scene.frame_end = int(frame_end)
    fps = scene.render.fps / scene.render.fps_base
    nu = float(reservoir_plan.get("provenance", {}).get("kinematic_viscosity_m2_s", DEFAULT_KINEMATIC_VISCOSITY_M2_S))
    if not math.isfinite(nu) or not 1e-9 <= nu <= 1.0:
        raise ValueError("Reservoir viscosity must be a finite supported SI kinematic viscosity")
    dimensions = tuple(DOMAIN_MAX_M[index] - DOMAIN_MIN_M[index] for index in range(3))
    voxel = max(dimensions) / int(resolution)
    radius = 2.5 * voxel
    minimum_half_depth = max(0.0013, 1.15 * voxel)
    maximum_half_depth = max(minimum_half_depth, 2.5 * voxel)
    physics = _collection(scene, "Plating External Physics")
    flows = _collection(scene, "Plating External Sources")
    effectors = _collection(scene, "Plating External Effectors")

    # The visible spoon remains intact, but is intentionally absent from this
    # external-only CFD boundary. It is handled by the analytic reservoir.
    collider = spoon_data.get("collider")
    if collider:
        for modifier in list(collider.modifiers):
            if modifier.type == "FLUID" and modifier.fluid_type == "EFFECTOR":
                collider.modifiers.remove(modifier)
    ground = spoon_data.get("porcelain") or scene.objects.get("PorcelainSurface")
    if ground is None:
        ground = _box("ExternalPorcelainCollision", (-0.30, -0.10, -0.04), (0.22, 0.10, 0.0), effectors)
        ground.hide_render = True
    if ground.name not in effectors.objects:
        effectors.objects.link(ground)
    ground_modifier = _collision(ground, 0.0)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0)
    source = bpy.context.object
    source.name = "ReservoirDrivenExternalNozzle"
    source.scale = (radius, radius, minimum_half_depth)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for collection in list(source.users_collection):
        collection.objects.unlink(source)
    flows.objects.link(source)
    source.hide_render = True
    source.display_type = "WIRE"
    modifier = source.modifiers.new("Finite reservoir-driven external inflow", "FLUID")
    modifier.fluid_type = "FLOW"
    flow = modifier.flow_settings
    flow.flow_type = "LIQUID"
    flow.flow_behavior = "INFLOW"
    flow.flow_source = "MESH"
    flow.use_plane_init = False
    flow.surface_distance = 0.0
    flow.volume_density = 1.0
    flow.use_initial_velocity = True
    if hasattr(flow, "velocity_factor"):
        flow.velocity_factor = 0.0  # Motion velocity is included explicitly below.
    flow.subframes = 4

    schedule = []
    for frame in range(1, int(frame_end) + 1):
        state = by_frame[frame]
        q = float(state["flow_ml_s"])
        if not math.isfinite(q) or q < 0:
            raise ValueError("Reservoir Q must be finite, nonnegative ml/s")
        nominal = Vector(state["nozzle_world"])
        direction = Vector(state.get("nozzle_direction_world", (0.0, 0.0, -1.0)))
        if direction.length:
            direction.normalize()
        head = max(0.0, float(state.get("nozzle_sheet_depth_m", state.get("head_m", 0.0))))
        target_volume = q * 1e-6 / fps
        half_depth = min(maximum_half_depth, max(minimum_half_depth, 3 * target_volume / (4 * math.pi * radius**2)))
        center = nominal + direction * (0.8 * radius)
        center.z = max(float(nominal.z) + head / 2, half_depth + 0.25 * voxel)
        previous = Vector(by_frame[max(1, frame - 1)]["nozzle_world"])
        following = Vector(by_frame[min(int(frame_end), frame + 1)]["nozzle_world"])
        interval = (min(int(frame_end), frame + 1) - max(1, frame - 1)) / fps
        translation = (following - previous) / interval if interval else Vector((0, 0, 0))
        velocity = Vector(state["nozzle_velocity_world_m_s"]) + translation
        if not all(math.isfinite(value) for value in (*center, *velocity)):
            raise ValueError("Nozzle positions and velocities must be finite")
        enabled = q > 1e-6
        if enabled and any(center[index] - (half_depth if index == 2 else radius) <= DOMAIN_MIN_M[index]
                           or center[index] + (half_depth if index == 2 else radius) >= DOMAIN_MAX_M[index]
                           for index in range(3)):
            raise ValueError(f"Active nozzle at frame{frame} does not fit the external domain")
        # The J coupon showed a one-frame lag for use_inflow in baked fields.
        # The planned preceding interval is therefore authored one frame early.
        key_frame = frame - 1
        source.location = center
        source.scale = (1.0, 1.0, half_depth / minimum_half_depth)
        source.keyframe_insert("location", frame=key_frame)
        source.keyframe_insert("scale", frame=key_frame)
        flow.use_inflow = enabled
        flow.velocity_coord = velocity
        flow.keyframe_insert("use_inflow", frame=key_frame)
        flow.keyframe_insert("velocity_coord", frame=key_frame)
        schedule.append({"frame": frame, "authored_key_frame": key_frame, "enabled": enabled,
                         "target_flow_ml_s": q, "target_interval_volume_ml": target_volume * 1e6,
                         "nominal_lip_world_m": list(nominal), "source_center_world_m": list(center),
                         "numerical_offset_world_m": list(center - nominal), "radius_xy_m": radius,
                         "half_depth_z_m": half_depth, "velocity_world_m_s": list(velocity),
                         "geometric_source_volume_ml": 4 * math.pi * radius**2 * half_depth / 3 * 1e6})
    # No extrapolated source activity after the finite planned sequence.
    flow.use_inflow = False
    flow.keyframe_insert("use_inflow", frame=int(frame_end))
    for curve in getattr(getattr(source.animation_data, "action", None), "fcurves", ()):
        for point in curve.keyframe_points:
            point.interpolation = "CONSTANT" if curve.data_path.endswith("use_inflow") else "LINEAR"

    domain = _box("SauceExternalLiquidDomain", DOMAIN_MIN_M, DOMAIN_MAX_M, physics)
    domain.display_type = "WIRE"
    domain_modifier = domain.modifiers.new("Mantaflow external viscous sauce", "FLUID")
    domain_modifier.fluid_type = "DOMAIN"
    settings = domain_modifier.domain_settings
    settings.domain_type = "LIQUID"
    settings.cache_type = "MODULAR"
    settings.cache_directory = str(cache)
    settings.cache_frame_start = 1
    settings.cache_frame_end = int(frame_end)
    settings.cache_frame_offset = 0
    settings.cache_resumable = False
    settings.cache_data_format = "OPENVDB"
    settings.openvdb_cache_compress_type = "BLOSC"
    settings.cache_mesh_format = "BOBJECT"
    settings.cache_particle_format = "UNI"
    settings.resolution_max = int(resolution)
    settings.simulation_method = "APIC"
    settings.time_scale = 1.0
    settings.use_adaptive_timesteps = True
    settings.timesteps_min = 8
    settings.timesteps_max = 32
    settings.cfl_condition = 1.0
    settings.particle_number = 2
    settings.particle_min = 8
    settings.particle_max = 16
    settings.particle_radius = 1.0
    settings.particle_randomness = 0.05
    settings.particle_band_width = 12.0
    settings.use_fractions = True
    settings.fractions_distance = 0.15
    settings.fractions_threshold = 0.05
    settings.delete_in_obstacle = False
    settings.use_diffusion = True
    viscosity_exponent = max(0, min(9, math.ceil(-math.log10(nu))))
    settings.viscosity_base = nu * 10**viscosity_exponent
    settings.viscosity_exponent = viscosity_exponent
    settings.use_viscosity = False
    settings.surface_tension = 0.1
    settings.use_mesh = True
    settings.mesh_scale = 2
    settings.mesh_generator = "IMPROVED"
    settings.mesh_particle_radius = 2.0
    settings.mesh_smoothen_pos = 1
    settings.mesh_smoothen_neg = 1
    settings.use_speed_vectors = False
    for kind in ("spray", "bubble", "foam", "tracer"):
        setattr(settings, "use_" + kind + "_particles", False)
    for side in ("front", "back", "left", "right", "top"):
        setattr(settings, "use_collision_border_" + side, False)
    settings.use_collision_border_bottom = True
    settings.fluid_group = flows
    settings.effector_group = effectors
    for polygon in domain.data.polygons:
        polygon.use_smooth = True
    initial = float(reservoir_plan.get("provenance", {}).get("initial_volume_ml", 5.0))
    metadata = {
        "solver": "Mantaflow APIC", "source_mechanism": "hybrid_reservoir_driven_INFLOW",
        "full_moving_cup_CFD": False, "external_jet_and_plate_CFD": True,
        "initial_volume_ml": initial, "initial_volume_m3": initial * 1e-6,
        "initial_volume_is_reservoir_reference_only": True,
        "actual_emitted_volume_calibrated": False, "exact_CFD_mass_conservation_claimed": False,
        "kinematic_viscosity_m2_s": nu, "high_viscosity_solver": False,
        "gravity_m_s2": [0, 0, -9.81], "surface_tension_grid_units": 0.1,
        "domain_min_m": DOMAIN_MIN_M, "domain_max_m": DOMAIN_MAX_M,
        "resolution": int(resolution), "voxel_size_m": voxel,
        "approximate_grid": [math.ceil(length / voxel) for length in dimensions],
        "frame_start": 1, "frame_end": int(frame_end), "fps": fps,
        "temporal_settings": {"timesteps_min": 8, "timesteps_max": 32, "cfl": 1.0},
        "cache_directory": str(cache), "cache_type": "MODULAR", "cache_resumable": False,
        "nozzle_schedule": schedule,
        "target_emitted_volume_ml": sum(item["target_interval_volume_ml"] for item in schedule),
        "bounded_calibration": {
            "case": "K36", "viscosity_m2_s": 1e-3,
            "dominant_component_fraction_frame24": 0.9889746059,
            "dominant_component_fraction_frame36": 0.9605096445,
            "phi_volume_frame24_ml": 5.3926563392, "phi_volume_frame36_ml": 5.3106223356,
            "mass_conservation_validated": False, "raised_3_to_5_mm_pool_validated": False,
            "limitations": "Fixed nozzle coupon reached open domain edges; stationary coupon cannot establish moving-source trajectory or exact source rate.",
        },
        "notes": [
            "Analytic hydrostatic reservoir and prescribed discharge are separate approximations from the external CFD.",
            "Source ellipsoid dimensions and forward/up offsets resolve a millimetre-scale outlet; they are recorded per frame.",
            "Minimum source depth can exceed low-Q interval volume. Actual injected volume must be calibrated from cached fields/geometry.",
            "The J coupon established connected pooling but showed reconstructed volume growth after emission stopped.",
            "The richer-viscosity K36 coupon retained a dominant connected pool; open-edge contact prevents a mass-conservation or settled-shape claim.",
            "One-frame-early inflow keys compensate for an observed baked-field toggle lag; verify actual phi_inflow frames in this bake.",
            "No authored sauce trail, per-frame mesh replacement, or full moving-cup CFD is used by this module.",
        ],
    }
    domain["plating_physics"] = json.dumps(metadata, sort_keys=True)
    domain["source_mechanism"] = metadata["source_mechanism"]
    domain["initial_volume_ml"] = initial
    source["source_mechanism"] = metadata["source_mechanism"]
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return {"domain": domain, "domain_modifier": domain_modifier, "domain_settings": settings,
            "source": source, "source_modifier": modifier, "source_settings": flow,
            "porcelain": ground, "porcelain_effector_modifier": ground_modifier,
            "physics_collection": physics, "flow_collection": flows, "effector_collection": effectors,
            "metadata": metadata, "notes": metadata["notes"]}
