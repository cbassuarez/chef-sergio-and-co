"""Read-only metadata inspection of an existing Mantaflow data frame.

Prefix remeshing is intentionally disabled. Changing Fluid RNA cache properties
can invalidate and delete the previously active cache, even on equal assignments.
Use only immutable filesystem snapshots for diagnostics.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time

import bmesh
import bpy


def _digest(bytes_: bytes) -> str:
    return hashlib.sha256(bytes_).hexdigest()


def _grid_metadata(file: Path) -> dict:
    volume = bpy.data.volumes.new("READ-ONLY cached fluid metadata")
    try:
        volume.filepath = str(file)
        loaded = volume.grids.load()
        if not loaded or volume.grids.error_message:
            raise RuntimeError(f"VDB metadata failed to load: {volume.grids.error_message}")
        return {
            "file": str(file),
            "bytes": file.stat().st_size,
            "grids": [
                {
                    "name": grid.name,
                    "data_type": grid.data_type,
                    "channels": grid.channels,
                    "matrix_object": [list(row) for row in grid.matrix_object],
                }
                for grid in volume.grids
            ],
        }
    finally:
        bpy.data.volumes.remove(volume)


def _copy_stable(source: Path, destination: Path) -> dict:
    before = source.stat()
    if time.time() - before.st_mtime < 1.0:
        raise RuntimeError(f"Refusing a cache file that may still be written: {source}")
    bytes_ = source.read_bytes()
    after = source.stat()
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        raise RuntimeError(f"Source cache changed while taking its snapshot: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(bytes_)
    if _digest(destination.read_bytes()) != _digest(bytes_):
        raise RuntimeError(f"Diagnostic cache copy failed its checksum: {destination}")
    return {"file": str(source), "bytes": len(bytes_), "sha256": _digest(bytes_)}


def _mesh_stats(domain: bpy.types.Object, initial_volume_ml: float) -> tuple[bpy.types.Mesh, dict]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = domain.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.transform(domain.matrix_world)
        volume_ml = abs(bm.calc_volume(signed=True)) * 1_000_000 if bm.faces else 0.0
        stats = {
            "vertices": len(bm.verts),
            "faces": len(bm.faces),
            "nonmanifold_edges": sum(not edge.is_manifold for edge in bm.edges),
            "volume_ml": volume_ml,
            "initial_volume_ml": initial_volume_ml,
            "meshed_volume_ratio_to_initial": volume_ml / initial_volume_ml if initial_volume_ml else None,
            "world_bounds_m": {
                "min": [min(vertex.co[axis] for vertex in bm.verts) for axis in range(3)] if bm.verts else None,
                "max": [max(vertex.co[axis] for vertex in bm.verts) for axis in range(3)] if bm.verts else None,
            },
        }
    finally:
        bm.free()
    # A fluid modifier can expose the original domain box after a failed cache
    # load. Never mistake that box, even with misleading bake flags, for sauce.
    if stats["faces"] <= 12 or stats["vertices"] <= 8 or volume_ml <= 0:
        bpy.data.meshes.remove(mesh)
        raise RuntimeError(f"No actual positive fluid surface was reconstructed: {stats}")
    if initial_volume_ml and volume_ml > initial_volume_ml * 3:
        bpy.data.meshes.remove(mesh)
        raise RuntimeError(f"Reconstructed volume is implausible for the finite fill; possible domain box or wrong transform: {stats}")
    return mesh, stats


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--frame", type=int, required=True)
    parser.add_argument("--cache-dir")
    parser.add_argument("--output")
    parser.add_argument("--mesh-prefix", action="store_true")
    options = parser.parse_args(args)
    if options.mesh_prefix:
        raise RuntimeError("Prefix remeshing is disabled: Fluid RNA setters can invalidate the source cache. This helper is read-only.")
    source_blend = Path(options.blend).expanduser().resolve()
    if options.frame < 1:
        raise ValueError("Diagnostic frame must be positive")
    bpy.ops.wm.open_mainfile(filepath=str(source_blend), load_ui=False)
    scene = bpy.context.scene
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 1
    domain = next((obj for obj in scene.objects if any(mod.type == "FLUID" and mod.fluid_type == "DOMAIN" for mod in obj.modifiers)), None)
    if domain is None:
        raise RuntimeError("The matching study .blend contains no liquid domain")
    modifier = next(mod for mod in domain.modifiers if mod.type == "FLUID" and mod.fluid_type == "DOMAIN")
    settings = modifier.domain_settings
    cache = Path(options.cache_dir).expanduser().resolve() if options.cache_dir else Path(bpy.path.abspath(settings.cache_directory)).resolve()
    requested = cache / "data" / f"fluid_data_{options.frame:04d}.vdb"
    metadata = json.loads(domain.get("plating_physics", "{}"))
    report = {
        "kind": "partial-trajectory-diagnostic",
        "production_ready": False,
        "blender": bpy.app.version_string,
        "source_blend": str(source_blend),
        "source_cache": str(cache),
        "frame": options.frame,
        "original_frame_end": settings.cache_frame_end,
        "original_baked_data_flag": bool(settings.has_cache_baked_data),
        "original_baked_mesh_flag": bool(settings.has_cache_baked_mesh),
        "vdb": _grid_metadata(requested),
        "notes": [
            "A complete data-frame prefix establishes only this partial simulated trajectory.",
            "This helper never performs a fluid/data simulation or sets read-only bake flags.",
            "The diagnostic is outside the production packaging path and is not a complete animation.",
        ],
    }
    print("CACHED_FLUID_GRIDS", json.dumps(report), flush=True)
    return


if __name__ == "__main__":
    main()
