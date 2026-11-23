"""Read-only export of existing evaluated Mantaflow liquid cache meshes.

No Fluid RNA settings, modifiers, materials or cache files are assigned. This
only opens a completed .blend, selects existing times, reads evaluated meshes,
and writes a separate JSON artifact. It never saves the .blend or runs a bake.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _liquid_domain(name=None):
    candidates = []
    for obj in bpy.context.scene.objects:
        if name and obj.name != name:
            continue
        for modifier in obj.modifiers:
            if modifier.type == "FLUID" and modifier.fluid_type == "DOMAIN":
                settings = modifier.domain_settings
                if settings and settings.domain_type == "LIQUID":
                    candidates.append((obj, settings))
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one existing liquid domain, found {len(candidates)}")
    return candidates[0]


def export_cached_liquid(source: Path, output: Path, frames, domain_name=None):
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    if not source.is_file() or output == source:
        raise ValueError("Need an existing source .blend and a separate output JSON")
    before_hash = _sha256(source)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    domain, settings = _liquid_domain(domain_name)
    cache_path = Path(bpy.path.abspath(settings.cache_directory)).resolve()
    if output == cache_path or cache_path in output.parents:
        raise ValueError("The JSON output must be outside the preserved cache directory")
    snapshots = []
    for frame in frames:
        if frame < scene.frame_start or frame > scene.frame_end:
            raise ValueError(f"Frame {frame} is outside the saved scene's existing range")
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = domain.evaluated_get(graph)
        mesh = evaluated.to_mesh(preserve_all_data_layers=False, depsgraph=graph)
        try:
            if mesh is None or (len(mesh.vertices) <= 8 and len(mesh.polygons) <= 6):
                raise RuntimeError(f"Frame {frame} did not resolve an existing liquid mesh")
            matrix = evaluated.matrix_world
            vertices = [list(matrix @ vertex.co) for vertex in mesh.vertices]
            faces = [list(polygon.vertices) for polygon in mesh.polygons]
            minimum = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
            maximum = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
            bounds = {"min": minimum, "max": maximum,
                      "dimensions": [maximum[axis] - minimum[axis] for axis in range(3)]}
            snapshots.append({"frame": frame, "vertices": vertices, "faces": faces,
                              "vertex_count": len(vertices), "face_count": len(faces), "bounds": bounds})
            print("CACHED_LIQUID_SNAPSHOT", json.dumps({"frame": frame, "vertices": len(vertices),
                  "faces": len(faces), "bounds": bounds}), flush=True)
        finally:
            evaluated.to_mesh_clear()
    after_hash = _sha256(source)
    if before_hash != after_hash:
        raise RuntimeError("The source .blend changed during this read-only export")
    result = {
        "version": 1,
        "method": "read-only native evaluated Mantaflow liquid mesh cache export",
        "source_blend": str(source),
        "source_blend_sha256": before_hash,
        "source_blend_unchanged": True,
        "cache_directory": str(cache_path),
        "domain": domain.name,
        "coordinate_space": "world metres, Blender Z up",
        "frames": snapshots,
        "fluid_rna_assignments": False,
        "cache_or_blend_saved": False,
        "usage_note": (
            "Actual native cached liquid geometry at four different simulation ages. "
            "Any rigid translation for a material-look composition is a diagnostic; "
            "it is not evidence of one continuous four-stop timeline pour."
        ),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print("CACHED_LIQUID_EXPORTED", json.dumps({"output": str(output), "frames": list(frames),
          "bytes": output.stat().st_size, "source_unchanged": True}), flush=True)
    return result


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", nargs="+", type=int, default=[8, 12, 18, 22])
    parser.add_argument("--domain")
    options = parser.parse_args(args)
    export_cached_liquid(options.source, options.output, options.frames, options.domain)


if __name__ == "__main__":
    main()
