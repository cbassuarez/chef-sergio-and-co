// Package actual conservative thin-film photographs and their physical ledger.
// This never solves, renders, or replaces a missing frame with study artwork.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { positionals, values } = parseArgs({ allowPositionals: true, options: { film: { type: 'string', default: 'output/plating-timeline/thinfilm-oblique-projected' } } })
if (positionals.length > 1) throw new Error('Usage: node scripts/package-thinfilm-frames.mjs [render-directory] --film [solved-film-directory]')
const INPUT = path.resolve(ROOT, positionals[0] || 'output/plating-timeline/thinfilm-oblique-final')
const FILM = path.resolve(ROOT, values.film)
const DESTINATION = path.join(ROOT, 'public/art/plating')
const REGISTRY = path.join(ROOT, 'content/art.source.json')
const PIPELINE = 'conservative-viscous-film'
const STUDIO = [
  'scripts/blender/create_plating_scene.py', 'scripts/blender/plating_spoon.py',
  'scripts/blender/plating_fluid.py', 'scripts/blender/plating_materials.py',
  'scripts/blender/plating_engraving.py', 'scripts/blender/plating_reservoir.py',
  'scripts/blender/plating_external.py',
]
const PHYSICAL = ['scripts/blender/plating_thinfilm.py', 'scripts/blender/plating_thinfilm_solver.cpp', 'scripts/blender/prepare_plating_performance.py']
const RENDER = ['scripts/blender/plating_surface.py', 'scripts/blender/render_thinfilm_sequence.py']
const SOURCES = [...STUDIO, ...PHYSICAL, ...RENDER]
const STATION_FRAMES = [24, 72, 120, 168]
const FRAMES = Array.from({ length: 73 }, (_, index) => 24 + index * 2)
const TOLERANCE_ML = 1e-6
const MODEL = 'reduced-order Newtonian gravity/lubrication thin-film finite-volume solver'
const AI_CREDENTIAL = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }
const number = (value, label, minimum = 0) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed < minimum) fail(`Invalid ${label}`)
  return parsed
}
const near = (actual, expected, label, tolerance = TOLERANCE_ML) => {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) fail(`${label}: ${actual} differs from ${expected}`)
}
const exact = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match the required production sequence`)
}
async function read(folder, name, json = true) {
  const bytes = await fs.readFile(path.join(folder, name))
  return { bytes, sha256: sha(bytes), ...(json ? { value: JSON.parse(bytes.toString('utf8')) } : {}) }
}
async function sourcesNow() {
  return Promise.all(SOURCES.map(async source => ({ path: source, sha256: sha(await fs.readFile(path.join(ROOT, source))) })))
}

function validatePhysics(metadata, plan, ledger) {
  if (metadata.model !== MODEL || metadata.full_3d_Navier_Stokes !== false || metadata.Mantaflow !== false || metadata.authored_trail !== false || metadata.surface_tension_pressure !== false || metadata.positive !== true) fail('The physical dataset must explicitly establish its positive, unauthored reduced-order model')
  if (metadata.frame_count !== 180 || metadata.boundary !== 'closed no-flux') fail('The physical dataset must contain all 180 frames with no-flux boundaries')
  const initial = number(plan.provenance?.initial_volume_ml, 'initial reservoir volume', Number.MIN_VALUE)
  near(initial, 8, 'Production initial reservoir volume')
  const fps = number(plan.provenance?.fps, 'reservoir fps', 1)
  near(fps, 24, 'Reservoir fps', 1e-9)
  near(number(metadata.fps, 'physical fps'), fps, 'Physical fps', 1e-9)
  if (plan.provenance.full_moving_cup_CFD !== false || !Array.isArray(plan.states) || plan.states.length !== 180 || plan.states.some((state, index) => state.frame !== index + 1)) fail('The complete analytic reservoir plan and explicit approximation are required')
  if (!Array.isArray(ledger.frames) || ledger.frames.length !== 180 || ledger.frames.some((row, index) => Number(row.frame) !== index + 1)) fail('The physical volume ledger must contain frames 1 through 180 exactly once')
  const states = []
  let previous = initial, cumulative = 0, maximumError = 0
  for (let index = 0; index < 180; index++) {
    const state = plan.states[index], row = ledger.frames[index], frame = index + 1
    const remaining = number(state.volume_ml, `reservoir frame ${frame} remaining volume`)
    const emitted = number(state.emitted_total_ml, `reservoir frame ${frame} cumulative emission`)
    const interval = number(state.emitted_since_previous_frame_ml, `reservoir frame ${frame} interval emission`)
    const flow = number(state.flow_ml_s, `reservoir frame ${frame} mean flow`)
    cumulative += interval
    near(previous - remaining, interval, `Reservoir frame ${frame} finite interval`)
    near(flow / fps, interval, `Reservoir frame ${frame} mean-Q interval`)
    near(cumulative, emitted, `Reservoir frame ${frame} cumulative ledger`)
    near(remaining + emitted, initial, `Reservoir frame ${frame} conservation`)
    if (remaining > previous + TOLERANCE_ML || remaining > initial + TOLERANCE_ML) fail(`Reservoir frame ${frame} gained liquid`)
    if (index === 0) { near(remaining, initial, 'Initial reservoir'); near(emitted, 0, 'Initial emission'); near(interval, 0, 'Initial interval') }
    const measured = number(row.measured_m3, `film frame ${frame} measured volume`) * 1e6
    const target = number(row.target_m3, `film frame ${frame} source target`) * 1e6
    const minimum = number(row.minimum_height_m, `film frame ${frame} minimum height`)
    const maximum = number(row.maximum_height_m, `film frame ${frame} maximum height`)
    if (maximum < minimum) fail(`Film frame ${frame} has invalid height bounds`)
    near(target, emitted, `Film frame ${frame} target versus finite emission`)
    near(measured, target, `Film frame ${frame} finite-volume conservation`)
    near(number(row.reservoir_remaining_ml, `film frame ${frame} reservoir ledger`), remaining, `Film frame ${frame} reservoir reference`)
    near(number(row.film_ml, `film frame ${frame} millilitre ledger`), measured, `Film frame ${frame} measured ledger`)
    near(number(row.combined_ml, `film frame ${frame} combined ledger`), initial, `Film frame ${frame} combined ledger`)
    near(measured + remaining, initial, `Film frame ${frame} combined reservoir + film mass`)
    near(Number(row.error_m3) * 1e6, measured - target, `Film frame ${frame} recorded error`)
    near(number(row.time_s, `film frame ${frame} time`), index / fps, `Film frame ${frame} time`, 1e-9)
    maximumError = Math.max(maximumError, Math.abs(measured + remaining - initial), Math.abs(measured - target))
    states.push({ frame, remainingReservoirMl: remaining, filmVolumeMl: measured, plannedEmittedMl: emitted, plannedIntervalEmissionMl: interval, meanFlowMlS: flow, minimumHeightM: minimum, maximumHeightM: maximum })
    previous = remaining
  }
  const last = states.at(-1)
  near(number(metadata.source_volume_ml, 'physical total finite source'), last.plannedEmittedMl, 'Physical source summary')
  near(number(metadata.measured_final_volume_ml, 'physical final measured volume'), last.filmVolumeMl, 'Physical final volume summary')
  near(number(metadata.initial_reservoir_volume_ml, 'physical initial reservoir reference'), initial, 'Physical initial reservoir summary')
  near(number(metadata.remaining_reservoir_volume_ml, 'physical remaining reservoir reference'), last.remainingReservoirMl, 'Physical remaining reservoir summary')
  near(number(ledger.source_volume_ml, 'ledger total finite source'), last.plannedEmittedMl, 'Ledger source summary')
  near(number(plan.provenance.remaining_volume_ml, 'analytic final remaining volume'), last.remainingReservoirMl, 'Analytic remaining summary')
  near(number(plan.provenance.emitted_volume_ml, 'analytic final emission'), last.plannedEmittedMl, 'Analytic emission summary')
  if (number(metadata.maximum_frame_volume_error_ml, 'maximum physical volume error') > TOLERANCE_ML || number(metadata.maximum_combined_reservoir_film_error_ml, 'maximum combined reservoir/film error') > TOLERANCE_ML || number(plan.provenance.maximum_mass_balance_error_ml, 'maximum analytic error') > TOLERANCE_ML) fail('Recorded physical/analytic mass error exceeds tolerance')
  const nu = number(metadata.kinematic_viscosity_m2_s, 'film kinematic viscosity', Number.MIN_VALUE)
  const dx = number(metadata.dx_m, 'film grid spacing', Number.MIN_VALUE)
  if (!Array.isArray(metadata.grid) || metadata.grid.length !== 2 || metadata.grid.some(value => !Number.isInteger(value) || value < 3)) fail('Invalid physical grid shape')
  if (!Array.isArray(metadata.domain_xy_m) || metadata.domain_xy_m.length !== 4 || !metadata.domain_xy_m.every(Number.isFinite)) fail('Invalid physical domain')
  near((metadata.domain_xy_m[1] - metadata.domain_xy_m[0]) / dx, metadata.grid[1], 'Physical X extent/grid', 1e-6)
  near((metadata.domain_xy_m[3] - metadata.domain_xy_m[2]) / dx, metadata.grid[0], 'Physical Y extent/grid', 1e-6)
  return { initial, fps, nu, dx, states, maximumError }
}

function finiteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) fail(`Invalid ${label}`)
  return [...value]
}

function validatePhotography(value) {
  if (value?.projection !== 'perspective') fail('The photographic proof must establish its perspective camera')
  const location = finiteVector(value.camera_location_m, 'camera location')
  const target = finiteVector(value.camera_target_m, 'camera target')
  const focus = finiteVector(value.fixed_focus_point_m, 'fixed camera focus point')
  const forward = target.map((coordinate, axis) => coordinate - location[axis])
  const distance = Math.hypot(...forward)
  if (distance <= 0) fail('Camera location and target must differ')
  const focusDistance = number(value.focus_distance_m, 'camera focus distance', Number.MIN_VALUE)
  const projectedFocusDistance = focus.reduce((sum, coordinate, axis) => sum + (coordinate - location[axis]) * forward[axis] / distance, 0)
  near(focusDistance, projectedFocusDistance, 'Fixed focus point versus lens-plane distance', 1e-6)
  const focusMethod = 'fixed near-end focus; real Cycles aperture depth of field'
  if (value.focus_method !== focusMethod) fail('The photographic proof must establish its actual fixed aperture focus method')
  return {
    projection: 'perspective', cameraLocationM: location, cameraTargetM: target,
    groundHorizontalFieldM: number(value.ground_horizontal_field_m, 'camera ground field', Number.MIN_VALUE),
    lensMm: number(value.lens_mm, 'camera focal length', Number.MIN_VALUE),
    fStop: number(value.f_stop, 'camera aperture', Number.MIN_VALUE),
    fixedFocusPointM: focus, focusDistanceM: focusDistance, focusMethod,
  }
}

function sanitizePerformance(plan) {
  const performance = plan.provenance.spoon_performance
  if (!performance) return undefined
  if (performance.authored_spoon_motion !== true || performance.authored_liquid_outline !== false) fail('The performance must distinguish authored spoon motion from the solved liquid outline')
  const result = { authoredSpoonMotion: true, authoredLiquidOutline: false }
  if (performance.route === 'oblique') {
    const parameters = performance.route_parameters
    if (parameters?.camera_projection_compensation !== true || parameters.spoon_trajectory_authored !== true || parameters.liquid_outline_authored !== false) fail('The oblique route must disclose its authored camera-compensated spoon trajectory')
    const anchors = parameters.station_x_m
    if (!Array.isArray(anchors) || anchors.length !== STATION_FRAMES.length || !anchors.every(Number.isFinite) || anchors.some((value, index) => index > 0 && value <= anchors[index - 1])) fail('Invalid physical projection-compensated X anchors')
    const samples = performance.detent_route_samples
    if (!Array.isArray(samples) || samples.length !== STATION_FRAMES.length || samples.some((sample, index) => sample.frame !== STATION_FRAMES[index])) fail('Missing oblique route detent samples')
    result.route = 'oblique curved approach'
    result.cameraProjectionCompensation = true
    result.stationXM = [...anchors]
    result.farStartYM = number(parameters.far_start_y_m, 'route far-start Y', -Infinity)
    result.nearFinishYM = number(parameters.near_finish_y_m, 'route near-finish Y', -Infinity)
    result.bowM = number(parameters.bow_m, 'route bow', -Infinity)
    result.detents = samples.map((sample, index) => {
      const nozzle = finiteVector(sample.nozzle_world, `route frame ${sample.frame} nozzle`)
      const source = finiteVector(plan.states[sample.frame - 1].nozzle_world, `source frame ${sample.frame} nozzle`)
      for (let axis = 0; axis < 3; axis++) near(nozzle[axis], source[axis], `Route frame ${sample.frame} nozzle axis ${axis}`, 1e-7)
      near(nozzle[0], anchors[index], `Route frame ${sample.frame} physical X anchor`, 1e-7)
      return { frame: sample.frame, nozzleWorldM: nozzle }
    })
  }
  return result
}

function validateRenders(proof, frames, physics, metadata, planHash, sourceStates) {
  if (proof.pipeline !== PIPELINE || proof.diagnostic_only !== false || proof.renderer !== 'Blender Cycles' || proof.units !== 'meters' || proof.full_trail !== true) fail('A complete non-diagnostic conservative-film photographic proof is required')
  exact(frames, FRAMES, 'render-frames.json')
  exact(proof.station_frames, STATION_FRAMES, 'Detent frames')
  if (!Array.isArray(proof.frames) || proof.frames.length !== FRAMES.length || proof.frames.some((record, index) => record.frame !== FRAMES[index])) fail('Render records do not match all 73 actual frames')
  near(number(proof.fps, 'photography fps'), physics.fps, 'Photographic fps', 1e-9)
  const material = proof.material_overrides
  for (const key of ['roughness', 'roughness_variation', 'transmission']) if (number(material?.[key], `material ${key}`) > 1) fail(`Material ${key} exceeds its physical range`)
  number(material.absorption_multiplier, 'material absorption', Number.MIN_VALUE)
  number(material.emulsion_scatter_per_m, 'material scatter')
  return proof.frames.map(record => {
    const frame = record.frame, state = physics.states[frame - 1], geometry = record.geometry, film = record.film
    const sourcePose = sourceStates[frame - 1]
    if (record.root_pose_matches_source !== true) fail(`Frame ${frame} does not establish that the photographed spoon used its physical source pose`)
    for (const [field, expected, tolerance] of [
      ['rendered_root_location', sourcePose.location, 1e-7],
      ['rendered_root_rotation_euler', sourcePose.rotation_euler, 1e-6],
    ]) {
      const actual = record[field]
      if (!Array.isArray(actual) || actual.length !== 3 || !actual.every(Number.isFinite) || !Array.isArray(expected) || expected.length !== 3 || !expected.every(Number.isFinite)) fail(`Frame ${frame} lacks finite three-component ${field} evidence`)
      for (let axis = 0; axis < 3; axis++) near(actual[axis], expected[axis], `Frame ${frame} ${field} axis ${axis}`, tolerance)
    }
    const station = STATION_FRAMES.includes(frame)
    exact([record.width, record.height], station ? [1920, 900] : [1280, 600], `Frame ${frame} native source dimensions`)
    if (!Number.isInteger(record.samples) || record.samples < (station ? 128 : 64)) fail(`Frame ${frame} lacks its detent/motion sample quality`)
    if (!/^[a-f0-9]{64}$/.test(record.png_sha256 ?? '')) fail(`Frame ${frame} has no actual PNG hash`)
    if (!geometry || !Number.isInteger(geometry.vertices) || geometry.vertices < 4 || !Number.isInteger(geometry.faces) || geometry.faces < 4 || geometry.nonmanifold_edges !== 0 || geometry.components !== 1) fail(`Frame ${frame} must contain one connected, closed liquid volume`)
    const volume = number(geometry.volume_ml, `frame ${frame} rendered film volume`, Number.MIN_VALUE)
    if (state.filmVolumeMl <= 0 || Math.abs(volume / state.filmVolumeMl - 1) > .01) fail(`Frame ${frame} mesh volume differs from its solved film by more than 1%`)
    if (film?.frame !== frame || film.model !== metadata.model || film.authored_trail !== false || film.full_3d_Navier_Stokes !== false || film.Mantaflow !== false || film.whole_continuous_film !== true || film.mesh_connected_components !== 1 || film.non_manifold_edges !== 0 || film.source_plan_sha256 !== planHash) fail(`Frame ${frame} does not establish actual connected, unauthored reduced-model liquid`)
    near(number(film.solver_volume_ml, `frame ${frame} solver proof volume`), state.filmVolumeMl, `Frame ${frame} solved volume binding`)
    near(number(film.rendered_volume_ml, `frame ${frame} committed mesh proof volume`), volume, `Frame ${frame} mesh volume binding`, Math.max(1e-6, volume * 1e-5))
    if (Math.abs(number(film.relative_volume_error, `frame ${frame} render volume error`, -1)) > .01) fail(`Frame ${frame} render surface exceeds its volume bound`)
    const reservoir = record.reservoir
    if (reservoir?.frame !== frame) fail(`Frame ${frame} lacks visible reservoir evidence`)
    near(number(reservoir.target_volume_ml, `frame ${frame} visible reservoir target`), state.remainingReservoirMl, `Frame ${frame} analytic reservoir binding`)
    const visibleReservoir = number(reservoir.mesh_volume_ml, `frame ${frame} visible reservoir volume`)
    if (Math.abs(visibleReservoir - state.remainingReservoirMl) > Math.max(1e-6, state.remainingReservoirMl * .01)) fail(`Frame ${frame} visible reservoir exceeds its analytic volume bound`)
    near(number(record.expected_emitted_volume_ml, `frame ${frame} expected emission`), state.plannedEmittedMl, `Frame ${frame} expected emission binding`)
    near(number(record.remaining_reservoir_volume_ml, `frame ${frame} remaining reservoir`), state.remainingReservoirMl, `Frame ${frame} remaining reservoir binding`)
    return { frame, sourceWidth: record.width, sourceHeight: record.height, renderSamples: record.samples,
      rootPoseMatchesSource: true, renderedRootLocationM: record.rendered_root_location,
      renderedRootRotationEulerRad: record.rendered_root_rotation_euler,
      sourceResolutionTier: station ? 'native-1920-detent' : 'native-1280-motion-upscaled-for-desktop',
      pngSha256: record.png_sha256, vertices: geometry.vertices, faces: geometry.faces,
      nonmanifoldEdges: 0, components: 1, solverVolumeMl: state.filmVolumeMl, renderedVolumeMl: volume,
      relativeRenderVolumeError: volume / state.filmVolumeMl - 1, analyticReservoirVolumeMl: state.remainingReservoirMl,
      visibleReservoirVolumeMl: visibleReservoir,
      renderMeniscusSigmaM: number(film.render_meniscus_sigma_m, `frame ${frame} render meniscus sigma`),
      renderHeightNormalization: number(film.render_height_normalization, `frame ${frame} render height normalization`, Number.MIN_VALUE),
      contactOffsetM: number(film.contact_offset_m, `frame ${frame} render contact offset`),
    }
  })
}

let stage, backup, temporaryRegistry, installed = false, registryCommitted = false
try {
  const [render, proof, studio, studioBlend, metadata, dataset, ledger, plan, sources] = await Promise.all([
    read(INPUT, 'render-frames.json'), read(INPUT, 'render-provenance.json'), read(INPUT, 'scene-provenance.json'), read(INPUT, 'plating.blend', false),
    read(FILM, 'metadata.json'), read(FILM, 'heightfields.npz', false), read(FILM, 'volume-ledger.json'), read(FILM, 'reservoir-plan.json'), sourcesNow(),
  ])
  const hashes = proof.value.source_hashes
  if (!hashes || Object.keys(hashes).length !== SOURCES.length || sources.some(source => hashes[source.path] !== source.sha256)) fail('All twelve photographed studio/solver/render sources must match their exact recorded hashes')
  for (const source of sources.filter(item => STUDIO.includes(item.path))) if (studio.value.source_hashes?.[source.path] !== source.sha256) fail(`${source.path} differs from the saved photography studio`)
  const byPath = new Map(sources.map(source => [source.path, source.sha256]))
  if (metadata.value.solver_source_sha256 !== byPath.get(PHYSICAL[1]) || metadata.value.python_source_sha256 !== byPath.get(PHYSICAL[0]) || metadata.value.source_plan_sha256 !== plan.sha256) fail('Solved film metadata is not bound to the current C++/Python solver and finite source plan')
  const bindings = { studio_blend_sha256: studioBlend.sha256, studio_provenance_sha256: studio.sha256,
    physics_metadata_sha256: metadata.sha256, physics_dataset_sha256: dataset.sha256,
    physics_ledger_sha256: ledger.sha256, reservoir_plan_sha256: plan.sha256 }
  for (const [key, hash] of Object.entries(bindings)) if (proof.value[key] !== hash) fail(`Photographic ${key} binding differs from the actual input`)
  if (studio.value.units !== 'meters') fail('Photography studio units must be metres')
  const physics = validatePhysics(metadata.value, plan.value, ledger.value)
  const camera = validatePhotography(proof.value.photography)
  const spoonPerformance = sanitizePerformance(plan.value)
  const records = validateRenders(proof.value, render.value, physics, metadata.value, plan.sha256, plan.value.states)
  const oldRegistry = await fs.readFile(REGISTRY, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (oldRegistry && (JSON.parse(oldRegistry).assets || []).some(asset => !String(asset.file).startsWith('art/plating/'))) fail('Preserve artwork outside this timeline before replacing its registry')
  const blender = String(proof.value.blender || '').match(/^\d+\.\d+(?:\.\d+)?(?:\s+LTS)?/)?.[0]
  if (!blender) fail('Missing actual Blender version')
  const provenance = {
    kind: 'authored-3d-render', pipeline: PIPELINE, renderer: 'Blender Cycles', blender, units: 'meters', fps: physics.fps,
    photographyStudioOnly: true,
    physics: { model: MODEL, equation: 'dh/dt = div(g*h^3/(3*nu)*grad(h)) + finite Gaussian source',
      full3dNavierStokes: false, fullMovingCupCfd: false, Mantaflow: false, surfaceTensionPressure: false, authoredTrail: false,
      coupling: 'one-way prescribed analytic-reservoir discharge into a conservative gravity/lubrication film',
      simulatedFrames: 180, initialReservoirVolumeMl: physics.initial, finalFilmVolumeMl: physics.states.at(-1).filmVolumeMl,
      remainingReservoirVolumeMl: physics.states.at(-1).remainingReservoirMl, maximumCombinedMassErrorMl: physics.maximumError,
      kinematicViscosityM2S: physics.nu, gravityMS2: number(metadata.value.gravity_m_s2, 'gravity', Number.MIN_VALUE),
      grid: metadata.value.grid, dxM: physics.dx, domainXyM: metadata.value.domain_xy_m, boundary: 'closed no-flux',
      sourceSigmaM: number(metadata.value.source_sigma_m, 'source Gaussian sigma', Number.MIN_VALUE),
      sourceTruncationSigma: number(metadata.value.source_truncation_sigma, 'source Gaussian truncation', Number.MIN_VALUE),
      impact: 'Ballistic flight to the plate using relative exit velocity plus actual nozzle translation',
      spoonPerformance,
      massLedger: physics.states,
      assumptions: ['Reduced Newtonian low-Re gravity/lubrication model; no 3D jet inertia, sloshing, wetting hysteresis or capillary pressure.',
        'Reservoir discharge, ballistic landing and Gaussian impact footprint are explicit approximations; sauce rheology is not measured.',
        'Render-only contact-line smoothing is volume-normalised and is separate from the physical height evolution.'],
    },
    photography: { camera, materialOverrides: {
      roughness: proof.value.material_overrides.roughness, roughnessVariation: proof.value.material_overrides.roughness_variation,
      absorptionMultiplier: proof.value.material_overrides.absorption_multiplier,
      emulsionScatterPerM: proof.value.material_overrides.emulsion_scatter_per_m,
      transmission: proof.value.material_overrides.transmission },
      lastPhotographedFrame: 168, desktopEncoding: [1920, 900], mobileEncoding: [768, 360], sourceTiers: 'Native 1920 detents; native 1280 motion explicitly upscaled for desktop', frames: records },
    sources, sourceStages: { studio: STUDIO, physicalSolver: PHYSICAL, photography: RENDER },
    proofHashes: { ...bindings, renderProvenance: proof.sha256, renderFrames: render.sha256 },
  }
  stage = await fs.mkdtemp(path.join(INPUT, '.thinfilm-package-'))
  await Promise.all(['desktop', 'mobile'].map(directory => fs.mkdir(path.join(stage, directory))))
  const assets = []
  let finalSource
  sharp.concurrency(2)
  for (let index = 0; index < records.length; index++) {
    const record = records[index], filename = `${String(index).padStart(4, '0')}.png`
    const bytes = await fs.readFile(path.join(INPUT, 'frames', filename))
    if (sha(bytes) !== record.pngSha256) fail(`${filename} differs from its photographed per-frame PNG hash`)
    if (AI_CREDENTIAL.test(bytes.toString('latin1'))) fail(`${filename} carries a generative-AI content credential`)
    const image = await sharp(bytes, { failOn: 'error' }).metadata()
    if (image.format !== 'png' || image.hasAlpha !== true || image.width !== record.sourceWidth || image.height !== record.sourceHeight) fail(`${filename} lacks the exact recorded PNG dimensions and alpha channel`)
    for (const variant of [{ directory: 'desktop', width: 1920, height: 900 }, { directory: 'mobile', width: 768, height: 360 }]) {
      const buffer = await sharp(bytes).resize(variant.width, variant.height, { fit: 'inside' }).webp({ quality: 90, effort: 6 }).toBuffer()
      const dimensions = await sharp(buffer).metadata()
      if (dimensions.width !== variant.width || dimensions.height !== variant.height || dimensions.hasAlpha !== true) fail(`${filename} failed aspect-preserving alpha encoding`)
      const relative = `${variant.directory}/${String(index).padStart(4, '0')}.webp`
      await fs.writeFile(path.join(stage, relative), buffer)
      assets.push({ file: `art/plating/${relative}`, sha256: sha(buffer) })
    }
    if (index === records.length - 1) finalSource = bytes
    if ((index + 1) % 12 === 0 || index === records.length - 1) console.log(`Encoded ${index + 1}/${records.length} verified alpha photographs.`)
  }
  for (const width of [1280, 640, 1920]) {
    const name = `poster-${width}.webp`
    const buffer = await sharp(finalSource).resize(width, Math.round(width * 900 / 1920), { fit: 'inside' }).webp({ quality: 90, effort: 6 }).toBuffer()
    await fs.writeFile(path.join(stage, name), buffer)
    assets.push({ file: `art/plating/${name}`, sha256: sha(buffer) })
  }
  const manifest = { version: 1, pipeline: PIPELINE, frames: render.value, stations: STATION_FRAMES.map(frame => FRAMES.indexOf(frame)),
    desktop: { width: 1920, height: 900, directory: 'desktop' }, mobile: { width: 768, height: 360, directory: 'mobile' },
    poster: 'poster-1280.webp', provenance: { kind: 'authored-3d-render', pipeline: PIPELINE, renderer: 'Blender Cycles', blender,
      file: 'scene-provenance.json', proofHashes: provenance.proofHashes } }
  await fs.writeFile(path.join(stage, 'sequence.json'), JSON.stringify(manifest, null, 2) + '\n')
  await fs.writeFile(path.join(stage, 'scene-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  const current = await sourcesNow()
  if (sources.some((source, index) => source.sha256 !== current[index].sha256)) fail('A studio/solver/render source changed during packaging')
  const registry = { kind: 'authored-3d-render', pipeline: PIPELINE, sources, assets: assets.sort((a, b) => a.file.localeCompare(b.file)) }
  await fs.mkdir(path.dirname(DESTINATION), { recursive: true })
  if (await fs.stat(DESTINATION).then(() => true).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    backup = path.join(INPUT, `.previous-plating-${Date.now()}-${process.pid}`)
    await fs.rename(DESTINATION, backup)
  }
  await fs.rename(stage, DESTINATION); stage = null; installed = true
  temporaryRegistry = `${REGISTRY}.tmp-${process.pid}`
  await fs.writeFile(temporaryRegistry, JSON.stringify(registry, null, 2) + '\n')
  await fs.rename(temporaryRegistry, REGISTRY); temporaryRegistry = null; registryCommitted = true
  if (backup) { await fs.rm(backup, { recursive: true }).catch(error => console.warn(`Previous timeline retained at ${backup}: ${error.message}`)); backup = null }
  console.log(`Packaged ${records.length} actual conservative-film photographs, four native detents, two encodings and three alpha posters.`)
  console.log(`Finite volume: ${physics.initial.toFixed(9)} ml = ${physics.states.at(-1).filmVolumeMl.toFixed(9)} ml film + ${physics.states.at(-1).remainingReservoirMl.toFixed(9)} ml reservoir.`)
  console.log(`Sequence: ${path.join(DESTINATION, 'sequence.json')}`)
} catch (error) {
  if (!registryCommitted && backup) { await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {}); await fs.rename(backup, DESTINATION).catch(() => {}); backup = null }
  else if (!registryCommitted && installed) await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {})
  if (stage) await fs.rm(stage, { recursive: true }).catch(() => {})
  if (temporaryRegistry) await fs.rm(temporaryRegistry, { force: true }).catch(() => {})
  console.error(`Thin-film package rejected: ${error.message}`)
  process.exitCode = 1
}
