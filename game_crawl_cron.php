<?php
/**
 * game_crawl_cron.php — 비거래 게임 용어 주간 자동 학습 (cron 실행용)
 *
 * 동작: 13개 게임의 나무위키 문서 + game_crawl_sources(추가 등록 URL)를 크롤링하여
 *       Claude가 비거래 관련 용어를 추출 → game_knowledge에 신규 용어만 누적 저장.
 *
 * cron 등록 예 (매주 월요일 04:00):
 *   0 4 * * 1 php /var/www/html/game_crawl_cron.php >> /var/log/game_crawl.log 2>&1
 *
 * 수동 테스트:  php game_crawl_cron.php
 */
set_time_limit(0);
mb_internal_encoding('UTF-8');

$API   = 'http://1.221.202.77:20002/api.php';
$PROXY = 'http://1.221.202.77:20002/claude-proxy.php';

// 기본 게임 목록 (나무위키 문서명 기준 — 부정확하면 game_crawl_sources에 정확한 URL 보강)
$GAMES = [
    '메이플스토리',
    '메이플랜드',
    '아이온2',
    '디아블로 2',
    '디아블로 4',
    '바람의나라',
    '던전앤파이터',
    '로스트아크',
    '리니지',
    '월드 오브 워크래프트',
    '서든어택',
    '패스 오브 엑자일 2',
    '메이플플래닛',
];

function api_call($action, $path, $data = null) {
    global $API;
    $body = ['action' => $action, 'path' => $path];
    if ($data !== null) $body['data'] = $data;
    $ch = curl_init($API);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 25,
    ]);
    $r = curl_exec($ch);
    curl_close($ch);
    $j = json_decode($r, true);
    return (isset($j['data'])) ? $j['data'] : null;
}

/** 단순 GET 크롤링 (검색 결과 페이지용) */
function http_get($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        CURLOPT_HTTPHEADER => ['Accept-Language: ko-KR,ko;q=0.9'],
    ]);
    $r = curl_exec($ch);
    curl_close($ch);
    return $r ?: '';
}

/** DuckDuckGo HTML 검색 → 상위 결과 URL 배열 (인벤·커뮤니티 등 자동 수집) */
function ddg_search($query, $max = 3) {
    $html = http_get('https://html.duckduckgo.com/html/?q=' . urlencode($query) . '&kl=kr-kr');
    $urls = [];
    if (preg_match_all('/<a[^>]+class="result__a"[^>]+href="([^"]+)"/i', $html, $m)) {
        foreach ($m[1] as $href) {
            $real = $href;
            if (preg_match('/uddg=([^&]+)/', $href, $u)) $real = urldecode($u[1]);
            $real = html_entity_decode($real);
            if (strpos($real, 'http') === 0) $urls[] = $real;
            if (count($urls) >= $max) break;
        }
    }
    return $urls;
}

/** 한 URL을 크롤링해 비거래 용어 배열 반환 */
function crawl_terms($game, $url) {
    global $PROXY;
    $prompt = "[{$game}] 게임 관련 페이지를 분석해서, 아이템매니아 같은 거래 플랫폼에서 "
        . "비거래(대리/버스/순방/작/캐리/육성대행/계정거래/귀속아이템 등)와 관련될 수 있는 게임 용어와 은어를 추출하세요.\n\n"
        . "특히 직업명·스킬명·사냥터·콘텐츠명 자체는 중립이지만 '버스/순방/대리/작/캐리/팟/주차' 등과 조합되면 비거래 서비스를 뜻하는 은어가 됩니다. 그런 조합 패턴과 은어도 적극 추출하세요.\n\n"
        . "반드시 아래 JSON 배열 형식으로만 반환하세요:\n"
        . "[{\"term\":\"용어 또는 은어\",\"meaning\":\"의미 + 어떤 맥락·조합에서 비거래로 쓰이는지 구체적으로\",\"type\":\"대리_플레이 또는 버스_서비스 또는 귀속_아이템 또는 계정거래 중 하나\"}]\n\n"
        . "단어 단독으로는 중립이어도 비거래 은어로 자주 쓰이면 포함하되, meaning에 '단독은 정상, ~와 함께면 비거래'처럼 맥락을 명시하세요. 없으면 빈 배열 []을 반환하세요.";
    $body = [
        'model' => 'claude-haiku-4-5-20251001',
        'max_tokens' => 2048,
        'system' => '당신은 게임 커뮤니티 전문가입니다. 게임 용어를 정확히 분석하고 JSON 형식으로만 답변합니다.',
        'messages' => [['role' => 'user', 'content' => [['type' => 'text', 'text' => $prompt]]]],
        'fetchUrl' => $url,
    ];
    $ch = curl_init($PROXY);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 70,
    ]);
    $r = curl_exec($ch);
    curl_close($ch);
    $j = json_decode($r, true);
    $txt = isset($j['content'][0]['text']) ? $j['content'][0]['text'] : '';
    $txt = preg_replace('/```json\s*/', '', $txt);
    $txt = preg_replace('/```/', '', $txt);
    if (preg_match('/\[[\s\S]*\]/', $txt, $m)) {
        $arr = json_decode($m[0], true);
        if (is_array($arr)) return $arr;
    }
    return [];
}

/** 실제 비거래 처리된 판매글 제목 목록에서 은어·패턴 추출 */
function learn_from_blocked($titles) {
    global $PROXY;
    if (empty($titles)) return [];
    $list = '';
    foreach ($titles as $i => $t) { $list .= ($i + 1) . '. ' . $t . "\n"; }
    $prompt = "아래는 아이템매니아에서 실제로 '비거래'로 판정되어 제외된 게임 판매글 제목들입니다.\n"
        . "여기서 반복적으로 나타나는 비거래 은어·표현·조합 패턴을 추출하세요. "
        . "각 은어가 어떤 게임의 것인지 추정하고, 왜 비거래인지 설명하세요. "
        . "직업명·콘텐츠명 단독이 아니라 '버스/순방/대리/작/캐리/팟/주차' 등과 결합된 실제 은어 패턴에 주목하세요.\n\n"
        . "[제외된 판매글 제목]\n" . $list . "\n"
        . "JSON 배열로만 반환:\n"
        . "[{\"term\":\"은어/패턴\",\"meaning\":\"의미와 비거래로 보는 이유\",\"game\":\"추정 게임명\",\"type\":\"대리_플레이 또는 버스_서비스 또는 귀속_아이템 또는 계정거래 중 하나\"}]\n\n"
        . "확실한 비거래 은어만 추출하세요. 없으면 빈 배열 [].";
    $body = [
        'model' => 'claude-haiku-4-5-20251001',
        'max_tokens' => 3000,
        'system' => '당신은 게임 아이템 거래 플랫폼의 비거래 탐지 전문가입니다. JSON 형식으로만 답변합니다.',
        'messages' => [['role' => 'user', 'content' => [['type' => 'text', 'text' => $prompt]]]],
    ];
    $ch = curl_init($PROXY);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 90,
    ]);
    $r = curl_exec($ch);
    curl_close($ch);
    $j = json_decode($r, true);
    $txt = isset($j['content'][0]['text']) ? $j['content'][0]['text'] : '';
    $txt = preg_replace('/```json\s*/', '', $txt);
    $txt = preg_replace('/```/', '', $txt);
    if (preg_match('/\[[\s\S]*\]/', $txt, $m)) {
        $arr = json_decode($m[0], true);
        if (is_array($arr)) return $arr;
    }
    return [];
}

// ── 추가 등록 URL (게임별) ── {게임명: [url, ...]}
$sources = api_call('get', 'game_crawl_sources');
if (!is_array($sources)) $sources = [];

// ── 기존 용어 (중복 방지) ──
$existing = api_call('get', 'game_knowledge');
if (!is_array($existing)) $existing = [];
$seen = [];
foreach ($existing as $v) {
    if (isset($v['term'], $v['game'])) $seen[mb_strtolower($v['game'] . '|' . $v['term'])] = true;
}

$totalSaved = 0;
foreach ($GAMES as $game) {
    $urls = ['https://namu.wiki/w/' . rawurlencode($game)];
    // 검색엔진으로 추가 소스 자동 수집 — 인벤·디시 커뮤니티 집중 + 일반
    $urls = array_merge($urls, ddg_search($game . ' 버스 순방 대리 작 용어 site:inven.co.kr', 2));
    $urls = array_merge($urls, ddg_search($game . ' 버스 순방 대리 작업장 site:dcinside.com', 2));
    $urls = array_merge($urls, ddg_search($game . ' 작업장 대리 현질 계정거래 비매너 용어', 2));
    // 게임별 직접 등록 URL
    if (isset($sources[$game]) && is_array($sources[$game])) {
        $urls = array_merge($urls, $sources[$game]);
    }
    $urls = array_values(array_unique($urls));
    foreach ($urls as $url) {
        $terms = crawl_terms($game, $url);
        foreach ($terms as $t) {
            if (empty($t['term']) || empty($t['meaning'])) continue;
            $sig = mb_strtolower($game . '|' . $t['term']);
            if (isset($seen[$sig])) continue;
            $seen[$sig] = true;
            api_call('push', 'game_knowledge', [
                'term'      => $t['term'],
                'meaning'   => $t['meaning'],
                'game'      => $game,
                'type'      => isset($t['type']) ? $t['type'] : '',
                'source'    => 'auto_cron',
                'sourceUrl' => $url,
                'addedAt'   => round(microtime(true) * 1000),
            ]);
            $totalSaved++;
        }
        usleep(500000); // 0.5s 간격 (서버/API 부하 완화)
    }
    echo "  [{$game}] 완료\n";
}

// ── 실제 비거래 처리 데이터 학습 (현장 은어) ──
$blocked = api_call('get', 'imi_blocked');
if (is_array($blocked)) {
    $titles = [];
    foreach ($blocked as $b) {
        if (is_array($b) && (isset($b['type']) ? $b['type'] : '') === 'watch' && !empty($b['title'])) {
            $titles[] = $b['title'];
        }
    }
    $titles = array_slice(array_values(array_unique(array_reverse($titles))), 0, 120);
    if (count($titles)) {
        foreach (learn_from_blocked($titles) as $p) {
            if (empty($p['term']) || empty($p['meaning'])) continue;
            $g = !empty($p['game']) ? $p['game'] : '공통';
            $sig = mb_strtolower($g . '|' . $p['term']);
            if (isset($seen[$sig])) continue;
            $seen[$sig] = true;
            api_call('push', 'game_knowledge', [
                'term'    => $p['term'],
                'meaning' => $p['meaning'],
                'game'    => $g,
                'type'    => isset($p['type']) ? $p['type'] : '',
                'source'  => 'real_data',
                'addedAt' => round(microtime(true) * 1000),
            ]);
            $totalSaved++;
        }
        echo "  [실제 비거래 데이터 학습] 완료\n";
    }
}

api_call('set', 'game_crawl_last', ['at' => round(microtime(true) * 1000), 'saved' => $totalSaved]);
echo "✅ 전체 완료 — 신규 용어 {$totalSaved}개 저장\n";
