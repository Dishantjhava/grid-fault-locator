import { describe, it, expect } from 'vitest'
import {
  generateAISummary,
  generateTemplateFallbackSummary,
  IncidentSummaryInput,
} from '../src/services/aiSummary.js'

describe('AI Operator Briefing Summarizer (Phase 6)', () => {
  const sampleIncident: IncidentSummaryInput = {
    id: 'INC-SPAN-POLE-1-POLE-2-101',
    fault_type: 'span',
    topology_source: 'known',
    affected_pole_ids: ['POLE-2', 'POLE-3'],
    boundary_pole_id: 'POLE-1',
    first_dark_pole_id: 'POLE-2',
    confidence: 1.0,
    confidence_reason: 'Exact span fault isolated between live pole POLE-1 and dark pole POLE-2.',
    pincode: '560034',
    households_affected: 42,
  }

  it('1. Deterministic template fallback: should generate clean plain-language summary without AI API', () => {
    const summary = generateTemplateFallbackSummary(sampleIncident)
    expect(summary).toContain('Likely wire break between boundary pole POLE-1 and first dark pole POLE-2')
    expect(summary).toContain('~42 households in PIN 560034')
    expect(summary).toContain('Confidence is high')
  })

  it('2. Inferred topology fallback: should mention inferred MST topology in summary', () => {
    const inferredIncident: IncidentSummaryInput = {
      ...sampleIncident,
      topology_source: 'inferred',
      confidence: 0.75,
    }
    const summary = generateTemplateFallbackSummary(inferredIncident)
    expect(summary).toContain('inferred GPS MST topology')
    expect(summary).toContain('Confidence is medium')
  })

  it('3. Missing API key: should immediately return deterministic template fallback without errors', async () => {
    const start = Date.now()
    const summary = await generateAISummary(sampleIncident, undefined, 3000)
    const duration = Date.now() - start

    expect(duration).toBeLessThan(100) // Fast non-blocking return
    expect(summary).toContain('Likely wire break')
  })

  it('4. Fast timeout handling: should return template fallback if API call times out or fails', async () => {
    const start = Date.now()
    // Test with invalid API key and short 10ms timeout
    const summary = await generateAISummary(sampleIncident, 'sk-invalid-key-for-test', 10)
    const duration = Date.now() - start

    expect(duration).toBeLessThan(500) // Returns safely within timeout
    expect(summary).toBeDefined()
    expect(typeof summary).toBe('string')
  })
})
