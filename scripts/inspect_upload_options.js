const fs = require('fs');

function inspectUploadOptions() {
  const filePath = '/Users/abhi/StudioProjects/tinybit/node_modules/expo-file-system/build/NetworkTasks.types.d.ts';
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('--- NetworkTasks.types.d.ts ---');
    console.log(content);
  } else {
    console.log('File not found:', filePath);
  }
}

inspectUploadOptions();
