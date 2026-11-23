"""Material look diagnostic using frozen actual CFD pools at four ages.

The pools are rigidly repositioned for judging optics. This is NOT a coupled
timeline bake, and must never be packaged as the production sequence.
"""
import json
import math
from pathlib import Path
import bpy


def make_cached_study(material, stations, snapshot_path):
    data = json.loads(Path(snapshot_path).read_text())
    samples = data.get('samples', data.get('frames'))
    if len(samples) != 4: raise ValueError('Expected four native pool snapshots')
    collection = bpy.data.collections.new('DIAGNOSTIC_ActualCFDPoolsRepositionedForOptics')
    bpy.context.scene.collection.children.link(collection)
    collection['diagnostic_only'] = True
    collection['not_a_coupled_timeline_bake'] = True
    for index, (station, sample) in enumerate(zip(stations, samples)):
        points = sample['vertices']
        cx = (min(p[0] for p in points) + max(p[0] for p in points)) / 2
        cy = (min(p[1] for p in points) + max(p[1] for p in points)) / 2
        angle = (-.22, .30, -.12, .18)[index]
        c, s = math.cos(angle), math.sin(angle)
        vertices = [(station + c * (x-cx) - s * (y-cy), s * (x-cx) + c * (y-cy), z) for x,y,z in points]
        mesh = bpy.data.meshes.new(f'DIAGNOSTIC_NativeCFDPool_{sample["frame"]}')
        mesh.from_pydata(vertices, [], sample['faces'])
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        collection.objects.link(obj)
        mesh.materials.append(material)
        for polygon in mesh.polygons: polygon.use_smooth = True
        obj['diagnostic_only'] = True
        obj['actual_native_cache_frame'] = sample['frame']
        obj['rigid_reposition_only'] = True
    return collection
