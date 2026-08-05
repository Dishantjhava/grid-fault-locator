/**
 * src/services/aiSummary.ts
 *
 * Plain-language AI Operator Briefing Summarizer with 3-second timeout
 * and deterministic template fallback.
 */

export interface IncidentSummaryInput {
  id: string
  fault_type: 'span' | 'dt' | 'feeder'
  topology_source: 'known' | 'inferred'
  affected_pole_ids: string[]
  boundary_pole_id: string | null
  boundary_pole_range?: string[]
  first_dark_pole_id: string | null
  confidence: number
  confidence_reason: string
  pincode: string | null
  households_affected: number
}

/**
 * Builds a clean, deterministic template fallback summary string.
 */
export function generateTemplateFallbackSummary(
  input: IncidentSummaryInput
): string {
  const boundaryText = input.boundary_pole_id
    ? `pole ${input.boundary_pole_id}`
    : input.boundary_pole_range
    ? `range [${input.boundary_pole_range.join(', ')}]`
    : 'substation / transformer'

  const firstDarkText = input.first_dark_pole_id
    ? ` and first dark pole ${input.first_dark_pole_id}`
    : ''

  const topoText =
    input.topology_source === 'known'
      ? 'digitized network topology'
      : 'inferred GPS MST topology'

  const confText =
    input.confidence >= 0.9
      ? 'high'
      : input.confidence >= 0.7
      ? 'medium'
      : 'low'

  if (input.fault_type === 'dt') {
    return `Transformer-level blackout at DT affecting ~${input.households_affected} households across ${input.affected_pole_ids.length} poles in PIN ${input.pincode || '560001'}. Confidence is ${confText} (${topoText}).`
  }

  if (input.fault_type === 'feeder') {
    return `Feeder-level blackout affecting ~${input.households_affected} households across multiple transformers in PIN ${input.pincode || '560001'}. Confidence is ${confText} (${topoText}).`
  }

  return `Likely wire break between boundary ${boundaryText}${firstDarkText}, affecting ~${input.households_affected} households in PIN ${input.pincode || '560001'}. Confidence is ${confText} (${topoText}).`
}

/**
 * Generates an operator summary using OpenAI API if OPENAI_API_KEY is available,
 * with a 3-second AbortController timeout and deterministic template fallback.
 *
 * PROMPT GUARDRAIL:
 * "Only summarize the provided fields, do not add details not given."
 */
export async function generateAISummary(
  input: IncidentSummaryInput,
  apiKey: string | undefined = process.env.OPENAI_API_KEY,
  timeoutMs: number = 3000
): Promise<string> {
  const fallback = generateTemplateFallbackSummary(input)

  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('sk-...')) {
    return fallback
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const prompt = `You are a power grid operator assistant. Only summarize the provided fields, do not add details not given.

Structured Incident Data:
- Incident ID: ${input.id}
- Fault Type: ${input.fault_type}
- Topology Source: ${input.topology_source}
- Boundary Pole: ${
      input.boundary_pole_id || input.boundary_pole_range?.join(', ') || 'N/A'
    }
- First Dark Pole: ${input.first_dark_pole_id || 'N/A'}
- Affected Poles Count: ${input.affected_pole_ids.length}
- Households Affected: ${input.households_affected}
- PIN Code: ${input.pincode || '560001'}
- Confidence Score: ${input.confidence}
- Confidence Rationale: ${input.confidence_reason}

Write a 2-sentence plain-language summary for the control room operator.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.2,
      }),
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      return fallback
    }

    const data = await res.json()
    const summary = data?.choices?.[0]?.message?.content?.trim()
    return summary || fallback
  } catch (err) {
    clearTimeout(timeoutId)
    // On failure, network error, or 3s timeout abort, return fallback
    return fallback
  }
}
