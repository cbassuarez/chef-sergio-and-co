/** Shared continuous-scroll tuning and the visual sequence's diagnostic shape. */
export type DepthGateSnapshot = {
  phase: 'idle' | 'resisting' | 'transitioning' | 'settled'
  pressure: number
  threshold: number
  progress: number
  target: 0 | 1
  direction: -1 | 0 | 1
  commits: number
  reversals: number
  start: number
  end: number
  nativeY: number
  pendingEnergy: number
  velocity: number
  isAnimating: boolean
}

export const DEPTH_GATE = {
  stiffness: 320,
  damping: 36,
  maxPixelVelocity: 1150,
  maxWheelLag: 200,
  maxCoastLag: 96,
  coastDecayMs: 170,
  boundaryBrake: .14,
  boundarySpan: 90,
} as const
