import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const assetsDir = path.resolve('src/assets');

async function convertToWebP() {
    const files = fs.readdirSync(assetsDir);
    const pngFiles = files.filter(f => f.endsWith('.png'));

    console.log(`Found ${pngFiles.length} PNG files to convert...`);

    for (const file of pngFiles) {
        const inputPath = path.join(assetsDir, file);
        const outputPath = path.join(assetsDir, file.replace('.png', '.webp'));

        const stats = fs.statSync(inputPath);
        const originalSize = (stats.size / 1024).toFixed(0);

        try {
            await sharp(inputPath)
                .webp({ quality: 80 })
                .toFile(outputPath);

            const newStats = fs.statSync(outputPath);
            const newSize = (newStats.size / 1024).toFixed(0);
            const savings = ((1 - newStats.size / stats.size) * 100).toFixed(0);

            console.log(`✅ ${file}: ${originalSize}KB → ${newSize}KB (${savings}% smaller)`);
        } catch (err) {
            console.error(`❌ Failed to convert ${file}:`, err.message);
        }
    }

    console.log('\n🎉 Conversion complete!');
}

convertToWebP();
