"""Mass-balanced hydrostatic spoon reservoir for an explicitly hybrid render.

This is an analytic, quasi-static liquid approximation, NOT a moving-cup CFD
simulation. The actual spoon's inner profile supplies the bottom geometry.
Gravity defines a horizontal free surface; a Newtonian viscous-film law,
capped by an inertial weir law, supplies outflow to a separate external solver.
No scene loading, simulation baking, render, handlers or file output occurs.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import Counter
import math
from typing import Any

import bpy
import numpy as np
from mathutils import Euler, Vector


_G = 9.81
_DEFAULT_RINGS = 48
_DEFAULT_SECTORS = 128
_DEFAULT_CLEARANCE_M = 0.00005


class _FloorDomain:
    """Shared piecewise-linear floor for quadrature and visible mesh creation."""

    def __init__(self, spoon_data: dict[str, Any], spec: dict[str, Any] | None = None):
        spec = spec or {}
        self.rings = int(spec.get("radial_rings", _DEFAULT_RINGS))
        self.sectors = int(spec.get("angular_sectors", _DEFAULT_SECTORS))
        self.clearance = float(spec.get("bottom_clearance_m", _DEFAULT_CLEARANCE_M))
        if self.rings < 4 or self.sectors < 16 or self.clearance < 0:
            raise ValueError("Reservoir grid must have at least 4 rings/16 sectors and nonnegative clearance")
        floor_fn = spoon_data.get("inner_floor_fn")
        if not callable(floor_fn):
            raise ValueError("spoon_data requires its actual inner_floor_fn(x_m, y_m)")
        radii = spoon_data.get("bowl_radii_m", spoon_data.get("bowl_radii"))
        if not radii:
            raise ValueError("spoon_data requires its metre-space bowl_radii_m")
        centre = spoon_data.get("fill_center", (0, 0, 0))
        cx, cy = float(centre[0]), float(centre[1])
        rx, ry = float(radii[0]), float(radii[1])
        centre_z = floor_fn(cx, cy)
        if centre_z is None:
            raise ValueError("Reservoir centre is outside the spoon's open bowl")
        limits = []
        for sector in range(self.sectors):
            angle = sector * math.tau / self.sectors
            dx, dy = rx * math.cos(angle), ry * math.sin(angle)
            low, high = 0.0, 2.0
            while floor_fn(cx + dx * high, cy + dy * high) is not None and high < 8:
                high *= 2
            for _ in range(28):
                mid = (low + high) * 0.5
                if floor_fn(cx + dx * mid, cy + dy * mid) is None:
                    high = mid
                else:
                    low = mid
            limits.append(low * (1.0 - 1e-8))
        vertices = [(cx, cy, float(centre_z) + self.clearance)]
        for ring in range(1, self.rings + 1):
            radius = ring / self.rings
            for sector in range(self.sectors):
                angle = sector * math.tau / self.sectors
                x = cx + rx * math.cos(angle) * limits[sector] * radius
                y = cy + ry * math.sin(angle) * limits[sector] * radius
                z = floor_fn(x, y)
                if z is None:
                    raise RuntimeError("Reservoir floor grid escaped the actual bowl")
                vertices.append((x, y, float(z) + self.clearance))
        triangles = []
        for sector in range(self.sectors):
            triangles.append((0, 1 + sector, 1 + (sector + 1) % self.sectors))
        for ring in range(1, self.rings):
            inner = 1 + (ring - 1) * self.sectors
            outer = 1 + ring * self.sectors
            for sector in range(self.sectors):
                nxt = (sector + 1) % self.sectors
                triangles.extend(((inner + sector, outer + sector, outer + nxt),
                                  (inner + sector, outer + nxt, inner + nxt)))
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.triangles = np.asarray(triangles, dtype=np.int32)
        tri = self.vertices[self.triangles]
        edges_a, edges_b = tri[:, 1, :2] - tri[:, 0, :2], tri[:, 2, :2] - tri[:, 0, :2]
        self.areas = np.abs(edges_a[:, 0] * edges_b[:, 1] - edges_a[:, 1] * edges_b[:, 0]) * 0.5
        self.total_area = float(np.sum(self.areas))
        self.rim_indices = np.arange(1 + (self.rings - 1) * self.sectors, len(vertices))
        self.spec = {"radial_rings": self.rings, "angular_sectors": self.sectors,
                     "bottom_clearance_m": self.clearance}

    def volume_and_area(self, level: float, world_floor: np.ndarray, rzz: float) -> tuple[float, float]:
        """Exact positive-depth integral over this triangulated floor.

        A partially wet triangle is integrated as a clipped triangle or quad;
        this avoids the mass changes of a centre-sampled wet/dry cell mask.
        """
        depth = (level - world_floor[self.triangles]) / rzz
        low, high = np.min(depth, axis=1), np.max(depth, axis=1)
        full = low >= 0
        volume = float(np.sum(self.areas[full] * np.sum(depth[full], axis=1) / 3))
        wet_area = float(np.sum(self.areas[full]))
        mixed = (low < 0) & (high > 0)
        if np.any(mixed):
            d = np.sort(depth[mixed], axis=1)
            area = self.areas[mixed]
            single = d[:, 1] <= 0
            if np.any(single):
                c, b, a = d[single].T
                denominator = (a - b) * (a - c)
                volume += float(np.sum(area[single] * a ** 3 / (3 * denominator)))
                wet_area += float(np.sum(area[single] * a ** 2 / denominator))
            if np.any(~single):
                c, a, b = d[~single].T
                denominator = (c - a) * (c - b)
                volume += float(np.sum(area[~single] * ((a + b + c) / 3 - c ** 3 / (3 * denominator))))
                wet_area += float(np.sum(area[~single] * (1 - c ** 2 / denominator)))
        return max(0.0, volume), max(0.0, wet_area)

    def solve_level(self, volume: float, rotation: np.ndarray, location: np.ndarray) -> tuple[float, float, np.ndarray]:
        rzz = float(rotation[2, 2])
        if rzz <= 0.15:
            raise ValueError("Quasi-static reservoir does not support an inverted or near-vertical bowl")
        # Explicit components avoid small-matrix BLAS dispatch (and spurious
        # floating-point status warnings in Blender's macOS NumPy build).
        world_floor = (self.vertices[:, 0] * rotation[2, 0]
                       + self.vertices[:, 1] * rotation[2, 1]
                       + self.vertices[:, 2] * rotation[2, 2] + location[2])
        lower = float(np.min(world_floor))
        if volume <= 1e-15:
            return lower, 0.0, world_floor
        upper = float(np.max(world_floor)) + volume * rzz / self.total_area
        level = lower + (upper - lower) * 0.5
        tolerance = max(1e-15, volume * 1e-8)
        actual = 0.0
        for _ in range(32):
            actual, wet_area = self.volume_and_area(level, world_floor, rzz)
            error = actual - volume
            if abs(error) <= tolerance:
                break
            if error > 0:
                upper = level
            else:
                lower = level
            candidate = level - error * rzz / wet_area if wet_area > 1e-15 else math.inf
            level = candidate if lower < candidate < upper else (lower + upper) * 0.5
        if abs(actual - volume) > max(1e-12, volume * 1e-5):
            raise RuntimeError("Hydrostatic free-surface volume solve did not converge")
        return level, actual, world_floor


def _pose(location, rotation_euler) -> tuple[np.ndarray, np.ndarray]:
    return (np.asarray(location, dtype=np.float64),
            np.asarray(Euler(tuple(rotation_euler), "XYZ").to_matrix(), dtype=np.float64))


def _interpolate(a: dict, b: dict, fraction: float) -> tuple[list[float], list[float]]:
    location = [(1 - fraction) * float(a["location"][i]) + fraction * float(b["location"][i]) for i in range(3)]
    qa = Euler(tuple(a["rotation_euler"]), "XYZ").to_quaternion()
    qb = Euler(tuple(b["rotation_euler"]), "XYZ").to_quaternion()
    rotation = list(qa.slerp(qb, fraction).to_euler("XYZ"))
    return location, rotation


def plan_reservoir(
    spoon_data: dict[str, Any],
    poses: list[dict[str, Any]],
    fps: float = 24,
    initial_volume_ml: float = 5.0,
    nu_m2_s: float = 0.0002,
    spout_width_m: float = 0.012,
    *,
    substeps: int = 4,
    discharge_coefficient: float = 0.62,
    grid_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Plan remaining volume and a mass-balanced discharge at every frame.

    Each pose has frame, location and XYZ rotation_euler (radians), all in
    world metres. Sparse poses use linear translation / quaternion slerp;
    pass every authored frame to retain its exact kinematics. ``flow_ml_s``
    is the mean over the preceding frame interval, suitable for a finite
    external emission ledger; ``instantaneous_flow_ml_s`` is the endpoint Q.
    """
    if not poses or fps <= 0 or initial_volume_ml < 0 or nu_m2_s <= 0 or spout_width_m <= 0:
        raise ValueError("Need poses, positive fps/viscosity/spout width and nonnegative initial volume")
    if substeps < 1 or not 0 < discharge_coefficient <= 1:
        raise ValueError("Need at least one substep and a discharge coefficient in (0,1]")
    supplied = sorted(poses, key=lambda pose: int(pose["frame"]))
    frames = [int(pose["frame"]) for pose in supplied]
    if len(set(frames)) != len(frames):
        raise ValueError("Pose frames must be unique")
    domain = _FloorDomain(spoon_data, grid_spec)
    spout = np.asarray(spoon_data["spout_local"], dtype=np.float64)
    volume = float(initial_volume_ml) * 1e-6
    initial = volume
    states = []
    emitted_total = 0.0
    maximum_balance_error = 0.0

    def sample_pose(frame: float) -> tuple[list[float], list[float]]:
        index = max(0, min(len(frames) - 2, bisect_right(frames, frame) - 1))
        if len(frames) == 1 or frame <= frames[0]:
            return list(supplied[0]["location"]), list(supplied[0]["rotation_euler"])
        if frame >= frames[-1]:
            return list(supplied[-1]["location"]), list(supplied[-1]["rotation_euler"])
        return _interpolate(supplied[index], supplied[index + 1],
                            (frame - frames[index]) / (frames[index + 1] - frames[index]))

    def hydraulic(current_volume: float, location, euler) -> dict:
        loc, rotation = _pose(location, euler)
        level, actual, floor = domain.solve_level(current_volume, rotation, loc)
        nozzle = loc + np.sum(rotation * spout[np.newaxis, :], axis=1)
        head = max(0.0, level - float(nozzle[2])) if current_volume > 1e-15 else 0.0
        downhill = max(0.0, -float(rotation[2, 1]))
        laminar = spout_width_m * _G * downhill * head ** 3 / (3 * nu_m2_s)
        weir = discharge_coefficient * spout_width_m * head * math.sqrt(2 * _G * head)
        q = min(laminar, weir)
        return {"level": level, "quadrature_volume": actual, "head": head,
                "downhill": downhill, "laminar": laminar, "weir": weir, "q": q,
                "nozzle": nozzle, "direction": rotation[:, 1],
                "lowest_rim": float(np.min(floor[domain.rim_indices]))}

    for frame in range(frames[0], frames[-1] + 1):
        interval_emitted = 0.0
        interval_head_integral = 0.0
        if frame > frames[0]:
            dt = 1.0 / (fps * substeps)
            for step in range(substeps):
                midpoint = frame - 1 + (step + 0.5) / substeps
                location, euler = sample_pose(midpoint)
                start = hydraulic(volume, location, euler)
                predicted = max(0.0, volume - start["q"] * dt)
                end = hydraulic(predicted, location, euler)
                # Heun integration of the finite reservoir, with midpoint pose.
                loss = min(volume, (start["q"] + end["q"]) * 0.5 * dt)
                volume -= loss
                interval_emitted += loss
                interval_head_integral += (start["head"] + end["head"]) * 0.5 * dt
        emitted_total += interval_emitted
        location, euler = sample_pose(frame)
        state = hydraulic(volume, location, euler)
        mean_q = interval_emitted * fps
        mean_head = interval_head_integral * fps
        sheet_depth = max(state["head"], mean_head) if mean_q > 0 else 0.0
        speed = mean_q / (spout_width_m * sheet_depth) if sheet_depth > 0 else 0.0
        balance = abs(initial - volume - emitted_total)
        maximum_balance_error = max(maximum_balance_error, balance)
        states.append({
            "frame": frame, "time_s": (frame - frames[0]) / fps,
            "location": [float(value) for value in location],
            "rotation_euler": [float(value) for value in euler],
            "volume_ml": volume * 1e6, "emitted_total_ml": emitted_total * 1e6,
            "emitted_since_previous_frame_ml": interval_emitted * 1e6,
            "flow_ml_s": mean_q * 1e6,
            "instantaneous_flow_ml_s": state["q"] * 1e6,
            "laminar_candidate_ml_s": state["laminar"] * 1e6,
            "weir_cap_ml_s": state["weir"] * 1e6,
            "head_m": state["head"], "mean_head_previous_interval_m": mean_head,
            "level_world_z": state["level"],
            "nozzle_world": state["nozzle"].tolist(),
            "nozzle_direction_world": state["direction"].tolist(),
            "nozzle_velocity_world_m_s": (state["direction"] * speed).tolist(),
            "nozzle_sheet_depth_m": sheet_depth,
            "downhill_sine": state["downhill"],
            "lowest_bowl_rim_world_z": state["lowest_rim"],
            "quadrature_volume_ml": state["quadrature_volume"] * 1e6,
            "mass_balance_error_ml": balance * 1e6,
            "grid_spec": domain.spec,
        })
    return {
        "states": states,
        "provenance": {
            "method": "Hybrid analytic hydrostatic reservoir + viscous-film/weir discharge",
            "full_moving_cup_CFD": False,
            "free_surface": "World-horizontal plane solved against the actual triangulated inner spoon profile",
            "initial_volume_ml": initial_volume_ml,
            "remaining_volume_ml": volume * 1e6,
            "emitted_volume_ml": emitted_total * 1e6,
            "maximum_mass_balance_error_ml": maximum_balance_error * 1e6,
            "volume_quadrature": "Exact positive-depth integral over the shared piecewise-linear floor triangles",
            "floor_vertices": len(domain.vertices), "floor_triangles": len(domain.triangles),
            "grid_spec": domain.spec, "fps": fps, "integration_substeps_per_frame": substeps,
            "kinematic_viscosity_m2_s": nu_m2_s, "effective_spout_width_m": spout_width_m,
            "discharge_coefficient": discharge_coefficient,
            "laminar_law": "Q = b*g*max(0,-Rzy)*max(0,H-z_lip)^3/(3*nu)",
            "inertial_cap": "Q <= Cd*b*h*sqrt(2*g*h)",
            "integration": "Heun volume update at midpoint rigid pose; volume loss is recorded exactly",
            "flow_sampling": "flow_ml_s is the mean discharge during the preceding frame interval; first frame emits zero",
            "pose_sampling": "Linear translation and quaternion slerp between supplied pose samples",
            "assumptions": [
                "Quasi-static hydrostatic reservoir; inertial sloshing and air entrainment are omitted.",
                "Newtonian viscosity and effective outlet width are explicit approximations, not measured sauce rheology.",
                "Outflow uses one prescribed pouring lip; lateral overflow and contact-line hysteresis are not simulated.",
                "The visible free surface is planar; no capillary meniscus shape or surface-tension pressure is claimed.",
                "External jet and plate behavior require their own physical solver and independent mass/trajectory validation.",
            ],
        },
    }


def _visible_geometry(domain: _FloorDomain, state: dict[str, Any]) -> tuple[list[tuple], list[tuple], list[bool]]:
    location, rotation = _pose(state["location"], state["rotation_euler"])
    rzz = float(rotation[2, 2])
    if rzz <= 0.15:
        raise ValueError("Unsupported reservoir bowl orientation")
    floor = domain.vertices
    top_z = (float(state["level_world_z"]) - location[2] - rotation[2, 0] * floor[:, 0]
             - rotation[2, 1] * floor[:, 1]) / rzz
    depth = top_z - floor[:, 2]
    vertices: list[tuple] = []
    faces: list[tuple] = []
    smooth: list[bool] = []
    lookup = {}
    point_pairs = {}
    polygon_edges = Counter()
    oriented_edges = {}

    def pair(key, position: np.ndarray, height: float) -> tuple[int, int]:
        if key in lookup:
            return lookup[key]
        bottom_id = len(vertices)
        vertices.append(tuple(float(value) for value in position))
        if height <= 1e-10:
            top_id = bottom_id
        else:
            top_id = len(vertices)
            vertices.append((float(position[0]), float(position[1]), float(position[2] + height)))
        lookup[key] = (bottom_id, top_id)
        point_pairs[key] = (bottom_id, top_id)
        return bottom_id, top_id

    def add_face(indices, shaded: bool):
        unique = []
        for index in indices:
            if not unique or index != unique[-1]:
                unique.append(index)
        if len(unique) > 1 and unique[0] == unique[-1]:
            unique.pop()
        if len(set(unique)) >= 3:
            faces.append(tuple(unique))
            smooth.append(shaded)

    for triangle in domain.triangles:
        if np.max(depth[triangle]) <= 1e-10:
            continue
        polygon = []
        for i in range(3):
            a, b = int(triangle[i]), int(triangle[(i + 1) % 3])
            da, db = float(depth[a]), float(depth[b])
            if da > 0:
                key = ("v", a)
                pair(key, floor[a], da)
                polygon.append(key)
            if (da > 0) != (db > 0):
                fraction = da / (da - db)
                key = ("e", min(a, b), max(a, b))
                pair(key, floor[a] + (floor[b] - floor[a]) * fraction, 0.0)
                polygon.append(key)
        if len(polygon) < 3:
            continue
        add_face([point_pairs[key][1] for key in polygon], False)
        add_face([point_pairs[key][0] for key in reversed(polygon)], True)
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            edge = tuple(sorted((a, b)))
            polygon_edges[edge] += 1
            oriented_edges[edge] = (a, b)
    for edge, count in polygon_edges.items():
        if count == 1:
            a, b = oriented_edges[edge]
            ba, ta = point_pairs[a]
            bb, tb = point_pairs[b]
            add_face((ba, bb, tb, ta), True)
    return vertices, faces, smooth


def _closed_volume(vertices: list[tuple], faces: list[tuple]) -> float:
    triangles = [(face[0], face[i], face[i + 1]) for face in faces for i in range(1, len(face) - 1)]
    if not triangles:
        return 0.0
    points = np.asarray(vertices, dtype=np.float64)[np.asarray(triangles, dtype=np.int32)]
    return abs(float(np.sum(np.einsum("ij,ij->i", points[:, 0], np.cross(points[:, 1], points[:, 2]))) / 6))


class ReservoirMesh:
    """One reusable visible object; call apply_state after setting root pose.

    No frame handler is installed. The parent controls render evaluation and
    must use the same root pose as the state's location/rotation_euler.
    """

    def __init__(self, spoon_data: dict[str, Any], material: bpy.types.Material, states: list[dict[str, Any]]):
        if not states:
            raise ValueError("Need at least one reservoir state")
        self.states = {int(state["frame"]): state for state in states}
        self.domain = _FloorDomain(spoon_data, states[0].get("grid_spec"))
        mesh = bpy.data.meshes.new("HydrostaticSauceReservoirMesh")
        self.object = bpy.data.objects.new("HydrostaticSauceReservoir", mesh)
        (bpy.context.collection or bpy.context.scene.collection).objects.link(self.object)
        self.object.parent = spoon_data["root"]
        mesh.materials.append(material)
        self.object["physical_method"] = "Analytic hydrostatic reservoir; not moving-cup CFD"
        self.last_diagnostics: dict[str, Any] = {}
        self.apply_state(states[0])

    def apply_state(self, state_or_frame: dict[str, Any] | int) -> dict[str, Any]:
        state = self.states[int(state_or_frame)] if isinstance(state_or_frame, int) else state_or_frame
        target = float(state["volume_ml"]) * 1e-6
        mesh = self.object.data
        if target <= 1e-12:
            mesh.clear_geometry()
            self.object.hide_render = self.object.hide_viewport = True
            self.last_diagnostics = {"frame": state["frame"], "target_volume_ml": target * 1e6,
                                     "mesh_volume_ml": 0.0, "relative_volume_error": 0.0}
            return self.last_diagnostics
        vertices, faces, smooth = _visible_geometry(self.domain, state)
        actual = _closed_volume(vertices, faces)
        error = abs(actual - target) / target
        if error > 0.003 and abs(actual - target) > 1e-10:
            raise RuntimeError(f"Visible reservoir mass mismatch: {actual * 1e6:.6g} versus {target * 1e6:.6g} ml")
        mesh.clear_geometry()
        mesh.from_pydata(vertices, [], faces)
        mesh.update(calc_edges=True)
        for polygon, use_smooth in zip(mesh.polygons, smooth):
            polygon.use_smooth = use_smooth
        self.object.hide_render = self.object.hide_viewport = False
        self.object["reservoir_frame"] = int(state["frame"])
        self.object["remaining_volume_ml"] = float(state["volume_ml"])
        self.last_diagnostics = {"frame": state["frame"], "target_volume_ml": target * 1e6,
                                 "mesh_volume_ml": actual * 1e6, "relative_volume_error": error,
                                 "vertices": len(vertices), "faces": len(faces)}
        return self.last_diagnostics


def create_reservoir_mesh(
    spoon_data: dict[str, Any],
    material: bpy.types.Material,
    states: list[dict[str, Any]],
) -> ReservoirMesh:
    """Return a controller with .object and .apply_state(frame_or_state)."""
    return ReservoirMesh(spoon_data, material, states)
