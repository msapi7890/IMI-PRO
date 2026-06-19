<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$tid = isset($_GET['tid']) ? trim($_GET['tid']) : '';
if (!$tid) { echo json_encode(['exists' => null]); exit; }

$url = 'https://www.itemmania.com/sell/application.html?id=' . urlencode($tid);
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    CURLOPT_HTTPHEADER => ['Accept-Language: ko-KR,ko;q=0.9'],
]);
$html = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($html === false || $httpCode === 0) {
    echo json_encode(['exists' => null]);
    exit;
}

// 삭제된 아이템: JS로 myroom 리다이렉트
$exists = preg_match('/location\.href.*myroom/i', $html) ? false : true;

echo json_encode(['exists' => $exists]);
