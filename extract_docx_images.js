const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const zip = new AdmZip(path.join('비거래', '디아블로4 비거래 관련 자료.docx'));
const outDir = path.join('비거래', 'docx_images');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

zip.getEntries().forEach(e => {
  if (e.entryName.startsWith('word/media/')) {
    const name = path.basename(e.entryName);
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, e.getData());
    console.log('저장:', outPath, e.header.size, 'bytes');
  }
});
console.log('완료');
