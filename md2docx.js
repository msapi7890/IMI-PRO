/* md2docx.js — 간단 Markdown → Word(.docx) 변환기 (adm-zip 사용, 추가 설치 불필요)
   지원: # ## ### 제목, **굵게**, 표(|), - 목록/체크박스, > 인용, --- 구분선, [텍스트](링크)
   사용: node md2docx.js "입력.md" "출력.docx" */
const fs = require('fs');
const AdmZip = require('adm-zip');

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// 인라인 처리: 링크 → 텍스트, **굵게** 토글
function inlineRuns(text, base){
  base = base || {};
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1'); // 링크는 표시 텍스트만
  var runs = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach(function(p){
    if(!p) return;
    var bold = !!base.bold;
    var t = p;
    if(/^\*\*[\s\S]+\*\*$/.test(p)){ bold = true; t = p.slice(2,-2); }
    runs.push({ text:t, bold:bold, italic:!!base.italic, color:base.color, sz:base.sz });
  });
  if(!runs.length) runs.push({ text:'', bold:!!base.bold, sz:base.sz, color:base.color });
  return runs;
}

function runXml(r){
  var rpr = '';
  if(r.bold) rpr += '<w:b/>';
  if(r.italic) rpr += '<w:i/>';
  if(r.color) rpr += '<w:color w:val="'+r.color+'"/>';
  if(r.sz){ rpr += '<w:sz w:val="'+r.sz+'"/><w:szCs w:val="'+r.sz+'"/>'; }
  return '<w:r><w:rPr>'+rpr+'</w:rPr><w:t xml:space="preserve">'+esc(r.text)+'</w:t></w:r>';
}

function paraXml(runs, opt){
  opt = opt || {};
  var ppr = '<w:pPr>';
  ppr += '<w:spacing w:before="'+(opt.before||0)+'" w:after="'+(opt.after||100)+'" w:line="288" w:lineRule="auto"/>';
  if(opt.indent) ppr += '<w:ind w:left="'+opt.indent+'"/>';
  if(opt.shade) ppr += '<w:shd w:val="clear" w:color="auto" w:fill="'+opt.shade+'"/>';
  var bdr = '';
  if(opt.border) bdr += '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/>';
  if(opt.leftBar) bdr += '<w:left w:val="single" w:sz="18" w:space="6" w:color="2E5496"/>';
  if(bdr) ppr += '<w:pBdr>'+bdr+'</w:pBdr>';
  ppr += '</w:pPr>';
  return '<w:p>'+ppr+ runs.map(runXml).join('') +'</w:p>';
}

function tableXml(rows){
  // rows: array of array of cell-strings, 첫 행 = 헤더
  var cols = rows[0].length;
  var total = 9400;
  var w = Math.floor(total / cols);
  var borders = '<w:tblBorders>'+
    ['top','left','bottom','right','insideH','insideV'].map(function(s){
      return '<w:'+s+' w:val="single" w:sz="4" w:space="0" w:color="B0B6C0"/>';
    }).join('')+'</w:tblBorders>';
  var cellMar = '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>'+
                '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';
  var xml = '<w:tbl><w:tblPr><w:tblW w:w="'+total+'" w:type="dxa"/><w:jc w:val="center"/>'+borders+cellMar+'</w:tblPr>';
  xml += '<w:tblGrid>'+Array(cols).fill('<w:gridCol w:w="'+w+'"/>').join('')+'</w:tblGrid>';
  rows.forEach(function(cells, ri){
    var isHead = ri === 0;
    xml += '<w:tr>';
    for(var c=0;c<cols;c++){
      var txt = cells[c]!==undefined ? cells[c] : '';
      var shd = isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="2E5496"/>'
                       : (ri % 2 === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F4F6FA"/>' : '');
      var runs = inlineRuns(txt, { bold:isHead, sz:21, color: isHead ? 'FFFFFF' : '222222' });
      xml += '<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>'+shd+'<w:vAlign w:val="center"/></w:tcPr>'+
             '<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="264" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>'+
             runs.map(runXml).join('')+'</w:p></w:tc>';
    }
    xml += '</w:tr>';
  });
  xml += '</w:tbl>';
  return xml;
}

function mdToBody(md){
  var lines = md.split(/\r?\n/);
  var body = '';
  var i = 0;
  while(i < lines.length){
    var line = lines[i];
    var t = line.trim();

    // 표 블록
    if(/^\|.*\|$/.test(t)){
      var tbl = [];
      while(i < lines.length && /^\|.*\|$/.test(lines[i].trim())){
        var row = lines[i].trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(s){return s.trim();});
        if(!row.every(function(c){ return /^:?-{2,}:?$/.test(c) || c===''; })) tbl.push(row); // 구분행 제외
        i++;
      }
      if(tbl.length) body += tableXml(tbl);
      continue;
    }

    if(t === ''){ i++; continue; }

    if(/^#{1,6}\s/.test(t)){
      var level = t.match(/^(#{1,6})/)[1].length;
      var txt = t.replace(/^#{1,6}\s/, '');
      var sz = level===1?36:level===2?30:level===3?26:24;
      var color = level===1?'1F3864':level===2?'2E5496':'333333';
      body += paraXml(inlineRuns(txt, { bold:true, sz:sz, color:color }), { before: level<=2?160:120, after:80 });
      i++; continue;
    }

    if(/^---+$/.test(t) || /^___+$/.test(t)){
      body += paraXml([{text:''}], { border:true, after:60 });
      i++; continue;
    }

    if(/^>\s?/.test(t)){
      var qt = t.replace(/^>\s?/, '');
      body += paraXml(inlineRuns(qt, { color:'1F3864', sz:22 }), { indent:240, after:100, shade:'EEF2F9', leftBar:true });
      i++; continue;
    }

    var mli = t.match(/^([-*])\s+(.*)$/);
    if(mli){
      var item = mli[2].replace(/^\[ \]\s*/, '☐ ').replace(/^\[[xX]\]\s*/, '☑ ');
      body += paraXml(inlineRuns('•  ' + item, { sz:22, color:'222222' }), { indent:360, after:60 });
      i++; continue;
    }

    var mol = t.match(/^(\d+)\.\s+(.*)$/);
    if(mol){
      body += paraXml(inlineRuns(mol[1] + '.  ' + mol[2], { sz:22, color:'222222' }), { indent:360, after:60 });
      i++; continue;
    }

    body += paraXml(inlineRuns(t, { sz:22, color:'222222' }), { after:100 });
    i++;
  }
  return body;
}

function buildDocx(md, outPath){
  var body = mdToBody(md);
  var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
    '<w:body>'+ body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'+
    '</w:body></w:document>';

  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '</Types>';

  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
    '</Relationships>';

  var zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  zip.writeZip(outPath);
  console.log('✅ 생성:', outPath);
}

var inPath = process.argv[2], outPath = process.argv[3];
if(!inPath || !outPath){ console.error('사용법: node md2docx.js 입력.md 출력.docx'); process.exit(1); }
buildDocx(fs.readFileSync(inPath, 'utf8'), outPath);
