const xlsx = require('xlsx');
const admin = require('firebase-admin');
const serviceAccount = require('./manual-9a47c-firebase-adminsdk-fbsvc-1da55e3430.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://manual-9a47c-default-rtdb.firebaseio.com'
});

const db = admin.database();

const wb = xlsx.readFile('관리자 금칙어.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

const gameColMap = {
  '전체게임': 1,
  '롤(LOL)': 3,
  '서든어택': 5,
  '패스오브엑자일': 7,
  '메이플스토리': 9,
  '로스트아크': 11,
  '디아블로4': 13
};

const result = {};
for (const [game, col] of Object.entries(gameColMap)) {
  result[game] = rows.slice(3)
    .map(r => r[col])
    .filter(v => v != null && v !== '')
    .map(v => String(v).trim());
}

console.log('업로드할 데이터:');
for (const [game, words] of Object.entries(result)) {
  console.log(`  ${game}: ${words.length}개 — [${words.slice(0,5).join(', ')}${words.length>5?'...':''}]`);
}

// 먼저 전체 초기화 후 mania 경로에 업로드
db.ref('/imi_badwords').set({ mania: result, bay: {} }).then(() => {
  console.log('\nFirebase /imi_badwords/mania 업로드 완료!');
  console.log('  /imi_badwords/bay 빈 객체로 초기화 (베이 금칙어 별도 등록 필요)');
  process.exit(0);
}).catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
