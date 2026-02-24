/**
 * Audio Format Converter - Twilio to WisprFlow
 *
 * Converts Twilio mu-law 8kHz audio to WisprFlow PCM 16kHz format.
 * Optimized for real-time processing (~20ms audio chunks, thousands per call).
 *
 * Input:  mu-law encoded, 8kHz, 8-bit, base64
 * Output: PCM 16-bit, 16kHz, base64
 */

/**
 * ITU-T G.711 mu-law decoding table
 * Pre-computed lookup table for fast mu-law to 16-bit PCM conversion.
 * Each mu-law byte maps directly to a signed 16-bit PCM sample.
 */
const MULAW_DECODE_TABLE: Int16Array = createMulawDecodeTable();

function createMulawDecodeTable(): Int16Array {
    const table = new Int16Array(256);

    // ITU-T G.711 mu-law decoding constants
    const BIAS = 0x84;  // 132, the mu-law bias

    for (let i = 0; i < 256; i++) {
        // Complement the input (mu-law is stored complemented)
        const mulaw = ~i & 0xFF;

        // Extract sign bit (bit 7)
        const sign = (mulaw & 0x80) !== 0;

        // Extract exponent (bits 4-6)
        const exponent = (mulaw >> 4) & 0x07;

        // Extract mantissa (bits 0-3)
        const mantissa = mulaw & 0x0F;

        // Reconstruct the magnitude
        // Formula: ((mantissa << 3) + BIAS) << exponent - BIAS
        let sample = ((mantissa << 3) + BIAS) << exponent;
        sample -= BIAS;

        // Apply sign
        if (sign) {
            sample = -sample;
        }

        // Clamp to 16-bit signed range [-32768, 32767]
        table[i] = Math.max(-32768, Math.min(32767, sample)) as number;
    }

    return table;
}

/**
 * Decode a single mu-law byte to a 16-bit PCM sample using lookup table.
 * O(1) operation - direct array access.
 */
function decodeMulaw(mulawByte: number): number {
    return MULAW_DECODE_TABLE[mulawByte];
}

/**
 * Upsample PCM audio from 8kHz to 16kHz using linear interpolation.
 * Doubles the sample rate by interpolating between adjacent samples.
 *
 * Linear interpolation formula: output[2n] = input[n], output[2n+1] = (input[n] + input[n+1]) / 2
 *
 * @param samples - 16-bit PCM samples at 8kHz
 * @returns 16-bit PCM samples at 16kHz (2x length)
 */
function upsample8kTo16k(samples: Int16Array): Int16Array {
    const inputLength = samples.length;

    // Edge case: empty input
    if (inputLength === 0) {
        return new Int16Array(0);
    }

    // Output is exactly 2x the input length
    const outputLength = inputLength * 2;
    const output = new Int16Array(outputLength);

    // Process all samples except the last one
    for (let i = 0; i < inputLength - 1; i++) {
        const current = samples[i];
        const next = samples[i + 1];

        // Original sample at even index
        output[i * 2] = current;

        // Interpolated sample at odd index
        // Use bit shift for efficient division by 2
        output[i * 2 + 1] = ((current + next) >> 1) as number;
    }

    // Handle last sample: duplicate it (no next sample to interpolate with)
    const lastIndex = inputLength - 1;
    const lastSample = samples[lastIndex];
    output[lastIndex * 2] = lastSample;
    output[lastIndex * 2 + 1] = lastSample;

    return output;
}

/**
 * Convert Twilio mu-law base64 audio to WisprFlow PCM base64.
 *
 * This is the main conversion function optimized for real-time use.
 *
 * Processing steps:
 * 1. Decode base64 to raw mu-law bytes
 * 2. Convert mu-law to 16-bit PCM (using lookup table)
 * 3. Upsample from 8kHz to 16kHz (linear interpolation)
 * 4. Encode result back to base64
 *
 * @param mulawBase64 - Base64 encoded mu-law 8kHz audio from Twilio
 * @returns Base64 encoded PCM 16-bit 16kHz audio for WisprFlow
 *
 * @example
 * // 160 bytes mu-law input (20ms at 8kHz)
 * // produces 640 bytes PCM output (20ms at 16kHz, 16-bit)
 * const wisprFlowAudio = convertTwilioToWisprFlow(twilioMediaPayload);
 */
export function convertTwilioToWisprFlow(mulawBase64: string): string {
    // 1. Decode base64 to raw mu-law bytes
    const mulawBuffer = Buffer.from(mulawBase64, 'base64');
    const mulawLength = mulawBuffer.length;

    // 2. Convert mu-law to 16-bit PCM samples
    // Each mu-law byte becomes one 16-bit sample (2 bytes)
    const pcmSamples = new Int16Array(mulawLength);

    for (let i = 0; i < mulawLength; i++) {
        pcmSamples[i] = MULAW_DECODE_TABLE[mulawBuffer[i]];
    }

    // 3. Upsample 8kHz to 16kHz
    const upsampledSamples = upsample8kTo16k(pcmSamples);

    // 4. Convert Int16Array to Buffer (little-endian 16-bit)
    // Int16Array's underlying ArrayBuffer is already in native byte order,
    // but we need to ensure little-endian for PCM compatibility
    const pcmBuffer = Buffer.alloc(upsampledSamples.length * 2);

    for (let i = 0; i < upsampledSamples.length; i++) {
        pcmBuffer.writeInt16LE(upsampledSamples[i], i * 2);
    }

    // 5. Encode to base64
    return pcmBuffer.toString('base64');
}

/**
 * Batch convert multiple audio chunks for efficiency.
 * Useful when processing buffered chunks together.
 *
 * @param chunks - Array of base64 encoded mu-law audio chunks
 * @returns Array of base64 encoded PCM audio chunks
 */
export function convertTwilioChunks(chunks: string[]): string[] {
    return chunks.map(convertTwilioToWisprFlow);
}

/**
 * Convert Twilio mu-law base64 to raw PCM Buffer (without base64 re-encoding).
 * Useful when you need the raw bytes for further processing.
 *
 * @param mulawBase64 - Base64 encoded mu-law 8kHz audio from Twilio
 * @returns Raw PCM 16-bit 16kHz buffer
 */
export function convertTwilioToWisprFlowBuffer(mulawBase64: string): Buffer {
    // 1. Decode base64 to raw mu-law bytes
    const mulawBuffer = Buffer.from(mulawBase64, 'base64');
    const mulawLength = mulawBuffer.length;

    // 2. Convert mu-law to 16-bit PCM samples
    const pcmSamples = new Int16Array(mulawLength);

    for (let i = 0; i < mulawLength; i++) {
        pcmSamples[i] = MULAW_DECODE_TABLE[mulawBuffer[i]];
    }

    // 3. Upsample 8kHz to 16kHz
    const upsampledSamples = upsample8kTo16k(pcmSamples);

    // 4. Convert Int16Array to Buffer (little-endian 16-bit)
    const pcmBuffer = Buffer.alloc(upsampledSamples.length * 2);

    for (let i = 0; i < upsampledSamples.length; i++) {
        pcmBuffer.writeInt16LE(upsampledSamples[i], i * 2);
    }

    return pcmBuffer;
}

/**
 * Get expected output sizes for validation/debugging.
 *
 * @param inputMulawBytes - Number of input mu-law bytes
 * @returns Object with expected output sizes
 */
export function getExpectedOutputSizes(inputMulawBytes: number): {
    pcm8kHzBytes: number;
    pcm16kHzBytes: number;
    pcm16kHzSamples: number;
} {
    // Input: 1 mu-law byte = 1 sample at 8kHz
    // After mu-law decode: 1 sample = 2 bytes (16-bit)
    // After upsampling: 2x samples

    const pcm8kHzSamples = inputMulawBytes;
    const pcm8kHzBytes = pcm8kHzSamples * 2;  // 16-bit = 2 bytes per sample

    const pcm16kHzSamples = pcm8kHzSamples * 2;  // Upsampled
    const pcm16kHzBytes = pcm16kHzSamples * 2;   // 16-bit = 2 bytes per sample

    return {
        pcm8kHzBytes,
        pcm16kHzBytes,
        pcm16kHzSamples,
    };
}

// Export the decode table for testing/debugging
export { MULAW_DECODE_TABLE };
