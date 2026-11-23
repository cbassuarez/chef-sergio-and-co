"""Authored sauce LOOK DIAGNOSTIC, never a production fluid result.

The single closed volume lets lighting/material/framing be judged while the
independent external CFD test runs. Its shapes are deliberately art-directed;
no collision, source, fluid modifier, bake, or simulated provenance is added.
"""

from __future__ import annotations

import bisect
import math
from typing import Sequence

import bpy


def make_sauce_study(
    material: bpy.types.Material,
    stations: Sequence[float],
) -> bpy.types.Collection:
    """Create one smooth, fuller, irregular diagnostic trace in metre space.

    Station X anchors are retained exactly; the trace is centred at Y=0 on
    the porcelain Z=0 plane. Interior connections are approximately 3.8–4.9 mm
    wide, with 2–3 mm high pools. The ends taper naturally to the contact line.
    Returns a collection unmistakably labelled DIAGNOSTIC in name/metadata.
    """
    centres = [float(value) for value in stations]
    if len(centres) != 4 or any(centres[i + 1] <= centres[i] for i in range(3)):
        raise ValueError("Sauce look study requires four strictly increasing X stations")
    minimum_spacing = min(centres[i + 1] - centres[i] for i in range(3))
    if minimum_spacing < 0.040:
        raise ValueError("The metre-space station spacing is too small for this diagnostic sauce trace")
    pool_scale = min(1.35, max(0.75, minimum_spacing / 0.096))
    # Each shoulder has its own length and height. No repeated ellipsoids are
    # intersected or joined; all four pools belong to the same continuous loft.
    parameters = (
        (0.0100, 0.0175 * pool_scale, 0.0241 * pool_scale, 0.00120, 1.82),
        (0.0122, 0.0245 * pool_scale, 0.0188 * pool_scale, 0.00153, 2.12),
        (0.0097, 0.0197 * pool_scale, 0.0263 * pool_scale, 0.00108, 1.93),
        (0.0113, 0.0256 * pool_scale, 0.0206 * pool_scale, 0.00140, 2.04),
    )
    x_start = centres[0] - parameters[0][1] * 1.72
    x_end = centres[-1] + parameters[-1][2] * 1.73
    base_z = 0.000025
    end_taper_length = 0.0035 * pool_scale

    def centreline(x: float) -> float:
        interval = bisect.bisect_right(centres, x) - 1
        if 0 <= interval < 3:
            t = (x - centres[interval]) / (centres[interval + 1] - centres[interval])
            amplitude = (0.00068, -0.00088, 0.00054)[interval]
            return amplitude * max(0.0, math.sin(math.pi * t)) ** 1.45 * (1 + 0.17 * math.sin(3 * math.pi * t))
        if x < centres[0]:
            t = (x - x_start) / (centres[0] - x_start)
            return -0.00025 * math.sin(math.pi * max(0, min(1, t))) ** 1.5
        t = (x - centres[-1]) / (x_end - centres[-1])
        return 0.00031 * math.sin(math.pi * max(0, min(1, t))) ** 1.5

    def cross_section(x: float) -> tuple[float, float, float, float]:
        relative = x - centres[0]
        # A substantial continuous ribbon underlies all four asymmetric pools.
        half_width = 0.00215 * (1 + 0.095 * math.sin(relative * 43 + 0.6)
                               + 0.026 * math.sin(relative * 117 + 1.1))
        peak_height = 0.00105 * (1 + 0.085 * math.sin(relative * 38 + 1.7))
        for station, (amplitude, left, right, height, exponent) in zip(centres, parameters):
            distance = x - station
            sigma = left if distance < 0 else right
            shape = math.exp(-abs(distance / sigma) ** exponent)
            half_width += amplitude * shape
            peak_height += height * shape
        left_distance, right_distance = x - x_start, x_end - x
        end_distance = min(left_distance, right_distance)
        taper = math.sin(min(1.0, max(0.0, end_distance / end_taper_length)) * math.pi * 0.5)
        half_width *= taper ** 0.65
        peak_height *= taper ** 0.80
        # These small unequal shoulders break bilateral symmetry while the
        # highest point at each station remains on its original Y=0 anchor.
        asymmetry = 0.045 * math.sin(relative * 31 + 0.9) + 0.018 * math.sin(relative * 83)
        return half_width, peak_height, centreline(x), asymmetry

    longitudinal_segments = 300
    cross_segments = 48
    # Extra stations/shoulder samples preserve clean material highlights after
    # one subdivision level, without lumpy random displacement or stray beads.
    xs = {x_start + (x_end - x_start) * i / longitudinal_segments
          for i in range(1, longitudinal_segments)}
    xs.update(centres)
    for station, (_, left, right, _, _) in zip(centres, parameters):
        for factor in (-1.2, -0.8, -0.4, 0.4, 0.8, 1.2):
            point = station + factor * (left if factor < 0 else right)
            if x_start < point < x_end:
                xs.add(point)
    xs = sorted(xs)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    maximum_height = 0.0
    for x in xs:
        width, height, cy, asymmetry = cross_section(x)
        maximum_height = max(maximum_height, height)
        for cross in range(cross_segments):
            angle = cross / cross_segments * math.tau
            cosine, sine = math.cos(angle), math.sin(angle)
            side_width = width * (1 + asymmetry if cosine >= 0 else 1 - asymmetry)
            y = cy + side_width * cosine
            # A rounded shallow cap with a physically thin contact meniscus;
            # its lower half follows the porcelain rather than a second dome.
            z = base_z
            if sine > 0:
                z += height * sine * sine * (1 + 0.055 * cosine * math.sin((x - x_start) * 29))
            vertices.append((x, y, z))
    for row in range(len(xs) - 1):
        for cross in range(cross_segments):
            nxt = (cross + 1) % cross_segments
            a, b = row * cross_segments + cross, row * cross_segments + nxt
            c, d = (row + 1) * cross_segments + cross, (row + 1) * cross_segments + nxt
            faces.append((a, b, d, c))
    start_id, end_id = len(vertices), len(vertices) + 1
    vertices.extend(((x_start, centreline(x_start), base_z), (x_end, centreline(x_end), base_z)))
    last = (len(xs) - 1) * cross_segments
    for cross in range(cross_segments):
        nxt = (cross + 1) % cross_segments
        faces.append((start_id, nxt, cross))
        faces.append((end_id, last + cross, last + nxt))

    collection = bpy.data.collections.new("DIAGNOSTIC_SauceLookStudy")
    bpy.context.scene.collection.children.link(collection)
    collection["diagnostic_only"] = True
    collection["not_a_fluid_simulation"] = True
    collection["provenance"] = "Authored irregular sauce look volume; excluded from production physics claims"
    collection["station_centres_m"] = centres
    mesh = bpy.data.meshes.new("DIAGNOSTIC_AuthoredSauceTraceMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new("DIAGNOSTIC_AuthoredSauceTrace", mesh)
    collection.objects.link(obj)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    subdivision = obj.modifiers.new("Diagnostic sauce surface refinement", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = subdivision.render_levels = 1
    subdivision.show_only_control_edges = True
    obj["diagnostic_only"] = True
    obj["not_a_fluid_simulation"] = True
    obj["provenance"] = "Single authored watertight diagnostic loft; no simulation, source or collision"
    obj["maximum_cap_height_m"] = maximum_height
    obj["minimum_nominal_connector_width_m"] = 0.00215 * 2 * (1 - 0.095 - 0.026)
    obj["nominal_connector_height_m"] = 0.00105
    return collection
