// Package only a completed, evidenced Blender liquid render. This script never
// renders, bakes, or substitutes study artwork for a simulated frame sequence.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INPUT = path.resolve(ROOT, process.argv[2] || 'output/plating-timeline/blender-final')
const DESTINATION = path.join(ROOT, 'public/art/plating')
const REGISTRY = path.join(ROOT, 'content/art.source.json')
const BAKE_SOURCES = [
  'scripts/blender/create_plating_scene.py',
  'scripts/blender/plating_spoon.py',
  'scripts/blender/plating_fluid.py',
  'scripts/blender/plating_materials.py',
  'scripts/blender/plating_engraving.py',
  'scripts/blender/plating_reservoir.py',
  'scripts/blender/plating_external.py',
]
const RENDER_SOURCES = [
  'scripts/blender/render_plating_sequence.py',
  'scripts/blender/plating_surface.py',
]
const SOURCES = [...BAKE_SOURCES, ...RENDER_SOURCES]
const STATION_FRAMES = [24, 72, 120, 180]
const LEDGER_TOLERANCE_ML = 1e-6
const AI_CREDENTIAL = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }
const integerFrames = value => Array.isArray(value) && value.length > 0 && value.every((frame, index) => Number.isInteger(frame) && frame >= 1 && (!index || frame > value[index - 1]))

async function jsonFile(name) {
  const bytes = await fs.readFile(path.join(INPUT, name))
  return { bytes, value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }
}

async function sourceHashes() {
  return Promise.all(SOURCES.map(async source => ({ path: source, sha256: sha256(await fs.readFile(path.join(ROOT, source))) })))
}

function nearestIndex(frames, target) {
  return frames.reduce((best, frame, index) => Math.abs(frame - target) < Math.abs(frames[best] - target) ? index : best, 0)
}

function finiteNumber(value, name, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(`Invalid ${name} in bake provenance`)
  return value
}

function validateReservoir(plan, evidence, scene) {
  const provenance = plan?.provenance
  if (provenance?.full_moving_cup_CFD !== false) fail('Hybrid reservoir provenance must explicitly disclaim full moving-cup CFD')
  const initial = finiteNumber(provenance.initial_volume_ml, 'analytic initial reservoir volume', Number.MIN_VALUE)
  const fps = finiteNumber(provenance.fps, 'reservoir frame rate', 1)
  if (Math.abs(fps - Number(scene.fps)) > 1e-9) fail('The reservoir ledger and rendered scene use different frame rates')
  if (Math.abs(evidence.finite_initial_volume_ml - initial) > LEDGER_TOLERANCE_ML) fail('Bake evidence initial volume does not match its analytic reservoir reference')
  if (scene.frame_end !== 180 || evidence.frame_start !== 1 || evidence.frame_end !== 180) fail('The hybrid production sequence requires the complete 180-frame simulation interval')
  const states = plan.states
  if (!Array.isArray(states) || states.length !== 180 || states.some((state, index) => state?.frame !== index + 1)) fail('The reservoir plan must contain every frame from 1 through 180 exactly once')
  let previousVolume = initial, previousEmitted = 0, summedEmission = 0, maximumError = 0
  for (const state of states) {
    const volume = finiteNumber(state.volume_ml, `frame ${state.frame} remaining analytic volume`)
    const emitted = finiteNumber(state.emitted_total_ml, `frame ${state.frame} cumulative planned discharge`)
    const interval = finiteNumber(state.emitted_since_previous_frame_ml, `frame ${state.frame} planned interval discharge`)
    const flow = finiteNumber(state.flow_ml_s, `frame ${state.frame} planned mean flow`)
    if (state.frame === 1 && (Math.abs(volume - initial) > LEDGER_TOLERANCE_ML || emitted > LEDGER_TOLERANCE_ML || interval > LEDGER_TOLERANCE_ML || flow > LEDGER_TOLERANCE_ML)) fail('The first analytic state must contain the declared initial volume before any emission')
    finiteNumber(state.head_m, `frame ${state.frame} hydraulic head`)
    if (typeof state.level_world_z !== 'number' || !Number.isFinite(state.level_world_z)) fail(`Frame ${state.frame} has an invalid analytic free-surface level`)
    summedEmission += interval
    const errors = [Math.abs(volume + emitted - initial), Math.abs(emitted - summedEmission),
      Math.abs(previousVolume - volume - interval), Math.abs(emitted - previousEmitted - interval),
      Math.abs(flow / fps - interval)]
    maximumError = Math.max(maximumError, ...errors)
    if (volume > initial + LEDGER_TOLERANCE_ML || volume > previousVolume + LEDGER_TOLERANCE_ML || emitted < previousEmitted - LEDGER_TOLERANCE_ML || maximumError > LEDGER_TOLERANCE_ML) fail(`Frame ${state.frame} does not satisfy the finite analytic reservoir ledger`)
    previousVolume = volume
    previousEmitted = emitted
  }
  const remaining = finiteNumber(provenance.remaining_volume_ml, 'final analytic reservoir volume')
  const emitted = finiteNumber(provenance.emitted_volume_ml, 'total planned discharge')
  const recordedError = finiteNumber(provenance.maximum_mass_balance_error_ml, 'recorded analytic ledger error')
  if (recordedError > LEDGER_TOLERANCE_ML || Math.abs(remaining - previousVolume) > LEDGER_TOLERANCE_ML || Math.abs(emitted - previousEmitted) > LEDGER_TOLERANCE_ML || Math.abs(remaining + emitted - initial) > LEDGER_TOLERANCE_ML) fail('Reservoir summary does not match its complete analytic ledger')
  const simulation = scene.simulation
  if (simulation?.source_mechanism !== 'hybrid_reservoir_driven_INFLOW' || simulation.full_moving_cup_CFD !== false || simulation.external_jet_and_plate_CFD !== true) fail('Hybrid production must establish its actual external INFLOW solver and separate analytic reservoir')
  if (simulation.initial_volume_is_reservoir_reference_only !== true || simulation.actual_emitted_volume_calibrated !== false || simulation.exact_CFD_mass_conservation_claimed !== false) fail('External solver provenance must distinguish the analytic reference from uncalibrated CFD emission')
  return { initial, remaining, emitted, maximumError: Math.max(maximumError, recordedError), fps, states,
    viscosity: finiteNumber(provenance.kinematic_viscosity_m2_s, 'analytic reservoir viscosity', Number.MIN_VALUE) }
}

function sampleBounds(sample) {
  const bounds = sample.bounds_world_m
  if (!bounds || !['min', 'max'].every(key => Array.isArray(bounds[key]) && bounds[key].length === 3 && bounds[key].every(Number.isFinite))) fail(`Frame ${sample.frame} lacks actual liquid geometry bounds`)
  const dimensions = bounds.max.map((value, index) => value - bounds.min[index])
  if (dimensions.some(value => value <= 0)) fail(`Frame ${sample.frame} has degenerate liquid bounds`)
  return dimensions
}

function rejectDomainCube(sample, scene) {
  if (sample.vertices <= 8 && sample.faces <= 12) fail(`Frame ${sample.frame} resembles the unbaked domain cube, not a liquid surface`)
  const dimensions = sampleBounds(sample)
  const simulation = scene.simulation
  const minimum = simulation?.domain_min_m, maximum = simulation?.domain_max_m
  if (Array.isArray(minimum) && Array.isArray(maximum) && minimum.length === 3 && maximum.length === 3 && [...minimum, ...maximum].every(Number.isFinite)) {
    const domainDimensions = maximum.map((value, index) => value - minimum[index])
    const domainVolumeMl = domainDimensions.reduce((value, dimension) => value * dimension, 1) * 1e6
    if (domainDimensions.every(value => value > 0) && dimensions.every((value, index) => value >= domainDimensions[index] * .95) && sample.volume_ml >= domainVolumeMl * .9) fail(`Frame ${sample.frame} occupies the domain box; refuse an unbaked-domain render`)
  }
}

async function validateCacheOnDisk(evidence) {
  const directory = path.resolve(evidence.cache_directory || path.join(INPUT, 'cache'))
  for (const category of ['data', 'mesh']) {
    const found = { frames: new Set(), count: 0, bytes: 0 }
    async function visit(folder) {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) await visit(file)
        else if (entry.isFile()) {
          const stat = await fs.stat(file)
          if (stat.size <= 0) fail(`Empty actual ${category} cache file: ${entry.name}`)
          found.count++
          found.bytes += stat.size
          const frame = entry.name.match(/_(\d{4,})(?=\.)/)
          if (frame) found.frames.add(Number(frame[1]))
        }
      }
    }
    await visit(path.join(directory, category))
    const recorded = evidence.cache[category]
    if (found.count !== recorded.count || found.bytes !== recorded.bytes) fail(`Actual ${category} cache changed or disappeared after the bake evidence was recorded`)
    for (let frame = evidence.frame_start; frame <= evidence.frame_end; frame++) if (!found.frames.has(frame)) fail(`Actual ${category} cache is missing frame ${frame}; JSON flags cannot substitute for files`)
  }
}

function validateProof(frames, evidence, provenance, reservoir) {
  if (provenance.study_only === true || /diagnostic|lighting study/i.test(String(provenance.method || ''))) fail('Diagnostic or lighting-study images cannot be packaged as production simulation')
  if (provenance.simulation?.source_mechanism === 'hybrid_reservoir_driven_INFLOW' && !reservoir) fail('External INFLOW production requires its explicit hybrid flag and analytic reservoir ledger')
  if (!integerFrames(frames)) fail('render-frames.json must be an increasing array of actual positive simulation frame numbers')
  if (frames[0] > STATION_FRAMES[0] || frames.at(-1) < STATION_FRAMES.at(-1)) fail('Rendered frames must cover all four settled moments from frame 24 through frame 180')
  if (evidence.has_cache_baked_data !== true || evidence.has_cache_baked_mesh !== true) fail('Packaging requires actual baked liquid data AND mesh flags; study renders are not accepted')
  if (evidence.complete_cache_frame_coverage !== true) fail('The bake evidence does not establish complete data-and-mesh frame coverage')
  if (evidence.use_diffusion !== true || evidence.use_high_viscosity_solver !== false) fail('The evidence does not match the authored Diffusion viscosity path')
  if (!['Mantaflow APIC', 'Mantaflow FLIP'].includes(evidence.solver)) fail('Bake evidence must name the actual Mantaflow liquid solver')
  finiteNumber(evidence.finite_initial_volume_ml, 'finite initial liquid volume', Number.MIN_VALUE)
  finiteNumber(evidence.kinematic_viscosity_m2_s, 'kinematic viscosity', Number.MIN_VALUE)
  if (!Number.isInteger(evidence.frame_start) || evidence.frame_start < 1 || !Number.isInteger(evidence.frame_end) || evidence.frame_end < frames.at(-1)) fail('Bake evidence has an invalid or insufficient frame interval')
  const expectedCacheFrames = Array.from({ length: evidence.frame_end - evidence.frame_start + 1 }, (_, index) => evidence.frame_start + index)
  for (const category of ['data', 'mesh']) {
    const cache = evidence.cache?.[category]
    if (!cache || !Number.isInteger(cache.count) || cache.count < expectedCacheFrames.length || !integerFrames(cache.frames)) fail(`Missing actual ${category} cache-file counts and frame numbers`)
    const cached = new Set(cache.frames)
    if (expectedCacheFrames.some(frame => !cached.has(frame))) fail(`The ${category} cache does not cover every configured simulation frame`)
    if (frames.some(frame => !cached.has(frame))) fail(`Rendered frames include a frame absent from the baked ${category} cache`)
  }
  const stations = STATION_FRAMES.map(frame => nearestIndex(frames, frame))
  if (new Set(stations).size !== 4) fail('The four settled moments cannot resolve to duplicate rendered frames')
  for (const index of stations) {
    const frame = frames[index]
    const sample = evidence.geometry_samples?.find(item => item.frame === frame)
    if (!sample || !Number.isInteger(sample.vertices) || sample.vertices <= 0 || !Number.isInteger(sample.faces) || sample.faces <= 0 || !Number.isFinite(sample.volume_ml) || sample.volume_ml <= 0) fail(`Frame ${frame} lacks evaluated, positive-volume baked liquid geometry evidence`)
    if (sample.nonmanifold_edges !== 0) fail(`Frame ${frame} does not have closed simulated geometry for a reliable volume measurement`)
    rejectDomainCube(sample, provenance)
    if (!reservoir && sample.volume_ml > evidence.finite_initial_volume_ml * 2) fail(`Frame ${frame} contains more than twice the finite initial liquid volume; verify that the evidence is measuring the baked liquid surface`)
  }
  if (provenance.units !== 'meters') fail('Scene provenance must establish metre-based physical units')
  if (Number(provenance.frame_end) < frames.at(-1)) fail('Rendered frames extend beyond the scene provenance frame interval')
  return stations
}

function positiveClosedGeometry(value, frame, label) {
  if (!value || !Number.isInteger(value.vertices) || value.vertices <= 8 || !Number.isInteger(value.faces) || value.faces <= 12 || value.nonmanifold_edges !== 0) fail(`Frame ${frame} lacks closed ${label} liquid geometry`)
  return finiteNumber(value.volume_ml, `frame ${frame} ${label} liquid volume`, Number.MIN_VALUE)
}

function nativeSimulationVoxel(scene) {
  const simulation = scene.simulation
  const minimum = simulation?.domain_min_m, maximum = simulation?.domain_max_m
  if (!Array.isArray(minimum) || !Array.isArray(maximum) || minimum.length !== 3 || maximum.length !== 3 || ![...minimum, ...maximum].every(Number.isFinite)) fail('Native CFD voxel bounds are missing from the frozen scene provenance')
  const dimensions = maximum.map((value, index) => value - minimum[index])
  const resolution = finiteNumber(scene.resolution, 'native CFD resolution', 32)
  if (!Number.isInteger(resolution) || dimensions.some(value => value <= 0)) fail('Invalid frozen CFD grid dimensions or resolution')
  const derived = Math.max(...dimensions) / resolution
  const recorded = finiteNumber(simulation.voxel_size_m, 'recorded native CFD voxel size', Number.MIN_VALUE)
  if (Math.abs(recorded - derived) > Math.max(1e-12, derived * 1e-7)) fail('Recorded native voxel size differs from the frozen CFD bounds and resolution')
  return derived
}

function validateRenderSurface(proof, frames, evidence, sceneProof, bakeProof, sources, reservoir) {
  if (proof?.kind !== 'baked-hybrid-liquid-with-render-surface-reconstruction' || proof.diagnostic_only !== false || proof.fluid_cache_modified !== false) fail('Production render proof must establish non-diagnostic reconstruction of a read-only hybrid fluid cache')
  if (!reservoir) fail('The reconstructed hybrid render must retain its complete analytic reservoir ledger')
  if (proof.scene_provenance_sha256 !== sceneProof.sha256 || proof.bake_evidence_sha256 !== bakeProof.sha256) fail('Render proof does not match the exact scene and bake evidence being packaged')
  const hashes = proof.source_hashes
  if (!hashes || typeof hashes !== 'object' || Object.keys(hashes).length !== RENDER_SOURCES.length) fail('Render proof must hash both independent post-render source files')
  for (const source of sources.filter(item => RENDER_SOURCES.includes(item.path))) if (hashes[source.path] !== source.sha256) fail(`${source.path} differs from the recorded render source; render again before packaging`)
  if (!Array.isArray(proof.frames) || proof.frames.length !== frames.length || proof.frames.some((record, index) => record?.frame !== frames[index])) fail('Render proof must match render-frames.json exactly, in order, without missing or extra frames')
  const material = proof.material_overrides
  if (!material || finiteNumber(material.roughness, 'render roughness') > 1) fail('Invalid recorded render material roughness')
  finiteNumber(material.absorption_multiplier, 'render absorption multiplier', Number.MIN_VALUE)
  finiteNumber(material.emulsion_scatter_per_m, 'render emulsion scattering')
  if (finiteNumber(material.roughness_variation, 'render roughness variation') > 1) fail('Invalid recorded render roughness variation')
  finiteNumber(proof.samples, 'render samples', 1)
  const nativeVoxel = nativeSimulationVoxel(sceneProof.value)
  const records = []
  for (const record of proof.frames) {
    const frame = record.frame
    const nativeVolume = positiveClosedGeometry(record.native, frame, 'native cached')
    const renderVolume = positiveClosedGeometry(record.render_surface, frame, 'reconstructed render')
    const relativeVolumeError = renderVolume / nativeVolume - 1
    if (Math.abs(relativeVolumeError) > .05 + 1e-9) fail(`Frame ${frame} render reconstruction changes native liquid volume by more than 5%`)
    const surface = record.surface_reconstruction
    if (surface?.accepted !== true || surface.render_only !== true || surface.fluid_cache_modified !== false || surface.authored_trail !== false || surface.no_authored_outline !== true || surface.source !== 'independently copied native CFD geometry') fail(`Frame ${frame} does not establish accepted native-derived, render-only surfacing; raw rejected frames are not permitted`)
    if (surface.method !== 'native-CFD settled-plate height-field surface reconstruction' || surface.non_manifold_edges !== 0) fail(`Frame ${frame} has an unknown or unclosed reconstruction method`)
    const closing = finiteNumber(surface.closing_radius_m ?? surface.close_radius_m, `frame ${frame} reconstruction closing radius`)
    if (closing > nativeVoxel * 2 + 1e-12) fail(`Frame ${frame} reconstruction closing exceeds two native CFD voxels`)
    finiteNumber(surface.voxel_m, `frame ${frame} reconstruction voxel size`, Number.MIN_VALUE)
    const heightBlur = finiteNumber(surface.blur_sigma_m, `frame ${frame} reconstruction height blur`)
    const edgeBlur = finiteNumber(surface.edge_sigma_m, `frame ${frame} reconstruction edge blur`)
    if (heightBlur > nativeVoxel * 2 + 1e-12 || edgeBlur > nativeVoxel + 1e-12) fail(`Frame ${frame} reconstruction exceeds its native-grid height/edge filtering limits`)
    const normalization = finiteNumber(surface.thickness_normalization_factor, `frame ${frame} reconstruction thickness normalization`, Number.MIN_VALUE)
    if (normalization < .5 || normalization > 2) fail(`Frame ${frame} reconstruction needs excessive thickness normalization`)
    if (typeof surface.relative_volume_error !== 'number' || !Number.isFinite(surface.relative_volume_error) || Math.abs(surface.relative_volume_error) > .05 + 1e-9) fail(`Frame ${frame} has invalid reconstruction volume evidence`)
    for (const [name, reference] of [['native_volume_m3', nativeVolume], ['reconstructed_volume_m3', renderVolume]]) {
      const measured = finiteNumber(surface[name], `frame ${frame} ${name}`, Number.MIN_VALUE) * 1e6
      if (Math.abs(measured - reference) > Math.max(1e-8, reference * 1e-4)) fail(`Frame ${frame} ${name} differs from its independently measured mesh`)
    }
    if (typeof surface.overhang_filling_fraction !== 'number' || !Number.isFinite(surface.overhang_filling_fraction) || surface.overhang_filling_fraction > .05 + 1e-9) fail(`Frame ${frame} reconstruction exceeds the 5% overhang-fill limit`)
    const baked = evidence.geometry_samples?.find(sample => sample.frame === frame)
    if (baked && (baked.vertices !== record.native.vertices || baked.faces !== record.native.faces || Math.abs(baked.volume_ml - nativeVolume) > Math.max(1e-8, nativeVolume * 1e-5))) fail(`Frame ${frame} native render mesh differs from the recorded baked geometry`)
    const planned = reservoir.states[frame - 1]
    const renderedReservoir = record.reservoir
    if (!renderedReservoir || renderedReservoir.frame !== frame || Math.abs(finiteNumber(renderedReservoir.target_volume_ml, `frame ${frame} visible reservoir target`) - planned.volume_ml) > LEDGER_TOLERANCE_ML) fail(`Frame ${frame} rendered reservoir does not match the analytic ledger`)
    const reservoirVolume = finiteNumber(renderedReservoir.mesh_volume_ml, `frame ${frame} visible reservoir mesh volume`)
    if (Math.abs(reservoirVolume - planned.volume_ml) > Math.max(1e-6, planned.volume_ml * .003)) fail(`Frame ${frame} visible reservoir mesh exceeds its analytic volume tolerance`)
    records.push({ frame, nativeVolumeMl: nativeVolume, renderVolumeMl: renderVolume, relativeVolumeError,
      vertices: record.render_surface.vertices, faces: record.render_surface.faces,
      samplingVoxelM: surface.voxel_m, closingRadiusM: closing,
      heightBlurSigmaM: heightBlur, edgeBlurSigmaM: edgeBlur,
      closingRadiusInNativeVoxels: closing / nativeVoxel,
      heightBlurSigmaInNativeVoxels: heightBlur / nativeVoxel,
      edgeBlurSigmaInNativeVoxels: edgeBlur / nativeVoxel,
      thicknessNormalizationFactor: normalization, overhangFillingFraction: surface.overhang_filling_fraction,
      nativeMaximumHeightM: finiteNumber(surface.maximum_height_m, `frame ${frame} native maximum height`),
      reconstructedMaximumHeightM: finiteNumber(surface.maximum_reconstructed_height_m, `frame ${frame} reconstructed maximum height`),
      removedSurfaceIslands: Number.isInteger(surface.islands?.removed_islands) ? surface.islands.removed_islands : null,
      visibleReservoirVolumeMl: reservoirVolume,
    })
  }
  return { records, nativeVoxel, samples: proof.samples, material: {
    roughness: material.roughness, absorptionMultiplier: material.absorption_multiplier,
    emulsionScatterPerM: material.emulsion_scatter_per_m,
    roughnessVariation: material.roughness_variation,
  } }
}

function publicProvenance(scene, evidence, proofs, sources, reservoir, renderSurface) {
  // Deliberately select public fields. Cache directories, user paths, machine
  // names, .blend locations, and arbitrary free-form strings are not copied.
  const blender = String(scene.blender || evidence.blender || '').match(/^\d+\.\d+(?:\.\d+)?(?:\s+LTS)?/)?.[0]
  if (!blender) fail('Scene provenance is missing a Blender version')
  return {
    kind: 'authored-3d-render',
    renderer: 'Blender Cycles',
    blender,
    solver: evidence.solver,
    hybrid: Boolean(reservoir),
    units: 'meters',
    fps: finiteNumber(Number(scene.fps), 'frame rate', 1),
    resolution: finiteNumber(Number(scene.resolution), 'simulation resolution', 32),
    frameEnd: finiteNumber(Number(scene.frame_end), 'last simulation frame', 180),
    finiteInitialVolumeMl: evidence.finite_initial_volume_ml,
    initialVolumeScope: reservoir ? 'Analytic reservoir reference only; actual external CFD emission is uncalibrated' : 'Finite initial simulated liquid',
    gravityMS2: 9.81,
    renderSurface: {
      method: 'Native-CFD settled-plate height-field reconstruction on independent render copies',
      fluidCacheModified: false,
      authoredOutline: false,
      nativeContoursUnchanged: false,
      contourTreatment: 'Native-derived contours are morphologically closed and filtered; they are not preserved unchanged or replaced by an authored outline',
      nativeCfdVoxelM: renderSurface.nativeVoxel,
      filterLimits: { closingRadiusInNativeVoxels: 2, heightBlurSigmaInNativeVoxels: 2, edgeBlurSigmaInNativeVoxels: 1 },
      acceptedFrames: renderSurface.records.length,
      maximumAllowedRelativeVolumeChange: .05,
      geometricVolumeReference: 'Native cached surface geometry; not independent CFD mass or emitted-volume calibration',
      renderSamples: renderSurface.samples,
      materialOverrides: renderSurface.material,
      frames: renderSurface.records,
    },
    physics: {
      bakedData: true,
      bakedMesh: true,
      completeCacheFrameCoverage: true,
      kinematicViscosityM2S: evidence.kinematic_viscosity_m2_s,
      surfaceTensionGridUnits: finiteNumber(evidence.surface_tension_grid_units, 'grid surface tension'),
      highViscositySolver: false,
      dataCacheFiles: evidence.cache.data.count,
      meshCacheFiles: evidence.cache.mesh.count,
      dataCacheBytes: evidence.cache.data.bytes,
      meshCacheBytes: evidence.cache.mesh.bytes,
      ...(reservoir ? {
        coupling: 'one-way approximate reservoir-to-external-solver',
        fullMovingCupCfd: false,
        externallyEmittedVolumeCalibrated: false,
        externalCfdMassConservationClaimed: false,
        analyticReservoirLedgerMassBalanced: true,
        volumeComparisonScope: 'Measured external liquid surface versus planned analytic discharge; this ratio does not establish injected-volume calibration',
        reservoirLedger: {
          method: 'Quasi-static hydrostatic reservoir with prescribed viscous-film/weir discharge',
          initialVolumeMl: reservoir.initial,
          remainingVolumeMl: reservoir.remaining,
          plannedEmittedVolumeMl: reservoir.emitted,
          maximumMassBalanceErrorMl: reservoir.maximumError,
          massConservationScope: 'Analytic reservoir ledger only',
          kinematicViscosityM2S: reservoir.viscosity,
          states: reservoir.states.map(state => ({
            frame: state.frame, remainingVolumeMl: state.volume_ml,
            plannedEmittedTotalMl: state.emitted_total_ml,
            plannedIntervalEmissionMl: state.emitted_since_previous_frame_ml,
            plannedMeanFlowMlS: state.flow_ml_s,
          })),
        },
      } : {}),
      settledGeometry: STATION_FRAMES.map(target => {
        const frame = proofs.frames[nearestIndex(proofs.frames, target)]
        const sample = evidence.geometry_samples.find(item => item.frame === frame)
        const planned = reservoir?.states[frame - 1]
        return { frame, volumeMl: sample.volume_ml, vertices: sample.vertices, faces: sample.faces, nonmanifoldEdges: 0, surfaceIslands: Number.isInteger(sample.surface_islands) ? sample.surface_islands : null,
          ...(planned ? {
            measuredExternalSolverVolumeMl: sample.volume_ml,
            analyticReservoirVolumeMl: planned.volume_ml,
            plannedCumulativeDischargeMl: planned.emitted_total_ml,
            measuredToPlannedDischargeRatio: planned.emitted_total_ml > 0 ? sample.volume_ml / planned.emitted_total_ml : null,
          } : {}),
        }
      }),
    },
    sources,
    sourceStages: { bakedScene: BAKE_SOURCES, renderReconstruction: RENDER_SOURCES },
    proofHashes: {
      sceneProvenance: proofs.scene.sha256,
      bakeEvidence: proofs.bake.sha256,
      renderFrames: proofs.render.sha256,
      renderProvenance: proofs.renderSurface.sha256,
      ...(proofs.reservoir ? { reservoirPlan: proofs.reservoir.sha256 } : {}),
    },
  }
}

let stage, backup, temporaryRegistry, installed = false, registryCommitted = false
try {
  const [render, bake, scene, renderSurfaceProof, sources] = await Promise.all([
    jsonFile('render-frames.json'), jsonFile('bake-evidence.json'), jsonFile('scene-provenance.json'),
    jsonFile('render-provenance.json'), sourceHashes(),
  ])
  const frames = render.value
  const reservoirProof = scene.value.hybrid === true ? await jsonFile('reservoir-plan.json') : null
  const reservoir = reservoirProof ? validateReservoir(reservoirProof.value, bake.value, scene.value) : null
  const stations = validateProof(frames, bake.value, scene.value, reservoir)
  await validateCacheOnDisk(bake.value)
  if (reservoir && (!scene.value.source_hashes || typeof scene.value.source_hashes !== 'object')) fail('Hybrid scene provenance must record source hashes at build time')
  if (scene.value.source_hashes) {
    for (const source of sources.filter(item => BAKE_SOURCES.includes(item.path))) {
      if (scene.value.source_hashes[source.path] !== source.sha256) fail(`${source.path} differs from the source recorded when this scene was built; rebuild/render before packaging`)
    }
  }
  const renderSurface = validateRenderSurface(renderSurfaceProof.value, frames, bake.value, scene, bake, sources, reservoir)
  const previousRegistry = await fs.readFile(REGISTRY, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (previousRegistry) {
    const previous = JSON.parse(previousRegistry)
    if ((previous.assets || []).some(asset => !String(asset.file).startsWith('art/plating/'))) fail('content/art.source.json contains artwork outside this timeline; preserve and merge that registry before packaging')
  }
  const sceneTime = (await fs.stat(path.join(INPUT, 'scene-provenance.json'))).mtimeMs
  const provenance = publicProvenance(scene.value, bake.value, { frames, scene, bake, render, reservoir: reservoirProof, renderSurface: renderSurfaceProof }, sources, reservoir, renderSurface)
  stage = await fs.mkdtemp(path.join(INPUT, '.plating-package-'))
  await Promise.all(['desktop', 'mobile'].map(directory => fs.mkdir(path.join(stage, directory))))
  const assets = []
  let originalSize
  let finalSource
  sharp.concurrency(2)
  for (let index = 0; index < frames.length; index++) {
    const filename = `${String(index).padStart(4, '0')}.png`
    const inputFile = path.join(INPUT, 'frames', filename)
    const [bytes, stat] = await Promise.all([fs.readFile(inputFile), fs.stat(inputFile)])
    if (AI_CREDENTIAL.test(bytes.toString('latin1'))) fail(`${filename} carries a generative-AI content credential; it cannot be registered as authored Blender art`)
    if (stat.mtimeMs + 1000 < sceneTime) fail(`${filename} predates this scene's provenance; render fresh frames instead of reusing stale output`)
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) fail(`${filename} is not a valid PNG render`)
    if (metadata.width < 1920 || metadata.height < 900 || Math.abs(metadata.width / metadata.height - 1920 / 900) > 1e-6) fail(`${filename} is ${metadata.width}×${metadata.height}; expected the 1920×900 composition (32:15), without upscaling or stretching`)
    if (!originalSize) originalSize = [metadata.width, metadata.height]
    if (metadata.width !== originalSize[0] || metadata.height !== originalSize[1]) fail(`${filename} has different dimensions from the rest of the rendered sequence`)
    await Promise.all([
      { directory: 'desktop', width: 1920, height: 900 },
      { directory: 'mobile', width: 768, height: 360 },
    ].map(async variant => {
      const buffer = await sharp(bytes).resize(variant.width, variant.height, { fit: 'inside' }).webp({ quality: 90, effort: 6 }).toBuffer()
      const dimensions = await sharp(buffer).metadata()
      if (dimensions.width !== variant.width || dimensions.height !== variant.height) fail(`${filename} could not be resized to the approved ${variant.width}×${variant.height} composition`)
      const relative = `${variant.directory}/${String(index).padStart(4, '0')}.webp`
      await fs.writeFile(path.join(stage, relative), buffer)
      assets.push({ file: `art/plating/${relative}`, sha256: sha256(buffer) })
    }))
    if (index === frames.length - 1) finalSource = bytes
  }
  for (const width of [1280, 640, 1920]) {
    const filename = `poster-${width}.webp`
    const buffer = await sharp(finalSource).resize(width, Math.round(width * 900 / 1920), { fit: 'inside' }).webp({ quality: 90, effort: 6 }).toBuffer()
    await fs.writeFile(path.join(stage, filename), buffer)
    assets.push({ file: `art/plating/${filename}`, sha256: sha256(buffer) })
  }
  const manifest = {
    version: 1,
    frames,
    stations,
    desktop: { width: 1920, height: 900, directory: 'desktop' },
    mobile: { width: 768, height: 360, directory: 'mobile' },
    poster: 'poster-1280.webp',
    provenance: { kind: provenance.kind, renderer: provenance.renderer, blender: provenance.blender, solver: provenance.solver, hybrid: provenance.hybrid, renderSurfaceReconstruction: true, file: 'scene-provenance.json', proofHashes: provenance.proofHashes },
  }
  await fs.writeFile(path.join(stage, 'sequence.json'), JSON.stringify(manifest, null, 2) + '\n')
  await fs.writeFile(path.join(stage, 'scene-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  const currentSources = await sourceHashes()
  if (sources.some((source, index) => currentSources[index].sha256 !== source.sha256)) fail('Blender source changed during packaging; finish source changes and package again')
  const registry = { kind: 'authored-3d-render', sources, assets: assets.sort((a, b) => a.file.localeCompare(b.file)) }
  await fs.mkdir(path.dirname(DESTINATION), { recursive: true })
  if (await fs.stat(DESTINATION).then(() => true).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    backup = path.join(INPUT, `.previous-plating-${Date.now()}-${process.pid}`)
    await fs.rename(DESTINATION, backup)
  }
  await fs.rename(stage, DESTINATION)
  stage = null
  installed = true
  temporaryRegistry = `${REGISTRY}.tmp-${process.pid}`
  await fs.writeFile(temporaryRegistry, JSON.stringify(registry, null, 2) + '\n')
  await fs.rename(temporaryRegistry, REGISTRY)
  temporaryRegistry = null
  registryCommitted = true
  if (backup) {
    await fs.rm(backup, { recursive: true }).catch(error => console.warn(`Previous packaged output retained at ${backup}: ${error.message}`))
    backup = null
  }
  console.log(`Packaged ${frames.length} actual ${reservoir ? 'hybrid external-solver' : 'simulated'} frames at 1920×900 and 768×360, four settled stations, and three final-source posters.`)
  console.log(`Accepted native-derived render reconstruction for ${renderSurface.records.length} frames; maximum geometric-volume change ${(Math.max(...renderSurface.records.map(record => Math.abs(record.relativeVolumeError))) * 100).toFixed(6)}%. Fluid cache unchanged.`)
  if (reservoir) {
    console.log(`Analytic reservoir: ${reservoir.initial.toFixed(6)} ml initial = ${reservoir.remaining.toFixed(6)} ml remaining + ${reservoir.emitted.toFixed(6)} ml planned discharge.`)
    console.log('External CFD emission is uncalibrated; measured plate volume is reported separately from the analytic ledger.')
    for (const sample of provenance.physics.settledGeometry) console.log(`Frame ${sample.frame}: measured external surface ${sample.measuredExternalSolverVolumeMl.toFixed(6)} ml; planned discharge ${sample.plannedCumulativeDischargeMl.toFixed(6)} ml; reservoir ${sample.analyticReservoirVolumeMl.toFixed(6)} ml.`)
  }
  console.log(`Sequence: ${path.join(DESTINATION, 'sequence.json')}`)
  console.log(`Authored-art registry: ${REGISTRY}`)
} catch (error) {
  // Only remove this invocation's staged/generated files. Restore the previous
  // public sequence if installation failed before the registry was committed.
  if (!registryCommitted && backup) {
    await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {})
    await fs.rename(backup, DESTINATION).catch(() => {})
    backup = null
  } else if (!registryCommitted && installed) {
    await fs.rm(DESTINATION, { recursive: true, force: true }).catch(() => {})
  }
  if (stage) await fs.rm(stage, { recursive: true }).catch(() => {})
  if (temporaryRegistry) await fs.rm(temporaryRegistry, { force: true }).catch(() => {})
  console.error(`Plating package rejected: ${error.message}`)
  process.exitCode = 1
}
