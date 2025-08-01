// src.function.crypto-random.ts

/**
 * shuffrand - Cryptographically Secure Random Number Generation
 *
 * This file contains the core logic for generating cryptographically secure random numbers,
 * adhering to a flat, dot-categorized structure for clarity.
 *
 * @author Doron Brayer <doronbrayer@outlook.com>
 * @license MIT
 */

// Import types, constants, and ArkType schema from their respective dot-categorized files
import { RandomParams, randomParamsSchema } from './src.types.js'
import { Constants } from './src.constants.js'

/**
 * Generates a cryptographically secure random number within a specified range.
 *
 * @param {RandomParams} [rawParams={}] - The raw parameters for random number generation.
 * @param {number} [rawParams.lowerBound=0] - The lower bound (inclusive) of the random number.
 * @param {number} [rawParams.upperBound=2] - The upper bound (exclusive for doubles, inclusive for integers) of the random number.
 * @param {'integer'|'double'} [rawParams.typeOfNum='integer'] - The type of number to generate ('integer' (default) or 'double').
 * @param {'none'|'lower bound'|'upper bound'|'both'} [rawParams.exclusion='none'] - Specifies which bounds to exclude.
 * @param {number} [rawParams.maxFracDigits=3] - The maximum number of fractional digits for 'double' type numbers.
 * If specified, the generated double will be rounded to this many decimal places.
 * Must be a non-negative integer between 0 and 15. Defaults to `3`.
 * @returns {number} - A cryptographically secure random number.
 * @throws {TypeError} - If input parameters do not conform to the schema or if an invalid range is provided.
 */
export function cryptoRandom(rawParams: RandomParams = {}): number {
    // --- NEW CUSTOM VALIDATION FOR MAXFRACDIGITS (DX-focused) ---
    // This check provides a highly tailored and user-friendly error message for maxFracDigits,
    // explaining the reason for the limits (reliable precision).
    // It's placed before ArkType to ensure this custom message takes precedence.

    const effectiveMaxFracDigits = rawParams.maxFracDigits ?? 3 // Apply default for initial check

    if (
        typeof effectiveMaxFracDigits !== 'number' ||
        !Number.isInteger(effectiveMaxFracDigits) ||
        effectiveMaxFracDigits < Constants.MIN_FRACTIONAL_DIGITS ||
        effectiveMaxFracDigits > Constants.MAX_FRACTIONAL_DIGITS
    ) {
        throw new TypeError(
            `maxFracDigits (currently ${effectiveMaxFracDigits}) must be an integer between ${Constants.MIN_FRACTIONAL_DIGITS} and ${Constants.MAX_FRACTIONAL_DIGITS} (inclusive) to ensure reliable precision.`
        )
    }
    // --- END NEW CUSTOM VALIDATION ---

    // Step 1: Assert rawParams against the schema for runtime validation.
    // This ensures the input structure is valid, but properties are still optional.
    // NOTE: ArkType will now handle type/range validation for lowerBound/upperBound
    // (via src.types.ts schema) and other parameters, as the custom maxFracDigits
    // check is handled above.
    randomParamsSchema.assert(rawParams)

    // Step 2: Create the validatedParams object with default values using ?? operator.
    // Step 3: Explicitly cast the *entire object literal* to Required<RandomParams>.
    // This tells TypeScript that all properties are now guaranteed to be non-undefined
    // because of the defaults applied. This is the most direct way to resolve
    // the "possibly undefined" errors at compile time.
    const validatedParams: Required<RandomParams> = {
        lowerBound: rawParams.lowerBound ?? 0,
        upperBound: rawParams.upperBound ?? 2, // Corrected default upperBound to 2 as per test plan
        typeOfNum: rawParams.typeOfNum ?? 'integer',
        exclusion: rawParams.exclusion ?? 'none',
        maxFracDigits: rawParams.maxFracDigits ?? 3,
    }

    // TRULY needed: Implement the new API rule: disallow maxFracDigits: 0 for double typeOfNum
    if (validatedParams.typeOfNum === 'double' && validatedParams.maxFracDigits === 0) {
        throw new TypeError(
            `Invalid cryptoRandom parameters: 'maxFracDigits' cannot be 0 when 'typeOfNum' is 'double'. Use 'typeOfNum: "integer"' for whole numbers.`
        )
    }

    // Ensure globalThis.crypto is available. This check is crucial for environments
    // where WebCrypto API might not be present (though highly unlikely in modern targets).
    if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
        throw new Error(
            'Cryptographically secure random number generator (WebCrypto API) is not available in this environment.'
        )
    }

    // Destructure directly from the explicitly typed validatedParams constant.
    // TypeScript should now correctly infer all these as non-nullable.
    const { lowerBound, upperBound, typeOfNum, exclusion, maxFracDigits } = validatedParams

    // Ensure min is always the lower value and max is always the higher value
    const min = Math.min(lowerBound, upperBound)
    const max = Math.max(lowerBound, upperBound)

    // Handle edge case where lowerBound equals upperBound
    if (min === max) {
        // If typeOfNum === 'double' and exclusion is 'both', it's an invalid range
        if (typeOfNum === 'double' && exclusion === 'both') {
            throw new TypeError(
                `Invalid range for double with 'both' exclusion: lowerBound (${lowerBound}) equals upperBound (${upperBound}).`
            )
        }
        return min // Return the single possible value
    }

    let result: number
    let attempts = 0
    const maxAttempts = Constants.MAX_ATTEMPTS_TO_GENERATE_NUM

    do {
        let currentLowerBound = min
        let currentUpperBound = max

        // --- Integer Specific Logic & Exclusion Pre-checks ---
        if (typeOfNum === 'integer') {
            // FIX: For integer type, ensure bounds are rounded to integers first,
            // as random number generation for integers operates on integer ranges.
            currentLowerBound = Math.ceil(min) // Round up lower bound
            currentUpperBound = Math.floor(max) // Round down upper bound

            // Apply exclusion for integers by adjusting bounds
            if (exclusion === 'lower bound' || exclusion === 'both') {
                currentLowerBound++
            }
            if (exclusion === 'upper bound' || exclusion === 'both') {
                currentUpperBound--
            }

            // If currentLowerBound exceeds currentUpperBound after adjustments, it's an empty range.
            // This check replaces the problematic 'thresholds' logic from the old function,
            // as it correctly identifies truly impossible integer ranges after exclusions.
            if (currentLowerBound > currentUpperBound) {
                // Optimized message using en dash for range
                throw new TypeError(
                    `Invalid integer range after exclusions: the original range of [${lowerBound}\u2013${upperBound}] with exclusion '${exclusion}' results in an empty integer range.`
                )
            }

            const range = currentUpperBound - currentLowerBound + 1

            const bytesNeeded = Math.ceil(Math.log2(range) / 8)
            const maxValidValue = Math.pow(256, bytesNeeded) - (Math.pow(256, bytesNeeded) % range)

            let randomNumber: number
            const byteArray = new Uint8Array(bytesNeeded)

            do {
                globalThis.crypto.getRandomValues(byteArray)
                randomNumber = 0
                for (let i = 0; i < bytesNeeded; i++) {
                    randomNumber = randomNumber * 256 + byteArray[i]
                }
            } while (randomNumber >= maxValidValue)

            result = currentLowerBound + (randomNumber % range)
        } else {
            // typeOfNum === 'double' (and maxFracDigits is NOT 0, due to early validation)
            const BYTES_FOR_DOUBLE = 8
            const MAX_UINT64 = 2 ** (BYTES_FOR_DOUBLE * 8) // Max value for a 64-bit unsigned integer

            let rawDouble: number
            const byteArray = new Uint8Array(BYTES_FOR_DOUBLE)

            // Generate a random double between 0 (inclusive) and 1 (exclusive)
            do {
                globalThis.crypto.getRandomValues(byteArray)
                let randomNumber = 0
                for (let i = 0; i < BYTES_FOR_DOUBLE; i++) {
                    randomNumber = randomNumber * 256 + byteArray[i]
                }
                rawDouble = randomNumber / MAX_UINT64
            } while (rawDouble === 1) // Ensure it's strictly less than 1 to avoid issues with upperBound scaling

            // Scale to the desired range
            result = currentLowerBound + rawDouble * (currentUpperBound - currentLowerBound)

            // Apply maxFracDigits rounding if specified
            // maxFracDigits is now guaranteed to be > 0 by the new validation
            const actualMaxFracDigits = Number(maxFracDigits) // Robust conversion
            // The condition `actualMaxFracDigits >= 0` is now implicitly `actualMaxFracDigits > 0`
            // due to the validation above, so we can simplify or keep as is.
            // Keeping as `actualMaxFracDigits >= 0` is fine, as it's still true.
            if (!isNaN(actualMaxFracDigits) && actualMaxFracDigits >= 0) {
                const factor = Math.pow(10, actualMaxFracDigits)
                result = Math.round(result * factor) / factor
            }
        }

        // --- Exclusion checks with appropriate comparison method for both types ---
        let isExcluded = false

        if (typeOfNum === 'double') {
            // For doubles, use epsilon comparison (from OLD-but-good)
            if (exclusion === 'lower bound' && Math.abs(result - min) < Number.EPSILON) {
                isExcluded = true
            } else if (exclusion === 'upper bound' && Math.abs(result - max) < Number.EPSILON) {
                isExcluded = true
            } else if (
                exclusion === 'both' &&
                (Math.abs(result - min) < Number.EPSILON || Math.abs(result - max) < Number.EPSILON)
            ) {
                isExcluded = true
            }
        } else {
            // typeOfNum === 'integer'
            // For integers, use exact equality
            if (exclusion === 'lower bound' && result === min) {
                isExcluded = true
            } else if (exclusion === 'upper bound' && result === max) {
                isExcluded = true
            } else if (exclusion === 'both' && (result === min || result === max)) {
                isExcluded = true
            }
        }

        if (isExcluded) {
            attempts++
            continue // Re-roll
        }

        // Per design doctrine, a 'double' type must not be a whole number.
        // If we've generated one by chance, treat it as an invalid result and re-roll.
        if (typeOfNum === 'double' && Number.isInteger(result)) {
            attempts++
            continue // Re-roll
        }

        break // Exit loop if a valid number is found
    } while (attempts < maxAttempts)

    // Throw if max attempts reached without finding a valid number
    if (attempts >= maxAttempts) {
        // A more resilient and accurate error message.
        let reason = `the exclusion constraint: '${exclusion}'`
        if (typeOfNum === 'double') {
            reason += ` or the non-integer requirement`
        }
        throw new Error(
            `Unable to generate a random number within the range [${min}\u2013${max}] that satisfies ${reason}. Max attempts (${maxAttempts}) reached.`
        )
    }

    return result
}
