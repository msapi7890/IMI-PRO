const AdmZip = require('adm-zip');
const path = require('path');

try {
  const zip = new AdmZip(path.join('비거래', '디아블로4 비거래 관련 자료.docx'));
  console.log('파일 목록:');
  zip.getEntries().forEach(e => console.log(' ', e.entryName, e.header.size));

  const xml = zip.readAsText('word/document.xml');
  console.log('\n--- document.xml 원본 (앞 3000자) ---');
  console.log(xml.slice(0, 3000));
} catch(e) {
  console.error('ERR:', e.message);
}
