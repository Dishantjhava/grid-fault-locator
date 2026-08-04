/**
 * src/services/topology.ts
 *
 * In-memory radial tree construction module for electrical distribution transformers (DT).
 */

export type TopologySource = 'known' | 'inferred'

export interface PoleData {
  pole_id: string
  lat: number
  lon: number
  parent_pole_id: string | null
  seq_on_line: number | null
}

export interface DTData {
  dt_id: string
  lat: number
  lon: number
}

export interface TreeNode {
  pole_id: string
  lat: number
  lon: number
  parent_pole_id: string | null
  children: TreeNode[]
}

export interface DTPoleTree {
  dt_id: string
  topology_source: TopologySource
  root: TreeNode | null
  nodes: Map<string, TreeNode>
}

/**
 * Calculates Haversine distance in meters between two lat/lon coordinates.
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000 // Earth's mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Builds an in-memory tree of poles for a given DT.
 *
 * CASE A — KNOWN TOPOLOGY:
 * If poles have seq_on_line/parent_pole_id populated, we build the tree directly
 * using existing parent_pole_id relationships.
 *
 * CASE B — UNKNOWN / INFERRED TOPOLOGY (MST via Prim's Algorithm):
 * For undigitized DTs (~60% of network), parent_pole_id links are missing (null).
 * We infer a plausible radial tree by computing a Minimum Spanning Tree (MST)
 * rooted at the DT's lat/lon location using Haversine distance as edge weights.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REASONING FOR GEOGRAPHIC DISTANCE MST AS A PROXY:
 * 1. Physical Grid Reality: Power distribution lines are constructed by utilities
 *    to minimize total conductor length, pole count, and voltage drop across a ward.
 *    Wires are strung sequentially from pole to adjacent pole along road corridors.
 * 2. Euclidean / Haversine distance closely mirrors physical wire routing in dense
 *    radial distribution networks.
 *
 * KNOWN FAILURE MODES & LIMITATIONS OF GEOGRAPHIC MST:
 * 1. Parallel Lines / Double Circuits: If two separate feeders or branches run parallel
 *    down opposite sides of a road, MST can incorrectly create cross-street connections
 *    between parallel lines instead of following each line sequentially.
 * 2. Branch Spur Misplacement: A branch spur starting at a junction pole might be
 *    erroneously connected to a neighboring non-junction pole if it happens to be
 *    a few meters closer geographically.
 * 3. Physical Obstacles: Straight-line distance ignores physical terrain barriers
 *    (e.g., lakes, railway tracks, multi-story buildings) that force physical wires
 *    to take longer detour routes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function buildDTPoleTree(dt: DTData, poles: PoleData[]): DTPoleTree {
  if (poles.length === 0) {
    return {
      dt_id: dt.dt_id,
      topology_source: 'known',
      root: null,
      nodes: new Map(),
    }
  }

  // Check if topology is digitized (known) or undigitized (inferred)
  const isKnown = poles.some(
    (p) => p.parent_pole_id !== null || p.seq_on_line !== null
  )

  if (isKnown) {
    return buildKnownTree(dt, poles)
  } else {
    return buildInferredTreeMST(dt, poles)
  }
}

/**
 * Builds tree for digitized DTs using parent_pole_id links.
 */
function buildKnownTree(dt: DTData, poles: PoleData[]): DTPoleTree {
  const nodes = new Map<string, TreeNode>()

  // 1. Create all TreeNodes
  for (const p of poles) {
    nodes.set(p.pole_id, {
      pole_id: p.pole_id,
      lat: p.lat,
      lon: p.lon,
      parent_pole_id: p.parent_pole_id,
      children: [],
    })
  }

  let root: TreeNode | null = null

  // 2. Link parent -> children
  for (const node of nodes.values()) {
    if (node.parent_pole_id && nodes.has(node.parent_pole_id)) {
      const parentNode = nodes.get(node.parent_pole_id)!
      parentNode.children.push(node)
    } else {
      // Pole with no parent in this set is the root pole connected directly to DT
      if (!root) {
        root = node
      }
    }
  }

  // Fallback: If no pole had null parent_pole_id, pick the one closest to DT lat/lon as root
  if (!root && poles.length > 0) {
    let minDistance = Infinity
    for (const node of nodes.values()) {
      const dist = haversineMeters(dt.lat, dt.lon, node.lat, node.lon)
      if (dist < minDistance) {
        minDistance = dist
        root = node
      }
    }
  }

  return {
    dt_id: dt.dt_id,
    topology_source: 'known',
    root,
    nodes,
  }
}

/**
 * Builds inferred tree for undigitized DTs using Prim's Minimum Spanning Tree algorithm.
 */
function buildInferredTreeMST(dt: DTData, poles: PoleData[]): DTPoleTree {
  const nodes = new Map<string, TreeNode>()

  // Step 1: Find the pole closest to the DT location to serve as the root pole
  let rootPole: PoleData = poles[0]
  let minRootDist = Infinity

  for (const p of poles) {
    const dist = haversineMeters(dt.lat, dt.lon, p.lat, p.lon)
    if (dist < minRootDist) {
      minRootDist = dist
      rootPole = p
    }
  }

  // Create root node
  const rootNode: TreeNode = {
    pole_id: rootPole.pole_id,
    lat: rootPole.lat,
    lon: rootPole.lon,
    parent_pole_id: null,
    children: [],
  }
  nodes.set(rootNode.pole_id, rootNode)

  const visited = new Set<string>([rootNode.pole_id])
  const unvisited = new Set<string>(
    poles.map((p) => p.pole_id).filter((id) => id !== rootNode.pole_id)
  )

  const poleMap = new Map<string, PoleData>()
  for (const p of poles) {
    poleMap.set(p.pole_id, p)
  }

  // Step 2: Prim's algorithm to grow the tree greedily based on minimum Haversine distance
  while (unvisited.size > 0) {
    let bestParentId: string | null = null
    let bestChildId: string | null = null
    let minEdgeDist = Infinity

    for (const visitedId of visited) {
      const parentPole = poleMap.get(visitedId)!
      for (const unvisitedId of unvisited) {
        const childPole = poleMap.get(unvisitedId)!
        const dist = haversineMeters(
          parentPole.lat,
          parentPole.lon,
          childPole.lat,
          childPole.lon
        )
        if (dist < minEdgeDist) {
          minEdgeDist = dist
          bestParentId = visitedId
          bestChildId = unvisitedId
        }
      }
    }

    if (!bestParentId || !bestChildId) break

    const childPole = poleMap.get(bestChildId)!
    const parentNode = nodes.get(bestParentId)!

    const childNode: TreeNode = {
      pole_id: childPole.pole_id,
      lat: childPole.lat,
      lon: childPole.lon,
      parent_pole_id: bestParentId,
      children: [],
    }

    parentNode.children.push(childNode)
    nodes.set(bestChildId, childNode)
    visited.add(bestChildId)
    unvisited.delete(bestChildId)
  }

  return {
    dt_id: dt.dt_id,
    topology_source: 'inferred',
    root: rootNode,
    nodes,
  }
}
