/**
 * Audio Format Converter
 * Converts between Twilio's µ-law format and Eleven Labs' PCM format
 */

/**
 * Convert µ-law to 16-bit PCM
 * Based on G.711 µ-law decoding algorithm
 */
export function ulawToPcm(ulawData: Buffer): Buffer {
    const pcmData = Buffer.alloc(ulawData.length * 2); // 16-bit = 2 bytes per sample

    const MULAW_BIAS = 0x84;
    const MULAW_MAX = 0x1FFF;

    for (let i = 0; i < ulawData.length; i++) {
        let ulaw = ulawData[i];
        ulaw = ~ulaw;

        const sign = (ulaw & 0x80) !== 0;
        const exponent = (ulaw >> 4) & 0x07;
        const mantissa = ulaw & 0x0F;

        let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
        sample = sample - MULAW_BIAS;

        if (sign) {
            sample = -sample;
        }

        // Clamp to 16-bit range
        sample = Math.max(-32768, Math.min(32767, sample));

        // Write as 16-bit little-endian
        pcmData.writeInt16LE(sample, i * 2);
    }

    return pcmData;
}

/**
 * Convert 16-bit PCM to µ-law
 * Based on G.711 µ-law encoding algorithm
 */
export function pcmToUlaw(pcmData: Buffer): Buffer {
    const ulawData = Buffer.alloc(pcmData.length / 2);

    const MULAW_MAX = 0x1FFF;
    const MULAW_BIAS = 0x84;

    for (let i = 0; i < ulawData.length; i++) {
        let sample = pcmData.readInt16LE(i * 2);

        // Get sign and absolute value
        const sign = sample < 0 ? 0x80 : 0x00;
        if (sample < 0) {
            sample = -sample;
        }

        // Add bias
        sample += MULAW_BIAS;

        // Clamp
        if (sample > MULAW_MAX) {
            sample = MULAW_MAX;
        }

        // Find exponent and mantissa
        let exponent = 7;
        for (let exp = 0; exp < 8; exp++) {
            if (sample <= (0xFF << exp)) {
                exponent = exp;
                break;
            }
        }

        const mantissa = (sample >> (exponent + 3)) & 0x0F;
        const ulaw = ~(sign | (exponent << 4) | mantissa);

        ulawData[i] = ulaw & 0xFF;
    }

    return ulawData;
}

/**
 * Resample audio from one sample rate to another
 * Simple linear interpolation resampling
 */
export function resample(
    inputBuffer: Buffer,
    inputRate: number,
    outputRate: number
): Buffer {
    if (inputRate === outputRate) {
        return inputBuffer;
    }

    const inputSamples = inputBuffer.length / 2; // 16-bit samples
    const outputSamples = Math.floor((inputSamples * outputRate) / inputRate);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    const ratio = inputSamples / outputSamples;

    for (let i = 0; i < outputSamples; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
        const fraction = srcIndex - srcIndexFloor;

        // Linear interpolation
        const sample1 = inputBuffer.readInt16LE(srcIndexFloor * 2);
        const sample2 = inputBuffer.readInt16LE(srcIndexCeil * 2);
        const interpolated = Math.round(sample1 + (sample2 - sample1) * fraction);

        outputBuffer.writeInt16LE(interpolated, i * 2);
    }

    return outputBuffer;
}

/**
 * Convert Twilio audio (8kHz µ-law base64) to Eleven Labs format (16kHz PCM)
 */
export function convertTwilioToElevenLabs(base64Audio: string): Buffer {
    // 1. Decode base64
    const ulawBuffer = Buffer.from(base64Audio, 'base64');

    // 2. Convert µ-law to PCM
    const pcmBuffer = ulawToPcm(ulawBuffer);

    // 3. Resample 8kHz to 16kHz
    const resampledBuffer = resample(pcmBuffer, 8000, 16000);

    return resampledBuffer;
}

/**
 * Convert Eleven Labs audio (16kHz PCM) to Twilio format (8kHz µ-law base64)
 */
export function convertElevenLabsToTwilio(pcmBuffer: Buffer): string {
    // 1. Resample 16kHz to 8kHz
    const downsampled = resample(pcmBuffer, 16000, 8000);

    // 2. Convert PCM to µ-law
    const ulawBuffer = pcmToUlaw(downsampled);

    // 3. Encode to base64
    return ulawBuffer.toString('base64');
}
