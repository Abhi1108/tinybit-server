const fs = require('fs');

function inspectFileJs() {
  const filePath = '/Users/abhi/StudioProjects/tinybit/node_modules/expo-file-system/build/File.js';
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('--- File.js upload implementation ---');
    
    // Find the upload method
    const uploadMethod = content.match(/upload\([^)]*\)\s*{[^}]*}/s);
    if (uploadMethod) {
      console.log(uploadMethod[0]);
    } else {
      // Print lines around "upload("
      const lines = content.split('\n');
      const index = lines.findIndex(l => l.includes('upload('));
      if (index !== -1) {
        console.log(lines.slice(index, index + 30).join('\n'));
      } else {
        console.log(content.slice(0, 1500));
      }
    }
  } else {
    console.log('File not found:', filePath);
  }
}

inspectFileJs();
