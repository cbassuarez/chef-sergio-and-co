"""Optical materials for the metre-scale Cycles plating scene (Blender 4.5).

Import ``create_materials`` to obtain (silver, porcelain, sauce). This module
does not configure lighting, geometry, animation, rendering, or fluid physics.
Each material has a node named ``Plating material controls`` whose inputs are
the exposed, named settings. Geometry/object scales must already be applied.

Sauce colour comes primarily from real volume absorption, not alpha or an
opaque yellow surface. Cycles uses sigma_a = (1 - colour) * density for the
Volume Absorption closure. The group converts explicit RGB coefficients in
inverse metres into those sockets, so Beer-Lambert depth remains predictable.
"""
from __future__ import annotations

import json

import bpy


CONTROL_NODE = "Plating material controls"
SILVER_DEFAULTS = {
    "Reflectance (linear RGB)": (0.94, 0.93, 0.91, 1.0),
    "Base Roughness": 0.132,
    "Roughness Variation": 0.026,
    "Anisotropy": 0.18,
    "Scratch Spacing (m)": 0.000045,
    "Polish Grain Length (m)": 0.012,
    "Scratch Depth (m)": 0.00000045,
}
PORCELAIN_DEFAULTS = {
    "Ivory (linear RGB)": (0.88, 0.85, 0.79, 1.0),
    "Body Roughness": 0.26,
    "Roughness Variation": 0.022,
    "Glaze Weight": 0.28,
    "Glaze Roughness": 0.105,
    "Glaze IOR": 1.49,
    "Microtexture Spacing (m)": 0.00017,
    "Microtexture Height (m)": 0.0000014,
}
SAUCE_DEFAULTS = {
    "Liquid IOR": 1.46,
    "Surface Roughness": 0.064,
    "Roughness Variation": 0.025,
    "Transmission": 0.985,
    "Absorption R (1/m)": 40.0,
    "Absorption G (1/m)": 140.0,
    "Absorption B (1/m)": 650.0,
    "Absorption Multiplier": 1.0,
    "Emulsion Scatter (1/m)": 18.0,
    "Forward Scatter": 0.15,
}


def _input(group, name, value, *, minimum=0.0, maximum=1.0, description=""):
    colour = isinstance(value, tuple)
    socket = group.interface.new_socket(
        name=name, in_out="INPUT", socket_type="NodeSocketColor" if colour else "NodeSocketFloat"
    )
    socket.default_value = value
    if not colour:
        socket.min_value = minimum
        socket.max_value = maximum
    socket.description = description
    return socket


def _group(name, defaults, *, volume=False):
    group = bpy.data.node_groups.new(name, "ShaderNodeTree")
    for key, value in defaults.items():
        if "(1/m)" in key:
            maximum = 995.0 if "Absorption" in key else 100.0
            _input(group, key, value, maximum=maximum, description="Physical coefficient in inverse metres.")
        elif "IOR" in key:
            _input(group, key, value, minimum=1.0, maximum=2.5)
        elif "(m)" in key:
            _input(group, key, value, minimum=0.000000001, maximum=0.1,
                   description="Metres in applied object coordinates; not an arbitrary texture scale.")
        elif key == "Absorption Multiplier":
            _input(group, key, value, maximum=4.0,
                   description="Scales all three absorption coefficients together without changing the surface BSDF.")
        elif key == "Forward Scatter":
            _input(group, key, value, minimum=-0.9, maximum=0.9)
        else:
            _input(group, key, value)
    group.interface.new_socket(name="Surface", in_out="OUTPUT", socket_type="NodeSocketShader")
    if volume:
        group.interface.new_socket(name="Volume", in_out="OUTPUT", socket_type="NodeSocketShader")
    inputs = group.nodes.new("NodeGroupInput")
    inputs.name = "Physical material parameters"
    inputs.location = (-1040, 250)
    output = group.nodes.new("NodeGroupOutput")
    output.location = (680, 250)
    return group, inputs, output


def _node(group, type_name, name, location):
    node = group.nodes.new(type_name)
    node.name = node.label = name
    node.location = location
    return node


def _principled(group, name, location=(380, 250)):
    shader = _node(group, "ShaderNodeBsdfPrincipled", name, location)
    shader.inputs["Alpha"].default_value = 1.0
    return shader


def _material(name, group, colour):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = colour
    material.node_tree.nodes.clear()
    instance = material.node_tree.nodes.new("ShaderNodeGroup")
    instance.node_tree = group
    instance.name = instance.label = CONTROL_NODE
    instance.width = 310
    instance.location = (-280, 0)
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (140, 0)
    material.node_tree.links.new(instance.outputs["Surface"], output.inputs["Surface"])
    if "Volume" in instance.outputs:
        material.node_tree.links.new(instance.outputs["Volume"], output.inputs["Volume"])
    material["controls_node"] = CONTROL_NODE
    material["physical_length_unit"] = "metre; apply object scale before use"
    return material


def _roughness(group, fac, inputs, base_name, variation_name, location):
    x, y = location
    center = _node(group, "ShaderNodeMath", "Zero-centred micro-polish", (x, y))
    center.operation = "SUBTRACT"
    center.inputs[1].default_value = 0.5
    group.links.new(fac, center.inputs[0])
    variation = _node(group, "ShaderNodeMath", "Restrained roughness variation", (x + 165, y))
    variation.operation = "MULTIPLY"
    group.links.new(center.outputs[0], variation.inputs[0])
    group.links.new(inputs.outputs[variation_name], variation.inputs[1])
    add = _node(group, "ShaderNodeMath", "Polish around physical base roughness", (x + 330, y))
    add.operation = "ADD"
    group.links.new(inputs.outputs[base_name], add.inputs[0])
    group.links.new(variation.outputs[0], add.inputs[1])
    return add.outputs[0]


def _silver():
    group, inputs, output = _group("Plating / silver / longitudinal micro-polish", SILVER_DEFAULTS)
    shader = _principled(group, "Real silver conductor")
    shader.inputs["Metallic"].default_value = 1.0
    shader.inputs["Coat Weight"].default_value = 0.0
    group.links.new(inputs.outputs["Reflectance (linear RGB)"], shader.inputs["Base Color"])
    group.links.new(inputs.outputs["Anisotropy"], shader.inputs["Anisotropic"])

    coordinates = _node(group, "ShaderNodeTexCoord", "Applied metre-scale spoon coordinates", (-1040, -200))
    spacing = _node(group, "ShaderNodeCombineXYZ", "Micron spacing across / long grain along Y", (-840, -340))
    group.links.new(inputs.outputs["Scratch Spacing (m)"], spacing.inputs["X"])
    group.links.new(inputs.outputs["Polish Grain Length (m)"], spacing.inputs["Y"])
    group.links.new(inputs.outputs["Scratch Spacing (m)"], spacing.inputs["Z"])
    scale = _node(group, "ShaderNodeVectorMath", "Physical directional polish coordinates", (-640, -180))
    scale.operation = "DIVIDE"
    group.links.new(coordinates.outputs["Object"], scale.inputs[0])
    group.links.new(spacing.outputs["Vector"], scale.inputs[1])
    grain = _node(group, "ShaderNodeTexNoise", "Fine polish, not visible scratch stripes", (-430, -180))
    grain.noise_dimensions = "3D"
    grain.inputs["Scale"].default_value = 1.0
    grain.inputs["Detail"].default_value = 1.4
    grain.inputs["Roughness"].default_value = 0.52
    group.links.new(scale.outputs["Vector"], grain.inputs["Vector"])
    roughness = _roughness(group, grain.outputs["Fac"], inputs,
                          "Base Roughness", "Roughness Variation", (-400, 580))
    group.links.new(roughness, shader.inputs["Roughness"])

    bump = _node(group, "ShaderNodeBump", "Sub-micron silver relief", (-100, -200))
    bump.inputs["Strength"].default_value = 0.18
    group.links.new(inputs.outputs["Scratch Depth (m)"], bump.inputs["Distance"])
    group.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    group.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    tangent = _node(group, "ShaderNodeVectorTransform", "Polish direction follows the moving spoon", (-100, -440))
    tangent.vector_type = "VECTOR"
    tangent.convert_from = "OBJECT"
    tangent.convert_to = "WORLD"
    tangent.inputs["Vector"].default_value = (0.0, 1.0, 0.0)
    group.links.new(tangent.outputs["Vector"], shader.inputs["Tangent"])
    group.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material = _material("Plating silver - polished solid conductor", group, SILVER_DEFAULTS["Reflectance (linear RGB)"])
    material["optical_model"] = "metallic conductor; no dielectric clear-coat"
    return material


def _porcelain():
    group, inputs, output = _group("Plating / ivory porcelain / micro-glaze", PORCELAIN_DEFAULTS)
    shader = _principled(group, "Glazed ivory ceramic")
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Transmission Weight"].default_value = 0.0
    group.links.new(inputs.outputs["Ivory (linear RGB)"], shader.inputs["Base Color"])
    group.links.new(inputs.outputs["Glaze IOR"], shader.inputs["IOR"])
    group.links.new(inputs.outputs["Glaze IOR"], shader.inputs["Coat IOR"])
    group.links.new(inputs.outputs["Glaze Weight"], shader.inputs["Coat Weight"])
    group.links.new(inputs.outputs["Glaze Roughness"], shader.inputs["Coat Roughness"])
    coordinates = _node(group, "ShaderNodeTexCoord", "Applied metre-scale porcelain coordinates", (-1040, -200))
    frequency = _node(group, "ShaderNodeMath", "Inverse physical glaze spacing", (-840, -200))
    frequency.operation = "DIVIDE"
    frequency.inputs[0].default_value = 1.0
    group.links.new(inputs.outputs["Microtexture Spacing (m)"], frequency.inputs[1])
    grain = _node(group, "ShaderNodeTexNoise", "Very fine ceramic glaze structure", (-630, -180))
    grain.inputs["Detail"].default_value = 2.0
    grain.inputs["Roughness"].default_value = 0.58
    group.links.new(coordinates.outputs["Object"], grain.inputs["Vector"])
    group.links.new(frequency.outputs[0], grain.inputs["Scale"])
    bump = _node(group, "ShaderNodeBump", "Micrometre glaze relief", (-100, -200))
    bump.inputs["Strength"].default_value = 0.14
    group.links.new(inputs.outputs["Microtexture Height (m)"], bump.inputs["Distance"])
    group.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    group.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    group.links.new(bump.outputs["Normal"], shader.inputs["Coat Normal"])
    roughness = _roughness(group, grain.outputs["Fac"], inputs,
                          "Body Roughness", "Roughness Variation", (-400, 580))
    group.links.new(roughness, shader.inputs["Roughness"])
    group.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return _material("Plating porcelain - warm ivory micro-glaze", group, PORCELAIN_DEFAULTS["Ivory (linear RGB)"])


def _sauce():
    group, inputs, output = _group("Plating / amber jus / refractive liquid and optical depth", SAUCE_DEFAULTS, volume=True)
    shader = _principled(group, "Liquid air interface - true dielectric", (370, 420))
    shader.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Coat Weight"].default_value = 0.0
    shader.inputs["Subsurface Weight"].default_value = 0.0
    group.links.new(inputs.outputs["Liquid IOR"], shader.inputs["IOR"])
    coordinates = _node(group, "ShaderNodeTexCoord", "Metre-scale suspended emulsion coordinates", (-1250, 650))
    emulsion = _node(group, "ShaderNodeTexNoise", "Subtle uneven reduction and fine emulsion", (-1040, 650))
    emulsion.inputs["Scale"].default_value = 1200.0
    emulsion.inputs["Detail"].default_value = 2.0
    emulsion.inputs["Roughness"].default_value = 0.6
    group.links.new(coordinates.outputs["Object"], emulsion.inputs["Vector"])
    roughness = _roughness(group, emulsion.outputs["Fac"], inputs,
                          "Surface Roughness", "Roughness Variation", (-820, 950))
    group.links.new(roughness, shader.inputs["Roughness"])
    group.links.new(inputs.outputs["Transmission"], shader.inputs["Transmission Weight"])
    group.links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    coefficients = _node(group, "ShaderNodeCombineXYZ", "Physical RGB absorption coefficients per metre", (-790, -130))
    for channel in "RGB":
        group.links.new(inputs.outputs[f"Absorption {channel} (1/m)"], coefficients.inputs["RGB".index(channel)])
    normalise = _node(group, "ShaderNodeVectorMath", "Encode coefficients at 1000 inverse metres", (-560, -130))
    normalise.operation = "DIVIDE"
    normalise.inputs[1].default_value = (1000.0, 1000.0, 1000.0)
    group.links.new(coefficients.outputs["Vector"], normalise.inputs[0])
    colour = _node(group, "ShaderNodeVectorMath", "Cycles absorption colour = one minus sigma over density", (-320, -130))
    colour.operation = "SUBTRACT"
    colour.inputs[0].default_value = (1.0, 1.0, 1.0)
    group.links.new(normalise.outputs["Vector"], colour.inputs[1])
    density = _node(group, "ShaderNodeMath", "Physical density multiplier", (-320, -360))
    density.operation = "MULTIPLY"
    density.inputs[0].default_value = 1000.0
    group.links.new(inputs.outputs["Absorption Multiplier"], density.inputs[1])
    variation = _node(group, "ShaderNodeMapRange", "Restrained optical density variation, 0.8 to 1.2", (-790, -570))
    variation.inputs["From Min"].default_value = 0.0
    variation.inputs["From Max"].default_value = 1.0
    variation.inputs["To Min"].default_value = 0.8
    variation.inputs["To Max"].default_value = 1.2
    group.links.new(emulsion.outputs["Fac"], variation.inputs["Value"])
    textured_density = _node(group, "ShaderNodeMath", "Reduction density with fine suspended variation", (-280, -600))
    textured_density.operation = "MULTIPLY"
    group.links.new(density.outputs[0], textured_density.inputs[0])
    group.links.new(variation.outputs["Result"], textured_density.inputs[1])
    absorption = _node(group, "ShaderNodeVolumeAbsorption", "Beer-Lambert amber absorption", (-70, -130))
    group.links.new(colour.outputs["Vector"], absorption.inputs["Color"])
    group.links.new(textured_density.outputs[0], absorption.inputs["Density"])
    scatter = _node(group, "ShaderNodeVolumeScatter", "Sparse emulsion haze - inverse metre density", (-60, -420))
    scatter.inputs["Color"].default_value = (0.97, 0.955, 0.93, 1.0)
    group.links.new(inputs.outputs["Emulsion Scatter (1/m)"], scatter.inputs["Density"])
    group.links.new(inputs.outputs["Forward Scatter"], scatter.inputs["Anisotropy"])
    volume = _node(group, "ShaderNodeAddShader", "Independent absorption plus emulsion scattering", (390, -160))
    group.links.new(absorption.outputs["Volume"], volume.inputs[0])
    group.links.new(scatter.outputs["Volume"], volume.inputs[1])
    group.links.new(volume.outputs["Shader"], output.inputs["Volume"])
    material = _material("Plating amber jus - refractive absorbing liquid", group, (0.75, 0.39, 0.035, 1.0))
    material["optical_model"] = "dielectric surface + RGB volume absorption + sparse volume scatter"
    material["absorption_coefficients_per_metre"] = [40.0, 140.0, 650.0]
    material["requires_closed_outward_liquid_mesh"] = True
    return material


def create_materials() -> tuple[bpy.types.Material, bpy.types.Material, bpy.types.Material]:
    """Return independent silver, porcelain and amber-liquid materials.

    To tune a value, use for example::

        controls = sauce.node_tree.nodes[CONTROL_NODE]
        controls.inputs['Absorption Multiplier'].default_value = 0.8

    The fluid mesh must be closed, consistently outward-facing, and represented
    in real metres. No shader can replace its actual thickness or meniscus.
    """
    return _silver(), _porcelain(), _sauce()


if __name__ == "__main__":
    materials = create_materials()
    report = []
    for material in materials:
        controls = material.node_tree.nodes[CONTROL_NODE]
        assert material.use_nodes and not any(node.type == "BSDF_TRANSPARENT" for node in controls.node_tree.nodes)
        report.append({"material": material.name, "group": controls.node_tree.name,
                       "nodes": len(controls.node_tree.nodes), "links": len(controls.node_tree.links)})
    print("PLATING_MATERIALS_VALIDATED", json.dumps(report))
