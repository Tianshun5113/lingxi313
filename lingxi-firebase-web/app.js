import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase, ref, get, set, update, remove, runTransaction, onValue, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { ROUND_MS, MAX_WORD_CHARS, cleanWord, validWord, remainingMs, roundKey, everyoneSubmitted, evaluateRound } from './logic.mjs';

const app = document.getElementById('app');
const toastNode = document.getElementById('toast');
const STORAGE_NAME = 'lingxi-firebase-nickname';
const STORAGE_ROOM = 'lingxi-firebase-last-room';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let db, auth, uid = null;
let isConnected = false, serverOffset = 0;
let screen = 'create', capacityChoice = 2, pending = false;
let activeRoom = '', meta = null, players = {}, submitted = {}, answers = null, myAnswer = null;
let draft = '', subscribedKey = '', subscribedPhase = '';
let globalUnsubs = [], roomUnsubs = [], roundUnsubs = [];
let authReady = false;
let cachedHistory = {}, alertTimer = null, lastRevealAttempt = 0;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const roomParam = () => String(new URL(location.href).searchParams.get('room') || '').trim().toUpperCase();
const roomRef = suffix => ref(db, `rooms/${activeRoom}${suffix ? '/' + suffix : ''}`);
const estimatedNow = () => Date.now() + serverOffset;
const myName = () => (localStorage.getItem(STORAGE_NAME) || '').trim();
const currentKey = () => meta?.currentKey || '';

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('show');
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => toastNode.classList.remove('show'), 3500);
}
function errorText(error) {
  console.error(error);
  const msg = String(error?.code || error?.message || error);
  if (msg.includes('permission_denied') || msg.includes('PERMISSION_DENIED')) return '操作被数据库规则拒绝。请检查 Firebase 的 database.rules.json 是否已经发布，或房间状态已变化。';
  if (msg.includes('auth/operation-not-allowed')) return '请在 Firebase Authentication 中启用「匿名」登录。';
  if (msg.includes('auth/unauthorized-domain')) return '请把网站域名加入 Firebase Authentication 的已获授权网域。';
  if (msg.includes('network') || msg.includes('unavailable')) return '网络暂不可用，请确认能连接 Firebase。';
  return `操作失败：${msg.slice(0, 160)}`;
}
function changeRoomParam(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}
function inviteURL() {
  const url = new URL(location.href);
  url.searchParams.set('room', activeRoom);
  return url.toString();
}
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}
function stop(unsubs) {
  while (unsubs.length) {
    try { unsubs.pop()(); } catch (err) { console.warn(err); }
  }
}
function detachRoom({clearLink = true} = {}) {
  stop(roundUnsubs);
  stop(roomUnsubs);
  activeRoom = ''; meta = null; players = {}; submitted = {}; answers = null; myAnswer = null;
  cachedHistory = {}; draft = ''; subscribedKey = ''; subscribedPhase = '';
  if (clearLink) {
    changeRoomParam('');
    localStorage.removeItem(STORAGE_ROOM);
  }
}
function showFailure(title, body) {
  app.innerHTML = `<section class="panel error-panel"><div class="stage-ornament">✳</div>
    <h1>${esc(title)}</h1><p>${esc(body)}</p><p>请参考压缩包里的 <code>README.md</code> 检查配置。</p>
    <button class="secondary" id="backHome">返回首页</button></section>`;
  document.getElementById('backHome').onclick = () => {detachRoom(); screen='create'; showHome();};
}
function showSetup() {
  app.innerHTML = `<section class="panel error-panel">
    <p class="eyebrow">ONE-TIME SETUP</p><h1>只需配置一次 Firebase</h1>
    <p>此版本已经不需要 Node.js。不过要真实远程联机，需要将你自己 Firebase 项目的配置填入 <code>firebase-config.js</code>。</p>
    <ol><li>访问 <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase 控制台</a>，创建项目并添加 Web 应用。</li>
      <li>启用 Authentication → 登录方式 → 匿名；创建 Realtime Database。</li>
      <li>将 <code>database.rules.json</code> 的内容复制到数据库的「规则」并发布。</li>
      <li>填入网页配置（含 databaseURL），把本站文件上传到 GitHub Pages。</li></ol>
    <p>完整版步骤见 ZIP 内的 README.md。配置完成后刷新页面即可。</p></section>`;
}
function showHome() {
  if (!uid) {
    app.innerHTML = '<div class="startup-loading">正在匿名登录 Firebase……</div>';
    return;
  }
  const join = screen === 'join';
  app.innerHTML = `<section class="hero">
    <p class="eyebrow">THE WORD SYNC GAME</p>
    <h1>想到一起，<br><span class="gradient-text">才算默契。</span></h1>
    <p class="hero-subtitle">每轮 20 秒。每个人独立写下一个词，<br>直到所有人的答案完全相同。</p></section>
    <section class="panel"><div class="switcher" role="tablist">
      <button id="tabCreate" type="button" role="tab" aria-selected="${!join}" class="${!join ? 'active' : ''}">创建房间</button>
      <button id="tabJoin" type="button" role="tab" aria-selected="${join}" class="${join ? 'active' : ''}">加入房间</button></div>
      <form id="entryForm">
        <div class="field"><label class="field-label" for="nameInput">你的昵称</label>
          <input id="nameInput" class="text-input" maxlength="32" autocomplete="nickname" placeholder="输入一个昵称" value="${esc(myName())}" required></div>
        ${join ? `<div class="field"><label class="field-label" for="codeInput">6 位房间码</label>
          <input id="codeInput" class="text-input" maxlength="6" autocapitalize="characters" placeholder="例如：AB3DE5" value="${esc(roomParam())}" required></div>` :
        `<div class="field"><span class="field-label">选择人数</span><div class="mode-options">
          <button type="button" class="mode-option ${capacityChoice === 2 ? 'active' : ''}" data-capacity="2" aria-pressed="${capacityChoice === 2}"><span class="mode-num">2</span><span class="mode-word">人默契</span></button>
          <button type="button" class="mode-option ${capacityChoice === 3 ? 'active' : ''}" data-capacity="3" aria-pressed="${capacityChoice === 3}"><span class="mode-num">3</span><span class="mode-word">人默契</span></button>
        </div></div>`}
        <button type="submit" class="primary full" ${pending ? 'disabled' : ''}>${pending ? '正在连接…' : join ? '加入游戏 →' : '创建房间 →'}</button>
      </form>
      <p class="tip">免注册 · 无需下载安装 · 手机/电脑跨地区联机 · 同一房间同步计时</p>
    </section><div class="rule-strip"><b>01 / 邀请朋友</b><span class="arrow">→</span><b>02 / 20 秒写词</b><span class="arrow">→</span><b>03 / 同时揭晓</b><span class="arrow">→</span><b>04 / 直到默契成功</b></div>`;
  const rememberName = () => localStorage.setItem(STORAGE_NAME, document.getElementById('nameInput')?.value || '');
  document.getElementById('tabCreate').onclick = () => {rememberName(); screen='create'; changeRoomParam(''); showHome();};
  document.getElementById('tabJoin').onclick = () => {rememberName(); screen='join'; showHome();};
  document.querySelectorAll('[data-capacity]').forEach(btn => btn.onclick = () => {
    rememberName(); capacityChoice = Number(btn.dataset.capacity); showHome();
  });
  document.getElementById('entryForm').onsubmit = async event => {
    event.preventDefault();
    if (pending) return;
    const name = document.getElementById('nameInput').value.trim();
    if (Array.from(name).length < 1 || Array.from(name).length > 16) return toast('昵称应为 1～16 个字符');
    const code = join ? document.getElementById('codeInput').value.trim().toUpperCase() : '';
    if (join && !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return toast('请输入正确的六位房间码');
    localStorage.setItem(STORAGE_NAME, name);
    pending = true; showHome();
    try {
      if (join) await joinRoom(code, name);
      else await createRoom(name, capacityChoice);
    } catch (err) { toast(errorText(err)); }
    finally { pending = false; if (!activeRoom) showHome(); }
  };
}

async function createRoom(name, capacity) {
  let created = null;
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    const metaData = {host: uid, capacity, phase: 'lobby', game: 1, round: 0,
      currentKey: 'none', startedAt: 0, createdAt: Date.now()};
    const result = await runTransaction(ref(db, `rooms/${code}/meta`),
      old => old ? undefined : metaData, {applyLocally: false});
    if (!result.committed) continue;
    created = code;
    break;
  }
  if (!created) throw new Error('房间码创建失败，请重试');
  await set(ref(db, `rooms/${created}/players/${uid}`), {name, joinedAt: serverTimestamp()});
  attachRoom(created);
  toast('房间创建成功！快把链接发给朋友吧 ✦');
}
async function joinRoom(code, name) {
  const base = `rooms/${code}`;
  const metaSnap = await get(ref(db, `${base}/meta`));
  const m = metaSnap.val();
  if (!m) throw new Error('找不到这个房间，请确认房间码');
  const ownSnap = await get(ref(db, `${base}/players/${uid}`));
  if (!ownSnap.exists()) {
    if (m.phase !== 'lobby') throw new Error('游戏已经开始，新玩家暂时不能加入');
    await set(ref(db, `${base}/players/${uid}`), {name, joinedAt: serverTimestamp()});
  }
  attachRoom(code);
  toast('已经进入房间，等大家一起开始 ✦');
}
function attachRoom(code) {
  detachRoom({clearLink: false});
  activeRoom = code;
  localStorage.setItem(STORAGE_ROOM, code);
  changeRoomParam(code);
  roomUnsubs.push(onValue(roomRef('meta'), snap => {
    if (!activeRoom || activeRoom !== code) return;
    const latest = snap.val();
    if (!latest) {
      detachRoom(); screen='create'; showHome(); toast('房间已被解散或不存在'); return;
    }
    meta = latest;
    bindCurrentRound();
    renderRoom();
    fetchHistory();
  }, err => {showFailure('无法读取房间状态', errorText(err));}));
  roomUnsubs.push(onValue(roomRef('players'), snap => {
    if (activeRoom !== code) return;
    players = snap.val() || {};
    renderRoom();
    maybeReveal();
  }, err => {toast(errorText(err));}));
}
function bindCurrentRound() {
  if (!meta || !activeRoom) return;
  const key = currentKey();
  const viewPhase = meta.phase === 'reveal' ? 'reveal' : meta.phase === 'typing' ? 'typing' : 'lobby';
  if (key === subscribedKey && viewPhase === subscribedPhase) return;
  stop(roundUnsubs);
  subscribedKey = key;
  subscribedPhase = viewPhase;
  submitted = {};
  answers = null;
  myAnswer = null;
  draft = '';
  lastRevealAttempt = 0;
  if (viewPhase === 'lobby' || key === 'none') return;
  const path = `rounds/${key}`;
  if (viewPhase === 'typing') {
    roundUnsubs.push(onValue(roomRef(`${path}/submitted`), snap => {
      if (!meta || currentKey() !== key || meta.phase !== 'typing') return;
      submitted = snap.val() || {};
      renderRoom(); maybeReveal();
    }, err => toast(errorText(err))));
    roundUnsubs.push(onValue(roomRef(`${path}/answers/${uid}`), snap => {
      if (!meta || currentKey() !== key || meta.phase !== 'typing') return;
      myAnswer = snap.val(); renderRoom();
    }, err => toast(errorText(err))));
  } else {
    roundUnsubs.push(onValue(roomRef(`${path}/answers`), snap => {
      if (!meta || currentKey() !== key || meta.phase !== 'reveal') return;
      answers = snap.val() || {};
      cachedHistory[`${activeRoom}:${key}`] = {...answers};
      renderRoom();
    }, err => toast(errorText(err))));
  }
}
async function fetchHistory() {
  if (!meta || meta.round < 2) return;
  const code = activeRoom, game = meta.game, lastRound = meta.round;
  const start = Math.max(1, lastRound - 8);
  const ids = Array.from({length: lastRound - start}, (_, i) => roundKey(game, i + start));
  for (const key of ids) {
    if (!activeRoom || code !== activeRoom || meta?.game !== game) return;
    const cacheKey = `${code}:${key}`;
    if (cacheKey in cachedHistory) continue;
    try {
      const snap = await get(ref(db, `rooms/${code}/rounds/${key}/answers`));
      if (activeRoom !== code) return;
      cachedHistory[cacheKey] = snap.val() || {};
      renderRoom();
    } catch (err) { console.warn('历史记录暂不可读取', err); }
  }
}
async function maybeReveal() {
  if (!activeRoom || meta?.phase !== 'typing') return;
  const full = everyoneSubmitted(players, submitted, meta.capacity);
  const timeout = remainingMs(meta.startedAt, estimatedNow()) <= 0;
  if (!full && !timeout) return;
  if (Date.now() - lastRevealAttempt < 1100) return;
  lastRevealAttempt = Date.now();
  try {
    await runTransaction(roomRef('meta'), current => {
      if (!current || current.phase !== 'typing') return;
      if (current.currentKey !== currentKey()) return;
      return {...current, phase: 'reveal'};
    }, {applyLocally: false});
  } catch (err) {
    // 服务器规则在最终的 20 秒届满前可能拒绝；下一个计时 tick 会重试。
    if (!String(err.message).includes('PERMISSION_DENIED')) console.warn('揭晓等待同步', err);
  }
}
async function startRound(next = false, restart = false) {
  if (pending || !meta || meta.host !== uid) return;
  if (Object.keys(players).length !== meta.capacity) return toast('请等所有人加入');
  if (next && meta.phase !== 'reveal') return;
  if (!next && meta.phase !== 'lobby') return;
  const game = restart ? meta.game + 1 : meta.game;
  const round = restart ? 1 : next ? meta.round + 1 : 1;
  pending = true;
  try {
    await update(roomRef('meta'), {phase: 'typing', game, round,
      currentKey: roundKey(game, round), startedAt: serverTimestamp()});
  } catch (err) {toast(errorText(err));}
  finally {pending = false;}
}
async function submitWord(event) {
  event.preventDefault();
  if (pending || !meta || meta.phase !== 'typing' || myAnswer !== null || submitted[uid]) return;
  if (!isConnected) return toast('网络断开，请恢复连接后再提交');
  const text = cleanWord(document.getElementById('wordInput')?.value ?? draft);
  if (!validWord(text)) return toast(`请输入 1～${MAX_WORD_CHARS} 个字符的词语`);
  if (remainingMs(meta.startedAt, estimatedNow()) <= 0) return toast('本轮已到时间');
  const key = currentKey();
  pending = true;
  const btn = document.querySelector('#wordForm button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    await update(roomRef(), {
      [`rounds/${key}/answers/${uid}`]: text,
      [`rounds/${key}/submitted/${uid}`]: true
    });
    toast('答案已锁定，等待其他玩家');
  } catch (err) {toast(errorText(err));}
  finally {pending = false;}
}
function cardsMarkup() {
  const list = Object.entries(players).map(([id, p], index) => {
    const label = meta?.phase === 'typing' ? (submitted[id] ? '已提交 ✓' : '正在思考') : '已加入';
    return `<div class="person"><div class="avatar">${esc(Array.from(p.name || '?')[0])}</div>
      <div class="person-info"><div class="person-name">${esc(p.name)}${id === uid ? ' · 你' : ''}</div>
      <div class="person-sub">${id === meta.host ? '房主 · ' : ''}${label}</div></div></div>`;
  });
  for (let i = list.length; i < (meta?.capacity || 2); i++) list.push('<div class="waiting-slot">＋ 等待加入</div>');
  return list.join('');
}
function resultMarkup(outcome) {
  return `<div class="reveal-grid">${outcome.rows.map(row => `<div class="answer-box ${outcome.matched ? 'highlight' : ''} ${row.timedOut ? 'timeout' : ''}">
    <span class="label">${esc(row.name)}</span><span class="word">${row.timedOut ? '超时未提交' : esc(row.word)}</span></div>`).join('')}</div>`;
}
function timerMarkup() {
  return `<div class="round-timer" aria-label="本轮限时20秒">
    <div class="timer-line"><span>本轮倒计时 · 20 秒</span><strong id="countdown">20<span class="timer-unit">s</span></strong></div>
    <div class="timer-track"><div id="timerBar" class="timer-progress" style="width:100%"></div></div></div>`;
}
function historyMarkup() {
  if (!meta || meta.round < 2) return '';
  const items = [];
  for (let i = meta.round - 1; i >= Math.max(1, meta.round - 8); i--) {
    const id = roundKey(meta.game, i);
    const previous = cachedHistory[`${activeRoom}:${id}`];
    if (!previous) continue;
    const outcome = evaluateRound(players, previous, meta.capacity);
    items.push(`<div class="history-row"><span class="history-round">第 ${i} 轮 ${outcome.matched ? '✦' : '↗'}</span>
      <div class="history-words">${outcome.rows.map(row => `<span class="${outcome.matched ? 'same' : ''}" title="${esc(row.name)}">${esc(row.word ?? '超时')}</span>`).join('')}</div></div>`);
  }
  return items.length ? `<section class="history-section"><div class="history-header"><span>默契轨迹</span><span class="history-count">前 ${items.length} 轮</span></div>
    <div class="history-list">${items.join('')}</div></section>` : '';
}
function stageMarkup() {
  const host = uid === meta.host;
  const full = Object.keys(players).length === meta.capacity;
  if (meta.phase === 'lobby') {
    return `<div class="stage-ornament">✦</div><h2 class="stage-title">好词，等一个同频的人。</h2>
      <p class="stage-desc">${full ? '所有玩家都已加入。准备开始默契挑战吧！' : `还差 ${meta.capacity - Object.keys(players).length} 位朋友，复制邀请链接发给 TA。`}</p>
      <div class="stage-action">${host ? `<button class="primary center-button" id="startBtn" ${!full || pending ? 'disabled' : ''}>开始游戏 →</button>` :
        '<div class="submitted-bubble">等待房主开始<span class="loading-dots"></span></div>'}</div>
      <p class="tiny-note">一人创建房间，其他人打开邀请链接加入；每轮统一限时 20 秒。</p>`;
  }
  if (meta.phase === 'typing') {
    const count = Object.values(submitted).filter(v => v === true).length;
    const already = myAnswer !== null || submitted[uid] === true;
    if (already) return `${timerMarkup()}<div class="stage-ornament">☾</div><h2 class="stage-title">答案已提交</h2>
      <p class="stage-desc">你的答案已经锁定，其他人的词会在所有人提交或倒计时结束时公开。</p>
      <div class="submitted-bubble">${myAnswer !== null ? esc(myAnswer) : '已提交 ✓'}</div>
      <p class="tiny-note">已提交 ${count} / ${meta.capacity} 人，等待揭晓<span class="loading-dots"></span></p>`;
    return `${timerMarkup()}<div class="stage-ornament">✳</div><h2 class="stage-title">此刻，你想到了什么？</h2>
      <p class="stage-desc">不要商量，凭直觉写下一个词。<br>这一轮，会不会正好想到一起？</p>
      <form id="wordForm" class="stage-action"><div class="input-combo">
        <input class="text-input" id="wordInput" maxlength="48" type="text" autocomplete="off" placeholder="写下你的词语…" aria-label="本轮词语" value="${esc(draft)}" required>
        <button type="submit" class="primary" ${pending ? 'disabled' : ''}>确认提交 ↗</button></div>
        <div class="word-count"><span id="wordCounter">${Array.from(draft).length}</span> / ${MAX_WORD_CHARS} 字</div></form>
      <p class="tiny-note">已提交 ${count} / ${meta.capacity} 人 · 每人仅能提交一次 · 提交前不显示他人答案</p>`;
  }
  if (answers === null) return `<div class="stage-ornament">✦</div><h2 class="stage-title">正在同步答案<span class="loading-dots"></span></h2>`;
  const outcome = evaluateRound(players, answers, meta.capacity);
  if (outcome.matched) return `<div class="win-ornament">🎉</div><div class="score-tag">✦ 同频成功 ✦</div>
    <h2 class="stage-title">你们想到一起了！</h2><div class="win-word">${esc(outcome.word)}</div>
    <p class="stage-desc">经过 ${meta.round} 轮，你们 ${meta.capacity} 个人写下了完全相同的词。</p>
    ${resultMarkup(outcome)}<div class="stage-action">${host ? '<button class="primary center-button" id="restartBtn">再来一局 ↗</button>' : '<div class="submitted-bubble">等待房主再开一局</div>'}</div>`;
  return `<div class="stage-ornament">↗</div><h2 class="stage-title">${outcome.timedOut ? '时间到！这一轮结束。' : '差一点，就想到一起了。'}</h2>
    <p class="stage-desc">${outcome.timedOut ? '有人没有在 20 秒内提交，所以这一轮不算成功。' : '参考上一轮大家的答案，下一轮再试一次。'}<br>默契不是一开始就有的。</p>
    ${resultMarkup(outcome)}<div class="stage-action">${host ? '<button class="primary center-button" id="nextBtn">进入下一轮 →</button>' : '<div class="submitted-bubble">等待房主开启下一轮</div>'}</div>`;
}
function renderRoom() {
  if (!activeRoom || !meta) return;
  const focus = document.activeElement?.id === 'wordInput';
  const selection = focus ? document.activeElement.selectionStart : 0;
  const host = meta.host === uid;
  app.innerHTML = `<section class="room-layout">
    <div class="room-head"><div><div class="room-caption">${meta.capacity} 人默契挑战 / FIREBASE ONLINE</div>
      <h1 class="room-title">你们的默契空间 <span class="gradient-text">✳</span></h1></div>
      <div class="room-actions"><span class="code-pill" title="房间码">${esc(activeRoom)}</span>
        <button id="shareBtn" class="secondary">复制邀请链接</button></div></div>
    <div class="room-panel"><div class="room-topline"><span class="section-kicker">PLAYERS · ${Object.keys(players).length}/${meta.capacity}</span>
      <span class="round-num">${meta.round ? `ROUND ${String(meta.round).padStart(2, '0')}` : '等待开始'}</span></div>
      <div class="players">${cardsMarkup()}</div><section class="game-stage">${stageMarkup()}</section>
      ${historyMarkup()}</div>
    <div class="room-bottom"><div class="room-hint"><span class="connection ${isConnected ? 'ok' : 'bad'}"><span class="dot"></span>
      ${isConnected ? 'Firebase 已连接' : '正在重连'}</span><div>判断时仅忽略首尾空格；大小写、繁简体不同均算不同词。</div></div>
      <div class="room-controls">${host ? '<button class="danger-ghost" id="disbandBtn">解散房间</button>' : ''}
        <button class="danger-ghost" id="leaveBtn">暂时退出</button></div></div>
    </section>`;
  const input = document.getElementById('wordInput');
  if (input && focus) {input.focus(); try {input.setSelectionRange(selection, selection);} catch {}}
  if (input) input.oninput = () => {
    draft = input.value;
    const counter = document.getElementById('wordCounter');
    if (counter) counter.textContent = String(Array.from(draft).length);
  };
  const form = document.getElementById('wordForm');
  if (form) form.onsubmit = submitWord;
  const start = document.getElementById('startBtn');
  if (start) start.onclick = () => startRound();
  const next = document.getElementById('nextBtn');
  if (next) next.onclick = () => startRound(true);
  const restart = document.getElementById('restartBtn');
  if (restart) restart.onclick = () => startRound(true, true);
  document.getElementById('shareBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(inviteURL()); toast('邀请链接已复制，发给朋友即可加入！'); }
    catch {window.prompt('请复制这个邀请链接：', inviteURL());}
  };
  document.getElementById('leaveBtn').onclick = async () => {
    if (!confirm('暂时退出房间吗？在当前浏览器重新打开邀请链接，可以恢复自己的位置。')) return;
    // 游戏已开始时保留席位；大厅阶段退出则让出席位（房主仍保留席位以便恢复）。
    if (meta.phase === 'lobby' && !host) {
      try {await remove(roomRef(`players/${uid}`));} catch (err) {toast(errorText(err)); return;}
    }
    detachRoom(); screen='create'; showHome();
  };
  const disband = document.getElementById('disbandBtn');
  if (disband) disband.onclick = async () => {
    if (!confirm('解散房间将删除全部玩家、答案和历史记录，确定吗？')) return;
    try {await remove(roomRef()); detachRoom(); screen='create'; showHome(); toast('房间已解散');}
    catch (err) {toast(errorText(err));}
  };
  updateCountdown();
}
function updateCountdown() {
  if (!meta || meta.phase !== 'typing') return;
  const left = remainingMs(meta.startedAt, estimatedNow());
  const seconds = Math.ceil(left / 1000);
  const number = document.getElementById('countdown');
  const bar = document.getElementById('timerBar');
  if (number) {
    number.innerHTML = `${seconds}<span class="timer-unit">s</span>`;
    number.classList.toggle('timer-urgent', seconds <= 5);
  }
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, left / ROUND_MS * 100))}%`;
    bar.classList.toggle('timer-bar-urgent', seconds <= 5);
  }
  if (left <= 0) {
    const field = document.getElementById('wordInput');
    const btn = document.querySelector('#wordForm button[type=submit]');
    if (field) field.disabled = true;
    if (btn) btn.disabled = true;
  }
  if (left <= 0) maybeReveal();
}
setInterval(updateCountdown, 160);

function configured() {
  const fields = ['apiKey','authDomain','databaseURL','projectId','appId'];
  return fields.every(key => typeof firebaseConfig?.[key] === 'string' &&
    !!firebaseConfig[key] && !/(YOUR_|PASTE_)/.test(firebaseConfig[key]));
}
async function boot() {
  if (!configured()) {showSetup(); return;}
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    auth = getAuth(firebaseApp);
    globalUnsubs.push(onValue(ref(db, '.info/serverTimeOffset'), snap => {
      serverOffset = Number(snap.val()) || 0;
    }));
    globalUnsubs.push(onValue(ref(db, '.info/connected'), snap => {
      isConnected = snap.val() === true;
      if (activeRoom) renderRoom();
    }));
    onAuthStateChanged(auth, async user => {
      if (!user) {
        try {await signInAnonymously(auth);} catch (err) {showFailure('匿名登录失败', errorText(err));}
        return;
      }
      if (authReady && uid === user.uid) return;
      authReady = true;
      uid = user.uid;
      const code = roomParam() || localStorage.getItem(STORAGE_ROOM) || '';
      if (code && /^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
        try {
          const member = await get(ref(db, `rooms/${code}/players/${uid}`));
          if (member.exists()) {attachRoom(code); return;}
        } catch (err) {console.warn('无法自动恢复房间', err);}
        changeRoomParam(code);
        screen = 'join';
      }
      showHome();
    });
  } catch (err) {showFailure('Firebase 初始化失败', errorText(err));}
}
boot();
