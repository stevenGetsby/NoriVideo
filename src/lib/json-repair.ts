import { jsonrepair } from 'jsonrepair'

/**
 * Strip markdown code fences (```json ... ```) from LLM output.
 */
function stripMarkdownFence(input: string): string {
    return input
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/g, '')
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim()
}
/**
 * Try to extract a JSON object or array substring from mixed text.
 * Returns the extracted substring, or the original input if no clear
 * JSON boundary is found.
 */
function extractJsonSubstring(input: string): string {
    const firstBrace = input.indexOf('{')
    const firstBracket = input.indexOf('[')
    if (firstBrace === -1 && firstBracket === -1) return input

    // Pick whichever delimiter comes first
    const isObject = firstBracket === -1 || (firstBrace !== -1 && firstBrace < firstBracket)
    const openChar = isObject ? '{' : '['
    const closeChar = isObject ? '}' : ']'
    const start = isObject ? firstBrace : firstBracket

    // Walk forward to find the matching close bracket
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < input.length; i++) {
        const ch = input[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\') { escaped = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === openChar) depth++
        else if (ch === closeChar) {
            depth--
            if (depth === 0) {
                return input.slice(start, i + 1)
            }
        }
    }
    return input
}

function extractBalancedSubstring(input: string, openChar: '{' | '[', closeChar: '}' | ']'): string {
    const start = input.indexOf(openChar)
    if (start === -1) return input

    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < input.length; i++) {
        const ch = input[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\') { escaped = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === openChar) depth++
        else if (ch === closeChar) {
            depth--
            if (depth === 0) {
                return input.slice(start, i + 1)
            }
        }
    }
    return input
}

function extractBalancedSubstrings(input: string, openChar: '{' | '[', closeChar: '}' | ']'): string[] {
    const results: string[] = []
    let depth = 0
    let start = -1
    let inString = false
    let escaped = false

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\') { escaped = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue

        if (ch === openChar) {
            if (depth === 0) start = i
            depth++
        } else if (ch === closeChar && depth > 0) {
            depth--
            if (depth === 0 && start >= 0) {
                results.push(input.slice(start, i + 1))
                start = -1
            }
        }
    }

    return results
}

function parseJsonCandidate(input: string): unknown {
    try {
        return JSON.parse(input)
    } catch {
        return JSON.parse(jsonrepair(input))
    }
}

/**
 * Safely parse JSON text from LLM output.
 * First attempts a direct JSON.parse; on failure, tries to extract a JSON
 * substring and uses jsonrepair to fix common LLM issues (unescaped quotes,
 * control characters, trailing commas, single quotes, etc.) before re-parsing.
 */
export function safeParseJson(input: string): unknown {
    const cleaned = stripMarkdownFence(input.trim())
    // Fast path: direct parse
    try {
        return JSON.parse(cleaned)
    } catch { /* continue to repair */ }

    // Try extracting a JSON substring first (handles LLM explanatory text)
    const extracted = extractJsonSubstring(cleaned)
    try {
        return JSON.parse(extracted)
    } catch { /* continue to repair */ }

    // Last resort: jsonrepair on the extracted substring
    return JSON.parse(jsonrepair(extracted))
}

/**
 * Parse LLM output as a JSON object.
 * Throws if the result is not a plain object.
 */
export function safeParseJsonObject(input: string): Record<string, unknown> {
    const cleaned = stripMarkdownFence(input.trim())
    let result: unknown

    try {
        result = JSON.parse(cleaned)
    } catch {
        const candidates = extractBalancedSubstrings(cleaned, '{', '}')
        for (let index = 0; index < candidates.length; index++) {
            try {
                result = parseJsonCandidate(candidates[index])
                if (result && typeof result === 'object' && !Array.isArray(result)) {
                    return result as Record<string, unknown>
                }
            } catch {
                // continue trying earlier object candidates
            }
        }
        result = parseJsonCandidate(extractBalancedSubstring(cleaned, '{', '}'))
    }

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return result as Record<string, unknown>
    }
    throw new Error('Expected JSON object from LLM output')
}

/**
 * Parse LLM output as a JSON array of objects.
 * Also handles the case where the LLM wraps the array inside an object.
 */
export function safeParseJsonArray(
    input: string,
    fallbackKey?: string,
): Record<string, unknown>[] {
    const cleaned = stripMarkdownFence(input.trim())
    let result: unknown

    try {
        result = JSON.parse(cleaned)
    } catch {
        if (fallbackKey) {
            const objectCandidates = extractBalancedSubstrings(cleaned, '{', '}')
            for (let index = objectCandidates.length - 1; index >= 0; index--) {
                try {
                    const candidate = parseJsonCandidate(objectCandidates[index])
                    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
                        const value = (candidate as Record<string, unknown>)[fallbackKey]
                        if (Array.isArray(value)) {
                            return value.filter(
                                (item): item is Record<string, unknown> => !!item && typeof item === 'object',
                            )
                        }
                    }
                } catch {
                    // continue trying earlier object candidates
                }
            }
        }

        const arrayCandidates = extractBalancedSubstrings(cleaned, '[', ']')
        for (let index = arrayCandidates.length - 1; index >= 0; index--) {
            try {
                result = parseJsonCandidate(arrayCandidates[index])
                if (Array.isArray(result)) {
                    return result.filter(
                        (item): item is Record<string, unknown> => !!item && typeof item === 'object',
                    )
                }
            } catch {
                // continue trying earlier array candidates
            }
        }

        const objectCandidates = extractBalancedSubstrings(cleaned, '{', '}')
        for (let index = objectCandidates.length - 1; index >= 0; index--) {
            try {
                result = parseJsonCandidate(objectCandidates[index])
                break
            } catch {
                // continue trying earlier object candidates
            }
        }

        if (result === undefined) {
            result = safeParseJson(cleaned)
        }
    }

    if (Array.isArray(result)) {
        return result.filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object',
        )
    }

    // LLM sometimes wraps the array in an object like { "clips": [...] }
    if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>
        // Try the explicit fallback key first, then common wrapper keys
        const keys = fallbackKey ? [fallbackKey] : Object.keys(obj)
        for (const key of keys) {
            const value = obj[key]
            if (Array.isArray(value)) {
                return value.filter(
                    (item): item is Record<string, unknown> => !!item && typeof item === 'object',
                )
            }
        }
    }

    throw new Error('Expected JSON array from LLM output')
}
