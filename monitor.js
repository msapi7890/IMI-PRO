// EXE 토스트 클릭 → 모니터링 현황 이동
if (window.electronAPI && window.electronAPI.onNavMonhw) {
    window.electronAPI.onNavMonhw(function() {
        window._navMonhwPending = true; // 로드 시 기본탭(공지)이 덮지 않도록
        var go = function(){ if (typeof window._imiNavSwitch === 'function') window._imiNavSwitch('monhw'); };
        go();
        setTimeout(go, 200); // 직후 기본탭 전환과 경쟁 시 한 번 더
    });
}

// ===== IMI BOT 상태 대시보드 =====
// Firebase SDK initializeApp 없이 REST API 직접 통신
var _MON_FB  = 'https://manual-9a47c-default-rtdb.firebaseio.com';
var _MON_KEY = 'AIzaSyDc3L_8IfVJxjIkv1tnOXRy_tQx3fSPxOI';
var _monFbTok = null;
var _monFbTokExp = 0;

function _monGetToken() {
    if (_monFbTok && Date.now() < _monFbTokExp) return Promise.resolve(_monFbTok);
    if (typeof _fbRestToken !== 'undefined' && _fbRestToken) return Promise.resolve(_fbRestToken);
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + _MON_KEY, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email:'imiprobot@gmail.com', password:'mania3001!', returnSecureToken:true})
    }).then(function(r){ return r.json(); }).then(function(d){
        if (d && d.idToken) { _monFbTok = d.idToken; _monFbTokExp = Date.now() + 55*60*1000; return d.idToken; }
        return '';
    }).catch(function(){ return ''; });
}

function _monSnap(path, val) {
    return {
        val: function(){ return val; },
        key: path ? path.split('/').pop() : null,
        exists: function(){ return val !== null && val !== undefined; },
        forEach: function(cb){ if(val && typeof val==='object') Object.keys(val).forEach(function(k){ cb(_monSnap(path+'/'+k, val[k])); }); },
        child: function(cp){ return _monSnap(path+'/'+cp, val&&typeof val==='object'?val[cp]:undefined); }
    };
}

// Firebase 실시간 스트리밍(SSE 푸시) — 봇이 쓰는 즉시 받음 (폴링 텀 없음). 끊기면 자동 재연결.
function _fbStream(path, onData) {
    var es = null, node = {}, renewTimer = null;
    function setNode(p, data) {
        if (p === '/' || p === '') { node = (data && typeof data === 'object') ? data : {}; return; }
        var key = p.replace(/^\//, '').split('/')[0];
        if (!node || typeof node !== 'object') node = {};
        if (data === null || data === undefined) delete node[key];
        else node[key] = data;
    }
    function connect() {
        if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
        _monGetToken().then(function(tok) {
            try {
                if (es) { try { es.close(); } catch (_) {} es = null; }
                es = new EventSource(_MON_FB + '/' + path + '.json' + (tok ? '?auth=' + tok : ''));
                es.addEventListener('put', function(e) {
                    try { var m = JSON.parse(e.data); setNode(m.path, m.data); onData(node); } catch (_) {}
                });
                es.addEventListener('patch', function(e) {
                    try {
                        var m = JSON.parse(e.data);
                        if ((m.path === '/' || m.path === '') && m.data && typeof m.data === 'object') {
                            if (!node || typeof node !== 'object') node = {};
                            Object.keys(m.data).forEach(function(k) { node[k] = m.data[k]; });
                        } else { setNode(m.path, m.data); }
                        onData(node);
                    } catch (_) {}
                });
                es.onerror = function() { try { if (es) es.close(); } catch (_) {} es = null; setTimeout(connect, 5000); };
            } catch (_) { setTimeout(connect, 5000); }
        }).catch(function() { setTimeout(connect, 5000); });
        renewTimer = setTimeout(connect, 50 * 60 * 1000); // 토큰 만료 전 재연결
    }
    connect();
}

var _mDb = (function(){
    function makeRef(path, lim) {
        path = (path||'').replace(/^\/+/,'').replace(/\/+$/,'');
        var _timers = [];
        function doGet(){
            return _monGetToken().then(function(tok){
                var url = _MON_FB+'/'+path+'.json'+(tok?'?auth='+tok:'');
                if(lim) url += (tok?'&':'?')+'orderBy="$key"&limitToLast='+lim;
                return fetch(url).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; });
            });
        }
        function doWrite(method, data){
            return _monGetToken().then(function(tok){
                return fetch(_MON_FB+'/'+path+'.json'+(tok?'?auth='+tok:''), {
                    method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
                });
            }).catch(function(){});
        }
        var self = {
            key: path?path.split('/').pop():null,
            child: function(cp){ return makeRef(path?path+'/'+cp:cp); },
            once: function(evt,cb){ return doGet().then(function(val){ var s=_monSnap(path,val); if(cb)cb(s); return s; }); },
            on: function(evt,cb,errCb){
                self.once(evt,cb);
                var t=setInterval(function(){ doGet().then(function(val){ cb(_monSnap(path,val)); }).catch(function(e){ if(errCb)errCb(e); }); },20000);
                _timers.push(t); return cb;
            },
            off: function(){ _timers.forEach(clearInterval); _timers=[]; },
            set: function(data,cb){ return doWrite('PUT',data).then(function(){ if(cb)cb(null); }).catch(function(e){ if(cb)cb(e); }); },
            update: function(data,cb){ return doWrite('PATCH',data).then(function(){ if(cb)cb(null); }).catch(function(e){ if(cb)cb(e); }); },
            remove: function(cb){ return _monGetToken().then(function(tok){ return fetch(_MON_FB+'/'+path+'.json'+(tok?'?auth='+tok:''),{method:'DELETE'}); }).then(function(){ if(cb)cb(null); }).catch(function(e){ if(cb)cb(e); }); },
            push: function(data,cb){ return _monGetToken().then(function(tok){ return fetch(_MON_FB+'/'+path+'.json'+(tok?'?auth='+tok:''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }).then(function(r){ return r.json(); }).then(function(d){ var nr=makeRef(path+'/'+(d&&d.name?d.name:Date.now())); if(cb)cb(null,nr); return nr; }).catch(function(e){ if(cb)cb(e); }); },
            limitToLast: function(n){ return makeRef(path,n); },
            orderByChild: function(){ return self; },
            equalTo: function(){ return self; },
            toString: function(){ return path; }
        };
        return self;
    }
    return { ref: function(path){ return makeRef(path||''); } };
})();

var _botStatus = null;
var _botBridgeConnected = false;

// 확장프로그램 브릿지 연결 감지 + 푸시 알림 수신
window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.__imiBotConnected) {
        var wasConnected = _botBridgeConnected;
        _botBridgeConnected = true;
        _updateBotToggleBtn();
        if (!wasConnected) {
            _sendToBot({ type: 'SYNC_STATUS' });
        }
    }
    // 사기글 재감지 자동 닫기 신호
    if (e.data.__imiBotPush && e.data.type === 'FRAUD_CLEARED') {
        if (window._fraudCloseHandlers) {
            var _fcFn = window._fraudCloseHandlers[e.data.ruleId || '_'];
            if (_fcFn) _fcFn();
        }
    }
    // Firebase 오프라인 시 bridge 직접 푸시로 상태 수신
    if (e.data.type === 'BOT_STATUS_DIRECT' && e.data.status) {
        var s = e.data.status;
        var isFirebaseStale = !_botStatus || !_botStatus.lastUpdate || (Date.now() - _botStatus.lastUpdate) > 30000;
        if (isFirebaseStale) {
            _botStatus = s;
            _renderBotStatus();
            _updateHdrDot();
            _updateBotToggleBtn();
        }
    }
});

function _sendToBot(msg) {
    window.postMessage(Object.assign({ __imiBot: true }, msg), '*');
}

function _isBotPrivileged(){
    return typeof _currentUser !== 'undefined' && _currentUser &&
           (_currentUser.role === 'admin' || _currentUser.role === 'subadmin');
}

var _botTogglePending = false;
var _botToggleExpected = null; // 'start' | 'stop'

function toggleBotFromWeb() {
    if(!_isBotPrivileged()){ alert('관리자 또는 부관리자만 봇을 제어할 수 있습니다.'); return; }
    var btn = document.getElementById('monBotToggleBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 전송 중...';
        btn.style.background = '#334155';
        btn.style.color = '#94a3b8';
    }
    _botTogglePending = true;
    if (_botStatus && _botStatus.active) {
        _botToggleExpected = 'stop';
        _mDb.ref('bot_cmd').set({ cmd: 'stop', ts: Date.now() });
        if (_botBridgeConnected) _sendToBot({ type: 'STOP_ALL' });
    } else {
        var rules = (_botStatus && _botStatus.rules) || [];
        var checkedIds = rules
            .filter(function(r) {
                var chk = document.getElementById('ruleChk_' + r.id);
                return chk && chk.checked;
            })
            .map(function(r) { return r.id; });
        if (!checkedIds.length) {
            alert('실행할 규칙을 하나 이상 체크해주세요.');
            _botTogglePending = false;
            if (btn) { btn.disabled = false; _updateBotToggleBtn(); }
            return;
        }
        _botToggleExpected = 'start';
        _mDb.ref('bot_cmd').set({ cmd: 'start', ruleIds: checkedIds, ts: Date.now() });
        if (_botBridgeConnected) _sendToBot({ type: 'START_SELECTED', ruleIds: checkedIds });
    }
    // 30초 후에도 Firebase 응답 없으면 버튼 복구
    setTimeout(function() {
        if (_botTogglePending) { _botTogglePending = false; _updateBotToggleBtn(); }
    }, 30000);
}

function _updateBotToggleBtn() {
    var btn = document.getElementById('monBotToggleBtn');
    if (!btn) return;

    if (!_isBotPrivileged()) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';

    var active = _botStatus && _botStatus.active;

    // 기대 상태로 실제로 바뀐 경우에만 pending 해제
    if (_botTogglePending) {
        var expectedActive = _botToggleExpected === 'start';
        if (active !== expectedActive) return; // 아직 안 바뀜 — 전송 중 유지
        _botTogglePending = false;
        _botToggleExpected = null;
    }
    if (active) {
        btn.textContent = '⏸ 봇 중지';
        btn.style.background = '#ef4444';
        btn.style.color = '#fff';
    } else {
        btn.textContent = '▶ 봇 시작';
        btn.style.background = '#22c55e';
        btn.style.color = '#fff';
    }
    btn.disabled = false;
}

// Firebase에서 봇 상태 실시간 구독 (auth 완료 후 재구독으로 permission_denied 복구)
function _subscribeBotStatus() {
    _mDb.ref('bot_status').off('value');
    _mDb.ref('bot_status').on('value', function(snap) {
        _botStatus = snap.val();
        _renderBotStatus();
        _updateHdrDot();
        _updateBotToggleBtn();
    });
}
_subscribeBotStatus(); // 초기 시도 (auth 캐시 있으면 즉시 성공)

/* 작업표시줄 🟢/🔴 주기적 동기화 — 타이밍 문제 방어 */
setInterval(function() {
    if (!window.electronAPI) return;
    var isActive = _botStatus && _botStatus.active;
    var isStale  = _botStatus && _botStatus.lastUpdate && (Date.now() - _botStatus.lastUpdate) > 5 * 60 * 1000;
    window.electronAPI.send('monitor-active', !!(isActive && !isStale));
}, 5000);

// REST API 방식은 auth 콜백 불필요 — 토큰은 _monGetToken()이 자동 처리

function _renderBotStatus() {
    var s = _botStatus;
    var dot     = document.getElementById('monitorDot');
    var text    = document.getElementById('monitorStatusText');
    var badge   = document.getElementById('monBotBadge');
    var lastUpd = document.getElementById('monLastUpdate');
    var ruleList= document.getElementById('monitorRuleList');

    /* 작업표시줄 🟢/🔴 — DOM 유무와 무관하게 항상 전송 */
    var _isActive = s && s.active;
    var _isStale  = s && s.lastUpdate && (Date.now() - s.lastUpdate) > 5 * 60 * 1000;
    if (window.electronAPI) window.electronAPI.send('monitor-active', !!(_isActive && !_isStale));

    if (!dot) return;

    if (!s) {
        dot.classList.remove('active');
        if (text) text.textContent = 'IMI BOT 미연결 — 확장프로그램을 실행하세요';
        if (badge) { badge.textContent = '오프라인'; badge.style.background = '#374151'; badge.style.color = '#6b7280'; }
        if (ruleList) {
            ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;">봇 연결 없음</div>';
        }
        return;
    }

    var isActive = s.active;
    var isStale = s.lastUpdate && (Date.now() - s.lastUpdate) > 5 * 60 * 1000; // 5분 이상 갱신 없음
    dot.classList.toggle('active', isActive && !isStale);

    if (text) {
        if (isStale) {
            text.textContent = '⚠ 연결 끊김 — 확장프로그램이 응답하지 않습니다';
        } else {
            text.textContent = isActive
                ? '감시 중 — ' + (s.activeCount || 0) + '개 규칙 실행 중'
                : '봇 중지됨 — ' + (s.totalCount || 0) + '개 규칙 등록됨';
        }
    }
    if (badge) {
        if (isStale) {
            badge.textContent  = '⚠ 연결 끊김';
            badge.style.background = '#78350f';
            badge.style.color      = '#fbbf24';
        } else {
            badge.textContent  = isActive ? '● 감시 중' : '■ 중지됨';
            badge.style.background = isActive ? '#166534' : '#374151';
            badge.style.color      = isActive ? '#4ade80'  : '#9ca3af';
        }
    }
    if (lastUpd && s.lastUpdate) {
        var mins = Math.floor((Date.now() - s.lastUpdate) / 60000);
        var timeStr = new Date(s.lastUpdate).toLocaleTimeString('ko-KR');
        lastUpd.textContent = isStale
            ? '마지막 동기화: ' + timeStr + ' (' + mins + '분 전)'
            : '마지막 동기화: ' + timeStr;
    }

    if (!ruleList) return;
    var rules = s.rules || [];
    if (!rules.length) {
        ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;font-style:italic;">등록된 규칙이 없습니다</div>';
        return;
    }
    // 사기글 먼저, 비거래 나중
    rules = rules.slice().sort(function(a, b) {
        return (a.type === 'watch' ? 1 : 0) - (b.type === 'watch' ? 1 : 0);
    });
    var canCtrl = _isBotPrivileged();
    ruleList.innerHTML = rules.map(function(r) {
        var liveRule = _botRules.find(function(br) { return br.id === r.id; });
        var isEnabled = liveRule !== undefined ? liveRule.enabled : r.enabled;
        var runColor = (isEnabled && r.tabOpen) ? '#22c55e' : (isEnabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (isEnabled && r.tabOpen) ? '● 감시중' : (isEnabled ? '○ 대기' : '■ 비활성');
        var chkId = 'ruleChk_' + r.id;
        var chkDisabled = canCtrl ? '' : 'disabled';
        var isWatch = r.type === 'watch';
        var borderColor = isWatch ? '#22c55e33' : '#ef444433';
        var typeTag = isWatch
            ? '<span style="font-size:9px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            : '<span style="font-size:9px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 5px;flex-shrink:0;">🚨 사기글</span>';
        return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid '+(isWatch?'#22c55e':'#ef4444')+';border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:'+(canCtrl?'pointer':'default')+';flex:1;min-width:0;">'
            + '<input type="checkbox" id="' + chkId + '" ' + (isEnabled ? 'checked' : '') + ' ' + chkDisabled + ' onchange="toggleBotRuleEnabled(\'' + _esc(r.id) + '\',this.checked)" style="width:15px;height:15px;cursor:'+(canCtrl?'pointer':'default')+';accent-color:var(--active-focus-color);">'
            + '<span style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.name) + '</span>'
            + '</label>'
            + typeTag
            + '<span style="font-size:10px;font-weight:900;color:' + runColor + ';flex-shrink:0;">' + runLabel + '</span>'
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword        ? '<span class="mon-tag">🔑 ' + _esc(r.keyword) + '</span>' : '')
            + (r.subKeyword     ? '<span class="mon-tag" style="color:#7dd3fc;border-color:#0284c7;">🔗 AND: ' + _esc(r.subKeyword) + '</span>' : '')
            + (r.minPrice       ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + (r.maxPrice       ? '<span class="mon-tag">💰 ' + Number(r.maxPrice).toLocaleString() + '원↓</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + (r.excludeKeyword ? '<span class="mon-tag">🚫 ' + _esc(r.excludeKeyword) + '</span>' : '')
            + (r.photoMinPrice   ? '<span class="mon-tag">📸 ' + Number(r.photoMinPrice).toLocaleString() + '원↑</span>' : '')
            + (r.noPhotoMinPrice ? '<span class="mon-tag">📝 ' + Number(r.noPhotoMinPrice).toLocaleString() + '원↑</span>' : '')
            + '</div>'
            + '</div>';
    }).join('');
}


function openMonitorModal() {
    _renderBotStatus();
    document.getElementById('monitorModal').classList.remove('hidden');
    window.postMessage({ __imiBotPing: true }, '*');
    _stopTabBlink('fraud');
}
function closeMonitorModal() { document.getElementById('monitorModal').classList.add('hidden'); }

function renderMonitorRules() {
    var list = document.getElementById('monitorRuleList');
    var entries = Object.entries(monitorRules);
    if (!entries.length) {
        list.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;font-style:italic;">등록된 감시 규칙이 없습니다</div>';
        return;
    }
    list.innerHTML = entries.map(function(e) {
        var id = e[0], r = e[1];
        return '<div class="mon-rule">'
            + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">'
            + '<div style="flex:1;font-size:13px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.name)+'</div>'
            + '<label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;font-weight:900;white-space:nowrap;flex-shrink:0;">'
            + '<input type="checkbox" onchange="toggleMonitorRule(\''+id+'\',this.checked)" '+(r.enabled?'checked':'')+'>'
            + '<span style="color:'+(r.enabled?'#22c55e':'#94a3b8')+'">'+(r.enabled?'활성':'비활성')+'</span></label>'
            + '<button id="montest_'+id+'" onclick="testMonitorRule(\''+id+'\')" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1.5px solid var(--active-focus-color);color:var(--active-focus-color);background:none;cursor:pointer;font-weight:900;white-space:nowrap;transition:0.15s;flex-shrink:0;">🔍 테스트</button>'
            + '<button onclick="deleteMonitorRule(\''+id+'\')" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;font-weight:900;white-space:nowrap;transition:0.15s;flex-shrink:0;" onmouseover="this.style.background=\'#ef4444\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'none\';this.style.color=\'#ef4444\'">삭제</button>'
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">'
            + (r.gameLabel ? '<span class="mon-tag">🎮 '+_esc(r.gameLabel)+'</span>' : '')
            + (r.keyword ? '<span class="mon-tag">🔑 '+_esc(r.keyword)+'</span>' : '')
            + (r.minPrice ? '<span class="mon-tag">💰 '+Number(r.minPrice).toLocaleString()+'원↑</span>' : '')
            + '<span class="mon-tag">📄 '+(r.maxPages||3)+'페이지</span>'
            + '</div>'
            + '<div style="font-size:9.5px;opacity:0.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.url||'')+'</div>'
            + '</div>';
    }).join('');
}

function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtTid(tid) {
    return String(tid||'').replace(/(.{4})(?=.)/g, '$1 ');
}

// 다중 CORS 프록시 자동 전환
async function _fetchViaProxy(url, postBody) {
    if (window.__tmConnected) return await tmFetch(url);

    // 1. 물리적(다이렉트) 접속 시도 (크롬 CORS 확장프로그램 켜져 있을 때 탬퍼몽키 없이 즉시 작동)
    try {
        var dirController = new AbortController();
        var dirTimer = setTimeout(function(){ dirController.abort(); }, 8000);
        var fetchOpts = { signal: dirController.signal, cache: 'no-store' };
        
        if (postBody) {
            fetchOpts.method = 'POST';
            fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            fetchOpts.body = postBody;
        }

        var dirRes;
        try { dirRes = await fetch(url, fetchOpts); }
        finally { clearTimeout(dirTimer); }
        if (dirRes && dirRes.ok) {
            var buffer = await dirRes.arrayBuffer();
            var decoder = new TextDecoder('euc-kr'); // 아이템매니아 한글 깨짐 방지
            var dirHtml = decoder.decode(buffer);
            if (dirHtml && dirHtml.length > 200) return dirHtml;
        } else if (dirRes) {
            throw new Error('서버 요청 실패 (상태코드: ' + dirRes.status + '). URL 또는 파라미터를 확인하세요.');
        }
    } catch(e) {
        if (postBody) {
            throw new Error('검색(POST) 요청이 실패했습니다. CORS 확장 프로그램이 켜져 있는지, 네트워크 연결이 정상인지 확인해주세요. (' + e.message + ')');
        }
        console.warn('[MON] 다이렉트 통신 차단됨, 무료 프록시로 우회합니다.');
    }

    var proxies = [
        { build: function(u){ return 'https://api.allorigins.win/get?disableCache=true&url='+encodeURIComponent(u); }, parse: function(r){ return r.json().then(function(d){ return d.contents||''; }); } },
        { build: function(u){ return 'https://corsproxy.io/?'+encodeURIComponent(u); }, parse: function(r){ return r.text(); } },
        { build: function(u){ return 'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u); }, parse: function(r){ return r.text(); } }
    ];
    for (var pi=0; pi<proxies.length; pi++) {
        var proxy = proxies[pi];
        try {
            var controller = new AbortController();
            var timer = setTimeout(function(){ controller.abort(); }, 12000);
            var res;
            try { res = await fetch(proxy.build(url), { signal: controller.signal }); }
            finally { clearTimeout(timer); }
            if (!res || !res.ok) continue;
            var html = await proxy.parse(res);
            if (html && html.length > 200) return html;
        } catch(e) { console.warn('[MON] proxy '+pi+' fail:', e.message); }
    }
    throw new Error('모든 프록시 실패 — 네트워크 또는 URL 확인 필요');
}

// EUC-KR 한글 인코딩 테이블 로드 및 변환 (아이템매니아 검색용)
window.eucKrTable = null;
async function getEucKrTable() {
    if (window.eucKrTable) return window.eucKrTable;
    try {
        var res = await fetch('https://encoding.spec.whatwg.org/index-euc-kr.txt');
        var text = await res.text();
        window.eucKrTable = {};
        var lines = text.split('\n');
        for (var i=0; i<lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '#') continue;
            var parts = line.split(/\s+/);
            if (parts.length >= 2) window.eucKrTable[parseInt(parts[1], 16)] = parseInt(parts[0], 10);
        }
    } catch(e) { console.warn('EUC-KR table fetch error:', e); }
    return window.eucKrTable;
}

async function encodeEucKrUrl(str) {
    var table = await getEucKrTable();
    if (!table) return encodeURIComponent(str);
    var res = '';
    for (var i=0; i<str.length; i++) {
        var code = str.charCodeAt(i);
        if (code <= 0x7F) res += encodeURIComponent(str.charAt(i));
        else if (table[code] !== undefined) res += '%' + (Math.floor(table[code] / 190) + 0x81).toString(16).toUpperCase() + '%' + ((table[code] % 190) + 0x41).toString(16).toUpperCase();
        else res += encodeURIComponent(str.charAt(i));
    }
    return res;
}

// 페이지 번호 URL 생성 및 HTML 가져오기 (있는 그대로 POST 전송)
async function _fetchPageHtml(baseUrl, page, keyword) {
    if (keyword) {
        var postUrl = baseUrl.split('?')[0];

        var qs = baseUrl.split('?')[1] || '';
        var pairs = qs.split('&');
        var postParts = [];
        for (var i = 0; i < pairs.length; i++) {
            if (!pairs[i]) continue;
            var key = pairs[i].split('=')[0];
            if (key !== 'page' && key !== 'search_word' && key !== 'searchWord') {
                postParts.push(pairs[i]);
            }
        }

        var mainKw = keyword.split(',')[0].trim();
        var encodedKw = await encodeEucKrUrl(mainKw);
        postParts.push('search_word=' + encodedKw);
        postParts.push('searchWord=' + encodedKw);

        if (page > 1) {
            postParts.push('page=' + page);
        }

        return await _fetchViaProxy(postUrl, postParts.join('&'));
    } else {
        var u = baseUrl;
        if (page > 1) {
            if (/[?&]page=\d+/.test(u)) u = u.replace(/([?&]page=)\d+/, '$1' + page);
            else u += (u.includes('?') ? '&' : '?') + 'page=' + page;
        }
        u += (u.includes('?') ? '&' : '?') + '_t=' + Date.now();
        return await _fetchViaProxy(u, null);
    }
}

async function testMonitorRule(id) {
    var rule = monitorRules[id];
    if (!rule) return;
    var btn = document.getElementById('montest_'+id);
    if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
    try {
        var maxPages = rule.maxPages || 3;
        var allItems = [], filteredItems = [], usedProxy = '';
        for (var page=1; page<=maxPages; page++) {
            var html = await _fetchPageHtml(rule.url, page, rule.keyword);
            var pageAll = _parseItemmaniaHtml(html, '', 0, rule.url||'');
            var pageFilt = _parseItemmaniaHtml(html, rule.keyword||'', rule.minPrice||0, rule.url||'');
            allItems = allItems.concat(pageAll);
            filteredItems = filteredItems.concat(pageFilt);
            if (pageAll.length === 0 && page > 1) break;
            if (page < maxPages) await new Promise(function(r){ setTimeout(r,800); });
        }
        var msg = '🔍 테스트 결과 — '+rule.name+'\n─────────────────────\n📄 확인한 페이지: '+maxPages+'페이지\n📄 전체 파싱된 물품: '+allItems.length+'개\n✅ 조건 일치 물품: '+filteredItems.length+'개\n\n';
        if (allItems.length === 0) {
            msg += '⚠️ 물품을 하나도 파싱하지 못했습니다.\n→ HTML 구조 파싱 실패 가능성.\n→ URL이 목록 페이지가 맞는지 확인하세요.';
        } else if (filteredItems.length === 0) {
            msg += '⚠️ 조건에 맞는 물품 없음\n';
            if (rule.keyword) msg += '→ 키워드 "'+rule.keyword+'" 없음\n';
            if (rule.minPrice) msg += '→ 최소가격 '+Number(rule.minPrice).toLocaleString()+'원 미충족\n';
            msg += '\n[ 파싱된 물품 예시 ]\n';
            allItems.slice(0,3).forEach(function(it,i){ msg += (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'')+'\n'; });
        } else {
            msg += '[ 감지된 물품 ]\n';
            filteredItems.slice(0,5).forEach(function(it,i){ msg += (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'')+'\n'; });
        }
        alert(msg);
    } catch(e) {
        alert('❌ '+e.message);
    } finally {
        if (btn) { btn.textContent = '🔍 테스트'; btn.disabled = false; }
    }
}

function toggleMonitorRule(id, enabled) { _mDb.ref('monitor_rules/'+id+'/enabled').set(enabled); }
function deleteMonitorRule(id) {
    if (!confirm('이 감시 규칙을 삭제하시겠습니까?')) return;
    var pw = prompt('관리자 비밀번호:');
    if (pw !== ADMIN_PW) { if (pw) alert('❌ 비밀번호 오류'); return; }
    _mDb.ref('monitor_rules/'+id).remove();
}

function addMonitorRule() {
    var name = (document.getElementById('mrName').value||'').trim();
    var url = (document.getElementById('mrUrl').value||'').trim();
    var keyword = (document.getElementById('mrKeyword').value||'').trim();
    var minPriceRaw = (document.getElementById('mrMinPrice').value||'').trim();
    var gameLabel = (document.getElementById('mrGame').value||'').trim();
    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요. (https://...)'); return; }
    if (!keyword && !minPriceRaw) { alert('키워드 또는 최소가격 중 하나는 입력해야 합니다.'); return; }
    var pw = prompt('관리자 비밀번호:');
    if (pw !== ADMIN_PW) { if (pw) alert('❌ 비밀번호 오류'); return; }
    var minPrice = minPriceRaw ? (parseInt(minPriceRaw.replace(/[^0-9]/g,''))||0) : 0;
    var maxPages = parseInt(document.getElementById('mrMaxPages').value)||3;
    _mDb.ref('monitor_rules').push({ name:name, url:url, keyword:keyword, minPrice:minPrice, gameLabel:gameLabel, maxPages:maxPages, enabled:true, createdAt:Date.now() });
    ['mrName','mrUrl','mrKeyword','mrMinPrice','mrGame'].forEach(function(i){ document.getElementById(i).value=''; });
    document.getElementById('mrMaxPages').value='3';
    alert('✅ 감시 규칙이 등록되었습니다!');
}

function toggleMonitoring() { if (_monIsActive) stopMonitoringEngine(); else startMonitoringEngine(); }

window.__tmConnected = false;
window.__tmResolvers = {};
var _tmPingTimer = setInterval(function() {
    if (window.__tmConnected) clearInterval(_tmPingTimer);
    else window.postMessage({ type: 'TM_PING' }, '*');
}, 1000);

window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'TM_CONNECTED') {
        window.__tmConnected = true;
        var badge = document.getElementById('tmStatusBadge');
        if (badge) { badge.innerHTML = '✅ 우회 스크립트 연결됨'; badge.style.background = '#22c55e'; }
    }
    if (e.data && e.data.type === 'TM_FETCH_SUCCESS') {
        if (window.__tmResolvers[e.data.reqId]) {
            window.__tmResolvers[e.data.reqId].resolve(e.data.responseText);
            delete window.__tmResolvers[e.data.reqId];
        }
    }
    if (e.data && e.data.type === 'TM_FETCH_ERROR') {
        if (window.__tmResolvers[e.data.reqId]) {
            window.__tmResolvers[e.data.reqId].reject(new Error(e.data.error));
            delete window.__tmResolvers[e.data.reqId];
        }
    }
});
function tmFetch(url) {
    return new Promise(function(resolve, reject) {
        var reqId = 'req_' + Date.now() + '_' + Math.random();
        window.__tmResolvers[reqId] = { resolve: resolve, reject: reject };
        window.postMessage({ type: 'TM_FETCH_REQUEST', reqId: reqId, url: url }, '*');
    });
}

function startMonitoringEngine() {
    if (_monIntervalId) return;
    _monIsActive = true;
    _doMonitorCheck();
    _monIntervalId = setInterval(_doMonitorCheck, _monIntervalMin * 60000);
    updateMonitorStatusDisplay();
    _updateHdrDot();
}

function stopMonitoringEngine() {
    clearInterval(_monIntervalId); _monIntervalId = null; _monIsActive = false;
    updateMonitorStatusDisplay(); _updateHdrDot();
}

function setMonitorInterval(min) {
    _monIntervalMin = min; localStorage.setItem('mon_interval', min);
    if (_monIsActive) { stopMonitoringEngine(); startMonitoringEngine(); }
}

function updateMonitorStatusDisplay() {
    var dot = document.getElementById('monitorDot');
    var txt = document.getElementById('monitorStatusText');
    var btn = document.getElementById('monitorToggleBtn');
    if (!dot||!txt||!btn) return;
    if (_monIsActive) {
        dot.classList.add('active');
        var lc = localStorage.getItem('mon_last_check');
        txt.textContent = lc ? '마지막 체크: '+new Date(+lc).toLocaleTimeString('ko-KR') : '모니터링 중...';
        btn.textContent = '⏸ 중지'; btn.style.background = '#ef4444';
    } else {
        dot.classList.remove('active');
        txt.textContent = '모니터링 중지됨';
        btn.textContent = '▶ 시작'; btn.style.background = '#22c55e';
    }
}

function _updateHdrDot() {
    var dot = document.getElementById('hdrMonDot');
    if (!dot) return;
    var isActive = _botStatus && _botStatus.active;
    if (isActive) dot.classList.add('active'); else dot.classList.remove('active');
}

async function _doMonitorCheck() {
    var active = Object.entries(monitorRules).filter(function(e){ return e[1].enabled; });
    if (!active.length) return;
    localStorage.setItem('mon_last_check', Date.now().toString());
    if (!document.getElementById('monitorModal').classList.contains('hidden')) updateMonitorStatusDisplay();
    for (var i=0; i<active.length; i++) {
        try { await _checkOneRule(active[i][0], active[i][1]); }
        catch(e) { console.warn('[MON] Rule error:', active[i][1].name, e); }
        if (i < active.length-1) await new Promise(function(r){ setTimeout(r,2000); });
    }
}

async function _checkOneRule(id, rule) {
    var maxPages = rule.maxPages || 3;
    var allItems = [];
    for (var page=1; page<=maxPages; page++) {
        try {
            var html = await _fetchPageHtml(rule.url, page, rule.keyword);
            var pageItems = _parseItemmaniaHtml(html, rule.keyword||'', rule.minPrice||0, rule.url||'');
            allItems = allItems.concat(pageItems);
            var pageAll = _parseItemmaniaHtml(html, '', 0, rule.url||'');
            if (pageAll.length === 0 && page > 1) break;
        } catch(e) { console.warn('[MON] page'+page+' error:', e.message); break; }
        if (page < maxPages) await new Promise(function(r){ setTimeout(r,1000); });
    }
    if (!allItems.length) return;
    _triggerMonitorAlert(id, rule, allItems);
}

function _parseItemmaniaHtml(html, keyword, minPrice, baseUrl) {
    var origin = '';
    if (baseUrl) { try { origin = new URL(baseUrl).origin; } catch(e) {} }
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var matched = [];
    var seen = {};

    // 링크, HTML 구조 전부 무시하고 텍스트 블록 자체를 스캔하는 무적 로직
    var rows = doc.querySelectorAll('li, tr, .item_row, .item_wrap');
    for (var i=0; i<rows.length; i++) {
        var el = rows[i];
        // 하위 요소에 또 li나 tr이 있다면 중복 방지를 위해 패스
        if (el.tagName === 'LI' && el.querySelector('li')) continue;
        if (el.tagName === 'TR' && el.querySelector('tr')) continue;

        var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 15) continue;
        if (text.includes('물품제목') && text.includes('등록일시')) continue;

        var m = text.match(/(\d{1,3}(,\d{3})+)/g) || text.match(/(\d{5,})/g);
        if (!m) continue;
        var nums = m.map(function(s){ return parseInt(s.replace(/,/g,'')); }).filter(function(n){ return n >= 1000; });
        if (!nums.length) continue;
        var price = Math.max.apply(null, nums);

        var _kws = keyword ? keyword.split(',').map(function(k){return k.trim();}).filter(Boolean) : [];
        if (_kws.length > 0 && !_kws.some(function(k){ return text.indexOf(k)>=0; })) continue;
        if (minPrice > 0 && price < minPrice) continue;

        var key = price + "_" + text.substring(0, 15);
        if (seen[key]) continue;
        seen[key] = true;

        var titleEl = el.querySelector('.item_title, .title, .col_title, td:nth-child(2)');
        var title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim().replace(/\n/g, ' ') : text.substring(0, 40) + '...';

        var anchors = el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a'));
        var appA = anchors.find(function(a){ var h=a.getAttribute('href')||''; return h.indexOf('application')>=0; });
        var anyA = anchors.find(function(a){ var h=a.getAttribute('href')||''; return h && h!=='#' && h.indexOf('javascript')<0; });
        var rawHref = (appA || anyA) ? ((appA||anyA).getAttribute('href')||'') : '';
        var itemUrl = rawHref.startsWith('http') ? rawHref : (rawHref.startsWith('/') && origin ? origin + rawHref : '');

        matched.push({ title:title, price:price, url:itemUrl });
        if (matched.length >= 20) break;
    }
    return matched;
}

function _extractPrice(text) {
    var m = text.match(/(\d{1,3}(,\d{3})+)/g);
    if (!m) m = text.match(/(\d{4,})/g);
    if (!m) return 0;
    var nums = m.map(function(s){ return parseInt(s.replace(/[^0-9]/g,'')); }).filter(function(n){ return n >= 100; });
    return nums.length ? Math.max.apply(null,nums) : 0;
}

function _triggerMonitorAlert(id, rule, items) {
    var lines = items.slice(0,5).map(function(it,i){
        return (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'');
    });
    var content = '🚨 [자동감지] '+rule.name+'\n'
        +(rule.gameLabel?'게임: '+rule.gameLabel+'\n':'')
        +(rule.keyword?'키워드: "'+rule.keyword+'"\n':'')
        +(rule.minPrice?'최소가격: '+Number(rule.minPrice).toLocaleString()+'원 이상\n':'')
        +'감지된 물품: '+items.length+'개\n\n'
        +lines.join('\n')
        +'\n\n🔗 '+rule.url;
    var _at = Date.now();
    _mDb.ref('monitor_flash_state').set({
        active: true,
        ruleName: rule.name,
        ruleKeyword: rule.keyword || '',
        itemCount: items.length,
        itemRows: items.map(function(it){ return {t:it.title, p:it.price||0, u:it.url||''}; }),
        at: _at
    });
    // 구 모니터 엔진(거래번호 감시)은 history 기록 안 함
}

function closeMonitorFlash() { _mDb.ref('monitor_flash_state/active').set(false); }

function _getNotifPrefs(){
    try{ return Object.assign({flash:true,popup:true,sound:false,watchPopup:false},JSON.parse(localStorage.getItem('imi_notif_prefs')||'{}')); }catch(e){ return {flash:true,popup:true,sound:false,watchPopup:false}; }
}

// 브릿지 기반 in-page 토스트 팝업 (사기글: 우하단 빨강 / 비거래: 좌하단 초록)
(function() {
    var _styleInjected = false;
    function _ensureStyle() {
        if (_styleInjected) return;
        _styleInjected = true;
        var s = document.createElement('style');
        s.textContent = '@keyframes _imiPopIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} ._imi-wrap{opacity:1!important;}';
        document.head.appendChild(s);
    }
    function _getContainer(isWatch) {
        var id = isWatch ? '_imi_watch_toasts' : '_imi_fraud_toasts';
        var c = document.getElementById(id);
        if (c) { c.style.display = ''; return c; } // 새 알림 시 숨겨진 컨테이너도 재표시
        c = document.createElement('div');
        c.id = id;
        c.style.cssText = 'position:fixed;z-index:2147483640;bottom:20px;'
            + (isWatch ? 'left:20px;' : 'right:20px;')
            + 'display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:480px;'
            + 'isolation:isolate;';
        document.body.appendChild(c);
        return c;
    }
    window._showInPagePopup = function(type, data) {
        _ensureStyle();
        var isWatch = type === 'watch';
        var accent   = isWatch ? '#22c55e' : '#ef4444';
        var accentA  = isWatch ? '#22c55e77' : '#ef444477';
        var accentB  = isWatch ? '#22c55e33' : '#ef444433';
        var priceClr = isWatch ? '#22c55e' : '#ef4444';
        var btnClr   = isWatch ? '#86efac' : '#f87171';
        var container = _getContainer(isWatch);

        var wrap = document.createElement('div');
        wrap.className = '_imi-wrap';
        wrap.style.cssText = 'width:460px;border:2px solid '+(isWatch?'#22c55e':'#ef4444')+';border-radius:8px;'
            + 'background:#0f172a;font-family:sans-serif;font-size:12px;color:#f1f5f9;'
            + 'animation:_imiPopIn 0.22s ease forwards;pointer-events:auto;'
            + 'box-shadow:0 4px 32px rgba(0,0,0,0.85);';

        // 카드 헤더
        var cardHdr = document.createElement('div');
        cardHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid '+accentB+';';
        var hdrLabel = (isWatch ? '📦 ' : '🚨 ') + _esc(data.ruleName || (isWatch ? '비거래' : '감지'));
        var kw = data.ruleKeyword || data.keyword || '';
        cardHdr.innerHTML = '<span style="font-size:12px;font-weight:900;color:'+accent+';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            + hdrLabel
            + (kw ? '&nbsp;<span style="color:'+btnClr+';font-size:10px;">· "'+_esc(kw)+'"</span>' : '')
            + '</span>'
            + '<span style="font-size:10px;color:#94a3b8;font-weight:700;flex-shrink:0;">'+(data.itemCount||0)+'개</span>';
        wrap.appendChild(cardHdr);

        // 아이템 목록
        var itemList = document.createElement('div');
        itemList.style.cssText = 'max-height:220px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;padding:0 10px;';
        (data.itemRows || []).forEach(function(it) {
            var k = _esc(it.key || (it.t||'').substring(0,30).trim());
            var row = document.createElement('div');
            row.style.cssText = 'padding:5px 0;border-bottom:1px solid #33415540;';
            var tidHtml = '';
            var _itKw = (it.matchedKw || '');
            var kwBadge = _itKw ? '<span style="font-size:11px;font-weight:900;color:#22c55e;background:rgba(34,197,94,0.12);border:1.5px solid rgba(34,197,94,0.45);border-radius:12px;padding:2px 9px;margin-left:6px;vertical-align:middle;white-space:nowrap;">'+_esc(_itKw)+'</span>' : '';
            if (it.tid) {
                if (isWatch) {
                    tidHtml = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;"><a href="https://www.itemmania.com/buy/buy_main.php?tid='+_esc(it.tid)+'" target="_blank" style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;text-decoration:none;">#'+_fmtTid(it.tid)+'</a>'+kwBadge+'</div>';
                } else {
                    tidHtml = '<div style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#'+_fmtTid(it.tid)+kwBadge+'</div>';
                }
            }
            row.innerHTML = tidHtml
                +'<div style="display:flex;align-items:center;gap:6px;">'
                +'<div style="font-size:11px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
                +(it.p?'<div style="color:'+priceClr+';font-weight:900;font-size:11px;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>':'')
                +'</div>'
                +'<div style="display:flex;gap:6px;padding:6px 0 2px;">'
                +'<button data-bk="'+k+'" data-title="'+_esc(it.t||'')+'" data-tid="'+_esc(it.tid||'')+'" data-price="'+(it.p||0)+'"'+(isWatch?' data-bktype="watch"':'')+' style="flex:1;font-size:11px;font-weight:800;padding:5px 0;border-radius:5px;border:1px solid '+btnClr+';color:'+btnClr+';background:none;cursor:pointer;">필터제외</button>'
                +(isWatch?'<button class="_imi_toast_done" data-tid="'+_esc(it.tid||'')+'" style="flex:1;font-size:11px;font-weight:800;padding:5px 0;border-radius:5px;border:none;color:#052e16;background:#22c55e;cursor:pointer;">✅ 처리완료</button>':'')
                +'</div>';
            itemList.appendChild(row);
        });
        wrap.appendChild(itemList);

        // 사기글만 30초 자동 닫기 진행 바 (비거래는 수동 닫기만)
        if (!isWatch) {
            var prog = document.createElement('div');
            prog.style.cssText = 'height:3px;background:#1e293b;border-radius:0 0 8px 8px;';
            var bar = document.createElement('div');
            bar.style.cssText = 'height:100%;width:100%;background:'+accent+';transition:width 30s linear;border-radius:0 0 8px 8px;';
            prog.appendChild(bar);
            wrap.appendChild(prog);
            setTimeout(function() { bar.style.width = '0%'; }, 50);
        }
        // 비거래도 사기글과 동일하게 누적 방식
        container.appendChild(wrap);

        var _autoCloseTimer = null;

        function remove() {
            var hdrTab = document.getElementById(isWatch ? 'watchHeaderTab' : 'fraudHeaderTab');
            if(hdrTab && hdrTab._popupCount) {
                hdrTab._popupCount = Math.max(0, hdrTab._popupCount - (data.itemCount || 0));
                if(hdrTab._popupCount <= 0) {
                    hdrTab._popupCount = 0;
                    hdrTab.style.display = 'none';
                    hdrTab.classList.remove('hdr-tab-blink');
                    if(typeof _stopTabBlink === 'function') _stopTabBlink(isWatch ? 'watch' : 'fraud');
                    if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
                    if(isWatch && typeof _syncWatchBanner === 'function') _syncWatchBanner();
                } else {
                    var badge = isWatch
                        ? '⚠️ 비거래&nbsp;<span style="background:#22c55e;color:#000;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+hdrTab._popupCount+'</span>'
                        : '🚨 사기글&nbsp;<span style="background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+hdrTab._popupCount+'</span>';
                    hdrTab.innerHTML = badge;
                }
            }
            if (!isWatch) _removeChatBorderFlash();
            wrap.style.cssText += 'opacity:0;transform:translateX('+(isWatch?'-':'')+'20px);transition:all 0.2s ease;';
            setTimeout(function() {
                if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                // 팝업 제거 후 컨테이너 비었으면 탭 강제 숨기기 (_popupCount 오차 방어)
                var cont = document.getElementById(isWatch ? '_imi_watch_toasts' : '_imi_fraud_toasts');
                if (cont && cont.childElementCount === 0) {
                    var t = document.getElementById(isWatch ? 'watchHeaderTab' : 'fraudHeaderTab');
                    if (t && t.style.display !== 'none') {
                        t.style.display = 'none';
                        t.classList.remove('hdr-tab-blink');
                        if (typeof _stopTabBlink === 'function') _stopTabBlink(isWatch ? 'watch' : 'fraud');
                        if (typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
                        if (!isWatch) _removeChatBorderFlash();
                    }
                }
            }, 220);
        }

        // 처리완료 버튼 (비거래)
        itemList.addEventListener('click', function(e) {
            var doneBtn = e.target.closest('._imi_toast_done');
            if (!doneBtn || doneBtn.disabled) return;
            var tid = doneBtn.getAttribute('data-tid');
            if (!tid) return;
            var by = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            doneBtn.disabled = true;
            _mDb.ref('imi_watch_done/' + tid).set({ at: Date.now(), by: by });
            // 해당 항목 행 페이드아웃 후 제거
            var row = doneBtn.closest('[style*="border-bottom"]') || doneBtn.parentNode.parentNode;
            row.style.transition = 'opacity 0.4s';
            row.style.opacity = '0';
            setTimeout(function() {
                if (row.parentNode) row.parentNode.removeChild(row);
                // 남은 항목 없으면 즉시 팝업 닫기
                var remaining = itemList.querySelectorAll('._imi_toast_done');
                if (remaining.length === 0) remove();
            }, 400);
        });

        // 사기글: 30초 자동 닫기 + 재감지 자동 닫기 핸들러 등록
        if (!isWatch) {
            _autoCloseTimer = setTimeout(remove, 30000);
            if (!window._fraudCloseHandlers) window._fraudCloseHandlers = {};
            var _rid = data.ruleId || '_';
            window._fraudCloseHandlers[_rid] = function() {
                clearTimeout(_autoCloseTimer);
                remove();
                delete window._fraudCloseHandlers[_rid];
            };
        }
    };
}());

function _playAlertBeep(){
    try{
        var ctx=new (window.AudioContext||window.webkitAudioContext)();
        [0,0.22,0.44].forEach(function(d){
            var o=ctx.createOscillator(), g=ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type='sine'; o.frequency.value=880;
            g.gain.setValueAtTime(0.35,ctx.currentTime+d);
            g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+d+0.18);
            o.start(ctx.currentTime+d); o.stop(ctx.currentTime+d+0.2);
        });
    }catch(e){}
}
function _applyChatBorderFlash() {}
function _removeChatBorderFlash() {
    // fraudDropPanel border + maxHeight 강제 초기화
    var fraudPanel = document.getElementById('fraudDropPanel');
    if (fraudPanel) {
        fraudPanel.style.borderColor = 'transparent';
        fraudPanel.style.maxHeight = '0px';
    }
}
setInterval(function() {
    var fraudTab = document.getElementById('fraudHeaderTab');
    if (!fraudTab || fraudTab.style.display !== 'flex') {
        _removeChatBorderFlash();
        var fp = document.getElementById('fraudDropPanel');
        if (fp) { fp.classList.remove('fraud-panel-blink'); fp.style.boxShadow = 'none'; }
    }
    var watchTab = document.getElementById('watchHeaderTab');
    if (!watchTab || watchTab.style.display !== 'flex') {
        var wp = document.getElementById('watchDropPanel');
        if (wp) { wp.style.borderColor = 'transparent'; wp.style.maxHeight = '0px'; wp.classList.remove('watch-panel-blink'); wp.style.boxShadow = 'none'; }
    }
}, 200);
function _fireOsNotif(s) {
    // 익스텐션이 설치돼 있으면 background.js가 알림을 처리하므로 중복 방지
    if (_botBridgeConnected) return;
    if (s.ruleType === 'watch' || !('Notification' in window)) return;
    var allTids = (s.itemRows||[]).map(function(r){ return r.tid||''; }).filter(Boolean);
    var newTids = allTids.filter(function(t){ return !_notifSentTids.has(t); });
    var shouldNotif = allTids.length === 0 || newTids.length > 0;
    newTids.forEach(function(t){ _notifSentTids.add(t); });
    if (!shouldNotif) return;
    var notifCount = allTids.length === 0 ? (s.itemCount||0) : newTids.length;
    var title = '🚨 ' + (s.ruleName || 'IMI PRO') + ' 감지됨';
    var body  = notifCount + '개 감지' + (s.ruleKeyword ? ' · 키워드: ' + s.ruleKeyword : '') + '\nIMI PRO 확인 바랍니다';
    // Electron 환경: IPC 경유 → main.js의 showWindow()가 클릭 처리 (트레이·최소화 모두 복원)
    if (window.electronAPI && window.electronAPI.showNotification) {
        window.electronAPI.showNotification(title, body);
        return;
    }
    // 웹 브라우저 폴백
    var _fn = function() {
        var _n = new Notification(title, { body: body, icon: 'https://msapi7890.github.io/IMI-PRO/favicon.ico', tag: 'imi-pro-alert' });
        _n.onclick = function() { _n.close(); window.focus(); };
    };
    if (Notification.permission === 'granted') { _fn(); }
    else if (Notification.permission === 'default') { Notification.requestPermission().then(function(p){ if(p==='granted') _fn(); }); }
}

function _showMonitorFlash(s) {
    if (s.ruleType === 'watch') {
        // 비거래 재감지: 봇이 monitor_flash_state로 현재 스캔 결과 전달 → 사라진 항목 블러
        if (window._wItemCache && window._wGone && typeof window._rebuildWatchPanel === 'function') {
            var _wCurTids = new Set((s.itemRows||[]).map(function(it){ return String(it.tid||''); }).filter(Boolean));
            var _wRuleLabel = s.label || s.ruleName || '';
            var _wChanged = false;
            Object.keys(window._wItemCache).forEach(function(tid) {
                var info = window._wItemCache[tid];
                if (_wRuleLabel && info.label !== _wRuleLabel) return;
                if (!_wCurTids.has(tid) && !window._wGone.has(tid)) { window._wGone.add(tid); _wChanged = true; }
                if (_wCurTids.has(tid) && window._wGone.has(tid))    { window._wGone.delete(tid); _wChanged = true; }
            });
            if (_wChanged) window._rebuildWatchPanel();
        }
        return;
    }
    // 필터제외 물품 제거 — 재감지 시 이미 제외된 물품은 알림 안 띄움
    var filteredRows = (s.itemRows || []).filter(function(it) {
        var k = it.key || (it.t||'').substring(0,30).trim();
        return !_blockedKeysCache.has(String(k));
    });
    if (filteredRows.length === 0) return;
    s.itemRows = filteredRows;
    s.itemCount = filteredRows.length;

    // 재감지 시: 이전 스캔에 있었는데 현재 없는 tid → 물품 삭제됨 자동 블러
    var ruleKey = s.ruleKeyword || s.ruleName || '_default';
    var curTids = new Set(filteredRows.map(function(it){ return String(it.tid||''); }).filter(Boolean));
    var prevTids = _monhwRuleLastTids[ruleKey];
    if (prevTids) {
        prevTids.forEach(function(tid) {
            if (!curTids.has(tid)) _monhwAutoMarkGone(tid);
        });
    }
    _monhwRuleLastTids[ruleKey] = curTids;

    // 재감지 판별: 모두 이미 알림된 tid이면 블러만 처리하고 알람·카드는 건너뜀
    var hasNewTid = filteredRows.some(function(it) {
        var tid = String(it.tid || '').trim();
        return !tid || !_monhwFraudShownTids.has(tid);
    });
    if (!hasNewTid) return;

    // 모니터링 현황 패널에 항상 추가 (팝업 설정 무관)
    _monhwAddFraudCard(s);

    var _np=_getNotifPrefs();

    if (_np.sound) _playAlertBeep();
    _startTabBlink(s.ruleName, s.itemCount, 'fraud');
    _fireOsNotif(s);
}

function _triggerFullscreenFlash() {
    var overlay = document.getElementById('monFullscreenOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'monFullscreenOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;pointer-events:none;background:rgba(239,68,68,0);transition:none;';
        document.body.appendChild(overlay);
    }
    var count = 0;
    if (window._overlayFlashInterval) clearInterval(window._overlayFlashInterval);
    window._overlayFlashInterval = setInterval(function() {
        count++;
        overlay.style.background = count % 2 === 1
            ? 'rgba(239,68,68,0.35)'
            : 'rgba(239,68,68,0)';
        if (count >= 8) {
            clearInterval(window._overlayFlashInterval);
            window._overlayFlashInterval = null;
            overlay.style.background = 'rgba(239,68,68,0)';
        }
    }, 250);
}

function _startTabBlink(ruleName, itemCount, id) {
    var alertTitle = '🚨 [' + (itemCount||0) + '개 감지] ' + (ruleName||'모니터링 경고');
    var qid = id || 'default';
    if (!window._tabBlinkQueue) window._tabBlinkQueue = [];
    var q = window._tabBlinkQueue;
    var idx = q.findIndex(function(e) { return e.id === qid; });
    if (idx !== -1) { q[idx].title = alertTitle; }
    else { q.push({ id: qid, title: alertTitle }); }
    if (!window._tabBlinkOrigTitle) window._tabBlinkOrigTitle = document.title;
    // Electron IPC — flashFrame + blinkTitle
    if (window.electronAPI) {
        if (window.electronAPI.flashFrame) window.electronAPI.flashFrame(true);
        var labels = (window._tabBlinkQueue||[]).map(function(e){ return e.id; });
        if (window.electronAPI.blinkTitle) window.electronAPI.blinkTitle(true, labels);
    }
    // id별 30초 자동 종료 타이머
    var autoKey = '_tabBlinkAuto_' + qid;
    if (window[autoKey]) clearTimeout(window[autoKey]);
    window[autoKey] = setTimeout(function() { _stopTabBlink(qid); window[autoKey] = null; }, 10000);
    if (window._tabBlinkInterval) return;
    window._tabBlinkTick = 0;
    window._tabBlinkInterval = setInterval(function() {
        var queue = window._tabBlinkQueue || [];
        if (!queue.length) { _stopTabBlink(); return; }
        var tick = window._tabBlinkTick++;
        if (tick % 2 === 0) {
            document.title = window._tabBlinkOrigTitle;
        } else {
            document.title = queue[Math.floor(tick / 2) % queue.length].title;
        }
    }, 700);
}

function _stopTabBlink(id) {
    if (id !== undefined) {
        window._tabBlinkQueue = (window._tabBlinkQueue || []).filter(function(e) { return e.id !== id; });
        if (window._tabBlinkQueue.length > 0) return;
    } else {
        window._tabBlinkQueue = [];
        _removeChatBorderFlash();
    }
    if (window._tabBlinkInterval) { clearInterval(window._tabBlinkInterval); window._tabBlinkInterval = null; }
    if (window._tabBlinkOrigTitle) { document.title = window._tabBlinkOrigTitle; window._tabBlinkOrigTitle = null; }
    window._tabBlinkTick = 0;
    // Electron IPC — flashFrame·blinkTitle 초기화 → 🟢 복구
    if (window.electronAPI) {
        if (window.electronAPI.flashFrame) window.electronAPI.flashFrame(false);
        if (window.electronAPI.blinkTitle) window.electronAPI.blinkTitle(false, []);
    }
}

function _hideMonitorFlashLocal() {
    if (window.electronAPI && window.electronAPI.closeNotification) window.electronAPI.closeNotification();
    _removeChatBorderFlash();
    if (window._monFlashTimer) { clearTimeout(window._monFlashTimer); window._monFlashTimer = null; }
    if (window._overlayFlashInterval) { clearInterval(window._overlayFlashInterval); window._overlayFlashInterval = null; }
    var overlay = document.getElementById('monFullscreenOverlay');
    if (overlay) overlay.style.background = 'rgba(239,68,68,0)';
    _stopTabBlink('fraud');
    // 사기글 헤더 탭 & 드롭패널 숨기기
    var fraudTab   = document.getElementById('fraudHeaderTab');
    var fraudPanel = document.getElementById('fraudDropPanel');
    if(fraudTab){ fraudTab.style.display = 'none'; fraudTab.innerHTML = ''; fraudTab.classList.remove('hdr-tab-blink'); if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow(); }
    if(fraudPanel){ fraudPanel.style.maxHeight = '0px'; fraudPanel.style.borderColor = 'transparent'; fraudPanel.innerHTML = ''; fraudPanel._totalCount = 0; }
}

var _lastFlashAt = 0;
var _notifSentTids = new Set();
var _blockedKeysCache = new Set();
function _subscribeBlocked() {
    _mDb.ref('/imi_blocked').off('value');
    _mDb.ref('/imi_blocked').on('value', function(snap) {
        _blockedKeysCache = new Set();
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        list.forEach(function(item) {
            var k = typeof item === 'object' ? item.key : item;
            if (k) _blockedKeysCache.add(String(k)); // fraud·watch 모두 캐시 (비거래 필터제외 누락 버그 수정)
        });
    });
}
var _flashPollStarted = false;
function _flashPollMs() {
    var min = Infinity;
    if (typeof _botRules !== 'undefined' && Array.isArray(_botRules)) {
        _botRules.forEach(function(r) {
            if (r && r.enabled) { var s = parseInt(r.scanInterval) || 300; if (s < min) min = s; }
        });
    }
    if (!isFinite(min)) min = 180;
    return Math.max(30, min) * 1000; // 규칙 스캔 주기에 맞춤, 최소 30초
}
function _handleFlashState(s) {
    if (!s) return;
    if (s.active && s.at && (Date.now() - s.at) < 600000 && s.at !== _lastFlashAt) {
        _lastFlashAt = s.at;
        _showMonitorFlash(s);
        var panel = document.getElementById('logPanel');
        if (panel && !panel.classList.contains('hidden')) {
            var tab1 = document.getElementById('logTab1');
            var tab2 = document.getElementById('logTab2');
            if (tab1 && tab1.classList.contains('mon-tab-active')) setTimeout(loadMonitorLog, 1500);
            else if (tab2 && tab2.classList.contains('mon-tab-active')) setTimeout(loadWatchLog, 1500);
        }
    } else if (!s.active) _hideMonitorFlashLocal();
}
function _subscribeFlashState() {
    if (_flashPollStarted) return;
    _flashPollStarted = true;
    // 실시간 푸시 (감지 즉시) — 봇이 monitor_flash_state에 쓰는 순간 받음
    _fbStream('monitor_flash_state', function(s) { _handleFlashState(s); });
    // 백업 폴링 (스트림 끊겼을 때 대비, 규칙 주기마다)
    (function _pollFlash() {
        var ms = _flashPollMs();
        _mDb.ref('monitor_flash_state').once('value', function(snap) { _handleFlashState(snap.val()); });
        setTimeout(_pollFlash, ms);
    })();
}
_subscribeBlocked();
_subscribeFlashState();

// 감지 상태 인디케이터 동기화 (1초마다)
var _watchIndToggle = false;
setInterval(function() {
    _watchIndToggle = !_watchIndToggle;
    var fraudInd = document.getElementById('fraudStatusIndicator');
    var watchInd = document.getElementById('watchStatusIndicator');
    if (!fraudInd && !watchInd) return;

    // 인디케이터 색 적용 — 개별 속성 설정(cssText 누적 방지), 테마 대응 + 진한 활성색
    function _setInd(el, border, color, bg) {
        el.style.borderColor = border;
        el.style.color = color;
        el.style.background = bg;
    }
    function _setIndLabel(el, txt) { // 이모지 span은 보존하고 .ind-label만 갱신
        var l = el.querySelector('.ind-label');
        if (l) l.textContent = txt; else el.textContent = txt;
    }
    var _dark = document.body.classList.contains('dark-mode');
    var _IDLE = ['var(--border-ui)', 'var(--text-main)', 'var(--bg-body)'];
    // 다크모드: 밝은 색 / 라이트·그린모드: 진한 색 (배경 대비 확보)
    var _RED   = _dark ? ['#f87171','#f87171','rgba(239,68,68,0.22)']  : ['#dc2626','#dc2626','rgba(220,38,38,0.14)'];
    var _GREEN = _dark ? ['#4ade80','#4ade80','rgba(34,197,94,0.22)']  : ['#15803d','#15803d','rgba(21,128,61,0.14)'];
    var _AMBER = _dark ? ['#fbbf24','#fbbf24','rgba(245,158,11,0.22)'] : ['#b45309','#b45309','rgba(180,83,9,0.14)'];

    // 사기글: monhwFraudContent에서 활성 항목 수
    if (fraudInd) {
        var fc = document.getElementById('monhwFraudContent');
        var fCount = 0;
        if (fc) { fc.querySelectorAll('[data-item-tid]').forEach(function(r){ if (!r._autoGone && !r._filterDone) fCount++; }); }
        _setInd.apply(null, [fraudInd].concat(fCount > 0 ? _RED : _IDLE));
    }

    // 비거래 + 거래번호 감시 인디케이터 — 두 상태 번갈아 표시
    if (watchInd) {
        // 처리완료/삭제/제외된 행은 빼고 '미처리 비거래'만 카운트 (사기글과 동일 방식) → 다 처리하면 불 꺼짐
        var wContent = document.getElementById('monhwWatchContent');
        var wCount = 0;
        if (wContent) { wContent.querySelectorAll('[data-item-tid]').forEach(function(r){ if (!r._autoGone && !r._filterDone) wCount++; }); }
        var tidCount = window._watchTidCount || 0;
        var showGreen  = wCount > 0;
        var showYellow = tidCount > 0;
        if (showGreen && showYellow) {
            if (_watchIndToggle) { _setInd.apply(null, [watchInd].concat(_GREEN)); _setIndLabel(watchInd, '비거래'); }
            else { _setInd.apply(null, [watchInd].concat(_AMBER)); _setIndLabel(watchInd, '거래번호'); }
        } else if (showYellow) {
            _setInd.apply(null, [watchInd].concat(_AMBER)); _setIndLabel(watchInd, '거래번호');
        } else if (showGreen) {
            _setInd.apply(null, [watchInd].concat(_GREEN)); _setIndLabel(watchInd, '비거래');
        } else {
            _setInd.apply(null, [watchInd].concat(_IDLE)); _setIndLabel(watchInd, '비거래');
        }
    }

    // 📡 모니터링 네비 버튼 — 상황별 색이 물결처럼 차오르는 효과
    var navMon = document.getElementById('imiNav-monitoring');
    if (navMon) {
        var _fc = (typeof fCount !== 'undefined') ? fCount : 0;
        var _wc = (typeof wCount !== 'undefined') ? wCount : 0;
        var _tc = (typeof tidCount !== 'undefined') ? tidCount : 0;
        // 자연스러운 중간 톤 (네온도 파스텔도 아닌) — 다크는 살짝 밝게, 라이트는 살짝 진하게
        var _P = _dark
            ? { r:'#f06a6a', g:'#4cb98a', a:'#e8a93f' }
            : { r:'#dd4b4b', g:'#3a9e74', a:'#cf8a1f' };
        var actives = [];
        if (_fc > 0) actives.push(_P.r); // 사기글 — 빨강
        if (_wc > 0) actives.push(_P.g); // 비거래 — 초록
        if (_tc > 0) actives.push(_P.a); // 거래번호 — 호박
        if (actives.length) {
            navMon.classList.add('mon-nav-alert');
            navMon.style.setProperty('--alert-color', actives[((Date.now()/2000)|0) % actives.length]);
        } else {
            navMon.classList.remove('mon-nav-alert');
            navMon.style.removeProperty('--alert-color');
        }
    }
}, 1000);

// 비거래 감지 패널 — imi_watch_alerts 리스너 (Firebase REST polling)
(function(){
    var _shownAlertKeys = new Set();
    var _initAt = Date.now();
    var _wItemCache = {};        // tid → {it, label, time}  전체 캐시
    var _wGone      = new Set(); // 사라진 tid
    window._wAiType  = {};       // tid → 'nt'|'check'  AI 분류 캐시
    window._wItemCache = _wItemCache;
    window._wGone    = _wGone;
    var _wRemovedTids = new Set(); // 처리완료 후 자동 제거된 tid (재추가 방지)
    window._wRemovedTids = _wRemovedTids;

    function _makeWatchAiBadge(type) {
        var isNt = type === 'nt';
        var b = document.createElement('span');
        b.setAttribute('data-ai-badge', isNt ? '비거래' : '확인필요');
        b.style.cssText = 'font-size:calc(var(--base-font,20px)*0.4);font-weight:900;border-radius:4px;padding:1px 5px;white-space:nowrap;flex-shrink:0;'
            + (isNt ? 'color:#ef4444;background:rgba(239,68,68,0.15);border:1.5px solid rgba(239,68,68,0.5);'
                    : 'color:#f59e0b;background:rgba(245,158,11,0.15);border:1.5px solid rgba(245,158,11,0.5);');
        b.textContent = isNt ? '🚫 비거래' : '⚠️ 물품확인필요';
        return b;
    }

    function _rebuildWatchPanel() {
        var content = document.getElementById('monhwWatchContent');
        if (!content) return;
        var tids = Object.keys(_wItemCache);
        if (!tids.length) {
            content.innerHTML = '<div id="monhwWatchEmpty" style="text-align:center;padding:60px 0;font-size:13px;opacity:0.3;">감지된 비거래가 없습니다.<br><span style="font-size:11px;">봇이 비거래를 감지하면 여기에 표시됩니다.</span></div>';
            _monhwWatchTotal = 0;
            var _c0 = document.getElementById('monhwWatchCount');
            if (_c0) _c0.style.display = 'none';
            return;
        }

        // 라벨+감지시각 단위 그룹핑 → 새로 감지된 건은 별도 새 카드
        var byLabel = {};
        tids.forEach(function(tid) {
            var info = _wItemCache[tid];
            var gkey = info.label + '@@' + (info.time || '');
            if (!byLabel[gkey]) byLabel[gkey] = { label: info.label, time: info.time, active: [], gone: [] };
            (_wGone.has(tid) ? byLabel[gkey].gone : byLabel[gkey].active).push(tid);
        });

        content.innerHTML = '';
        var total = 0;

        // 최신 감지 카드가 위로 (시각 내림차순)
        Object.keys(byLabel).sort(function(a,b){ return (byLabel[b].time||'').localeCompare(byLabel[a].time||''); }).forEach(function(gkey) {
            var g = byLabel[gkey];
            var count = g.active.length + g.gone.length;
            if (!count) return;
            var card = _monhwMakeCard('#22c55e', '📦', g.label, '', count, g.time, [], 'watch', gkey);
            var itemList = card.querySelector('[data-item-list]');

            function _buildRow(tid, isGone) {
                var info = _wItemCache[tid]; if (!info || !itemList) return;
                var row = _monhwMakeItemRow(info.it, 'watch', '#22c55e');
                // AI 배지 복원
                if (window._wAiType[tid]) {
                    var ai = _makeWatchAiBadge(window._wAiType[tid]);
                    var a = row.querySelector('a');
                    row.insertBefore(ai, a ? a.nextSibling : row.firstChild);
                }
                // 필터제외 복원
                var bk = String(info.it.key || (info.it.t||'').substring(0,30));
                if (_blockedKeysCache.has(bk)) {
                    row._filterDone = true;
                    var bkBtn = row.querySelector('[data-bk]');
                    if (bkBtn) { bkBtn.disabled = true; bkBtn.textContent = '제외됨'; bkBtn.style.opacity = '0.4'; }
                    _monhwRowDoneOverlay(row, '✅ 처리완료');
                }
                // 처리완료(서버 동기화) 복원 — 패널 재생성 시에도 처리완료 유지
                if (typeof _watchDoneSet !== 'undefined' && _watchDoneSet && _watchDoneSet[tid] && !row._filterDone) {
                    row._filterDone = true;
                    _monhwRowDoneOverlay(row, '✅ 처리완료');
                }
                // 물품 삭제됨 표시
                if (isGone) {
                    row._autoGone = true;
                    var bkBtn2 = row.querySelector('[data-bk]');
                    if (bkBtn2) { bkBtn2.disabled = true; bkBtn2.style.opacity = '0.3'; }
                    _monhwRowDoneOverlay(row, '✅ 물품 삭제됨');
                }
                itemList.appendChild(row);
            }

            g.active.forEach(function(tid){ _buildRow(tid, false); });
            g.gone.forEach(function(tid){ _buildRow(tid, true); });
            content.appendChild(card);
            total += count;
        });

        _monhwWatchTotal = total;
        var cnt = document.getElementById('monhwWatchCount');
        if (cnt) { cnt.style.display = total > 0 ? '' : 'none'; if (total > 0) cnt.textContent = total + '건'; }
    }
    window._rebuildWatchPanel = _rebuildWatchPanel; // _showMonitorFlash에서 접근

    // imi_watch_alerts 처리 함수 (5초 폴링 + on() 공용)
    function _processWatchAlerts(all) {
        if (!all || typeof all !== 'object') return;
        var needRebuild = false;
        var newByLabel = {};

        Object.keys(all).forEach(function(key) {
            var d = all[key]; if (!d) return;
            var lbl = d.label || d.keyword || '_default';
            if (_shownAlertKeys.has(key)) return;
            _shownAlertKeys.add(key);
            if ((d.at||0) < _initAt - 60000) return;

            var newTids = new Set((d.itemRows||[]).map(function(r){ return String(r.tid||''); }).filter(Boolean));

            // 새 스캔에 없는 기존 항목 → 블러, 다시 있는 항목 → 블러 해제
            Object.keys(_wItemCache).forEach(function(tid) {
                if (_wItemCache[tid].label !== lbl) return;
                if (!newTids.has(tid)) { _wGone.add(tid); }
                else { _wGone.delete(tid); }
            });

            var _allKws = (d.keyword||'').split(',').map(function(k){ return k.trim(); }).filter(Boolean);
            var ts = d.at || Date.now();
            var timeStr = String(new Date(ts).getHours()).padStart(2,'0')+':'+String(new Date(ts).getMinutes()).padStart(2,'0')+':'+String(new Date(ts).getSeconds()).padStart(2,'0');
            var newItems = [];

            (d.itemRows||[]).forEach(function(r) {
                var tid = String(r.tid||''); if (!tid) return;
                if (_wRemovedTids.has(tid)) return; // 처리완료로 자동 제거된 건은 재추가 안 함
                var it = {tid:r.tid||'',t:r.t||r.title||'',key:r.key||'',p:r.price||0};
                var matched = _allKws.find(function(kw){ return kw && (it.t||'').toLowerCase().indexOf(kw.toLowerCase())!==-1; });
                it._keyword = matched || '';
                if (!_wItemCache[tid]) {
                    _wItemCache[tid] = { it:it, label:lbl, time:timeStr };
                    if (!window._wAiType[tid]) newItems.push(it);
                }
            });

            if (!newByLabel[lbl]) newByLabel[lbl] = [];
            newByLabel[lbl] = newByLabel[lbl].concat(newItems);
            needRebuild = true;
        });

        if (needRebuild) {
            _rebuildWatchPanel();
            Object.keys(newByLabel).forEach(function(lbl) {
                if (newByLabel[lbl].length && typeof _aiClassifyWatchItems === 'function') {
                    _aiClassifyWatchItems(newByLabel[lbl], lbl);
                }
            });
        }
    }

    // 비거래 감지: 마지막으로 받은 것 "이후 새 것만" 받아옴 → 이미 받은 50건을 재다운하지 않음 (Firebase 비용↓)
    var _lastWatchAlertKey = '';
    function _pollWatchAlertsNew() {
        _monGetToken().then(function(tok) {
            var url = _MON_FB + '/imi_watch_alerts.json?orderBy=' + encodeURIComponent('"$key"');
            url += _lastWatchAlertKey ? ('&startAt="' + _lastWatchAlertKey + '"') : '&limitToLast=20';
            if (tok) url += '&auth=' + tok;
            return fetch(url, { cache: 'no-store' });
        }).then(function(r) { return (r && r.ok) ? r.json() : null; }).then(function(all) {
            if (!all || typeof all !== 'object') return;
            var keys = Object.keys(all).sort();
            if (keys.length) _lastWatchAlertKey = keys[keys.length - 1]; // 다음엔 이 이후만
            _processWatchAlerts(all); // 이미 본 key는 _shownAlertKeys로 내부에서 건너뜀
        }).catch(function(){});
    }
    // 폴링 주기를 "비거래 규칙의 스캔 주기"에 맞춤 → 봇이 그 주기로만 감지하므로 중간 헛확인 제거
    function _watchPollMs() {
        var min = Infinity;
        if (typeof _botRules !== 'undefined' && Array.isArray(_botRules)) {
            _botRules.forEach(function(r) {
                if (r && r.enabled && r.type === 'watch') {
                    var s = parseInt(r.scanInterval) || 300;
                    if (s < min) min = s;
                }
            });
        }
        if (!isFinite(min)) min = 300;        // 규칙 없으면 기본 300초
        return Math.max(30, min) * 1000;       // 규칙 주기, 최소 30초 하한
    }
    // 실시간 푸시 (감지 즉시) — 봇이 imi_watch_alerts에 쓰는 순간 받음
    _fbStream('imi_watch_alerts', function(node) { _processWatchAlerts(node); });
    // 백업 폴링 (스트림 끊겼을 때 대비, 규칙 주기마다 새 것만)
    (function _scheduleWatchPoll() {
        _pollWatchAlertsNew();
        setTimeout(_scheduleWatchPoll, _watchPollMs());
    })();


    // 3초마다 실존 여부 체크 → 비거래는 블러, 거래번호 배너는 즉시 제거
    var _wCheckQueue = [];
    var _wChecking = false;
    function _wCheckNext() {
        if (_wChecking) return;
        // 거래번호 배너 tid를 우선 체크 (물품 삭제 시 빨리 없애야 함)
        var bannerTids = (typeof window._getWatchBannerTids === 'function') ? window._getWatchBannerTids() : [];
        var watchTids = Object.keys(_wItemCache).filter(function(tid){ return !_wGone.has(tid); });
        var allTids = bannerTids.slice();
        watchTids.forEach(function(t){ if (allTids.indexOf(t) < 0) allTids.push(t); });
        if (!allTids.length) return;
        if (!_wCheckQueue.length) _wCheckQueue = allTids.slice();
        var tid = _wCheckQueue.shift();
        if (!tid) return;
        _wChecking = true;
        fetch('http://1.221.202.77:20002/check_item.php?tid=' + encodeURIComponent(tid), { cache: 'no-store' })
            .then(function(r){ return r.json(); })
            .then(function(data) {
                if (data.exists === false) {
                    // 비거래 패널: 블러
                    if (_wItemCache[tid] && !_wGone.has(tid)) { _wGone.add(tid); _rebuildWatchPanel(); }
                    // 거래번호 배너: 즉시 제거
                    if (typeof window._removeWatchBannerTid === 'function') window._removeWatchBannerTid(tid);
                }
                _wChecking = false;
            })
            .catch(function(){ _wChecking = false; });
    }
    setInterval(_wCheckNext, 3000);

    // 초기화 훅
    window._wWatchClearHook = function() {
        Object.keys(_wItemCache).forEach(function(k){ delete _wItemCache[k]; });
        _wGone.clear(); window._wAiType = {}; _wRemovedTids.clear();
        _shownAlertKeys = new Set();
    };

    // 처리완료/삭제/제외된 비거래는 일정 시간(60초) 후 자동 제거 — 미처리 건만 남김
    var _WATCH_DONE_TTL = 60000;
    setInterval(function() {
        var content = document.getElementById('monhwWatchContent');
        if (!content) return;
        var now = Date.now();
        var toRemove = [];
        content.querySelectorAll('[data-item-tid]').forEach(function(row) {
            if (!(row._autoGone || row._filterDone)) { row._doneAt = 0; return; } // 미처리 → 유지
            if (!row._doneAt) { row._doneAt = now; return; }                       // 막 처리됨 → 시작시각 기록
            if (now - row._doneAt >= _WATCH_DONE_TTL) {
                var tid = row.getAttribute('data-item-tid');
                if (tid) toRemove.push(tid);
            }
        });
        if (toRemove.length) {
            toRemove.forEach(function(tid) {
                delete _wItemCache[tid];
                _wGone.delete(tid);
                if (window._wAiType) delete window._wAiType[tid];
                _wRemovedTids.add(tid);
            });
            _rebuildWatchPanel();
        }
    }, 10000);

    // 비거래: 살아있는 항목의 실존 여부를 3초마다 직접 확인 → 사이트에서 삭제되면 즉시 '물품 삭제됨' 블러
    // (기존엔 봇의 카테고리 재스캔에만 의존 → 항목만 빠진 새 알림이 안 오면 영영 블러 안 됨. 사기글과 동일하게 직접 확인)
    var _wCheckQueue = [];
    var _wChecking = false;
    function _wCheckNext() {
        if (_wChecking) return;
        var content = document.getElementById('monhwWatchContent');
        if (!content) return;
        var rows = content.querySelectorAll('[data-item-tid]');
        var activeTids = [];
        rows.forEach(function(row) {
            if (!row._autoGone && !row._filterDone) {
                var tid = row.getAttribute('data-item-tid');
                if (tid) activeTids.push(tid);
            }
        });
        if (!activeTids.length) return;
        if (!_wCheckQueue.length) _wCheckQueue = activeTids.slice();
        var tid = _wCheckQueue.shift();
        if (!tid) return;
        _wChecking = true;
        fetch('http://1.221.202.77:20002/check_item.php?tid=' + encodeURIComponent(tid), { cache: 'no-store' })
            .then(function(r){ return r.json(); })
            .then(function(data) {
                if (data && data.exists === false) {
                    _wGone.add(tid);                                   // 재생성 시에도 블러 유지
                    if (typeof _monhwAutoMarkGone === 'function') _monhwAutoMarkGone(tid);
                }
                _wChecking = false;
            })
            .catch(function(){ _wChecking = false; });
    }
    setInterval(_wCheckNext, 3000);
})();

// 거래번호 노출 배너 — Firebase에서 직접 구독 (봇이 씀) + 2초 빠른 폴링
function _pollWatchBanner() {
    _mDb.ref('imi_watch_banner').once('value', function(snap) {
        if (typeof window._syncWatchBannerFromData === 'function') {
            window._syncWatchBannerFromData(snap.val() || {});
        }
    });
}
_pollWatchBanner();
setInterval(_pollWatchBanner, 10000);

// 전체 필터제외 버튼 — 이벤트 위임 (fraudDropPanel 카드 헤더)
document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bulk-exclude]');
    if (!btn) return;
    var card = btn.closest('[data-fraud-card]');
    if (!card) return;
    var bkBtns = card.querySelectorAll('[data-bk]:not([disabled])');
    bkBtns.forEach(function(b) { b.click(); });
});

// 필터제외 버튼 — 이벤트 위임 (모니터링 현황 패널 포함)
document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bk]');
    if (!btn) return;
    var fraudPanel  = document.getElementById('fraudDropPanel');
    var monItems    = document.getElementById('monitorAlertItems');
    var toastsEl    = document.getElementById('_imi_fraud_toasts');
    var watchToasts = document.getElementById('_imi_watch_toasts');
    var monhwFraud  = document.getElementById('monhwFraudContent');
    var monhwWatch  = document.getElementById('monhwWatchContent');
    if (!(fraudPanel  && fraudPanel.contains(btn))  &&
        !(monItems    && monItems.contains(btn))     &&
        !(toastsEl    && toastsEl.contains(btn))     &&
        !(watchToasts && watchToasts.contains(btn))  &&
        !(monhwFraud  && monhwFraud.contains(btn))   &&
        !(monhwWatch  && monhwWatch.contains(btn))) return;
    var key   = btn.getAttribute('data-bk');
    var title = btn.getAttribute('data-title') || '';
    var tid   = btn.getAttribute('data-tid') || '';
    var price = parseInt(btn.getAttribute('data-price') || 0) || 0;
    var blockType = btn.getAttribute('data-bktype') || 'fraud';

    // AI 학습 피드백 — 비거래 현황 패널의 배지 종류에 따라 패턴 저장
    if (blockType === 'watch' && title) {
        var _clickedRow = btn.closest('[data-item-tid]') || btn.parentNode.parentNode;
        var _aiBadge = _clickedRow && _clickedRow.querySelector('[data-ai-badge]');
        if (_aiBadge) {
            var _badgeType = _aiBadge.getAttribute('data-ai-badge');
            // 비거래 배지 → 비거래확정 패턴 저장
            // 확인필요 배지에서 필터제외 → 정상 물품 패턴 저장
            _saveWatchFeedback(title, _badgeType === '비거래' ? '비거래확정' : '정상물품');
        }
    }

    // 즉시 UI 반영: 캐시 업데이트 + 현황 패널 행 흐림 + 처리완료 배지
    _blockedKeysCache.add(String(key));
    ['monhwFraudContent','monhwWatchContent'].forEach(function(pid){
        var panel = document.getElementById(pid);
        if (!panel) return;
        panel.querySelectorAll('[data-bk="'+key+'"]').forEach(function(b){
            var row = b.closest('[data-item-tid]') || b.parentNode.parentNode;
            if (row && !row._filterDone) {
                row._filterDone = true;
                _monhwRowDoneOverlay(row, '✅ 처리완료');
            }
            b.disabled = true; b.textContent = '제외됨'; b.style.opacity = '0.4';
        });
    });

    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, price: price, addedBy: addedBy, addedAt: Date.now(), type: blockType });
            _mDb.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
        // 사기글 패널의 모든 항목이 제외됐으면 즉시 닫기
        if (blockType !== 'watch' && fraudPanel && fraudPanel.contains(btn)) {
            var remaining = fraudPanel.querySelectorAll('[data-bk]:not([disabled])');
            if (!remaining.length) closeMonitorFlash();
        }
    });
});

// 비거래 로그 처리완료 버튼 — 이벤트 위임
document.getElementById('monitorLogListW').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-logdone]');
    if (!btn || btn.disabled) return;
    var tid = btn.getAttribute('data-logdone');
    if (!tid) return;
    var by = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
    btn.disabled = true;
    btn.textContent = '✅ 처리완료';
    btn.style.background = 'none';
    btn.style.border = '1px solid #22c55e';
    btn.style.color = '#22c55e';
    btn.style.opacity = '0.4';
    btn.style.cursor = 'default';
    _mDb.ref('imi_watch_done/' + tid).set({ at: Date.now(), by: by });
    // 거래번호 노출 배너에서도 즉시 제거 (폴링 대기 없이)
    if (typeof window._removeWatchBannerTid === 'function') window._removeWatchBannerTid(tid);
});

// 필터제외 버튼 — 이벤트 위임 (log-box 안 #monitorLogList에 직접 위임, stopPropagation 우회)
function _handleLogBkClick(e) {
    var btn = e.target.closest('[data-logbk]');
    if (!btn || btn.disabled) return;
    var key   = btn.getAttribute('data-logbk');
    var title = btn.getAttribute('data-logtitle') || '';
    var tid   = btn.getAttribute('data-logtid') || '';
    var price = parseInt(btn.getAttribute('data-logprice') || 0) || 0;
    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, price: price, addedBy: addedBy, addedAt: Date.now(), type: 'fraud' });
            _mDb.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
        // 오른쪽 패널 제외 탭 자동 전환 및 갱신
        var fromFraud = document.getElementById('monitorLogList') && document.getElementById('monitorLogList').contains(btn);
        if (typeof switchLogExTab === 'function') switchLogExTab(fromFraud ? 1 : 2);
    });
}
document.getElementById('monitorLogList').addEventListener('click', _handleLogBkClick);
document.getElementById('monitorLogListW').addEventListener('click', _handleLogBkClick);

// ===== 로그 패널 =====
var _logFullMode  = false;
var _logFullModeW = false;

// 비거래 처리완료 상태 (Firebase imi_watch_done 동기화)
var _watchDoneSet = {};
_mDb.ref('imi_watch_done').on('value', function(snap) {
    _watchDoneSet = snap.val() || {};
    document.querySelectorAll('[data-logdone]').forEach(function(btn) {
        var tid = btn.getAttribute('data-logdone');
        var info = _watchDoneSet[tid];
        if (info && !btn.disabled) {
            btn.disabled = true;
            var byName = (info && typeof info === 'object') ? (info.by || '') : '';
            btn.textContent = '✅ 처리완료' + (byName ? ' · ' + byName : '');
            btn.style.background = 'none';
            btn.style.border = '1px solid #22c55e';
            btn.style.color = '#22c55e';
            btn.style.opacity = '0.4';
            btn.style.cursor = 'default';
        }
    });
});

function openLogPanel() {
    if (typeof _imiNavSwitch === 'function') _imiNavSwitch('log');
}
function closeLogPanel() {
    document.getElementById('logPanel').classList.add('hidden');
}
function _initLogPanel() {
    _logFullMode = false; _logFullModeW = false;
    ['logFullDayBtnWrap','logFullDayBtnWrapW'].forEach(function(wid) {
        var w = document.getElementById(wid);
        if (w) w.style.display = _isBotPrivileged() ? '' : 'none';
    });
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '📅 24시간 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLog; }
    var btnW = document.getElementById('logFullDayBtnW');
    if (btnW) { btnW.textContent = '📅 24시간 전체 기록 불러오기'; btnW.disabled = false; btnW.style.opacity = '1'; btnW.onclick = loadFullDayLogW; }
    switchLogTab(1);
    switchLogExTab(1);
}
function switchLogTab(n) {
    [1,2,5].forEach(function(i) {
        var t = document.getElementById('logTab'+i);
        var c = document.getElementById('logTabContent'+i);
        if (t) t.classList.toggle('mon-tab-active', i === n);
        if (c) c.style.display = i === n ? '' : 'none';
    });
    // 24시간 버튼: 현재 탭에 맞는 버튼만 표시
    var w1 = document.getElementById('logFullDayBtnWrap');
    var w2 = document.getElementById('logFullDayBtnWrapW');
    if (w1) w1.style.display = (n === 1 && _isBotPrivileged()) ? '' : 'none';
    if (w2) w2.style.display = (n === 2 && _isBotPrivileged()) ? '' : 'none';
    if (n === 1) { _logFullMode  = false; loadMonitorLog(false); switchLogExTab(1); }
    if (n === 2) { _logFullModeW = false; loadWatchLog(false); switchLogExTab(2); }
    if (n === 5 && typeof _imiNavSwitch === 'function') { _imiNavSwitch('stats'); }
}
function switchLogExTab(n) {
    [1,2].forEach(function(i) {
        var t = document.getElementById('logExTab'+i);
        var c = document.getElementById('logTabContent'+(i+2));
        if (t) t.classList.toggle('mon-tab-active', i === n);
        if (c) c.style.display = i === n ? '' : 'none';
    });
    // 전체 해제 버튼 교체
    var clearBtn = document.getElementById('logExClearBtn');
    if (clearBtn) {
        clearBtn.onclick = n === 1 ? clearAllBlockedFraud : clearAllBlockedWatch;
    }
    if (n === 1) loadBlockedFraud();
    if (n === 2) loadBlockedWatch();
}

function loadFullDayLog() {
    _logFullMode = true;
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '⏳ 불러오는 중...'; btn.disabled = true; btn.style.opacity = '0.55'; }
    loadMonitorLog(true);
}
function loadRecentLog() {
    _logFullMode = false;
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '📅 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLog; }
    loadMonitorLog(false);
}
function loadFullDayLogW() {
    _logFullModeW = true;
    var btn = document.getElementById('logFullDayBtnW');
    if (btn) { btn.textContent = '⏳ 불러오는 중...'; btn.disabled = true; btn.style.opacity = '0.55'; }
    loadWatchLog(true);
}
function loadRecentLogW() {
    _logFullModeW = false;
    var btn = document.getElementById('logFullDayBtnW');
    if (btn) { btn.textContent = '📅 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLogW; }
    loadWatchLog(false);
}

function loadMonitorLog(fullDay) { _loadLogByType(fullDay, false); }
function loadWatchLog(fullDay)   { _loadLogByType(fullDay, true);  }

function _loadLogByType(fullDay, isWatch) {
    var ids = isWatch ? {
        list: 'monitorLogListW', empty: 'monitorLogEmptyW',
        btn: 'logFullDayBtnW', loadFull: loadFullDayLogW, loadRecent: loadRecentLogW
    } : {
        list: 'monitorLogList', empty: 'monitorLogEmpty',
        btn: 'logFullDayBtn', loadFull: loadFullDayLog, loadRecent: loadRecentLog
    };

    var cutoff24 = Date.now() - 86400000;
    var histRef = fullDay
        ? _mDb.ref('/monitor_history').limitToLast(2000)
        : _mDb.ref('/monitor_history').limitToLast(500);

    _mDb.ref('/imi_blocked').once('value', function(blockedSnap) {
        var blockedList = blockedSnap.val() || [];
        if (!Array.isArray(blockedList)) blockedList = [];
        var blockedSet = {};
        blockedList.forEach(function(item) {
            var k = typeof item === 'object' ? (item.key || '') : item;
            if (k) blockedSet[k] = true;
            // TID로도 인덱싱 (key 불일치 대비)
            if (typeof item === 'object' && item.tid) blockedSet[item.tid] = true;
        });

        histRef.once('value', function(snap) {
            var val = snap.val() || {};
            var entries = [];
            Object.keys(val).forEach(function(k) {
                var e = val[k];
                if (!e) return;
                if (!e.ruleType) return; // ruleType 없는 구 모니터 엔진 로그 제외
                if (fullDay && e.at < cutoff24) return;
                var entryIsWatch = e.ruleType === 'watch';
                if (isWatch !== entryIsWatch) return;
                entries.push({ key: k, data: e });
            });
            entries.sort(function(a, b) { return b.data.at - a.data.at; });

            var empty = document.getElementById(ids.empty);
            var list  = document.getElementById(ids.list);
            if (!entries.length) {
                if (empty) empty.style.display = '';
                if (list)  list.innerHTML = '';
                var emptyBtn = document.getElementById(ids.btn);
                if (emptyBtn && _isBotPrivileged()) {
                    emptyBtn.disabled = false; emptyBtn.style.opacity = '1';
                    emptyBtn.textContent = fullDay ? '↩ 최근 100건 보기' : '📅 24시간 전체 기록 불러오기';
                    emptyBtn.onclick = fullDay ? ids.loadRecent : ids.loadFull;
                }
                return;
            }
            if (empty) empty.style.display = 'none';

            function _renderEntry(entry) {
                var d = entry.data;
                var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                var entryIsWatch = d.ruleType === 'watch';
                var rtTag = entryIsWatch
                    ? '<span style="font-size:8px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:3px;padding:0 4px;flex-shrink:0;white-space:nowrap;">📦 비거래</span>'
                    : '<span style="font-size:8px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:3px;padding:0 4px;flex-shrink:0;white-space:nowrap;">🚨 사기글</span>';
                var rows = (d.itemRows || []).map(function(it) {
                    var rawKey = it.key || (it.tid ? 'tid_' + it.tid : (it.t || '').substring(0, 30).trim());
                    var bk = _esc(rawKey);
                    var isBlocked = blockedSet[rawKey] || (it.tid && blockedSet[it.tid]);
                    var titleAttr = _esc(it.t || '');
                    var tidAttr = _esc(it.tid || '');
                    var listTime = it.listTime || '';
                    var btnHtml = bk
                        ? (isBlocked
                            ? '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" data-logprice="' + (it.p||0) + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                            : '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" data-logprice="' + (it.p||0) + '" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                        : '';
                    var doneHtml = '';
                    if (entryIsWatch && it.tid) {
                        var doneInfo = _watchDoneSet[it.tid];
                        var isDone = !!doneInfo;
                        var doneBy = (doneInfo && typeof doneInfo === 'object') ? (doneInfo.by || '') : '';
                        doneHtml = isDone
                            ? '<button data-logdone="' + _esc(it.tid) + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #22c55e;color:#22c55e;background:none;flex-shrink:0;opacity:0.4;cursor:default;">✅ 처리완료' + (doneBy ? ' · ' + _esc(doneBy) : '') + '</button>'
                            : '<button data-logdone="' + _esc(it.tid) + '" style="font-size:10px;padding:2px 7px;border-radius:4px;background:#22c55e;color:#000;border:none;cursor:pointer;font-weight:900;flex-shrink:0;">처리완료</button>';
                    }
                    return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                        + (it.tid ? '<div style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#' + _fmtTid(it.tid)
                            + (listTime ? '<span style="font-size:10px;font-weight:500;color:#64748b;">· ' + listTime + '</span>' : '')
                            + doneHtml
                            + '</div>' : '')
                        + '<div style="display:flex;align-items:center;gap:6px;">'
                        + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(it.t || '') + '</div>'
                        + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">' + Number(it.p).toLocaleString() + '원</div>' : '')
                        + btnHtml
                        + '</div>'
                        + '</div>';
                }).join('');
                return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid '+(entryIsWatch?'#22c55e':'#ef4444')+';border-radius:11px;padding:11px 14px;margin-bottom:8px;">'
                    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
                    + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(d.ruleName || '') + '</div>'
                    + rtTag
                    + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">' + timeStr + '</div>'
                    + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">' + (d.itemCount || 0) + '개 감지</div>'
                    + '</div>'
                    + (d.ruleKeyword ? '<div style="font-size:10px;color:#64748b;margin-bottom:7px;">🔑 ' + _esc(d.ruleKeyword) + '</div>' : '')
                    + '<div style="display:flex;flex-direction:column;gap:5px;">' + rows + '</div>'
                    + '</div>';
            }

            var html = '';
            if (fullDay) {
                var hourGroups = {};
                var hourOrder = [];
                entries.forEach(function(entry) {
                    var dt = new Date(entry.data.at);
                    var hKey = dt.getFullYear() + '-'
                        + String(dt.getMonth() + 1).padStart(2, '0') + '-'
                        + String(dt.getDate()).padStart(2, '0') + ' '
                        + String(dt.getHours()).padStart(2, '0');
                    if (!hourGroups[hKey]) { hourGroups[hKey] = []; hourOrder.push(hKey); }
                    hourGroups[hKey].push(entry);
                });
                hourOrder.forEach(function(hKey, idx) {
                    var groupEntries = hourGroups[hKey];
                    var parts = hKey.split(' ');
                    var label = parts[0] + ' ' + parseInt(parts[1]) + '시';
                    var totalItems = groupEntries.reduce(function(s, e){ return s + (e.data.itemCount || 0); }, 0);
                    html += '<details ' + (idx === 0 ? 'open' : '') + ' style="border:2px solid var(--border-ui);border-radius:12px;margin-bottom:8px;overflow:hidden;">'
                        + '<summary style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;font-weight:900;font-size:12px;background:var(--bg-body);user-select:none;list-style:none;">'
                        + '<span style="flex:1;">🕐 ' + label + '</span>'
                        + '<span style="font-size:11px;font-weight:700;color:#ef4444;">' + groupEntries.length + '회 감지 · 총 ' + totalItems + '개</span>'
                        + '</summary>'
                        + '<div style="padding:10px 10px 2px;">'
                        + groupEntries.map(_renderEntry).join('')
                        + '</div>'
                        + '</details>';
                });
            } else if (isWatch) {
                // 비거래 기본 모드: 최근 3회 감지
                var displayEntries = entries.slice(0, 3);
                var hiddenW = entries.length - 3;
                html = displayEntries.map(_renderEntry).join('');
                if (hiddenW > 0) {
                    html += '<div style="text-align:center;font-size:11px;opacity:0.45;padding:4px 0;">📅 이전 감지 ' + hiddenW + '회 — 24시간 전체 보기 버튼으로 확인</div>';
                }
            } else {
                // 사기글 기본 모드: 최신순 5회, 감지별 접힘 카드
                var displayEntries = entries.slice(0, 5);
                var hiddenF = entries.length - 5;
                html = displayEntries.map(function(entry, idx) {
                    var d = entry.data;
                    var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                    var rows = (d.itemRows || []).map(function(it) {
                        var rawKey = it.key || (it.tid ? 'tid_' + it.tid : (it.t || '').substring(0, 30).trim());
                        var bk = _esc(rawKey);
                        var isBlocked = blockedSet[rawKey] || (it.tid && blockedSet[it.tid]);
                        var titleAttr = _esc(it.t || '');
                        var tidAttr   = _esc(it.tid || '');
                        var listTime  = it.listTime || '';
                        var btnHtml = bk
                            ? (isBlocked
                                ? '<button data-logbk="'+bk+'" data-logtitle="'+titleAttr+'" data-logtid="'+tidAttr+'" data-logprice="'+(it.p||0)+'" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                                : '<button data-logbk="'+bk+'" data-logtitle="'+titleAttr+'" data-logtid="'+tidAttr+'" data-logprice="'+(it.p||0)+'" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                            : '';
                        return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                            + (it.tid ? '<div style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#'+_fmtTid(it.tid)
                                + (listTime ? '<span style="font-size:10px;font-weight:500;color:#64748b;">· '+listTime+'</span>' : '')
                                + '</div>' : '')
                            + '<div style="display:flex;align-items:center;gap:6px;">'
                            + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
                            + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>' : '')
                            + btnHtml
                            + '</div></div>';
                    }).join('');
                    return '<details '+(idx===0?'open':'')+' style="border:1.5px solid var(--border-ui);border-left:3px solid #ef4444;border-radius:11px;margin-bottom:8px;overflow:hidden;">'
                        + '<summary style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;list-style:none;background:var(--bg-body);">'
                        + '<span style="font-size:11px;color:#ef4444;flex-shrink:0;">▶</span>'
                        + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(d.ruleName||'')+'</div>'
                        + (d.ruleKeyword ? '<div style="font-size:10px;color:#64748b;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔑 '+_esc(d.ruleKeyword)+'</div>' : '')
                        + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">'+timeStr+'</div>'
                        + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">'+(d.itemCount||0)+'개</div>'
                        + '</summary>'
                        + '<div style="padding:8px 12px 10px;display:flex;flex-direction:column;gap:5px;">'+rows+'</div>'
                        + '</details>';
                }).join('');
                if (hiddenF > 0) {
                    html += '<div style="text-align:center;font-size:11px;opacity:0.45;padding:4px 0;">📅 이전 감지 '+hiddenF+'회 — 24시간 전체 보기 버튼으로 확인</div>';
                }
            }

            if (list) list.innerHTML = html;

            var btn = document.getElementById(ids.btn);
            if (btn && _isBotPrivileged()) {
                btn.disabled = false; btn.style.opacity = '1';
                if (fullDay) { btn.textContent = '↩ 최근 100건 보기'; btn.onclick = ids.loadRecent; }
                else { btn.textContent = '📅 24시간 전체 기록 불러오기'; btn.onclick = ids.loadFull; }
            }
        });
    });
}

// ===== 차단 목록 렌더 (type: 'fraud'=사기글, 'watch'=비거래, 없으면 fraud로 간주) =====
function _renderBlockedByType(type, containerId, emptyId) {
    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var filtered = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t === type;
        });
        var container = document.getElementById(containerId);
        var empty     = document.getElementById(emptyId);
        if (!filtered.length) {
            container.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        container.innerHTML = filtered.slice().reverse().map(function(item) {
            var key     = typeof item === 'object' ? (item.key   || '') : item;
            var title   = typeof item === 'object' ? (item.title || '') : '';
            var tid     = typeof item === 'object' ? (item.tid   || '') : '';
            var price   = typeof item === 'object' ? (item.price || 0) : 0;
            var addedBy = typeof item === 'object' ? (item.addedBy || '') : '';
            var addedAt = typeof item === 'object' && item.addedAt ? new Date(item.addedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
            var subText = tid ? ('#' + tid) : key;
            return '<div style="display:flex;align-items:center;gap:10px;padding:6px 12px;border:1.5px solid var(--border-ui);border-radius:8px;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                + (title ? '<div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(title) + '</div>' : '')
                + '<div style="font-size:10px;opacity:0.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(subText) + '</div>'
                + '</div>'
                + '<div style="flex-shrink:0;text-align:right;line-height:1.5;">'
                + (price ? '<div style="font-size:11px;font-weight:900;color:#ef4444;">' + Number(price).toLocaleString() + '원</div>' : '')
                + (addedBy ? '<div style="font-size:9.5px;opacity:0.5;white-space:nowrap;">✍️ ' + _esc(addedBy) + (addedAt ? ' · ' + addedAt : '') + '</div>' : '')
                + '</div>'
                + '<button onclick="unblockItem(\'' + _esc(key.replace(/'/g,'\\\'')) + '\')" style="font-size:10px;padding:3px 10px;border-radius:5px;border:1px solid #22c55e;color:#22c55e;background:none;cursor:pointer;font-weight:700;flex-shrink:0;">제외 해제</button>'
                + '</div>';
        }).join('');
    });
}
function loadBlockedFraud() { _renderBlockedByType('fraud', 'blockedItemList',  'blockedEmpty'); }
function loadBlockedWatch() { _renderBlockedByType('watch', 'blockedItemListW', 'blockedEmptyW'); }
function loadBlockedItems() { loadBlockedFraud(); }

// ===== 개별 차단 해제 (key 기반) =====
function unblockItem(key) {
    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var k = typeof item === 'object' ? item.key : item;
            return k !== key;
        });
        _mDb.ref('/imi_blocked').set(newList, function() {
            loadBlockedFraud();
            loadBlockedWatch();
            loadMonitorLog();
        });
    });
}

// ===== 전체 차단 해제 (타입별) =====
function clearAllBlockedFraud() {
    if (!confirm('사기글 필터제외 목록을 전체 삭제하시겠습니까?')) return;
    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t !== 'fraud';
        });
        _mDb.ref('/imi_blocked').set(newList, function() { loadBlockedFraud(); loadMonitorLog(); });
    });
}
function clearAllBlockedWatch() {
    if (!confirm('비거래 필터제외 목록을 전체 삭제하시겠습니까?')) return;
    _mDb.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t !== 'watch';
        });
        _mDb.ref('/imi_blocked').set(newList, function() { loadBlockedWatch(); });
    });
}
function clearAllBlocked() { clearAllBlockedFraud(); }

// ===== 감지 통계 =====

function loadStatsTab() {
    var today = new Date();
    var pad = function(n) { return String(n).padStart(2,'0'); };
    var todayStr = today.getFullYear() + '-' + pad(today.getMonth()+1) + '-' + pad(today.getDate());
    var monthStr = today.getFullYear() + '-' + pad(today.getMonth()+1);
    ['watchDayPicker','fraudDayPicker'].forEach(function(id) { var el=document.getElementById(id); if(el&&!el.value) el.value=todayStr; });
    ['watchMonthPicker','fraudMonthPicker'].forEach(function(id) { var el=document.getElementById(id); if(el&&!el.value) el.value=monthStr; });
    _loadWatchStats(
        (document.getElementById('watchDayPicker')||{}).value || todayStr,
        (document.getElementById('watchMonthPicker')||{}).value || monthStr
    );
    _loadFraudStats(
        (document.getElementById('fraudDayPicker')||{}).value || todayStr,
        (document.getElementById('fraudMonthPicker')||{}).value || monthStr
    );
}

function _onWatchDateChange()  { var dp=document.getElementById('watchDayPicker'); var mp=document.getElementById('watchMonthPicker'); _loadWatchStats(dp?dp.value:'', mp?mp.value:''); }
function _onWatchMonthChange() { var dp=document.getElementById('watchDayPicker'); var mp=document.getElementById('watchMonthPicker'); _loadWatchStats(dp?dp.value:'', mp?mp.value:''); }
function _onFraudDateChange()  { var dp=document.getElementById('fraudDayPicker'); var mp=document.getElementById('fraudMonthPicker'); _loadFraudStats(dp?dp.value:'', mp?mp.value:''); }
function _onFraudMonthChange() { var dp=document.getElementById('fraudDayPicker'); var mp=document.getElementById('fraudMonthPicker'); _loadFraudStats(dp?dp.value:'', mp?mp.value:''); }

// 비거래 통계 — imi_watch_alerts(오늘) + imi_watch_stats(과거), TID 중복제거
function _loadWatchStats(dateStr, monthStr) {
    var pad = function(n) { return String(n).padStart(2,'0'); };
    _mDb.ref('imi_watch_alerts').limitToLast(100).once('value', function(alertsSnap) {
        var alerts = alertsSnap.val() || {};
        // dateStr+hour별 첫 감지 시각 기준으로 TID 배정 (중복 제거)
        var tidFirstSeen = {}; // tid → { dStr, hStr, at }
        Object.values(alerts).forEach(function(val) {
            if (!val || !val.at) return;
            var d = new Date(val.at);
            var dStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
            var hStr = pad(d.getHours());
            (val.tids || []).forEach(function(tid) {
                if (!tid) return;
                if (!tidFirstSeen[tid] || val.at < tidFirstSeen[tid].at) {
                    tidFirstSeen[tid] = { dStr: dStr, hStr: hStr, at: val.at };
                }
            });
        });
        // 시간대별 카운트 (선택 날짜)
        var hourCounts = {};
        // 월별 일별 카운트
        var monthDayCounts = {};
        Object.values(tidFirstSeen).forEach(function(info) {
            if (info.dStr === dateStr) hourCounts[info.hStr] = (hourCounts[info.hStr] || 0) + 1;
            if (info.dStr.startsWith(monthStr)) {
                var day = info.dStr.split('-')[2];
                monthDayCounts[day] = (monthDayCounts[day] || 0) + 1;
            }
        });
        // 과거 데이터(imi_watch_stats) 보완 — 오늘 데이터 없는 날에 한해 사용
        _mDb.ref('/imi_watch_stats').once('value', function(statsSnap) {
            var allStats = statsSnap.val() || {};
            // 선택 날짜가 과거인 경우 imi_watch_stats 사용
            var histDay = allStats[dateStr] || {};
            if (Object.keys(hourCounts).length === 0) {
                Object.keys(histDay).forEach(function(hStr) { hourCounts[hStr] = histDay[hStr].total || 0; });
            }
            // 월별: imi_watch_stats에서 아직 없는 날 보완
            Object.keys(allStats).forEach(function(dStr) {
                if (!dStr.startsWith(monthStr)) return;
                var day = dStr.split('-')[2];
                if (!monthDayCounts[day]) {
                    var t = 0;
                    Object.values(allStats[dStr]).forEach(function(h) { t += (h.total || 0); });
                    monthDayCounts[day] = t;
                }
            });
            _renderBarChart('watchDayChart', hourCounts, '#22c55e');
            _renderLineChart('watchMonthChart', monthDayCounts, '#22c55e');
        });
    });
}

// 사기글 통계 — imi_fraud_stats (미리 집계된 데이터)
function _loadFraudStats(dateStr, monthStr) {
    _mDb.ref('/imi_fraud_stats').once('value', function(statsSnap) {
        var allStats = statsSnap.val() || {};
        var hourCounts = allStats[dateStr] || {};
        var monthDayCounts = {};
        Object.keys(allStats).forEach(function(dStr) {
            if (!dStr.startsWith(monthStr)) return;
            var day = dStr.split('-')[2];
            var t = 0;
            Object.values(allStats[dStr]).forEach(function(v) { t += (v || 0); });
            monthDayCounts[day] = t;
        });
        _renderBarChart('fraudDayChart', hourCounts, '#ef4444');
        _renderLineChart('fraudMonthChart', monthDayCounts, '#ef4444');
    });
}

// 막대 그래프 (시간대별 단색, 툴팁 포함)
function _renderBarChart(containerId, hourCounts, barColor) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var maxVal = 0;
    for (var h=0; h<24; h++) { var v=hourCounts[String(h).padStart(2,'0')]||0; if(v>maxVal) maxVal=v; }
    if (maxVal === 0) { container.innerHTML='<div style="text-align:center;padding:24px 0;font-size:11px;opacity:0.35;">해당 날짜 감지 기록 없음</div>'; return; }
    var W=340,H=130,pL=24,pB=16,pT=6,pR=4,cW=W-pL-pR,cH=H-pB-pT,slotW=cW/24,barW=slotW*0.65;
    var svg='<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;">';
    [0.25,0.5,0.75,1].forEach(function(r){
        var y=pT+cH*(1-r);
        svg+='<line x1="'+pL+'" y1="'+y.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+y.toFixed(1)+'" stroke="#1e293b" stroke-width="1"/>';
        svg+='<text x="'+(pL-2)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="7" fill="#475569">'+Math.round(maxVal*r)+'</text>';
    });
    svg+='<line x1="'+pL+'" y1="'+(pT+cH)+'" x2="'+(W-pR)+'" y2="'+(pT+cH)+'" stroke="#334155" stroke-width="1"/>';
    for (var h=0; h<24; h++){
        var hStr=String(h).padStart(2,'0'), v=hourCounts[hStr]||0;
        var x=pL+slotW*h+(slotW-barW)/2;
        if (v>0) {
            var bH=(v/maxVal)*cH;
            svg+='<rect x="'+x.toFixed(1)+'" y="'+(pT+cH-bH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bH.toFixed(1)+'" fill="'+barColor+'" rx="1.5"/>';
        }
        // 투명 호버 영역 (data-tip 속성으로 툴팁)
        svg+='<rect x="'+(pL+slotW*h).toFixed(1)+'" y="'+pT+'" width="'+slotW.toFixed(1)+'" height="'+cH+'" fill="transparent" data-tip="'+h+'시  '+v+'건"/>';
        if(h%3===0) svg+='<text x="'+(x+barW/2).toFixed(1)+'" y="'+(H-3)+'" text-anchor="middle" font-size="7" fill="#475569">'+h+'</text>';
    }
    svg+='</svg>';
    container.innerHTML=svg;
    _attachChartTip(container);
}

// 꺾은선 그래프 (월별 일별, 툴팁 포함)
function _renderLineChart(containerId, dailyCounts, lineColor) {
    var container=document.getElementById(containerId);
    if(!container) return;
    if(!lineColor) lineColor='#60a5fa';
    var maxVal=0;
    for(var d=1;d<=31;d++){var v=dailyCounts[String(d).padStart(2,'0')]||0;if(v>maxVal)maxVal=v;}
    if(maxVal===0){container.innerHTML='<div style="text-align:center;padding:20px 0;font-size:11px;opacity:0.35;">해당 월 감지 기록 없음</div>';return;}
    var W=340,H=100,pL=24,pB=14,pT=6,pR=4,cW=W-pL-pR,cH=H-pB-pT,xStep=cW/30;
    var svg='<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;">';
    [0.5,1].forEach(function(r){
        var y=pT+cH*(1-r);
        svg+='<line x1="'+pL+'" y1="'+y.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+y.toFixed(1)+'" stroke="#1e293b" stroke-width="1"/>';
        svg+='<text x="'+(pL-2)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="7" fill="#475569">'+Math.round(maxVal*r)+'</text>';
    });
    svg+='<line x1="'+pL+'" y1="'+(pT+cH)+'" x2="'+(W-pR)+'" y2="'+(pT+cH)+'" stroke="#334155" stroke-width="1"/>';
    var points=[];
    for(var d=1;d<=31;d++){
        var v=dailyCounts[String(d).padStart(2,'0')]||0;
        points.push({x:(pL+(d-1)*xStep),y:(pT+cH-(v/maxVal)*cH),v:v,d:d});
    }
    var pathD=points.map(function(p,i){return(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    svg+='<path d="'+pathD+' L'+points[30].x.toFixed(1)+','+(pT+cH)+' L'+points[0].x.toFixed(1)+','+(pT+cH)+' Z" fill="'+lineColor+'" fill-opacity="0.08"/>';
    svg+='<path d="'+pathD+'" fill="none" stroke="'+lineColor+'" stroke-width="1.5" stroke-linejoin="round"/>';
    points.forEach(function(p){
        if(p.v>0) svg+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="2.5" fill="'+lineColor+'"/>';
        // 투명 호버 영역
        svg+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="8" fill="transparent" data-tip="'+p.d+'일  '+p.v+'건"/>';
    });
    [1,5,10,15,20,25,31].forEach(function(d){var p=points[d-1];svg+='<text x="'+p.x.toFixed(1)+'" y="'+(H-2)+'" text-anchor="middle" font-size="7" fill="#475569">'+d+'</text>';});
    svg+='</svg>';
    container.innerHTML=svg;
    _attachChartTip(container);
}

// 툴팁 이벤트 연결
function _attachChartTip(container) {
    container.addEventListener('mousemove', function(e) {
        var tip = e.target.getAttribute('data-tip');
        if (tip) _showChartTip(e, tip);
        else _hideChartTip();
    });
    container.addEventListener('mouseleave', _hideChartTip);
}
function _showChartTip(evt, text) {
    var tip = document.getElementById('_statsTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = '_statsTip';
        tip.style.cssText = 'position:fixed;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;pointer-events:none;z-index:9999;white-space:nowrap;';
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = '';
    tip.style.left = (evt.clientX + 10) + 'px';
    tip.style.top = (evt.clientY - 32) + 'px';
}
function _hideChartTip() {
    var tip = document.getElementById('_statsTip');
    if (tip) tip.style.display = 'none';
}

// ===== 봇 규칙 관리 (Firebase /imi_rules 배열) =====
var _botRules = [];
var _botRuleEditingId = null;

_mDb.ref('/imi_rules').on('value', function(snap) {
    var val = snap.val();
    _botRules = Array.isArray(val) ? val.filter(Boolean)
              : (val && typeof val === 'object') ? Object.values(val).filter(Boolean)
              : [];
    _renderBotRuleList();
    _renderWatchRules();
});

function _renderBotRuleList() {
    var list = document.getElementById('botRuleList');
    if (!list) return;
    if (!_botRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 봇 규칙이 없습니다</div>';
        return;
    }
    var canEdit = _isBotPrivileged();
    var fraudRules = _botRules.filter(function(r) { return r.type !== 'watch'; });
    if (!fraudRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 사기글 규칙이 없습니다</div>';
        return;
    }
    var bf = 'calc(var(--base-font,20px)*';
    list.innerHTML = fraudRules.map(function(r) {
        var runStatus = (_botStatus && _botStatus.rules) ? _botStatus.rules.find(function(sr){ return sr.id === r.id; }) : null;
        var isRunning = !!(runStatus && runStatus.tabOpen);
        var isEnabled = !!r.enabled;
        var runColor  = isRunning ? '#22c55e' : (isEnabled ? '#f59e0b' : '#94a3b8');
        var runLabel  = isRunning ? '● 감시중' : (isEnabled ? '○ 감시대기' : '■ 대기');
        var typeTag = r.type === 'watch'
            ? '<span style="font-size:'+bf+'0.5);font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            : '<span style="font-size:'+bf+'0.5);font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 5px;flex-shrink:0;">🚨 사기글</span>';
        var kwTags = r.keyword ? r.keyword.split(',').map(function(k){ k=k.trim(); return k?'<span class="mon-tag">🔑 '+_esc(k)+'</span>':''; }).join('') : '';
        var subKwTags = r.subKeyword ? r.subKeyword.split(',').map(function(k){ k=k.trim(); return k?'<span class="mon-tag" style="color:#7dd3fc;border-color:#0284c7;">🔗 AND: '+_esc(k)+'</span>':''; }).join('') : '';
        var exKwTags = r.excludeKeyword ? r.excludeKeyword.split(',').map(function(k){ k=k.trim(); return k?'<span class="mon-tag">🚫 '+_esc(k)+'</span>':''; }).join('') : '';
        var statusEl = canEdit
            ? '<button onclick="toggleBotRuleEnabled(\''+_esc(r.id)+'\','+(!isEnabled)+')" title="'+(isEnabled?'클릭 → 비활성화':'클릭 → 활성화')+'" style="font-size:'+bf+'0.55);font-weight:900;color:'+runColor+';background:none;border:1.5px solid '+runColor+';border-radius:5px;cursor:pointer;padding:2px 7px;flex-shrink:0;transition:0.15s;">'+runLabel+'</button>'
            : '<span style="font-size:'+bf+'0.55);font-weight:900;color:'+runColor+';flex-shrink:0;">'+runLabel+'</span>';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            + '<span style="font-size:'+bf+'0.65);font-weight:900;">' + _esc(r.name) + '</span>'
            + '</div>'
            + typeTag
            + statusEl
            + (canEdit ? '<button onclick="startEditBotRule(\''+_esc(r.id)+'\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>' : '')
            + (canEdit ? '<button onclick="deleteBotRule(\''+_esc(r.id)+'\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>' : '')
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + kwTags + subKwTags
            + (r.minPrice       ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + (r.maxPrice       ? '<span class="mon-tag">💰 ' + Number(r.maxPrice).toLocaleString() + '원↓</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + exKwTags
            + (r.photoMinPrice   ? '<span class="mon-tag">📸 ' + Number(r.photoMinPrice).toLocaleString() + '원↑</span>' : '')
            + (r.noPhotoMinPrice ? '<span class="mon-tag">📝 ' + Number(r.noPhotoMinPrice).toLocaleString() + '원↑</span>' : '')
            + '</div>'
            + '<div style="font-size:'+bf+'0.5);opacity:0.3;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.url || '') + '</div>'
            + '</div>';
    }).join('');
}

function _saveBotRules(rules) {
    _mDb.ref('/imi_rules').set(rules);
}

function toggleBotRuleEnabled(id, enabled) {
    if (!_isBotPrivileged()) return;
    _saveBotRules(_botRules.map(function(r) {
        return r.id === id ? Object.assign({}, r, { enabled: enabled }) : r;
    }));
}

function deleteBotRule(id) {
    if (!_isBotPrivileged()) return;
    if (!confirm('이 봇 규칙을 삭제하시겠습니까?')) return;
    _saveBotRules(_botRules.filter(function(r) { return r.id !== id; }));
    if (_botRuleEditingId === id) _cancelBotRuleEdit();
}

function startEditBotRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; });
    if (!r) return;
    if (typeof switchMonBotTab === 'function') switchMonBotTab(1);
    _botRuleEditingId = id;
    document.getElementById('brName').value     = r.name || '';
    document.getElementById('brUrl').value      = r.url  || '';
    document.getElementById('brKw').value       = r.keyword || '';
    document.getElementById('brSubKw').value    = r.subKeyword || '';
    document.getElementById('brMin').value      = r.minPrice || '';
    document.getElementById('brMax').value      = r.maxPrice || '';
    document.getElementById('brInterval').value = r.scanInterval || 300;
    document.getElementById('brExclude').value  = r.excludeKeyword || '';
    document.getElementById('brPhotoMinPrice').value   = r.photoMinPrice   || '';
    document.getElementById('brNoPhotoMinPrice').value = r.noPhotoMinPrice || '';
    var brTypeEl = document.querySelector('input[name="brType"][value="'+(r.type||'fraud')+'"]');
    if (brTypeEl) brTypeEl.checked = true;
    document.getElementById('brAddBtn').textContent   = '✏️ 수정 완료';
    document.getElementById('brAddBtn').style.background = '#f59e0b';
    document.getElementById('brFormTitle').textContent  = '✏️ 규칙 수정 중';
    document.getElementById('brCancelBtn').style.display = '';
    document.getElementById('brName').focus();
}

function _cancelBotRuleEdit() {
    _botRuleEditingId = null;
    ['brName','brUrl','brKw','brSubKw','brMin','brMax','brExclude','brPhotoMinPrice','brNoPhotoMinPrice'].forEach(function(id) {
        document.getElementById(id).value = '';
    });
    document.getElementById('brInterval').value = '300';
    var fraudEl = document.getElementById('brTypeFraud'); if (fraudEl) fraudEl.checked = true;
    document.getElementById('brAddBtn').textContent   = '✅ 규칙 등록';
    document.getElementById('brAddBtn').style.background = '';
    document.getElementById('brFormTitle').textContent  = '➕ 새 규칙 추가';
    document.getElementById('brCancelBtn').style.display = 'none';
}

function addBotRule() {
    if (!_isBotPrivileged()) { alert('관리자 또는 부관리자만 봇 규칙을 관리할 수 있습니다.'); return; }
    var name           = (document.getElementById('brName').value || '').trim();
    var url            = (document.getElementById('brUrl').value  || '').trim();
    var keyword        = (document.getElementById('brKw').value     || '').trim();
    var subKeyword     = (document.getElementById('brSubKw').value  || '').trim();
    var minPrice       = parseInt(document.getElementById('brMin').value)      || 0;
    var maxPrice       = parseInt(document.getElementById('brMax').value)      || 0;
    var scanInterval   = parseInt(document.getElementById('brInterval').value) || 300;
    var excludeKeyword  = (document.getElementById('brExclude').value || '').trim();
    var photoMinPrice   = parseInt(document.getElementById('brPhotoMinPrice').value)   || 0;
    var noPhotoMinPrice = parseInt(document.getElementById('brNoPhotoMinPrice').value) || 0;
    var typeEl          = document.querySelector('input[name="brType"]:checked');
    var ruleType       = typeEl ? typeEl.value : 'fraud';

    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요. (https://...)'); return; }
    if (!keyword && !minPrice) { alert('키워드 또는 최소가격 중 하나는 필요합니다.'); return; }

    if (_botRuleEditingId) {
        _saveBotRules(_botRules.map(function(r) {
            return r.id === _botRuleEditingId
                ? Object.assign({}, r, { name: name, url: url, keyword: keyword, subKeyword: subKeyword, minPrice: minPrice, maxPrice: maxPrice, scanInterval: scanInterval, excludeKeyword: excludeKeyword, photoMinPrice: photoMinPrice, noPhotoMinPrice: noPhotoMinPrice, photoOnly: false, noPhotoOnly: false, type: ruleType })
                : r;
        }));
        _cancelBotRuleEdit();
        var _brBtn = document.getElementById('brAddBtn');
        if (_brBtn) { var _brOrig = _brBtn.textContent; _brBtn.textContent = '✅ 수정 완료!'; _brBtn.style.background = '#22c55e'; setTimeout(function(){ _brBtn.textContent = _brOrig; _brBtn.style.background = ''; }, 1500); }
    } else {
        var newRule = {
            id: 'r_' + Date.now(),
            name: name, url: url, keyword: keyword, subKeyword: subKeyword,
            minPrice: minPrice, maxPrice: maxPrice,
            scanInterval: scanInterval, excludeKeyword: excludeKeyword,
            photoMinPrice: photoMinPrice, noPhotoMinPrice: noPhotoMinPrice, type: ruleType, enabled: true, createdAt: Date.now()
        };
        _saveBotRules(_botRules.concat([newRule]));
        ['brName','brUrl','brKw','brSubKw','brMin','brMax','brExclude'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        document.getElementById('brInterval').value = '300';
        var fraudEl = document.getElementById('brTypeFraud'); if (fraudEl) fraudEl.checked = true;
        alert('✅ 규칙이 등록됐습니다: ' + name + '\n1분 내로 봇에 자동 반영됩니다.');
    }
}

// ===== 거래번호 감시 (watched_tids) =====
var _watchedTids = {};
var _watchEditingKey = null;

_mDb.ref('/watched_tids').on('value', function(snap) {
    _watchedTids = snap.val() || {};
    _renderWatchedTids();
    // watched_tids에 없는 고아 배너 즉시 정리
    _mDb.ref('/imi_watch_banner').once('value', function(bSnap) {
        var banners = bSnap.val() || {};
        Object.keys(banners).forEach(function(bKey) {
            if (!_watchedTids[bKey]) _mDb.ref('/imi_watch_banner/' + bKey).set(null);
        });
    });
});

function addWatchedTid() {
    var tid   = (document.getElementById('wtTid').value   || '').trim().replace(/\s/g, '');
    var label = (document.getElementById('wtLabel').value || '').trim();
    if (!tid || !/^\d+$/.test(tid)) { alert('거래번호는 숫자만 입력하세요.'); return; }

    if (_watchEditingKey) {
        _mDb.ref('/watched_tids/' + _watchEditingKey).update({ tid: tid, label: label, alertSent: false }, function(err) {
            if (err) { alert('수정 실패: ' + err.message); return; }
            _cancelWatchEdit();
            alert('✅ 수정됐습니다.');
        });
        return;
    }

    if (_watchedTids) {
        var exists = Object.values(_watchedTids).some(function(v){ return v && String(v.tid) === tid; });
        if (exists) { alert('이미 등록된 거래번호입니다.'); return; }
    }
    var key = 'wt_' + Date.now();
    var addedBy = (typeof _currentUser !== 'undefined' && _currentUser) ? (_currentUser.name || '') : '';
    _mDb.ref('/watched_tids/' + key).set({
        tid: tid, label: label, addedBy: addedBy,
        addedAt: Date.now(), alertSent: false
    }, function(err) {
        if (err) { alert('등록 실패: ' + err.message); return; }
        document.getElementById('wtTid').value   = '';
        document.getElementById('wtLabel').value = '';
        alert('✅ 거래번호 ' + tid + ' 감시 등록됐습니다.');
    });
}

function startEditWatchedTid(key) {
    var v = _watchedTids[key];
    if (!v) return;
    if (typeof switchMonBotTab === 'function') switchMonBotTab(3);
    _watchEditingKey = key;
    document.getElementById('wtTid').value   = v.tid   || '';
    document.getElementById('wtLabel').value = v.label || '';
    document.getElementById('wtAddBtn').textContent    = '✏️ 수정 완료';
    document.getElementById('wtAddBtn').style.background = '#f59e0b';
    document.getElementById('wtFormTitle').textContent = '✏️ 수정 중';
    document.getElementById('wtCancelBtn').style.display = '';
    document.getElementById('wtTid').focus();
}

function _cancelWatchEdit() {
    _watchEditingKey = null;
    document.getElementById('wtTid').value   = '';
    document.getElementById('wtLabel').value = '';
    document.getElementById('wtAddBtn').textContent    = '🔍 감시 등록';
    document.getElementById('wtAddBtn').style.background = '#22c55e';
    document.getElementById('wtFormTitle').textContent = '➕ 감시 등록';
    document.getElementById('wtCancelBtn').style.display = 'none';
}

function deleteWatchedTid(key, tid) {
    if (!confirm('"' + tid + '" 감시를 삭제하시겠습니까?')) return;
    _mDb.ref('/watched_tids/' + key).set(null, function(err) {
        if (err) { alert('삭제 실패: ' + err.message); return; }
        // 배너도 같이 제거
        _mDb.ref('/imi_watch_banner/' + key).set(null);
        if (_watchEditingKey === key) _cancelWatchEdit();
    });
}

function _loadWatchInterval() {
    _mDb.ref('/tid_watch_interval').once('value', function(snap) {
        var v = snap.val();
        var el = document.getElementById('wtInterval');
        // 구형 데이터(분)를 초로 자동 변환: 값이 120 이하면 분 단위 레거시
        if (el && v) el.value = (v <= 120 ? v * 60 : v);
    });
}

function saveWatchInterval() {
    var el = document.getElementById('wtInterval');
    var v = parseInt(el ? el.value : '') || 1200;
    if (v < 60) v = 60;
    if (v > 3600) v = 3600;
    el.value = v;
    _mDb.ref('/tid_watch_interval').set(v, function(err) {
        if (err) { alert('저장 실패: ' + err.message); return; }
        var min = Math.floor(v/60), sec = v%60;
        var label = min > 0 ? min + '분' + (sec > 0 ? ' ' + sec + '초' : '') : sec + '초';
        alert('✅ 체크 간격이 ' + label + '으로 저장됐습니다.\n다음 체크 주기부터 적용됩니다.');
    });
}

function _renderWatchedTids() {
    var list = document.getElementById('watchedTidList');
    if (!list) return;
    var entries = Object.entries(_watchedTids || {});
    if (!entries.length) {
        list.innerHTML = '<div style="text-align:center;padding:16px 0;opacity:0.35;font-size:12px;">등록된 감시 거래번호가 없습니다</div>';
        return;
    }
    var bf = 'calc(var(--base-font,20px)*';
    entries.sort(function(a, b){ return (b[1].addedAt||0) - (a[1].addedAt||0); });
    list.innerHTML = entries.map(function(e) {
        var k = e[0]; var v = e[1];
        var tid = _esc(String(v.tid || ''));
        var label = v.label ? ('<span style="font-size:'+bf+'0.6);font-weight:700;color:var(--text-main);">' + _esc(v.label) + '</span>') : '';
        var tidFmt = tid.replace(/(.{4})(?=.)/g, '$1 ');
        var statusColor = v.alertSent ? '#22c55e' : '#f59e0b';
        var statusText  = v.alertSent ? '✅ 노출 감지됨' : '⏳ 감시중';
        var addedAt = v.addedAt ? new Date(v.addedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:8px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;overflow:hidden;">'
            + '<span style="font-size:'+bf+'0.8);font-weight:900;color:#38bdf8;letter-spacing:0.03em;white-space:nowrap;flex-shrink:0;">#' + tidFmt + '</span>'
            + (label ? label : '')
            + '</div>'
            + (addedAt ? '<span style="font-size:'+bf+'0.48);opacity:0.4;flex-shrink:0;white-space:nowrap;">' + (v.addedBy ? v.addedBy + ' · ' : '') + addedAt + '</span>' : '')
            + '<span style="font-size:'+bf+'0.55);font-weight:900;color:' + statusColor + ';flex-shrink:0;">' + statusText + '</span>'
            + '<button onclick="startEditWatchedTid(\'' + _esc(k) + '\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>'
            + '<button onclick="deleteWatchedTid(\'' + _esc(k) + '\',\'' + tid + '\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>'
            + '</div>'
            + '</div>';
    }).join('');
}

// ===== 비거래 스캔 규칙 (type:'watch' in /imi_rules) =====
var _wsrEditingKey = null;

function _renderWatchRules() {
    var list = document.getElementById('watchScanRuleList');
    if (!list) return;
    var watchRules = _botRules.filter(function(r) { return r.type === 'watch'; });
    if (!watchRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 비거래 규칙이 없습니다</div>';
        return;
    }
    var canEdit = _isBotPrivileged();
    var bf = 'calc(var(--base-font,20px)*';
    list.innerHTML = watchRules.map(function(r) {
        var enabled = r.enabled !== false;
        var runStatus = (_botStatus && _botStatus.rules) ? _botStatus.rules.find(function(sr){ return sr.id === r.id; }) : null;
        var tabOpen = !!(runStatus && runStatus.tabOpen);
        var runColor = (enabled && tabOpen) ? '#22c55e' : (enabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (enabled && tabOpen) ? '● 감시중' : (enabled ? '○ 대기' : '■ 비활성');
        var kwTags = r.keyword ? r.keyword.split(',').map(function(k){ k=k.trim(); return k?'<span class="mon-tag">🔑 '+_esc(k)+'</span>':''; }).join('') : '';
        var exKwTags = r.excludeKeyword ? r.excludeKeyword.split(',').map(function(k){ k=k.trim(); return k?'<span class="mon-tag" style="color:#f87171;">🚫 '+_esc(k)+'</span>':''; }).join('') : '';
        return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid #22c55e;border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<div style="flex:1;min-width:0;">'
            + '<span style="font-size:'+bf+'0.65);font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">'+_esc(r.name||'(이름없음)')+'</span>'
            + '</div>'
            + '<span style="font-size:'+bf+'0.5);font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            + '<span style="font-size:'+bf+'0.55);font-weight:900;color:'+runColor+';flex-shrink:0;">'+runLabel+'</span>'
            + (canEdit?'<button id="wsrtest_'+_esc(r.id)+'" onclick="_testWsrRule(\''+_esc(r.id)+'\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid var(--active-focus-color);color:var(--active-focus-color);background:none;cursor:pointer;flex-shrink:0;">🔍 테스트</button>':'')
            + (canEdit?'<button onclick="_editWsrRule(\''+_esc(r.id)+'\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>':'')
            + (canEdit?'<button onclick="_deleteWsrRule(\''+_esc(r.id)+'\')" style="font-size:'+bf+'0.55);padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>':'')
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + kwTags + exKwTags
            + '<span class="mon-tag">⏱ '+(r.scanInterval||300)+'초</span>'
            + (enabled
                ? '<button onclick="toggleBotRuleEnabled(\''+_esc(r.id)+'\',false)" style="font-size:'+bf+'0.5);padding:1px 7px;border-radius:4px;border:1px solid #94a3b8;color:#94a3b8;background:none;cursor:pointer;">정지</button>'
                : '<button onclick="toggleBotRuleEnabled(\''+_esc(r.id)+'\',true)" style="font-size:'+bf+'0.5);padding:1px 7px;border-radius:4px;border:1px solid #22c55e;color:#22c55e;background:none;cursor:pointer;">시작</button>')
            + '</div>'
            + '<div style="font-size:'+bf+'0.5);opacity:0.25;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.url||'')+'</div>'
            + '</div>';
    }).join('');
}

async function _testWsrRule(id) {
    var v = _botRules.find(function(r){ return r.id === id; }); if (!v) return;
    var btn = document.getElementById('wsrtest_' + id);
    if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
    try {
        var html = await _fetchViaProxy(v.url);
        var allItems = _parseItemmaniaHtml(html, '', 0, v.url);
        var matchItems = _parseItemmaniaHtml(html, v.keyword || '', 0, v.url);
        var exKws = (v.excludeKeyword || '').split(',').map(function(k){ return k.trim().toLowerCase(); }).filter(Boolean);
        if (exKws.length) {
            matchItems = matchItems.filter(function(it) {
                var tl = (it.title || '').toLowerCase();
                return !exKws.some(function(k){ return tl.includes(k); });
            });
        }
        var msg = '🔍 비거래 스캔 테스트 — ' + v.name + '\n─────────────────────\n';
        msg += '📄 파싱된 물품: ' + allItems.length + '개\n';
        msg += '✅ 키워드 일치: ' + matchItems.length + '개\n\n';
        if (allItems.length === 0) {
            msg += '⚠️ 물품을 하나도 파싱하지 못했습니다.\n→ URL이 목록 페이지인지, CORS 확장이 켜져 있는지 확인하세요.';
        } else if (matchItems.length === 0) {
            msg += '⚠️ 키워드 "' + (v.keyword || '') + '"에 맞는 물품 없음\n\n';
            msg += '[ 파싱된 물품 예시 ]\n';
            allItems.slice(0, 3).forEach(function(it, i) { msg += (i + 1) + '. ' + it.title + '\n'; });
        } else {
            msg += '[ 감지된 물품 ]\n';
            matchItems.slice(0, 5).forEach(function(it, i) { msg += (i + 1) + '. ' + it.title + '\n'; });
        }
        alert(msg);
    } catch(e) {
        alert('❌ ' + e.message);
    } finally {
        if (btn) { btn.textContent = '🔍 테스트'; btn.disabled = false; }
    }
}

function addWatchScanRule() {
    if (!_isBotPrivileged()) { alert('관리자 또는 부관리자만 관리할 수 있습니다.'); return; }
    var name           = (document.getElementById('wsrName').value||'').trim();
    var url            = (document.getElementById('wsrUrl').value||'').trim();
    var keyword        = (document.getElementById('wsrKw').value||'').trim();
    var excludeKeyword = (document.getElementById('wsrExclude').value||'').trim();
    var interval       = parseInt(document.getElementById('wsrInterval').value)||300;
    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요.'); return; }
    if (!keyword) { alert('감지 키워드를 입력하세요.'); return; }
    if (interval < 10) interval = 10;

    if (_wsrEditingKey) {
        _saveBotRules(_botRules.map(function(r) {
            return r.id === _wsrEditingKey
                ? Object.assign({}, r, { name:name, url:url, keyword:keyword, excludeKeyword:excludeKeyword, scanInterval:interval })
                : r;
        }));
        _cancelWsrEdit();
        var _wsrBtn = document.getElementById('wsrAddBtn');
        if (_wsrBtn) { _wsrBtn.textContent = '✅ 수정 완료!'; _wsrBtn.style.background = '#22c55e'; setTimeout(function(){ _wsrBtn.textContent = '✅ 규칙 등록'; _wsrBtn.style.background = '#22c55e'; }, 1500); }
        return;
    }
    var addedBy = (typeof _currentUser !== 'undefined' && _currentUser) ? (_currentUser.name||'') : '';
    var newRule = {
        id: 'r_' + Date.now(),
        name:name, url:url, keyword:keyword, excludeKeyword:excludeKeyword,
        scanInterval:interval, enabled:true, type:'watch',
        addedBy:addedBy, createdAt:Date.now()
    };
    _saveBotRules(_botRules.concat([newRule]));
    ['wsrName','wsrUrl','wsrKw','wsrExclude'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('wsrInterval').value='300';
    alert('✅ 비거래 감지 규칙 등록됐습니다: '+name);
}

function _cancelWsrEdit() {
    _wsrEditingKey = null;
    ['wsrName','wsrUrl','wsrKw','wsrExclude'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('wsrInterval').value='300';
    document.getElementById('wsrAddBtn').textContent='✅ 규칙 등록';
    document.getElementById('wsrAddBtn').style.background='#22c55e';
    document.getElementById('wsrFormTitle').textContent='➕ 새 비거래 규칙 추가';
    document.getElementById('wsrCancelBtn').style.display='none';
}

function _editWsrRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; }); if (!r) return;
    if (typeof switchMonBotTab === 'function') switchMonBotTab(2);
    _wsrEditingKey = id;
    document.getElementById('wsrName').value     = r.name            || '';
    document.getElementById('wsrUrl').value      = r.url             || '';
    document.getElementById('wsrKw').value       = r.keyword         || '';
    document.getElementById('wsrExclude').value  = r.excludeKeyword  || '';
    document.getElementById('wsrInterval').value = r.scanInterval    || 300;
    document.getElementById('wsrAddBtn').textContent = '✏️ 수정 완료';
    document.getElementById('wsrAddBtn').style.background = '#f59e0b';
    document.getElementById('wsrFormTitle').textContent = '✏️ 수정 중';
    document.getElementById('wsrCancelBtn').style.display = '';
    document.getElementById('wsrFormWrap').style.display = '';
    document.getElementById('wsrName').focus();
}

function _deleteWsrRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; }); if (!r) return;
    if (!confirm('"'+(r.name||id)+'" 규칙을 삭제하시겠습니까?')) return;
    _saveBotRules(_botRules.filter(function(r) { return r.id !== id; }));
}

// ===== 모니터링 현황 패널 렌더링 =====
var _monhwFraudTotal = 0;
var _monhwWatchTotal = 0;

function _monhwDoneOverlay(card) {
    if (card.querySelector('[data-done-overlay]')) return;
    card.style.position = 'relative';
    var ov = document.createElement('div');
    ov.setAttribute('data-done-overlay','1');
    ov.style.cssText = 'position:absolute;inset:0;border-radius:7px;background:rgba(15,23,42,0.72);backdrop-filter:blur(3px);z-index:3;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:default;';
    // 대각선 2줄
    var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('style','position:absolute;inset:0;width:100%;height:100%;pointer-events:none;');
    svg.setAttribute('preserveAspectRatio','none');
    var l1 = document.createElementNS('http://www.w3.org/2000/svg','line');
    l1.setAttribute('x1','0'); l1.setAttribute('y1','0'); l1.setAttribute('x2','100%'); l1.setAttribute('y2','100%');
    l1.setAttribute('stroke','rgba(255,255,255,0.18)'); l1.setAttribute('stroke-width','1.5');
    var l2 = document.createElementNS('http://www.w3.org/2000/svg','line');
    l2.setAttribute('x1','100%'); l2.setAttribute('y1','0'); l2.setAttribute('x2','0'); l2.setAttribute('y2','100%');
    l2.setAttribute('stroke','rgba(255,255,255,0.18)'); l2.setAttribute('stroke-width','1.5');
    svg.appendChild(l1); svg.appendChild(l2);
    ov.appendChild(svg);
    var label = document.createElement('span');
    label.style.cssText = 'position:relative;z-index:1;font-size:calc(var(--base-font,20px)*0.7);font-weight:900;color:rgba(255,255,255,0.55);letter-spacing:0.12em;';
    label.textContent = '처리완료';
    ov.appendChild(label);
    card.appendChild(ov);
    card.style.opacity = '0.6';
}

// 개별 항목(행) 처리완료 표시 — 내용만 흐리게 + 중앙에 또렷한 배지
function _monhwRowDoneOverlay(row, text, color) {
    if (!row || row.querySelector('[data-row-done]')) return;
    row.style.position = 'relative';
    // 기존 자식들만 흐리게 (오버레이는 선명 유지)
    Array.prototype.forEach.call(row.children, function(ch){
        if (ch.getAttribute && ch.getAttribute('data-row-done')) return;
        ch.style.filter = 'blur(1.3px)';
        ch.style.opacity = '0.35';
    });
    var c = color || '#22c55e';
    var ov = document.createElement('div');
    ov.setAttribute('data-row-done','1');
    ov.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:calc(var(--base-font,20px)*0.6);font-weight:900;color:'+c+';background:rgba(2,20,12,0.94);border:1.6px solid '+c+';border-radius:7px;padding:3px 16px;letter-spacing:0.1em;box-shadow:0 2px 10px rgba(0,0,0,0.55);white-space:nowrap;';
    lbl.textContent = text || '✅ 처리완료';
    ov.appendChild(lbl);
    row.appendChild(ov);
}

function _monhwMakeItemRow(it, type, color) {
    var row = document.createElement('div');
    row.style.cssText = 'padding:5px 0;border-bottom:1px solid '+color+'1a;display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:relative;transition:opacity 0.4s,filter 0.4s;';
    if (it.tid) row.setAttribute('data-item-tid', it.tid);
    if (it.tid) {
        var tidLink = document.createElement('a');
        tidLink.href = 'https://www.itemmania.com/sell/application.html?id='+it.tid;
        tidLink.target = '_blank';
        tidLink.style.cssText = 'font-size:calc(var(--base-font,20px)*0.7);font-weight:900;color:#38bdf8;letter-spacing:0.03em;flex-shrink:0;text-decoration:none;';
        tidLink.textContent = '#'+_fmtTid(it.tid);
        row.appendChild(tidLink);
    }
    if (type === 'watch' && it._keyword) {
        var kwChip = document.createElement('span');
        kwChip.style.cssText = 'font-size:calc(var(--base-font,20px)*0.4);font-weight:700;border-radius:3px;padding:1px 5px;white-space:nowrap;flex-shrink:0;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.35);color:#4ade80;';
        kwChip.textContent = '"' + it._keyword + '"';
        row.appendChild(kwChip);
    }
    var titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-size:calc(var(--base-font,20px)*0.55);font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:80px;';
    titleEl.textContent = it.t||'';
    row.appendChild(titleEl);
    if (it.p) {
        var priceEl = document.createElement('span');
        priceEl.style.cssText = 'color:'+color+';font-weight:900;font-size:calc(var(--base-font,20px)*0.55);flex-shrink:0;';
        priceEl.textContent = Number(it.p).toLocaleString()+'원';
        row.appendChild(priceEl);
    }
    if (type === 'fraud' || type === 'watch') {
        var bkBtn = document.createElement('button');
        bkBtn.setAttribute('data-bk', it.key||(it.t||'').substring(0,30));
        bkBtn.setAttribute('data-title', it.t||'');
        bkBtn.setAttribute('data-tid', it.tid||'');
        bkBtn.setAttribute('data-price', it.p||0);
        if (type === 'watch') bkBtn.setAttribute('data-bktype', 'watch');
        var _bkColor = type === 'watch' ? '#16a34a' : '#dc2626';
        bkBtn.style.cssText = 'font-size:calc(var(--base-font,20px)*0.45);padding:2px 7px;border-radius:4px;border:1.5px solid '+_bkColor+';color:'+_bkColor+';background:none;cursor:pointer;flex-shrink:0;font-weight:700;';
        bkBtn.textContent = '필터제외';
        row.appendChild(bkBtn);
    }
    return row;
}

function _monhwMakeCard(color, icon, title, keyword, count, timeStr, itemRows, type, groupKey) {
    var card = document.createElement('div');
    card.dataset.groupKey = groupKey || '';
    card.style.cssText = 'position:relative;border:1.5px solid '+color+'77;border-radius:8px;background:'+color+'0d;flex-shrink:0;';

    // 헤더
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid '+color+'33;';
    var titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-size:calc(var(--base-font,20px)*0.6);font-weight:900;color:'+color+';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    titleSpan.textContent = icon+' '+title+(keyword?' · "'+keyword+'"':'');
    var cntSpan = document.createElement('span');
    cntSpan.setAttribute('data-count-el', '1');
    cntSpan.style.cssText = 'font-size:calc(var(--base-font,20px)*0.5);color:#94a3b8;flex-shrink:0;';
    cntSpan.textContent = count+'개';
    var timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'font-size:calc(var(--base-font,20px)*0.45);color:#64748b;flex-shrink:0;margin:0 6px;';
    timeSpan.textContent = timeStr;
    hdr.appendChild(titleSpan); hdr.appendChild(cntSpan); hdr.appendChild(timeSpan);
    card.appendChild(hdr);

    // 아이템 목록
    var itemList = document.createElement('div');
    itemList.setAttribute('data-item-list', '1');
    itemList.style.cssText = 'padding:4px 10px 6px;';
    (itemRows||[]).forEach(function(it) {
        itemList.appendChild(_monhwMakeItemRow(it, type, color));
    });
    card.appendChild(itemList);
    return card;
}

var _monhwFraudShownTids = new Set();
var _monhwRuleLastTids = {}; // {ruleKey: Set<tid>} — 규칙별 마지막 스캔 tids

function _monhwAutoMarkGone(tid) {
    var panels = ['monhwFraudContent', 'monhwWatchContent'];
    panels.forEach(function(pid) {
        var content = document.getElementById(pid);
        if (!content) return;
        var rows = content.querySelectorAll('[data-item-tid="'+tid+'"]');
        rows.forEach(function(row) {
            if (row._autoGone) return; // 이미 처리됨
            row._autoGone = true;
            row.style.opacity = '0.35';
            row.style.filter = 'blur(1.5px)';
            var badge = document.createElement('span');
            badge.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:900;color:#22c55e;background:#052e16;border:1px solid #22c55e44;border-radius:4px;padding:1px 6px;white-space:nowrap;pointer-events:none;';
            badge.textContent = '✅ 물품 삭제됨';
            row.appendChild(badge);
            // 필터제외 버튼 비활성화
            var bkBtn = row.querySelector('[data-bk]');
            if (bkBtn) { bkBtn.disabled = true; bkBtn.style.opacity = '0.3'; }
        });
    });
}

// 3초마다 사기글 패널 아이템 실존 여부 체크 → 사라진 항목 즉시 블러
(function() {
    var _fCheckQueue = [];
    var _fChecking = false;
    function _fCheckNext() {
        if (_fChecking) return;
        var content = document.getElementById('monhwFraudContent');
        if (!content) return;
        var rows = content.querySelectorAll('[data-item-tid]');
        var activeTids = [];
        rows.forEach(function(row) {
            if (!row._autoGone && !row._filterDone) {
                var tid = row.getAttribute('data-item-tid');
                if (tid) activeTids.push(tid);
            }
        });
        if (!activeTids.length) return;
        if (!_fCheckQueue.length) _fCheckQueue = activeTids.slice();
        var tid = _fCheckQueue.shift();
        if (!tid) return;
        _fChecking = true;
        fetch('http://1.221.202.77:20002/check_item.php?tid=' + encodeURIComponent(tid), { cache: 'no-store' })
            .then(function(r){ return r.json(); })
            .then(function(data) {
                if (data.exists === false) {
                    _monhwAutoMarkGone(tid);
                    // 모든 사기글 항목이 블러됐으면 알림/깜빡임 중지
                    var content = document.getElementById('monhwFraudContent');
                    if (content) {
                        var allRows = content.querySelectorAll('[data-item-tid]');
                        var allGone = true;
                        allRows.forEach(function(r) { if (!r._autoGone && !r._filterDone) allGone = false; });
                        if (allGone && allRows.length > 0) {
                            if (typeof _stopTabBlink === 'function') _stopTabBlink('fraud');
                            if (typeof _removeChatBorderFlash === 'function') _removeChatBorderFlash();
                            var tab = document.getElementById('fraudHeaderTab');
                            if (tab) { tab.classList.remove('hdr-tab-blink'); tab.style.display = 'none'; }
                        }
                    }
                }
                _fChecking = false;
            })
            .catch(function(){ _fChecking = false; });
    }
    setInterval(_fCheckNext, 3000);
})();

// 사기글: '물품 삭제됨'(블러)·필터제외 처리된 항목은 일정 시간(60초) 후 패널에서 자동 제거
// → 살아있는 사기글만 남고, 처리된 카드는 쌓이지 않음 (비거래 자동 제거와 동일 방식)
var _FRAUD_GONE_TTL = 60000;
setInterval(function() {
    var content = document.getElementById('monhwFraudContent');
    if (!content) return;
    var now = Date.now();
    var removed = false;
    content.querySelectorAll('[data-item-tid]').forEach(function(row) {
        if (!(row._autoGone || row._filterDone)) { row._doneAt = 0; return; } // 살아있는 사기글 → 유지
        if (!row._doneAt) { row._doneAt = now; return; }                       // 막 처리됨 → 시작시각 기록
        if (now - row._doneAt >= _FRAUD_GONE_TTL) {
            var tid = row.getAttribute('data-item-tid');
            if (tid) _monhwFraudShownTids.delete(tid); // 재감지 시 다시 표시 가능하게
            if (row.parentNode) row.parentNode.removeChild(row);
            removed = true;
        }
    });
    if (!removed) return;
    // 카드별 개수 갱신 + 항목 없는 카드 제거
    Array.prototype.slice.call(content.children).forEach(function(card) {
        if (!card.querySelector || card.id === 'monhwFraudEmpty') return;
        if (!card.querySelector('[data-item-list]')) return;
        var rows = card.querySelectorAll('[data-item-tid]');
        if (!rows.length) { if (card.parentNode) card.parentNode.removeChild(card); return; }
        var cntEl = card.querySelector('[data-count-el]');
        if (cntEl) cntEl.textContent = rows.length + '개';
    });
    // 전체 카운트 갱신
    _monhwFraudTotal = content.querySelectorAll('[data-item-tid]').length;
    var cntBadge = document.getElementById('monhwFraudCount');
    if (cntBadge) cntBadge.textContent = _monhwFraudTotal + '건';
    // 모두 비면 placeholder 복원
    if (!_monhwFraudTotal) {
        if (cntBadge) cntBadge.style.display = 'none';
        if (!document.getElementById('monhwFraudEmpty')) {
            content.innerHTML = '<div id="monhwFraudEmpty" style="text-align:center;padding:60px 0;font-size:13px;opacity:0.3;">감지된 사기글이 없습니다.<br><span style="font-size:11px;">봇이 사기글을 감지하면 여기에 표시됩니다.</span></div>';
        }
    }
}, 10000);

function _monhwAddFraudCard(s) {
    var content = document.getElementById('monhwFraudContent');
    if (!content) return;
    var empty = document.getElementById('monhwFraudEmpty');
    if (empty) empty.style.display = 'none';
    var now = new Date();
    var timeStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    var groupKey = s.ruleKeyword || s.ruleName || '감지';

    // 동일 거래번호(tid) 중복 제거
    var newRows = (s.itemRows||[]).filter(function(it) {
        var tid = String(it.tid || '').trim();
        if (!tid) return true; // tid 없는 항목은 통과
        if (_monhwFraudShownTids.has(tid)) return false;
        _monhwFraudShownTids.add(tid);
        return true;
    });
    if (!newRows.length) return;
    var itemCount = newRows.length;

    var card = _monhwMakeCard('#ef4444','🚨',s.ruleName||'감지',s.ruleKeyword||'',itemCount,timeStr,newRows,'fraud',groupKey);
    content.insertBefore(card, content.firstChild);

    _monhwFraudTotal += itemCount;
    var cnt = document.getElementById('monhwFraudCount');
    if (cnt) { cnt.style.display = ''; cnt.textContent = _monhwFraudTotal+'건'; }
    // 필터제외 이벤트 위임 (최초 1회)
    if (!content._bkDelegated) {
        content._bkDelegated = true;
        content.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-bk]');
            if (!btn) return;
            if (typeof addBlockedFraud === 'function') addBlockedFraud(btn.dataset.bk, btn.dataset.title, btn.dataset.tid, btn.dataset.price);
        });
    }
}

var _monhwWatchShownTids = new Set();

// 비거래 AI 피드백 저장 — game_knowledge DB에 학습 패턴 기록
function _saveWatchFeedback(title, feedbackType) {
    if (!title || !feedbackType) return;
    var mdb = window._mysqlDb;
    if (!mdb) return;
    var term = String(title).trim().substring(0, 50);
    if (!term) return;
    var meaning = feedbackType === '비거래확정'
        ? '비거래 확정 패턴 (모니터링 처리 완료됨)'
        : '정상 거래 물품 패턴 (비거래 아님, 필터 제외됨)';
    var now = Date.now();
    mdb.ref('game_knowledge').child(String(now)).set({
        term: term, meaning: meaning, type: feedbackType,
        game: '아이템매니아', savedAt: now, source: 'auto-feedback'
    });
}

// 비거래 AI 판별 — Claude Haiku로 각 항목이 확실한 비거래인지 확인 필요인지 분류
async function _aiClassifyWatchItems(rows, context) {
    if (!rows || !rows.length) return;
    var watchContent = document.getElementById('monhwWatchContent');
    if (!watchContent) return;

    // 학습 패턴 로드 (game_knowledge에서 auto-feedback 타입)
    var ntPatterns = [], normalPatterns = [];
    try {
        var mdb = window._mysqlDb;
        if (mdb) {
            var snap = await mdb.ref('game_knowledge').once('value');
            var gkData = snap.val() || {};
            Object.values(gkData).forEach(function(item) {
                if (!item || !item.term || item.source !== 'auto-feedback') return;
                if (item.type === '비거래확정') ntPatterns.push(item.term);
                else if (item.type === '정상물품') normalPatterns.push(item.term);
            });
        }
    } catch(e) {}

    var titles = rows.map(function(it, i) {
        return i + '. ' + (it.t || '(제목없음)');
    });

    var learnedCtx = '';
    if (ntPatterns.length)     learnedCtx += '\n[비거래 확정 패턴 — 이전 처리 기록]\n' + ntPatterns.map(function(t){ return '- '+t; }).join('\n');
    if (normalPatterns.length) learnedCtx += '\n[정상 물품 패턴 — 비거래 아님으로 확인됨]\n' + normalPatterns.map(function(t){ return '- '+t; }).join('\n');

    var prompt = '[감지 규칙: ' + context + ']'
        + (learnedCtx ? '\n' + learnedCtx : '') + '\n\n'
        + '아이템매니아 판매글 목록입니다. 각 항목이 게임 내 비거래(귀속·거래불가·손사냥·대리 등 서비스)인지, 확인이 필요한 경우인지 분류하세요.\n'
        + (learnedCtx ? '위의 학습된 패턴을 참고하여 유사한 항목은 동일하게 분류하세요.\n' : '')
        + 'JSON 배열만 응답: [{"i":0,"v":"비거래"},{"i":1,"v":"확인필요"},...]\n\n'
        + titles.join('\n');

    try {
        var res = await fetch('./claude-proxy.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 500,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        var d = await res.json();
        var txt = (d.content && d.content[0] && d.content[0].text) || '';
        var m = txt.match(/\[[\s\S]*?\]/);
        if (!m) return;
        var results = JSON.parse(m[0]);

        results.forEach(function(r) {
            var it = rows[r.i];
            if (!it) return;
            var tid = String(it.tid || '').trim();
            if (!tid) return;
            var domRow = watchContent.querySelector('[data-item-tid="' + tid + '"]');
            if (!domRow || domRow.querySelector('[data-ai-badge]')) return;

            var isNt = r.v === '비거래';
            // AI 분류 캐시 저장 (리빌드 시 배지 복원용)
            if (window._wAiType) window._wAiType[tid] = isNt ? 'nt' : 'check';
            var badge = document.createElement('span');
            badge.setAttribute('data-ai-badge', isNt ? '비거래' : '확인필요');
            badge.style.cssText = 'font-size:calc(var(--base-font,20px)*0.4);font-weight:900;border-radius:4px;padding:1px 5px;white-space:nowrap;flex-shrink:0;'
                + (isNt
                    ? 'color:#ef4444;background:rgba(239,68,68,0.15);border:1.5px solid rgba(239,68,68,0.5);'
                    : 'color:#f59e0b;background:rgba(245,158,11,0.15);border:1.5px solid rgba(245,158,11,0.5);');
            badge.textContent = isNt ? '🚫 비거래' : '⚠️ 물품확인필요';

            var tidLink = domRow.querySelector('a');
            if (tidLink) domRow.insertBefore(badge, tidLink.nextSibling);
            else domRow.insertBefore(badge, domRow.firstChild);
        });
    } catch(e) {}
}

function _monhwAddWatchCard(data) {
    var content = document.getElementById('monhwWatchContent');
    if (!content) return;
    var empty = document.getElementById('monhwWatchEmpty');
    if (empty) empty.style.display = 'none';
    var now = new Date();
    var timeStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    var groupKey = data.label || data.keyword || '비거래 감지';

    // 제목에서 실제 매칭된 키워드 역추적
    var _allKws = (data.keyword || '').split(',').map(function(k){ return k.trim(); }).filter(Boolean);
    (data.itemRows||[]).forEach(function(it) {
        var title = (it.t || '').toLowerCase();
        var matched = _allKws.find(function(kw){ return kw && title.indexOf(kw.toLowerCase()) !== -1; });
        it._keyword = matched || '';
    });

    // 동일 거래번호(tid) 중복 제거
    var newRows = (data.itemRows||[]).filter(function(it) {
        var tid = String(it.tid || '').trim();
        if (!tid) return true;
        if (_monhwWatchShownTids.has(tid)) return false;
        _monhwWatchShownTids.add(tid);
        return true;
    });
    if (!newRows.length) return;
    var itemCount = newRows.length;

    var card = _monhwMakeCard('#22c55e','📦',data.label||data.keyword||'비거래 감지','',itemCount,timeStr,newRows,'watch',groupKey);
    content.insertBefore(card, content.firstChild);

    _monhwWatchTotal += itemCount;
    var cnt = document.getElementById('monhwWatchCount');
    if (cnt) { cnt.style.display = ''; cnt.textContent = _monhwWatchTotal+'건'; }

    // AI 비거래 분류 — 새 항목에만 적용
    _aiClassifyWatchItems(newRows, data.label || data.keyword || '비거래');
}

function _monhwClearFraud() {
    var content = document.getElementById('monhwFraudContent');
    if (!content) return;
    content.innerHTML = '<div id="monhwFraudEmpty" style="text-align:center;padding:60px 0;font-size:13px;opacity:0.3;">감지된 사기글이 없습니다.<br><span style="font-size:11px;">봇이 사기글을 감지하면 여기에 표시됩니다.</span></div>';
    content._bkDelegated = false;
    _monhwFraudTotal = 0;
    _monhwFraudShownTids = new Set();
    _monhwRuleLastTids = {};
    var cnt = document.getElementById('monhwFraudCount');
    if (cnt) { cnt.style.display = 'none'; cnt.textContent = '0건'; }
}

function _monhwClearWatch() {
    var content = document.getElementById('monhwWatchContent');
    if (!content) return;
    content.innerHTML = '<div id="monhwWatchEmpty" style="text-align:center;padding:60px 0;font-size:13px;opacity:0.3;">감지된 비거래가 없습니다.<br><span style="font-size:11px;">봇이 비거래를 감지하면 여기에 표시됩니다.</span></div>';
    _monhwWatchTotal = 0;
    _monhwWatchShownTids = new Set();
    if (typeof window._wWatchClearHook === 'function') window._wWatchClearHook();
    var cnt = document.getElementById('monhwWatchCount');
    if (cnt) { cnt.style.display = 'none'; cnt.textContent = '0건'; }
}