const AdmZip = require('adm-zip');
const path = require('path');

try {
  const zip = new AdmZip(path.join('비거래', '디아블로4 비거래 관련 자료.docx'));
  const xml = zip.readAsText('word/document.xml');
  // 태그 제거 후 텍스트만 추출
  const text = xml
    .replace(/<w:br[^/]*/g, '\n')
    .replace(/<w:p[ >][^<]*/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
  console.log(text);
} catch(e) {
  console.error('ERR:', e.message);
}
