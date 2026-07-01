const fs = require('fs');
const path = require('path');

function findFile(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules') findFile(fullPath);
    } else {
      if (file.toLowerCase().includes('file.js') || file.toLowerCase().includes('file.ts')) {
        console.log('Found:', fullPath);
      }
    }
  }
}

findFile('/Users/abhi/StudioProjects/tinybit/node_modules/expo-file-system');
