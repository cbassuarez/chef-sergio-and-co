"""Recessed dry-handle engraving for the procedural silver spoon.

The reference is the official Christofle Rubans spoon photograph retained at
``output/plating-timeline/blender-assets/christofle-rubans-reference.png``.
Its paired filets and restrained terminal ribbon inform this original motif;
no brand marks, lettering, logos, or copied ornamental surface are applied.

``create_engraving(spoon_data, material)`` freezes the visual's existing render
subdivision, adds local top-handle sampling, and physically lowers that metal
surface along smooth incised grooves. It does not add relief, a decal, or an
engraving-coloured material. The liquid collider and wet bowl are not edited.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from typing import Any

import bmesh
import bpy

from plating_spoon import _cross_profile, _section


_CELL = 0.0006
_REFERENCE = "output/plating-timeline/blender-assets/christofle-rubans-reference.png"


def _surface_z(x: float, y: float, scale: float) -> float:
    width, centre, depth = _section(y / scale)
    u = max(-1.0, min(1.0, x / (width * scale)))
    q, _ = _cross_profile(u)
    return (centre + depth * q) * scale


def _bezier(points, count=48):
    result = []
    for i in range(count + 1):
        t = i / count
        a = 1.0 - t
        result.append(tuple(
            a * a * a * points[0][axis] + 3 * a * a * t * points[1][axis]
            + 3 * a * t * t * points[2][axis] + t * t * t * points[3][axis]
            for axis in range(2)
        ))
    return result


def _motif(scale: float):
    ratio = scale / 0.07
    lines = []
    # Paired borders follow the actual forged plan width, then return around
    # the teardrop terminal and neck with small continuous rounded caps.
    near, far = -0.0475 * ratio, -0.1764 * ratio
    for fraction, width, depth, cap in (
        (0.83, 0.00030, 0.00012, 0.0024),
        (0.62, 0.00023, 0.000095, 0.00175),
    ):
        samples = []
        n = 460
        for i in range(n + 1):
            y = near + (far - near) * i / n
            samples.append((-fraction * _section(y / scale)[0] * scale, y))
        end_half_width = fraction * _section(far / scale)[0] * scale
        for i in range(1, 193):
            a = math.pi * i / 192
            samples.append((-end_half_width * math.cos(a), far - cap * ratio * math.sin(a)))
        for i in range(1, n + 1):
            y = far + (near - far) * i / n
            samples.append((fraction * _section(y / scale)[0] * scale, y))
        start_half_width = fraction * _section(near / scale)[0] * scale
        for i in range(1, 193):
            a = math.pi * i / 192
            samples.append((start_half_width * math.cos(a), near + cap * ratio * 0.55 * math.sin(a)))
        samples.append(samples[0])
        lines.append((samples, width, depth))

    # A small engraved bow, not an attached metal ornament. The two loops and
    # two flowing tails sit within the inner filet near the broad dry terminal.
    cy = -0.1659 * ratio
    bow = []
    for i in range(577):
        a = math.pi * 2 * i / 576
        bow.append((0.00335 * ratio * math.sin(a), cy + 0.00175 * ratio * math.sin(2 * a)))
    lines.append((bow, 0.00026, 0.00011))
    knot = []
    for i in range(193):
        a = math.pi * 2 * i / 192
        knot.append((0.00046 * ratio * math.cos(a), cy + 0.00065 * ratio * math.sin(a)))
    lines.append((knot, 0.00022, 0.000105))
    for side in (-1, 1):
        tail = _bezier((
            (side * 0.0003 * ratio, cy + 0.00035 * ratio),
            (side * 0.00195 * ratio, cy + 0.00245 * ratio),
            (side * 0.0028 * ratio, cy + 0.0047 * ratio),
            (side * 0.00165 * ratio, cy + 0.00625 * ratio),
        ), 192)
        lines.append((tail, 0.00024, 0.00010))
    return lines


def _segment_grid(lines, padding=0.0):
    grid = defaultdict(list)
    count = 0
    for points, width, depth in lines:
        radius = width * 0.5
        for a, b in zip(points, points[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length_squared = dx * dx + dy * dy
            if length_squared < 1.0e-18:
                continue
            segment = (a[0], a[1], dx, dy, length_squared, radius, depth)
            reach = radius + padding
            low_x = math.floor((min(a[0], b[0]) - reach) / _CELL)
            high_x = math.floor((max(a[0], b[0]) + reach) / _CELL)
            low_y = math.floor((min(a[1], b[1]) - reach) / _CELL)
            high_y = math.floor((max(a[1], b[1]) + reach) / _CELL)
            for ix in range(low_x, high_x + 1):
                for iy in range(low_y, high_y + 1):
                    grid[(ix, iy)].append(segment)
            count += 1
    return grid, count


def _near_groove(x: float, y: float, padding: float, grid) -> bool:
    """The actual curve footprint, expanded by a small physical band."""
    for ax, ay, dx, dy, length_squared, radius, _ in grid.get((math.floor(x / _CELL), math.floor(y / _CELL)), ()):
        q = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_squared))
        sx, sy = x - ax - q * dx, y - ay - q * dy
        if sx * sx + sy * sy < (radius + padding) ** 2:
            return True
    return False


def _refine_groove_bands(bm, lines, scale, dry_limit):
    """Add sampling only where a recess will be cut, including crossed faces.

    The original cross-handle sampling is already fine. Most selected edges
    therefore split along Y only, rather than multiplying the entire surface
    in both directions. Terminal caps and ribbon turns get the tighter limit.
    """
    support, _ = _segment_grid(lines, padding=0.0008)
    split_counts = []
    ratio = scale / 0.07
    for pass_index, cuts in enumerate((2, 2, 1)):
        edges = []
        for edge in bm.edges:
            length = edge.calc_length()
            if length <= 0.000035:
                continue
            a, b = edge.verts
            if a.co.y >= dry_limit or b.co.y >= dry_limit:
                continue
            x = (a.co.x + b.co.x) * 0.5
            y = (a.co.y + b.co.y) * 0.5
            z = (a.co.z + b.co.z) * 0.5
            terminal = y < -0.153 * ratio or y > -0.052 * ratio
            target = 0.000035 if terminal else 0.00005
            if length <= target:
                continue
            if max(a.normal.z, b.normal.z) < 0.45 or abs(z - _surface_z(x, y, scale)) > 0.00018:
                continue
            # Expanding by half the edge length catches a groove crossing the
            # face between existing rows, even when no old vertex is in it.
            band = (0.00022 if pass_index == 0 else 0.00012) + min(length * 0.5, 0.0003)
            if _near_groove(x, y, band, support):
                edges.append(edge)
        split_counts.append(len(edges))
        if not edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)
        bm.normal_update()
    maximum = 0.0
    for edge in bm.edges:
        a, b = edge.verts
        if a.co.y >= dry_limit or b.co.y >= dry_limit:
            continue
        x, y, z = (a.co + b.co) * 0.5
        if max(a.normal.z, b.normal.z) < 0.45 or abs(z - _surface_z(x, y, scale)) > 0.00018:
            continue
        if _near_groove(x, y, 0.000035, support):
            maximum = max(maximum, edge.calc_length())
    return {"selected_edges_per_pass": split_counts, "maximum_edge_near_groove_m": maximum}


def _cut_depth(x: float, y: float, grid) -> float:
    deepest = 0.0
    for ax, ay, dx, dy, length_squared, radius, depth in grid.get((math.floor(x / _CELL), math.floor(y / _CELL)), ()):
        q = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_squared))
        sx, sy = x - ax - q * dx, y - ay - q * dy
        distance_squared = sx * sx + sy * sy
        if distance_squared < radius * radius:
            distance = math.sqrt(distance_squared)
            cut = depth * (0.5 + 0.5 * math.cos(math.pi * distance / radius))
            deepest = max(deepest, cut)
    return deepest


def _evaluated_render_mesh(visual):
    original_levels = []
    try:
        for modifier in visual.modifiers:
            if modifier.type == "SUBSURF":
                original_levels.append((modifier, modifier.levels))
                modifier.levels = modifier.render_levels
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = visual.evaluated_get(graph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=graph)
        mesh.name = "SilverSpoonPhysicallyEngravedMesh"
        return mesh
    finally:
        for modifier, levels in original_levels:
            modifier.levels = levels
        bpy.context.view_layer.update()


def create_engraving(spoon_data: dict[str, Any], material: bpy.types.Material) -> dict[str, Any]:
    """Physically incise double filets and an original ribbon terminal.

    The animation parent is retained, and no extra ornament object is created.
    The returned dictionary is suitable for the scene's provenance JSON.
    """
    visual = spoon_data["visual"]
    root = spoon_data["root"]
    collider = spoon_data["collider"]
    scale = float(spoon_data.get("scale", 0.07))
    if scale <= 0:
        raise ValueError("Spoon scale must be positive")
    if visual.get("plating_engraving"):
        previous = json.loads(visual["plating_engraving"])
        if previous.get("sampling_revision") == "adaptive-groove-v2":
            return previous
        raise ValueError("Recreate the original spoon before upgrading engraving sampling; existing cuts must not be deepened twice")
    if visual.parent != root:
        raise ValueError("The visual spoon must remain parented to its animation root")
    collider_mesh = collider.data
    collider_vertices = len(collider_mesh.vertices)
    mesh = _evaluated_render_mesh(visual)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()
        before_volume = bm.calc_volume(signed=True)
        dry_limit = -0.04 * scale / 0.07
        # One extra sample level only on the dry upper handle resolves each
        # 0.22-0.30mm groove. The bowl retains its evaluated render geometry.
        edges = set()
        for face in bm.faces:
            if face.normal.z < 0.45:
                continue
            centre = face.calc_center_median()
            if centre.y >= dry_limit or abs(centre.z - _surface_z(centre.x, centre.y, scale)) > 0.00018:
                continue
            edges.update(face.edges)
        if edges:
            bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=1, use_grid_fill=True)
            bm.normal_update()
        lines = _motif(scale)
        refinement = _refine_groove_bands(bm, lines, scale, dry_limit)
        grid, segment_count = _segment_grid(lines)
        affected = 0
        maximum_depth = 0.0
        for vertex in bm.verts:
            point = vertex.co
            if point.y >= dry_limit or vertex.normal.z < 0.45:
                continue
            if abs(point.z - _surface_z(point.x, point.y, scale)) > 0.00018:
                continue
            depth = _cut_depth(point.x, point.y, grid)
            if depth > 1.0e-8:
                point.z -= depth
                affected += 1
                maximum_depth = max(maximum_depth, depth)
        bm.normal_update()
        non_manifold = sum(not edge.is_manifold for edge in bm.edges)
        after_volume = bm.calc_volume(signed=True)
        if affected < 100 or maximum_depth < 0.00007:
            raise RuntimeError("The engraving was not adequately sampled into the metal surface")
        if non_manifold:
            raise RuntimeError(f"Engraving would create {non_manifold} non-manifold edges")
        if before_volume <= 0 or after_volume <= 0 or after_volume >= before_volume:
            raise RuntimeError("The engraving must remove a positive amount of silver")
        bm.to_mesh(mesh)
        mesh.update(calc_edges=True)
    except Exception:
        bpy.data.meshes.remove(mesh)
        raise
    finally:
        bm.free()

    # Commit only a validated closed incised surface. The existing render-level
    # subdivision is already represented by these vertices; another pass would
    # soften away the real shallow recesses and change the undisturbed bowl.
    previous_mesh = visual.data
    visual.modifiers.clear()
    visual.data = mesh
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if material.name not in mesh.materials:
        mesh.materials.append(material)
    if previous_mesh.users == 0:
        bpy.data.meshes.remove(previous_mesh)
    assert collider.data == collider_mesh and len(collider.data.vertices) == collider_vertices
    assert visual.parent == root
    provenance = {
        "sampling_revision": "adaptive-groove-v2",
        "method": "physically recessed dry-handle mesh incision; no applied relief or engraving texture",
        "reference_local": _REFERENCE,
        "reference_observation": "paired filet borders and terminal ribbon on the official Christofle Rubans spoon photograph",
        "motif": "original double inset filets and a small engraved ribbon bow with two tails",
        "brand_or_logo_geometry": False,
        "groove_width_m": [0.00022, 0.00030],
        "maximum_measured_depth_m": maximum_depth,
        "affected_vertices": affected,
        "curve_segments": segment_count,
        "adaptive_sampling": refinement,
        "visual_vertices": len(mesh.vertices),
        "non_manifold_edges": non_manifold,
        "silver_volume_before_m3": before_volume,
        "silver_volume_after_m3": after_volume,
        "removed_silver_m3": before_volume - after_volume,
        "wet_bowl_edited": False,
        "liquid_collider_edited": False,
        "animation_parent_retained": True,
    }
    visual["plating_engraving"] = json.dumps(provenance, sort_keys=True)
    return provenance


if __name__ == "__main__":
    from plating_materials import create_materials
    from plating_spoon import create_spoon

    silver, _, _ = create_materials()
    spoon = create_spoon(silver, scale=0.07)
    result = create_engraving(spoon, silver)
    print("PLATING_ENGRAVING_VALIDATED", json.dumps(result, sort_keys=True), flush=True)
