const fs = require('fs');
const path = require('path');

function inspectFileSystem() {
  const filePath = '/Users/abhi/StudioProjects/tinybit/node_modules/expo-file-system/build/index.d.ts';
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('--- expo-file-system build/index.d.ts ---');
    console.log(content.slice(0, 2000));
  } else {
    console.log('File not found:', filePath);
  }
}

inspectFileSystem();
