const mammoth = require('mammoth');
const path = require('path');
const file = path.join('비거래', '디아블로4 비거래 관련 자료.docx');
mammoth.extractRawText({path: file})
  .then(r => { console.log(r.value); })
  .catch(e => { console.error('ERR:', e.message); });
