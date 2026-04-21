import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const publicDir = path.resolve('public');
const files = fs.readdirSync(publicDir);

for (const file of files) {
  if (file.endsWith('.png') && file !== 'favicon.png' && !file.startsWith('icon-')) {
    const filePath = path.join(publicDir, file);
    const webpPath = path.join(publicDir, file.replace('.png', '.webp'));
    
    sharp(filePath)
      .webp({ quality: 80 })
      .toFile(webpPath)
      .then(() => {
        console.log(`Converted ${file} to WebP`);
        fs.unlinkSync(filePath); // delete original
      })
      .catch(err => console.error(err));
  }
}
