import { describe, it, expect } from 'vitest'
import {
  buildDTPoleTree,
  DTData,
  PoleData,
  haversineMeters,
} from '../src/services/topology.js'

describe('Topology Construction (Phase 3a)', () => {
  it('should calculate Haversine distance correctly in meters', () => {
    // Distance between Bengaluru Vidhana Soudha & MG Road (~1.79 km)
    const dist = haversineMeters(12.9796, 77.5906, 12.9756, 77.6066)
    expect(dist).toBeGreaterThan(1700)
    expect(dist).toBeLessThan(2200)
  })

  it('Case A — Known Topology: should build tree from parent_pole_id links', () => {
    const dt: DTData = {
      dt_id: 'DT-001',
      lat: 12.97,
      lon: 77.59,
    }

    // 6 poles in a line with 1 branch spur at Pole 3
    const poles: PoleData[] = [
      {
        pole_id: 'POLE-1',
        lat: 12.9702,
        lon: 77.59,
        parent_pole_id: null,
        seq_on_line: 0,
      },
      {
        pole_id: 'POLE-2',
        lat: 12.9705,
        lon: 77.59,
        parent_pole_id: 'POLE-1',
        seq_on_line: 1,
      },
      {
        pole_id: 'POLE-3',
        lat: 12.9708,
        lon: 77.59,
        parent_pole_id: 'POLE-2',
        seq_on_line: 2,
      },
      {
        pole_id: 'POLE-4',
        lat: 12.9711,
        lon: 77.59,
        parent_pole_id: 'POLE-3',
        seq_on_line: 3,
      },
      {
        pole_id: 'POLE-5',
        lat: 12.9714,
        lon: 77.59,
        parent_pole_id: 'POLE-4',
        seq_on_line: 4,
      },
      {
        pole_id: 'POLE-6',
        lat: 12.9708,
        lon: 77.5903,
        parent_pole_id: 'POLE-3',
        seq_on_line: 5,
      },
    ]

    const tree = buildDTPoleTree(dt, poles)

    expect(tree.topology_source).toBe('known')
    expect(tree.dt_id).toBe('DT-001')
    expect(tree.root).not.toBeNull()
    expect(tree.root?.pole_id).toBe('POLE-1')
    expect(tree.nodes.size).toBe(6)

    // Verify Pole 3 has 2 children (Pole 4 trunk and Pole 6 branch spur)
    const pole3Node = tree.nodes.get('POLE-3')
    expect(pole3Node).toBeDefined()
    expect(pole3Node?.children.length).toBe(2)
    const childIds = pole3Node?.children.map((c) => c.pole_id).sort()
    expect(childIds).toEqual(['POLE-4', 'POLE-6'])
  })

  it('Case B — Inferred Topology: should build tree via Minimum Spanning Tree (MST)', () => {
    const dt: DTData = {
      dt_id: 'DT-002',
      lat: 12.97,
      lon: 77.59,
    }

    // 5 undigitized poles (parent_pole_id & seq_on_line are null)
    const poles: PoleData[] = [
      {
        pole_id: 'POLE-A',
        lat: 12.9702,
        lon: 77.59,
        parent_pole_id: null,
        seq_on_line: null,
      }, // ~22m from DT
      {
        pole_id: 'POLE-B',
        lat: 12.9705,
        lon: 77.59,
        parent_pole_id: null,
        seq_on_line: null,
      }, // ~33m from POLE-A
      {
        pole_id: 'POLE-C',
        lat: 12.9708,
        lon: 77.59,
        parent_pole_id: null,
        seq_on_line: null,
      }, // ~33m from POLE-B
      {
        pole_id: 'POLE-D',
        lat: 12.9705,
        lon: 77.5903,
        parent_pole_id: null,
        seq_on_line: null,
      }, // ~33m east of POLE-B (branch)
      {
        pole_id: 'POLE-E',
        lat: 12.9711,
        lon: 77.59,
        parent_pole_id: null,
        seq_on_line: null,
      }, // ~33m from POLE-C
    ]

    const tree = buildDTPoleTree(dt, poles)

    expect(tree.topology_source).toBe('inferred')
    expect(tree.dt_id).toBe('DT-002')
    expect(tree.root).not.toBeNull()

    // POLE-A is closest to DT (lat: 12.9702), so it should be inferred as root
    expect(tree.root?.pole_id).toBe('POLE-A')
    expect(tree.nodes.size).toBe(5)

    // POLE-D is closest to POLE-B (at same latitude 12.9705), so B should be D's parent in MST
    const poleDNode = tree.nodes.get('POLE-D')
    expect(poleDNode?.parent_pole_id).toBe('POLE-B')

    // Verify POLE-B has 2 children (POLE-C trunk and POLE-D branch)
    const poleBNode = tree.nodes.get('POLE-B')
    expect(poleBNode?.children.length).toBe(2)
    const childIds = poleBNode?.children.map((c) => c.pole_id).sort()
    expect(childIds).toEqual(['POLE-C', 'POLE-D'])
  })
})
