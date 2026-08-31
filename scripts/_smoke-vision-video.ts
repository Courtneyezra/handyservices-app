/**
 * Smoke Test: Vision Worker with Video Support
 *
 * Tests:
 * 1. Image loading and processing
 * 2. Video loading (if test video exists)
 * 3. Gemini 2.5 Flash API connectivity
 * 4. Media type detection
 *
 * Run: npx tsx scripts/_smoke-vision-video.ts
 */

import 'dotenv/config';

import { loadImageAsBase64, loadVideoAsBase64, loadMediaAsBase64 } from '../server/workers/vision';
import { callLLMWithImages, callLLMWithVideo, MODELS } from '../server/llm/openrouter';
import fs from 'fs/promises';
import path from 'path';

const VERBOSE = process.argv.includes('--verbose');

async function log(label: string, status: '✓' | '✗' | '→', message: string) {
  console.log(`  ${status} ${label}: ${message}`);
}

async function findTestMedia(): Promise<{ images: string[]; videos: string[] }> {
  const mediaDir = path.join(process.cwd(), 'uploads');
  const images: string[] = [];
  const videos: string[] = [];

  try {
    const files = await fs.readdir(mediaDir);
    for (const file of files.slice(0, 20)) { // Check first 20 files
      const ext = path.extname(file).toLowerCase();
      const fullPath = path.join(mediaDir, file);

      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        images.push(fullPath);
      } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
        videos.push(fullPath);
      }
    }
  } catch {
    // uploads dir may not exist
  }

  return { images, videos };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Vision Worker + Video Support Smoke Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Check model configuration
  console.log('[1] Model Configuration');
  log('Vision model', '→', MODELS.vision);
  if (MODELS.vision === 'google/gemini-2.5-flash') {
    log('Model check', '✓', 'Using Gemini 2.5 Flash (correct)');
  } else {
    log('Model check', '✗', `Expected gemini-2.5-flash, got ${MODELS.vision}`);
    process.exit(1);
  }

  // 2. Find test media
  console.log('\n[2] Finding Test Media');
  const { images, videos } = await findTestMedia();
  log('Images found', images.length > 0 ? '✓' : '→', `${images.length} images`);
  log('Videos found', videos.length > 0 ? '✓' : '→', `${videos.length} videos`);

  // 3. Test image loading
  console.log('\n[3] Image Loading');
  if (images.length > 0) {
    const testImage = images[0];
    log('Test file', '→', path.basename(testImage));

    const imageData = await loadImageAsBase64(testImage);
    if (imageData) {
      log('Load result', '✓', `${(imageData.base64.length / 1024).toFixed(1)}KB base64, type=${imageData.mediaType}, isVideo=${imageData.isVideo}`);
    } else {
      log('Load result', '✗', 'Failed to load image');
    }
  } else {
    log('Skip', '→', 'No test images found');
  }

  // 4. Test video loading
  console.log('\n[4] Video Loading');
  if (videos.length > 0) {
    const testVideo = videos[0];
    log('Test file', '→', path.basename(testVideo));

    const videoData = await loadVideoAsBase64(testVideo, 'video/mp4');
    if (videoData) {
      log('Load result', '✓', `${(videoData.base64.length / 1024 / 1024).toFixed(2)}MB base64, type=${videoData.mediaType}, isVideo=${videoData.isVideo}`);
    } else {
      log('Load result', '✗', 'Failed to load video (may exceed 25MB limit)');
    }
  } else {
    log('Skip', '→', 'No test videos found');
  }

  // 5. Test media type detection
  console.log('\n[5] Media Type Detection');
  if (images.length > 0) {
    const imgResult = await loadMediaAsBase64(images[0], 'image/jpeg');
    log('Image detection', imgResult?.isVideo === false ? '✓' : '✗', `isVideo=${imgResult?.isVideo}`);
  }
  if (videos.length > 0) {
    const vidResult = await loadMediaAsBase64(videos[0], 'video/mp4');
    log('Video detection', vidResult?.isVideo === true ? '✓' : '✗', `isVideo=${vidResult?.isVideo}`);
  }

  // 6. Test Gemini 2.5 Flash API (with image)
  console.log('\n[6] Gemini 2.5 Flash API Test');
  if (images.length > 0) {
    const imageData = await loadImageAsBase64(images[0]);
    if (imageData) {
      try {
        log('API call', '→', 'Sending image to Gemini 2.5 Flash...');
        const start = Date.now();

        const response = await callLLMWithImages(
          'vision',
          'Describe what you see in this image in one sentence. Output JSON: {"description": "..."}',
          [{ base64: imageData.base64, mediaType: imageData.mediaType }],
          'What is in this image?',
          { jsonMode: true, maxTokens: 100 }
        );

        const duration = Date.now() - start;
        log('API response', '✓', `${duration}ms, ${response.usage.inputTokens}+${response.usage.outputTokens} tokens`);

        if (VERBOSE) {
          console.log('\n  Response content:');
          console.log('  ' + response.content.slice(0, 200));
        }
      } catch (error: any) {
        log('API call', '✗', error.message);
      }
    }
  } else {
    log('Skip', '→', 'No test images for API test');
  }

  // 7. Test video API (if video exists and is small enough)
  console.log('\n[7] Video API Test');
  if (videos.length > 0) {
    const videoData = await loadVideoAsBase64(videos[0], 'video/mp4');
    if (videoData) {
      try {
        log('API call', '→', 'Sending video to Gemini 2.5 Flash...');
        const start = Date.now();

        const response = await callLLMWithVideo(
          'vision',
          'Describe what you see in this video in one sentence. Output JSON: {"description": "..."}',
          { base64: videoData.base64, mediaType: videoData.mediaType },
          'What is shown in this video?',
          { jsonMode: true, maxTokens: 100 }
        );

        const duration = Date.now() - start;
        log('API response', '✓', `${duration}ms, ${response.usage.inputTokens}+${response.usage.outputTokens} tokens`);

        if (VERBOSE) {
          console.log('\n  Response content:');
          console.log('  ' + response.content.slice(0, 200));
        }
      } catch (error: any) {
        log('API call', '✗', error.message);
      }
    } else {
      log('Skip', '→', 'Video too large or failed to load');
    }
  } else {
    log('Skip', '→', 'No test videos for API test');
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Smoke test complete');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
