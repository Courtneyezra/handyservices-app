/**
 * Vision Worker — Gemini-powered photo AND video analysis for handyman quotes.
 *
 * Agent Framework V2, WS3: Vision Worker.
 *
 * Extracts structured information from customer media:
 * - Items visible (type, material, condition, location)
 * - Defects identified (type, severity, description)
 * - Text found (brand names, model numbers, OCR)
 *
 * Uses Gemini 2.5 Flash via OpenRouter for optimal vision quality.
 * - Images: Resized and converted to JPEG
 * - Videos: Native processing (no keyframe extraction needed)
 *
 * Updates the ConversationMemory with extraction results for downstream workers.
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { callLLMWithImages, callLLMWithVideo, type LLMResponse } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import { ensureLocalMedia } from '../media-store';
import type { MediaExtraction, ExtractedItem, ExtractedDefect } from '../../shared/conversation-memory';

// ==========================================
// CONSTANTS
// ==========================================

/** Maximum dimension for resized images — balances quality vs token cost */
const MAX_IMAGE_DIM = 1024;

/** JPEG quality for resized images */
const JPEG_QUALITY = 80;

// ==========================================
// VISION PROMPT
// ==========================================

const VISION_SYSTEM_PROMPT = `You are a trade expert analyzing photos and videos for a handyman quoting system.

Extract STRUCTURED information from the media. Be specific and accurate.

OUTPUT FORMAT (JSON):
{
  "items": [
    {
      "type": "tap | pipe | sink | toilet | door | fence | wall | floor | ceiling | other",
      "material": "chrome | brass | copper | plastic | wood | metal | other",
      "condition": "good | worn | damaged | leaking | corroded | broken",
      "location": "where in the property",
      "confidence": "high | medium | low"
    }
  ],
  "defects": [
    {
      "type": "leak | crack | corrosion | rot | missing | broken | worn | other",
      "severity": "minor | moderate | major",
      "description": "specific description of the defect",
      "itemRef": "which item this affects"
    }
  ],
  "textFound": ["any visible text, brand names, model numbers"],
  "whatIsShown": "one sentence describing what's actually in the media",
  "whatIsMissing": "if customer asked about X but media shows Y, note what's missing"
}

CRITICAL RULES:
1. Only describe what you ACTUALLY SEE, not what you assume
2. If the media doesn't show what was requested, say so in "whatIsMissing"
3. Brand names and model numbers are valuable — always extract them
4. Note access issues (tight spaces, heights, obstructions)
5. Confidence should be "low" if media is blurry or item is partially visible
6. For VIDEOS: analyze the full video including motion (e.g. water flow, mechanical issues) and any audio where the customer explains the problem`;

/** Max video file size in bytes (25MB) — OpenRouter/Gemini limit */
const MAX_VIDEO_SIZE_BYTES = 25 * 1024 * 1024;

// ==========================================
// TYPES
// ==========================================

export interface VisionWorkerInput {
  conversationId: string;
  mediaId: string;
  /** Path to media: either '/api/media/<file>' format or absolute local path */
  mediaPath: string;
  mediaType: 'image/jpeg' | 'image/png' | 'video/mp4' | string;
  /** What did customer say about this photo? Provides context for analysis */
  customerContext?: string;
}

export interface VisionWorkerOutput {
  extraction: MediaExtraction;
  workerRun: {
    durationMs: number;
    tokenUsage: { input: number; output: number };
  };
}

/** Result from loading and encoding media (image or video) */
interface MediaData {
  base64: string;
  mediaType: string;
  isVideo: boolean;
}

// ==========================================
// IMAGE LOADING
// ==========================================

/**
 * Resolve media path to local file path.
 * Handles '/api/media/<file>' format and absolute paths.
 */
async function resolveMediaPath(mediaPath: string): Promise<string | null> {
  if (mediaPath.startsWith('/api/media/')) {
    const filename = path.basename(mediaPath);
    const localPath = await ensureLocalMedia(filename);
    if (!localPath) {
      console.warn(`[VisionWorker] Could not load media: ${mediaPath}`);
      return null;
    }
    return localPath;
  }
  return mediaPath;
}

/**
 * Check if a media type is video.
 */
function isVideoMediaType(mediaType: string): boolean {
  return mediaType.startsWith('video/');
}

/**
 * Load an image and convert to base64 for vision API.
 *
 * Handles:
 * - '/api/media/<file>' paths (looks up local file, restores from S3 if needed)
 * - Absolute local file paths
 * - Resizes to MAX_IMAGE_DIM to control token costs
 * - Normalizes to JPEG for consistent handling
 *
 * @param mediaPath - Path to the image
 * @returns Base64 encoded image data, or null if loading failed
 */
export async function loadImageAsBase64(mediaPath: string): Promise<MediaData | null> {
  const filePath = await resolveMediaPath(mediaPath);
  if (!filePath) return null;

  try {
    const buffer = await sharp(filePath)
      .rotate() // Honour EXIF orientation
      .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return {
      base64: buffer.toString('base64'),
      mediaType: 'image/jpeg',
      isVideo: false,
    };
  } catch (error: any) {
    console.warn(`[VisionWorker] Failed to process image ${filePath}: ${error?.message}`);
    return null;
  }
}

/**
 * Load a video file as base64 for native video analysis.
 *
 * Gemini 2.5 Flash processes video natively — no keyframe extraction needed.
 * This provides better accuracy as the model sees motion, audio, and full context.
 *
 * @param mediaPath - Path to the video file
 * @param mediaType - MIME type (video/mp4, video/webm, etc.)
 * @returns Base64 encoded video data, or null if loading failed
 */
export async function loadVideoAsBase64(
  mediaPath: string,
  mediaType: string
): Promise<MediaData | null> {
  const filePath = await resolveMediaPath(mediaPath);
  if (!filePath) return null;

  try {
    // Check file size
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_VIDEO_SIZE_BYTES) {
      console.warn(
        `[VisionWorker] Video too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB > ${MAX_VIDEO_SIZE_BYTES / 1024 / 1024}MB limit`
      );
      return null;
    }

    // Read raw video file
    const buffer = await fs.readFile(filePath);

    console.log(
      `[VisionWorker] Loaded video: ${(stats.size / 1024 / 1024).toFixed(1)}MB, type=${mediaType}`
    );

    return {
      base64: buffer.toString('base64'),
      mediaType,
      isVideo: true,
    };
  } catch (error: any) {
    console.warn(`[VisionWorker] Failed to load video ${filePath}: ${error?.message}`);
    return null;
  }
}

/**
 * Load media (image or video) as base64 for vision API.
 *
 * Automatically detects media type and uses appropriate loading strategy:
 * - Images: Resized and converted to JPEG
 * - Videos: Loaded raw for native Gemini processing
 *
 * @param mediaPath - Path to the media file
 * @param mediaType - MIME type of the media
 * @returns Base64 encoded media data, or null if loading failed
 */
export async function loadMediaAsBase64(
  mediaPath: string,
  mediaType: string
): Promise<MediaData | null> {
  if (isVideoMediaType(mediaType)) {
    return loadVideoAsBase64(mediaPath, mediaType);
  }
  return loadImageAsBase64(mediaPath);
}

// ==========================================
// EXTRACTION PARSING
// ==========================================

interface VisionRawOutput {
  items?: Array<{
    type?: string;
    material?: string;
    condition?: string;
    location?: string;
    confidence?: 'high' | 'medium' | 'low';
  }>;
  defects?: Array<{
    type?: string;
    severity?: 'minor' | 'moderate' | 'major';
    description?: string;
    itemRef?: string;
  }>;
  textFound?: string[];
  whatIsShown?: string;
  whatIsMissing?: string;
}

/**
 * Parse and validate the raw LLM output into typed extraction data.
 */
function parseVisionOutput(raw: VisionRawOutput): {
  items: ExtractedItem[];
  defects: ExtractedDefect[];
  textFound: string[];
} {
  const items: ExtractedItem[] = (raw.items ?? []).map((item) => ({
    type: item.type ?? 'other',
    material: item.material,
    condition: item.condition,
    location: item.location,
    confidence: item.confidence ?? 'medium',
  }));

  const defects: ExtractedDefect[] = (raw.defects ?? [])
    .filter((d): d is typeof d & { type: string; severity: 'minor' | 'moderate' | 'major'; description: string } =>
      !!d.type && !!d.severity && !!d.description
    )
    .map((defect) => ({
      type: defect.type as ExtractedDefect['type'],
      severity: defect.severity,
      description: defect.description,
      itemRef: defect.itemRef,
    }));

  const textFound = (raw.textFound ?? []).filter((t): t is string => typeof t === 'string');

  return { items, defects, textFound };
}

/**
 * Calculate overall confidence score from extracted items.
 * Score is weighted by item confidence levels.
 */
function calculateConfidence(items: ExtractedItem[]): number {
  if (items.length === 0) return 0.3;

  const weights = { high: 1, medium: 0.7, low: 0.4 };
  const totalWeight = items.reduce((sum, item) => sum + weights[item.confidence], 0);
  const maxWeight = items.length;

  return 0.3 + (0.7 * (totalWeight / maxWeight));
}

// ==========================================
// MAIN WORKER
// ==========================================

/**
 * Run the vision worker to extract structured data from an image or video.
 *
 * This worker:
 * 1. Loads the media (image resized, video native)
 * 2. Sends to Gemini 2.5 Flash via OpenRouter for analysis
 * 3. Parses the structured JSON output
 * 4. Updates ConversationMemory with the extraction
 * 5. Logs the worker run for audit trail
 *
 * For videos, Gemini processes natively (no keyframe extraction) for best accuracy.
 *
 * @param input - Vision worker input with media path and context
 * @returns Extraction results and worker run metadata
 */
export async function runVisionWorker(input: VisionWorkerInput): Promise<VisionWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  // Load and encode the media (handles both images and videos)
  const mediaData = await loadMediaAsBase64(input.mediaPath, input.mediaType);
  if (!mediaData) {
    throw new Error(`Failed to load media: ${input.mediaPath}`);
  }

  // Build the user prompt with optional customer context
  const mediaTypeLabel = mediaData.isVideo ? 'video' : 'photo';
  const userPrompt = input.customerContext
    ? `Customer said: "${input.customerContext}"\n\nAnalyze this ${mediaTypeLabel} and extract structured information.`
    : `Analyze this ${mediaTypeLabel} and extract structured information for a handyman quote.`;

  // Call the vision model (different function for video vs image)
  let response: LLMResponse;
  try {
    if (mediaData.isVideo) {
      // Native video processing — Gemini analyzes all frames + audio
      response = await callLLMWithVideo(
        'vision',
        VISION_SYSTEM_PROMPT,
        { base64: mediaData.base64, mediaType: mediaData.mediaType },
        userPrompt,
        { jsonMode: true }
      );
    } else {
      // Image processing
      response = await callLLMWithImages(
        'vision',
        VISION_SYSTEM_PROMPT,
        [{ base64: mediaData.base64, mediaType: mediaData.mediaType }],
        userPrompt,
        { jsonMode: true }
      );
    }
  } catch (error: any) {
    // Log the failed run
    const memory = await getOrCreateMemory(input.conversationId);
    await appendWorkerRun(input.conversationId, {
      id: runId,
      worker: 'vision',
      model: 'gemini-2.5-flash',
      trigger: 'media_received',
      startedAt: new Date(start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      changes: [],
      error: error?.message ?? 'Unknown error',
      tokenUsage: null,
    });
    throw error;
  }

  // Parse the JSON response (strip markdown code blocks if present)
  let parsed: VisionRawOutput;
  try {
    const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    parsed = JSON.parse(raw);
  } catch (parseError) {
    console.warn(`[VisionWorker] Failed to parse JSON response: ${response.content.slice(0, 200)}...`);
    parsed = {};
  }

  const { items, defects, textFound } = parseVisionOutput(parsed);

  // Build the extraction result
  const extraction: MediaExtraction = {
    mediaId: input.mediaId,
    model: 'gemini-2.5-flash',
    extractedAt: new Date().toISOString(),
    items,
    defects,
    textFound,
    confidence: calculateConfidence(items),
    raw: response.content,
  };

  // Update conversation memory
  const memory = await getOrCreateMemory(input.conversationId);
  const existingExtractions = memory.mediaExtractions.filter(e => e.mediaId !== input.mediaId);

  await updateMemory(input.conversationId, {
    mediaExtractions: [...existingExtractions, extraction],
    readiness: memory.readiness === 'new' ? 'extracting_media' : memory.readiness,
  }, memory.version);

  // Log the worker run
  await appendWorkerRun(input.conversationId, {
    id: runId,
    worker: 'vision',
    model: response.model,
    trigger: 'media_received',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: [`mediaExtractions[${input.mediaId}]`],
    error: null,
    tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
  });

  return {
    extraction,
    workerRun: {
      durationMs: response.durationMs,
      tokenUsage: { input: response.usage.inputTokens, output: response.usage.outputTokens },
    },
  };
}

/**
 * Run vision extraction on multiple images for a conversation.
 *
 * Processes images in sequence (not parallel) to avoid rate limits
 * and to properly update memory with each extraction.
 *
 * @param conversationId - The conversation to update
 * @param mediaItems - Array of media items to process
 * @returns Array of extraction results
 */
export async function runVisionWorkerBatch(
  conversationId: string,
  mediaItems: Array<{ mediaId: string; mediaPath: string; mediaType: string; customerContext?: string }>
): Promise<VisionWorkerOutput[]> {
  const results: VisionWorkerOutput[] = [];

  for (const item of mediaItems) {
    try {
      const result = await runVisionWorker({
        conversationId,
        mediaId: item.mediaId,
        mediaPath: item.mediaPath,
        mediaType: item.mediaType,
        customerContext: item.customerContext,
      });
      results.push(result);
    } catch (error: any) {
      console.error(`[VisionWorker] Failed to process ${item.mediaId}: ${error?.message}`);
      // Continue with remaining items
    }
  }

  return results;
}
