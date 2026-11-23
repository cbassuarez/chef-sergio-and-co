"""A continuous forged-silver spoon and a closed liquid collision shell.

Blender 4.5, Z up. The bowl is at the origin; its pouring end points along +Y
and its handle along -Y. ``create_spoon(material, .07)`` gives a 22 cm spoon,
with metre-space vertices and an identity-scale animation parent. The whole
spoon is one quad mesh: no intersecting parts or Boolean neck construction.
"""

from __future__ import annotations

import math
from typing import Any

import bpy
from mathutils import Vector


def _smoothstep(value: float, low: float, high: float) -> float:
    t = min(1.0, max(0.0, (value - low) / (high - low)))
    return t * t * (3.0 - 2.0 * t)


def _profile(points: tuple[tuple[float, float], ...]) -> tuple:
    """Monotone cubic Hermite profile, with common tangents between spans."""
    intervals = [points[i + 1][0] - points[i][0] for i in range(len(points) - 1)]
    secants = [(points[i + 1][1] - points[i][1]) / intervals[i] for i in range(len(intervals))]
    tangents = [0.0] * len(points)
    for i in range(1, len(points) - 1):
        previous, following = secants[i - 1], secants[i]
        if previous * following > 0.0:
            a = 2.0 * intervals[i] + intervals[i - 1]
            b = intervals[i] + 2.0 * intervals[i - 1]
            tangents[i] = (a + b) / (a / previous + b / following)
    tangents[0] = ((2 * intervals[0] + intervals[1]) * secants[0] - intervals[0] * secants[1]) / (intervals[0] + intervals[1])
    tangents[-1] = ((2 * intervals[-1] + intervals[-2]) * secants[-1] - intervals[-1] * secants[-2]) / (intervals[-1] + intervals[-2])
    for index, adjacent in ((0, secants[0]), (-1, secants[-1])):
        if tangents[index] * adjacent <= 0.0:
            tangents[index] = 0.0
        elif abs(tangents[index]) > 3.0 * abs(adjacent):
            tangents[index] = 3.0 * adjacent
    return points, tuple(tangents)


def _sample(profile: tuple, coordinate: float) -> float:
    points, tangents = profile
    if coordinate <= points[0][0]:
        return points[0][1]
    if coordinate >= points[-1][0]:
        return points[-1][1]
    span = 0
    while coordinate > points[span + 1][0]:
        span += 1
    a, va = points[span]
    b, vb = points[span + 1]
    length = b - a
    t = (coordinate - a) / length
    t2, t3 = t * t, t * t * t
    return (
        (2 * t3 - 3 * t2 + 1) * va
        + (t3 - 2 * t2 + t) * length * tangents[span]
        + (-2 * t3 + 3 * t2) * vb
        + (t3 - t2) * length * tangents[span + 1]
    )


# Half-width in plan: slim stem, continuous bowl shoulders, and a gently
# asymmetric egg-shaped pouring bowl. Small end widths close as rounded tips.
_WIDTH_POINTS = (
    (-2.620, 0.0015), (-2.605, 0.048), (-2.570, 0.085), (-2.490, 0.112),
    (-2.380, 0.115), (-2.190, 0.100), (-1.880, 0.079), (-1.480, 0.060),
    (-1.080, 0.049), (-0.790, 0.046), (-0.640, 0.049), (-0.540, 0.060),
    (-0.480, 0.080), (-0.420, 0.145), (-0.340, 0.226), (-0.220, 0.296),
    (-0.070, 0.340), (0.100, 0.327), (0.250, 0.281), (0.380, 0.207),
    (0.460, 0.132), (0.505, 0.075), (0.532, 0.032), (0.544, 0.0015),
)
_HEIGHT_POINTS = (
    (-2.620, 0.199), (-2.450, 0.205), (-2.120, 0.203), (-1.700, 0.193),
    (-1.250, 0.178), (-0.930, 0.174), (-0.740, 0.177), (-0.600, 0.176),
    (-0.535, 0.169), (-0.480, 0.151), (-0.390, 0.108), (-0.250, 0.054),
    (-0.100, 0.028), (0.000, 0.025), (0.150, 0.034), (0.280, 0.063),
    (0.400, 0.103), (0.490, 0.141), (0.544, 0.152),
)
_WIDTH = _profile(_WIDTH_POINTS)
_HEIGHT = _profile(_HEIGHT_POINTS)
_Y_MIN, _Y_MAX = -2.620, 0.544
_CROSS_DENOMINATOR = 1.0 - math.sqrt(0.19)


def _section(y: float) -> tuple[float, float, float]:
    width = _sample(_WIDTH, y)
    centre = _sample(_HEIGHT, y)
    # A slight convex crown on the handle flows through the neck into the
    # concavity. It gives a travelling highlight instead of a flat blade face.
    crown = 0.0065 * min(1.0, width / 0.075)
    handle_edge = centre - crown
    bowl_edge = 0.160 + 0.003 * max(0.0, min(1.0, -y / 0.49))
    bowl_edge -= 0.008 * _smoothstep(y, 0.39, 0.544)
    blend = _smoothstep(y, -0.585, -0.435)
    edge = handle_edge + (bowl_edge - handle_edge) * blend
    # The very end of the pouring lip is a continuous thin sheet, not a notch.
    if y > 0.505:
        edge += (centre - edge) * _smoothstep(y, 0.505, 0.544)
    return width, centre, edge - centre


def _cross_profile(u: float) -> tuple[float, float]:
    """A quarter-elliptic bowl, with finite slope at its rolled silver lip."""
    root = math.sqrt(max(0.19, 1.0 - 0.81 * u * u))
    value = (1.0 - root) / _CROSS_DENOMINATOR
    derivative = 0.81 * u / (root * _CROSS_DENOMINATOR)
    return value, derivative


def inner_bowl_floor_z(x_m: float, y_m: float, scale: float = 0.07) -> float | None:
    """Exact upper surface in local metres; None outside the open bowl.

    The liquid owner can build a finite volume against this profile. A small
    simulation clearance still belongs to that owner's voxel-resolution setup.
    """
    if scale <= 0.0:
        raise ValueError("Spoon scale must be positive")
    x, y = x_m / scale, y_m / scale
    if y < -0.48 or y > _Y_MAX:
        return None
    width, centre, depth = _section(y)
    if abs(x) > width + 1e-10:
        return None
    fraction, _ = _cross_profile(max(-1.0, min(1.0, x / width)))
    return (centre + depth * fraction) * scale


def _longitudinal_samples(quality: int) -> list[float]:
    samples = set()
    for low, high, count in ((-2.62, -0.64, quality), (-0.64, -0.34, quality // 3), (-0.34, 0.544, quality)):
        for i in range(count + 1):
            samples.add(round(low + (high - low) * i / count, 10))
    samples.update(point[0] for point in _WIDTH_POINTS)
    samples.update(point[0] for point in _HEIGHT_POINTS)
    return sorted(samples)


def _quad_shell(
    scale: float,
    longitudinal_quality: int,
    cross_segments: int,
    rim_segments: int,
    *,
    collision: bool,
) -> tuple[list[tuple[float, float, float]], list[tuple[int, ...]]]:
    """Top and normal-offset underside, joined by a real semicircular rim.

    All faces, including the handle ends and the neck, are quads. A common
    longitudinal grid means the forging has no seam, collar or Boolean poles.
    """
    ys = _longitudinal_samples(longitudinal_quality)
    row_size = cross_segments + 1
    top: list[Vector] = []
    bottom: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    for y in ys:
        width, centre, depth = _section(y)
        delta = 0.00005
        before, after = _section(y - delta), _section(y + delta)
        dw = (after[0] - before[0]) / (2 * delta)
        dc = (after[1] - before[1]) / (2 * delta)
        dd = (after[2] - before[2]) / (2 * delta)
        bowl_blend = _smoothstep(y, -0.60, -0.40)
        for j in range(row_size):
            u = math.sin((j / cross_segments - 0.5) * math.pi)
            q, dq = _cross_profile(u)
            point = Vector((u * width, y, centre + depth * q))
            dzdx = depth * dq / width
            dzdy = dc + dd * q - depth * dq * u * dw / width
            normal = Vector((-dzdx, -dzdy, 1.0)).normalized()
            # At the very narrow dry terminal, an unrestricted normal offset
            # folds underneath the teardrop's tight plan curvature. Blend its
            # underside into a vertical forged section before the end cap.
            # The whole wet bowl and neck retain their exact normal offsets.
            terminal_blend = 1.0 - _smoothstep(y, -2.48, -2.36)
            normal = normal.lerp(Vector((0.0, 0.0, 1.0)), terminal_blend).normalized()
            if collision:
                thickness = 0.033
            else:
                handle_thickness = 0.009 + 0.010 * (1 - u * u)
                bowl_thickness = 0.0145 + 0.002 * (1 - u * u)
                thickness = handle_thickness + (bowl_thickness - handle_thickness) * bowl_blend
            top.append(point)
            bottom.append(point - normal * thickness)

    count = len(top)
    vertices = top + bottom
    for i in range(len(ys) - 1):
        for j in range(cross_segments):
            a = i * row_size + j
            b, c, d = a + 1, a + row_size, a + row_size + 1
            faces.append((a, b, d, c))
            faces.append((count + c, count + d, count + b, count + a))

    # One counterclockwise loop around the entire spoon, including both tips.
    boundary = list(range(row_size))
    boundary.extend(i * row_size + cross_segments for i in range(1, len(ys)))
    boundary.extend((len(ys) - 1) * row_size + j for j in range(cross_segments - 1, -1, -1))
    boundary.extend(i * row_size for i in range(len(ys) - 2, 0, -1))
    previous = boundary
    for ring in range(1, rim_segments + 1):
        if ring == rim_segments:
            current = [index + count for index in boundary]
        else:
            angle = ring / rim_segments * math.pi
            current = []
            for k, index in enumerate(boundary):
                inner, outer = top[index], bottom[index]
                centre = (inner + outer) * 0.5
                half = (inner - outer) * 0.5
                tangent = (top[boundary[(k + 1) % len(boundary)]] - top[boundary[k - 1]]).normalized()
                bulge = tangent.cross(half).normalized() * half.length
                point = centre + half * math.cos(angle) + bulge * math.sin(angle)
                current.append(len(vertices))
                vertices.append(point)
        for k in range(len(boundary)):
            nxt = (k + 1) % len(boundary)
            faces.append((previous[k], current[k], current[nxt], previous[nxt]))
        previous = current
    return [tuple(point * scale) for point in vertices], faces


def _mesh_object(
    name: str,
    geometry: tuple[list[tuple[float, float, float]], list[tuple[int, ...]]],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    vertices, faces = geometry
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def create_spoon(material: bpy.types.Material, scale: float = 0.07) -> dict[str, Any]:
    """Create a smooth continuous silver shell and its thicker liquid proxy.

    Both children are single closed connected quad meshes. All coordinates and
    profile helpers are in local metres; animate only ``root``. The collision
    mesh thickens outwards from the same upper surface, retaining the true
    concavity so fluid can sit in, flow through and drain from the bowl.
    """
    if scale <= 0.0:
        raise ValueError("Spoon scale must be positive")
    collection = bpy.context.collection or bpy.context.scene.collection
    root = bpy.data.objects.new("SilverSpoonRoot", None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.015

    visual = _mesh_object(
        "SilverSpoon",
        _quad_shell(scale, longitudinal_quality=104, cross_segments=48, rim_segments=8, collision=False),
        collection,
    )
    visual.parent = root
    visual.data.materials.append(material)
    subdivision = visual.modifiers.new("Continuous forged silver surface", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 2
    subdivision.show_only_control_edges = True

    collider = _mesh_object(
        "SilverSpoonCollision",
        _quad_shell(scale, longitudinal_quality=56, cross_segments=28, rim_segments=4, collision=True),
        collection,
    )
    collider.parent = root
    collider.hide_render = True
    collider.display_type = "WIRE"
    collider["purpose"] = "Closed quad shell; exact upper spoon surface, thickened exterior"
    collider["minimum_floor_thickness_m"] = 0.033 * scale
    root["model_scale_baked"] = scale
    root["bowl_floor_local_m"] = 0.025 * scale
    root["bowl_rim_local_m"] = 0.160 * scale
    root["geometry_revision"] = "continuous-quad-forging-v2"

    minimum = tuple(min(vertex.co[axis] for vertex in visual.data.vertices) for axis in range(3))
    maximum = tuple(max(vertex.co[axis] for vertex in visual.data.vertices) for axis in range(3))
    return {
        "root": root,
        "collider": collider,
        "bowl": visual,
        "visual": visual,
        "scale": scale,
        "bounds": {"min": minimum, "max": maximum},
        "dimensions": tuple(maximum[i] - minimum[i] for i in range(3)),
        "spout_local": (0.0, 0.552 * scale, 0.152 * scale),
        "fill_center": (0.0, 0.012 * scale, 0.072 * scale),
        "fill_radii": (0.20 * scale, 0.29 * scale, 0.025 * scale),
        "inner_floor_z": 0.025 * scale,
        "inner_floor_fn": lambda x_m, y_m: inner_bowl_floor_z(x_m, y_m, scale),
        "inner_floor_center_z": 0.025 * scale,
        "bowl_radii": (0.34 * scale, 0.49 * scale),
        "bowl_radii_m": (0.34 * scale, 0.49 * scale),
        "rim_z": 0.160 * scale,
    }
