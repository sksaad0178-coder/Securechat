'use strict';
/* SecureChat v3 — serverless end-to-end encrypted messenger (WebRTC).
   - Messages, files, voice and calls travel directly between the two phones (DTLS / SRTP encrypted).
   - A public relay (ntfy.sh) is used only to exchange tiny encrypted "connect" notes. It never sees content.
   - Your friends and settings are encrypted on this phone with a key derived from your passphrase.
   - By default, chat messages are NOT saved on the phone at all (memory only). */

const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomUUID();
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hex = u8 => [...u8].map(x => x.toString(16).padStart(2, '0')).join('');

/* ---------- look & feel (not secret, so kept plainly to style the login page too) ---------- */
const UI_DEFAULT = { bg: true, vbright: 1.15, theme: 'auto', accent: 'blue', fs: 16, wall: 'aurora', bubble: 'round', motion: true, ring: true, vib: true };
let UI = Object.assign({}, UI_DEFAULT, (() => { try { return JSON.parse(localStorage.getItem('sc_ui') || '{}'); } catch { return {}; } })());
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyUI() {
  const dark = UI.theme === 'dark' || (UI.theme === 'auto' && mq && mq.matches), h = document.documentElement;
  h.dataset.theme = dark ? 'dark' : 'light'; h.dataset.accent = UI.accent; h.dataset.wall = UI.wall; h.dataset.bubble = UI.bubble; h.dataset.motion = UI.motion ? 'on' : 'off';
  h.style.setProperty('--fs', UI.fs + 'px');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#07090f' : '#f3f5fa';
}
function saveUI() { try { localStorage.setItem('sc_ui', JSON.stringify(UI)); } catch {} applyUI(); }
if (mq) { if (mq.addEventListener) mq.addEventListener('change', applyUI); else if (mq.addListener) mq.addListener(applyUI); }
applyUI();
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  video: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="3"/>',
  videooff: '<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10M1 1l22 22"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>',
  micoff: '<path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="3"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  backsp: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/>',
  flip: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>'
};
const ic = n => '<svg class="i" viewBox="0 0 24 24">' + ICONS[n] + '</svg>';
const paintIcons = (root = document) => root.querySelectorAll('[data-ic]').forEach(b => { b.innerHTML = ic(b.dataset.ic); });
const buzz = p => { try { if (UI.vib && navigator.vibrate) navigator.vibrate(p); } catch {} };

/* ---------- storage (IndexedDB, encrypted values) ---------- */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('securechat', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function kv(mode, fn) {
  const db = await idb;
  return new Promise((res, rej) => {
    const q = fn(db.transaction('kv', mode).objectStore('kv'));
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
const kvGet = k => kv('readonly', s => s.get(k));
const kvSet = (k, v) => kv('readwrite', s => s.put(v, k));
const kvDel = k => kv('readwrite', s => s.delete(k));
const kvClear = () => kv('readwrite', s => s.clear());

let KEY = null;
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 400000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealWith(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function unsealWith(key, buf) {
  const b = new Uint8Array(buf);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
}
const seal = obj => sealWith(KEY, obj), unseal = buf => unsealWith(KEY, buf);

/* ---------- state ---------- */
const DEFAULTS = () => ({ name: '', stun: true, noStore: true, keepSec: 0, got: [], lockMin: 5, myId: '', turn: null, relayOnly: false });
let contacts = [];                 // {id,name,ttl,pid,ps}
let settings = DEFAULTS();
const msgsCache = {};              // cid -> [msg]
let curChat = null;                // contact id open in UI
let conn = null;                   // {cid, safety, rnd}
let unread = {};
const incoming = {};
let typingTimer = null;

async function loadAll() {
  const list = (await kvGet('contacts').then(b => b ? unseal(b) : [])) || [];
  contacts = list.filter(c => c.ps);               // drop half-finished pairings
  const s = await kvGet('settings').then(b => b ? unseal(b) : null);
  settings = Object.assign(DEFAULTS(), s || {});
  if (s && s.keepSec === undefined) settings.keepSec = s.noStore === false ? -1 : 0;
  settings.noStore = settings.keepSec === 0;
  if (!settings.myId) { settings.myId = b64u(crypto.getRandomValues(new Uint8Array(16))); await saveSettings(); }
}
const saveContacts = async () => { if (KEY) await kvSet('contacts', await seal(contacts.filter(c => c.ps))); };
const saveSettings = async () => { if (KEY) await kvSet('settings', await seal(settings)); };
async function getMsgs(cid) {
  if (!msgsCache[cid]) {
    if (settings.noStore) msgsCache[cid] = [];
    else { const b = await kvGet('m:' + cid); msgsCache[cid] = b ? await unseal(b) : []; }
  }
  return msgsCache[cid];
}
const saveTimers = {};
function saveMsgs(cid) {
  if (settings.noStore) return;
  clearTimeout(saveTimers[cid]);
  saveTimers[cid] = setTimeout(async () => { if (KEY) kvSet('m:' + cid, await seal(msgsCache[cid] || [])); }, 300);
}

/* ---------- toast ---------- */
function toast(t) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t;
  document.body.append(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 320); }, 2800);
}

/* ---------- lock screen ---------- */
let failCount = 0, lockTimer = null;
function shakeErr(e, m) { e.textContent = m; e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake'); }
async function initLock() {
  const check = await kvGet('check');
  const first = !check;
  $('#lockHelp').textContent = first
    ? 'Create a private passphrase (8+ characters). It protects everything on this phone. If you forget it, nobody can recover it.'
    : 'Welcome back. Enter your passphrase to unlock.';
  $('#lockBtn').textContent = first ? 'Get started' : 'Unlock';
  $('#pin2').classList.toggle('hidden', !first);
  $('#uname').classList.toggle('hidden', !first);
  $('#lockBtn').onclick = async () => {
    const p = $('#pin').value, err = $('#lockErr'); err.textContent = '';
    try {
      if (first) {
        if (!$('#uname').value.trim()) return shakeErr(err, 'Please enter your name.');
        if (p.length < 8) return shakeErr(err, 'Use at least 8 characters.');
        if (p !== $('#pin2').value) return shakeErr(err, 'Passphrases do not match.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        localStorage.setItem('sc_salt', btoa(String.fromCharCode(...salt)));
        KEY = await deriveKey(p, salt);
        await kvSet('check', await seal({ ok: 1 }));
      } else {
        if (failCount >= 3) await sleep(Math.min(30000, 2 ** failCount * 1000));
        const salt = Uint8Array.from(atob(localStorage.getItem('sc_salt')), c => c.charCodeAt(0));
        KEY = await deriveKey(p, salt);
        try { await unseal(check); } catch { KEY = null; failCount++; return shakeErr(err, 'Wrong passphrase.'); }
      }
      failCount = 0; $('#pin').value = $('#pin2').value = '';
      await loadAll();
      if (first) { settings.name = $('#uname').value.trim().slice(0, 40); await saveSettings(); }
      $('#lock').classList.add('hidden'); $('#app').classList.remove('hidden');
      await showList(); watchContacts(); handleLinkJoin(); keepAlive();
    } catch (e) { err.textContent = 'Error: ' + e.message; }
  };
  $('#pin').onkeydown = $('#pin2').onkeydown = e => { if (e.key === 'Enter') $('#lockBtn').click(); };
}
function lockNow() {
  if (call) return;
  stopKeepAlive(); stopWatch(); stopRelay(); closePeer();
  KEY = null; contacts = []; settings = DEFAULTS(); unread = {};
  for (const k in msgsCache) delete msgsCache[k];
  for (const k in ckCache) delete ckCache[k];
  curChat = null; document.body.classList.remove('chat-open');
  $('#app').classList.add('hidden'); $('#modal').classList.remove('show'); $('#lock').classList.remove('hidden');
  initLock();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (KEY && settings.lockMin > 0) lockTimer = setTimeout(lockNow, settings.lockMin * 60000); }
  else { clearTimeout(lockTimer); if (KEY) { watchContacts(); const t = curChat || lastConn; if (t && !isOn(t)) reach(t); keepAlive(); try { if (call && !wakeLock) navigator.wakeLock.request('screen').then(w => wakeLock = w).catch(() => {}); } catch {} } }
});

/* ---------- views ---------- */
const initials = n => (n || '?').trim().slice(0, 1).toUpperCase();
function paintAv(elm, name) {
  elm.textContent = initials(name);
  let h = 0; for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) % 360;
  elm.style.background = `linear-gradient(135deg,hsl(${h} 75% 62%),hsl(${(h + 35) % 360} 70% 46%))`;
}
const isOn = cid => !!(conn && conn.cid === cid && dc && dc.readyState === 'open');
async function showList() {
  try { closeEmoji(); clearReply(); closeMsgMenu(); } catch {}
  curChat = null; document.body.classList.remove('chat-open'); await renderList();
}
async function renderList() {
  const box = $('#chats'); box.innerHTML = '';
  if (!contacts.length) { box.innerHTML = '<div class="empty"><div class="orb"><svg viewBox="0 0 64 64"><path d="M14 12h36a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10H34l-11 9c-1.4 1.1-3 .2-3-1.6V50h-6A10 10 0 0 1 4 40V22A10 10 0 0 1 14 12z" fill="#fff" transform="translate(0 -2)"/><rect x="25.5" y="21" width="13" height="11" rx="3" fill="#2a63ff"/><path d="M28.2 21v-3a3.8 3.8 0 0 1 7.6 0v3" fill="none" stroke="#2a63ff" stroke-width="2.6" stroke-linecap="round"/></svg></div><b>No friends yet</b><br>Tap <b>+</b> to add one. You do this only once per friend. After that, just tap their name to connect.</div>'; return; }
  let i = 0;
  for (const c of contacts) {
    const ms = await getMsgs(c.id), last = ms[ms.length - 1];
    const r = document.createElement('div'); r.className = 'row'; r.style.animationDelay = (i++ * 60) + 'ms';
    r.innerHTML = '<div class="av"></div><div class="grow"><div class="n"></div><div class="l"></div></div><span class="badge hidden"></span><span class="dot"></span>';
    paintAv(r.querySelector('.av'), c.name);
    r.querySelector('.n').textContent = c.name;
    r.querySelector('.l').textContent = last ? (last.type === 'text' ? last.text : '[' + last.type + ']') : 'Tap to chat';
    const b = r.querySelector('.badge'); if (unread[c.id]) { b.textContent = unread[c.id]; b.classList.remove('hidden'); }
    if (isOn(c.id)) r.querySelector('.dot').classList.add('on');
    r.onclick = () => openChat(c.id);
    box.append(r);
  }
}
async function openChat(cid) {
  await purge(); curChat = cid; unread[cid] = 0;
  const c = contacts.find(x => x.id === cid); if (!c) return;
  $('#cname').textContent = c.name; paintAv($('#cav'), c.name);
  updateStatus(); await renderMsgs(false);
  document.body.classList.add('chat-open');
  reach(cid);
}
function updateStatus() {
  if (curChat === null) return;
  const on = isOn(curChat);
  $('#cstat').textContent = on ? 'online' : (attempt && attempt.cid === curChat ? 'connecting…' : 'offline');
  $('#cstat').classList.toggle('live', on);
  $('#aCall').disabled = $('#vCall').disabled = !on;
}
const tickOf = s => s === 'delivered' ? '✓✓' : s === 'sent' ? '✓' : s === 'pending' ? '…' : '';
const snipOf = m => m.type === 'img' ? '📷 Photo' : m.type === 'voice' ? '🎤 Voice message' : m.type === 'file' ? '📎 ' + (m.name || 'File') : (m.text || '').slice(0, 90);
const nameOfChat = () => (contacts.find(c => c.id === curChat) || {}).name || 'Friend';
function bubble(m) {
  const d = document.createElement('div'); d.className = 'b ' + (m.from === 'me' ? 'me' : 'them'); d.dataset.id = m.id;
  const pi = document.createElement('span'); pi.className = 'rpi'; pi.innerHTML = ic('reply'); d.append(pi);
  if (m.re) {
    const q = document.createElement('div'); q.className = 'rq'; q.dataset.to = m.re.id;
    const qn = document.createElement('b'); qn.textContent = m.re.from === 'me' ? 'You' : nameOfChat();
    const qt = document.createElement('span'); qt.textContent = m.re.text || '';
    q.append(qn, qt); d.append(q);
  }
  if (m.type === 'img') { const i = new Image(); i.src = m.data; d.append(i); }
  else if (m.type === 'voice') { const a = document.createElement('audio'); a.controls = true; a.src = m.data; d.append(a); }
  else if (m.type === 'file') { const a = document.createElement('a'); a.href = m.data; a.download = m.name || 'file'; a.textContent = (m.name || 'file'); d.append(a); }
  if (m.text) { const p = document.createElement('div'); p.textContent = m.text; d.append(p); }
  const meta = document.createElement('div'); meta.className = 'meta';
  const tm = document.createElement('span'); tm.className = 'tm';
  tm.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (m.from === 'me' ? ' ' + tickOf(m.status) : '');
  meta.append(tm); d.append(meta);
  const rx = m.rx && [m.rx.them, m.rx.me].filter(Boolean);
  if (rx && rx.length) { const p = document.createElement('div'); p.className = 'rx'; p.textContent = rx.join(' '); d.append(p); d.classList.add('hasrx'); }
  return d;
}
function refreshBubble(id) {
  const n = $('#msgs').querySelector('[data-id="' + id + '"]'); if (!n || !curChat) return;
  const m = (msgsCache[curChat] || []).find(x => x.id === id); if (!m) return;
  const nb = bubble(m); n.replaceWith(nb); nb.classList.add('rxpop');
}
function updateTick(id, status) {
  const n = $('#msgs').querySelector('[data-id="' + id + '"] .tm'); if (!n) return;
  n.textContent = n.textContent.replace(/\s*(✓✓|✓|…)$/, '') + ' ' + tickOf(status);
}
async function renderMsgs(animLast) {
  if (!curChat) return;
  const box = $('#msgs'), ms = await getMsgs(curChat);
  if (animLast && box.dataset.cid === curChat && box.children.length === ms.length - 1 && ms.length) {
    const b = bubble(ms[ms.length - 1]); b.classList.add('pop'); box.append(b);
    box.scrollTo({ top: box.scrollHeight, behavior: UI.motion ? 'smooth' : 'auto' }); return;
  }
  box.innerHTML = ''; box.dataset.cid = curChat;
  const frag = document.createDocumentFragment(); for (const m of ms) frag.append(bubble(m)); box.append(frag);
  box.style.scrollBehavior = 'auto'; box.scrollTop = box.scrollHeight; box.style.scrollBehavior = '';
}
async function deleteMsg(id, remote) {
  const cid = curChat; if (!cid) return;
  const ms = await getMsgs(cid), i = ms.findIndex(m => m.id === id);
  if (i < 0) return; const m = ms[i]; ms.splice(i, 1); saveMsgs(cid);
  const node = $('#msgs').querySelector('[data-id="' + id + '"]'); if (node) { node.classList.add('gone'); setTimeout(() => node.remove(), 280); }
  if (remote && m.from === 'me') sendRaw({ t: 'del', id });
}
/* iOS-style swipe from the left edge to go back */
(() => {
  let x0 = null, dx = 0; const v = () => $('#vChat');
  document.addEventListener('touchstart', e => { if (document.body.classList.contains('chat-open') && e.touches[0].clientX < 26) { x0 = e.touches[0].clientX; dx = 0; document.body.classList.add('dragging'); } }, { passive: true });
  document.addEventListener('touchmove', e => { if (x0 === null) return; dx = Math.max(0, e.touches[0].clientX - x0); v().style.transform = `translateX(${dx}px)`; }, { passive: true });
  document.addEventListener('touchend', () => {
    if (x0 === null) return; document.body.classList.remove('dragging'); v().style.transform = '';
    const go = dx > innerWidth * 0.3; x0 = null; if (go) showList();
  });
})();

/* ---------- sheets ---------- */
function openSheet(build) {
  const sh = $('#sheet'); sh.innerHTML = ''; build(sh);
  requestAnimationFrame(() => $('#modal').classList.add('show'));
}
const closeSheet = () => { $('#modal').classList.remove('show'); stopRelay(); pairing = false; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(); });
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag); Object.assign(e, props);
  kids.forEach(k => e.append(k)); return e;
}
$('#newChat').onclick = () => openSheet(sh => {
  sh.append(el('h2', { textContent: 'Add a friend' }),
    el('p', { textContent: 'You do this only once per friend. After that your friend stays saved and you connect by just tapping their name.' }),
    el('button', { className: 'pri', textContent: 'Invite a friend', onclick: inviteFlow }),
    el('button', { textContent: 'I have a code or link', onclick: joinAsk }));
});
function segCtl(opts, cur, on) {
  const d = el('div', { className: 'seg' });
  opts.forEach(([v, t]) => { const b = el('button', { textContent: t, className: v === cur ? 'on' : '' }); b.onclick = () => { [...d.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); on(v); }; d.append(b); });
  return d;
}
function swatchCtl(items, cur, on, cls) {
  const d = el('div', { className: 'sw ' + (cls || '') });
  items.forEach(([v, bg, label]) => { const b = el('button', { className: v === cur ? 'on' : '', title: label || v }); b.style.background = bg; b.onclick = () => { [...d.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); on(v); }; d.append(b); });
  return d;
}
function toggleCtl(val, on) { const w = el('label', { className: 'sw-s' }), i = el('input', { type: 'checkbox', checked: !!val }); i.onchange = () => on(i.checked); w.append(i, el('i')); return w; }
function setRow(t, d, ctl, col) {
  const r = el('div', { className: 'srow' + (col ? ' col' : '') }), lab = el('div', {}, el('div', { className: 't', textContent: t }));
  if (d) lab.append(el('div', { className: 'd', textContent: d })); r.append(lab, ctl); return r;
}
const grp = (...rows) => el('div', { className: 'group' }, ...rows);
const grpT = t => el('div', { className: 'grp-t', textContent: t });
$('#openSettings').onclick = () => openSheet(sh => {
  const nm = el('input', { value: settings.name, placeholder: 'Your name' });
  const tu = el('input', { value: (settings.turn && settings.turn.url) || '', placeholder: 'turn:your-server.com:3478', autocapitalize: 'off', autocorrect: 'off' });
  const tn = el('input', { value: (settings.turn && settings.turn.user) || '', placeholder: 'Username', autocapitalize: 'off' });
  const tp = el('input', { value: (settings.turn && settings.turn.pass) || '', placeholder: 'Password', type: 'password' });
  const keepSel = el('select', {}, ...[[0, "Don't save"], [3600, '1 hour'], [86400, '1 day'], [604800, '1 week'], [-1, 'Forever']].map(([v, t]) => el('option', { value: v, textContent: t, selected: settings.keepSec === v })));
  keepSel.onchange = async () => {
    const was = settings.noStore; settings.keepSec = +keepSel.value; settings.noStore = settings.keepSec === 0; await saveSettings();
    if (settings.noStore) for (const c of contacts) await kvDel('m:' + c.id);
    else { if (was) for (const c of contacts) if (msgsCache[c.id]) saveMsgs(c.id); await purge(); }
  };
  const lm = el('select', {}, ...[[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [0, 'Never']].map(([v, t]) => el('option', { value: v, textContent: t, selected: settings.lockMin === v })));
  lm.onchange = async () => { settings.lockMin = +lm.value; await saveSettings(); };
  const accents = [['blue', 'linear-gradient(135deg,#2f80ff,#38c6ff)'], ['purple', 'linear-gradient(135deg,#7c5cff,#c06bff)'], ['green', 'linear-gradient(135deg,#12b86a,#4be0a0)'], ['pink', 'linear-gradient(135deg,#ff4f8b,#ff8a5c)'], ['orange', 'linear-gradient(135deg,#ff8a00,#ffc23d)'], ['teal', 'linear-gradient(135deg,#0aa8b8,#3de0d0)']];
  const walls = [['none', 'var(--bg)', 'Plain'], ['aurora', 'linear-gradient(135deg,#bcd7ff,#ffd6f0)', 'Aurora'], ['dots', 'radial-gradient(#9aa6bf 1.2px,#eef1f8 1.4px) 0 0/10px 10px', 'Dots'], ['sand', '#efe9dd', 'Sand'], ['night', 'linear-gradient(180deg,#0b1030,#1b0f3d)', 'Night']];
  sh.append(el('h2', { textContent: 'Settings' }),
    grpT('Appearance'),
    grp(setRow('Theme', null, segCtl([['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']], UI.theme, v => { UI.theme = v; saveUI(); }), true),
      setRow('Accent colour', null, swatchCtl(accents, UI.accent, v => { UI.accent = v; saveUI(); }), true),
      setRow('Text size', null, segCtl([[14, 'Small'], [16, 'Medium'], [18, 'Large']], UI.fs, v => { UI.fs = v; saveUI(); }), true),
      setRow('Chat background', null, swatchCtl(walls, UI.wall, v => { UI.wall = v; saveUI(); }, 'wall'), true),
      setRow('Bubble style', null, segCtl([['round', 'Rounded'], ['tail', 'Classic']], UI.bubble, v => { UI.bubble = v; saveUI(); }), true),
      setRow('Video brightness', 'Makes dim video calls clearer', segCtl([[1, 'Normal'], [1.15, 'Bright'], [1.3, 'Brighter']], UI.vbright, v => { UI.vbright = v; saveUI(); applyBright(); }), true),
      setRow('Smooth animations', 'Turn off for a plainer, faster feel', toggleCtl(UI.motion, v => { UI.motion = v; saveUI(); }))),
    grpT('Sound and alerts'),
    grp(setRow('Call ringtone', null, toggleCtl(UI.ring, v => { UI.ring = v; saveUI(); })),
      setRow('Vibrate', 'For new messages and calls', toggleCtl(UI.vib, v => { UI.vib = v; saveUI(); buzz(40); }))),
    grpT('Privacy'),
    grp(setRow('Keep messages', 'Saved on this phone, encrypted. Older ones are erased automatically. "Don\'t save" keeps chats in memory only.', keepSel),
      setRow('Auto-lock after leaving', null, lm)),
    grpT('Profile'),
    grp(setRow('Your name', 'Friends see this', nm, true)),
    grpT('Connection'),
    grp(setRow('Stay connected in background', 'Keeps chat and calls running when you leave the app. Shows a small “SecureChat” media notification.', toggleCtl(UI.bg, v => { UI.bg = v; saveUI(); v ? keepAlive() : stopKeepAlive(); })),
      setRow('Connect over the internet', 'Uses public helper servers so phones on different networks can find each other. They only see addresses and encrypted data, never your messages.', toggleCtl(settings.stun, async v => { settings.stun = v; await saveSettings(); })),
      setRow('Always use the relay', 'Hides your IP address from your friend. Slower.', toggleCtl(settings.relayOnly, async v => { settings.relayOnly = v; await saveSettings(); })),
      setRow('Your own relay (optional)', 'Free accounts at relay providers work. Paste the address, username and password they give you.', el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, tu, tn, tp), true)),
    el('button', { textContent: 'Test my network', onclick: testNet }),
    el('button', { className: 'pri', textContent: 'Done', onclick: async () => {
      settings.name = nm.value.trim().slice(0, 40) || settings.name;
      settings.turn = tu.value.trim() ? { url: tu.value.trim(), user: tn.value.trim(), pass: tp.value } : null;
      await saveSettings(); closeSheet(); toast('Saved');
    } }),
    el('button', { textContent: 'Back up my friends', onclick: backup }),
    el('button', { textContent: 'Restore from backup', onclick: () => $('#bfile').click() }),
    el('button', { textContent: 'Lock now', onclick: () => { closeSheet(); setTimeout(lockNow, 300); } }),
    el('button', { className: 'danger', textContent: 'Erase everything on this phone', onclick: async () => {
      if (!confirm('Erase ALL friends, chats and your passphrase from this phone?')) return;
      closePeer(); await kvClear(); localStorage.clear(); location.reload();
    } }));
});
async function testNet() {
  openSheet(sh => sh.append(el('h2', { textContent: 'Testing your network…' }), el('div', { className: 'spin' }), el('p', { id: 'ntRes', textContent: 'This takes up to 10 seconds.', style: 'text-align:center' })));
  const found = { host: 0, srflx: 0, relay: 0, v6: 0 };
  try {
    const t = new RTCPeerConnection(iceConfig()); t.createDataChannel('x');
    t.onicecandidate = e => { if (e.candidate) { const c = e.candidate; found[c.type] = (found[c.type] || 0) + 1; if ((c.address || '').includes(':')) found.v6++; } };
    await t.setLocalDescription(await t.createOffer());
    await new Promise(r => { const to = setTimeout(r, 10000); t.addEventListener('icegatheringstatechange', () => { if (t.iceGatheringState === 'complete') { clearTimeout(to); r(); } }); });
    t.close();
  } catch (e) { found.err = e.message; }
  const line = (ok, yes, no) => el('div', { className: 'srow' }, el('div', { className: 't', textContent: ok ? yes : no }), el('div', { textContent: ok ? '✓' : '✗', style: 'font-weight:800;color:' + (ok ? 'var(--green)' : 'var(--red)') }));
  const verdict = found.relay ? 'Good. You can connect from other networks and mobile data.' : found.srflx ? 'Direct links may work, but some networks will fail. Add your own relay in Settings if a friend cannot connect.' : 'No internet routes found. Check your internet, or the relay settings.';
  openSheet(sh => sh.append(el('h2', { textContent: 'Network test' }),
    el('div', { className: 'group' }, line(found.host, 'Local network found', 'No local network'), line(found.srflx, 'Public address found (STUN)', 'Public address not found'), line(found.relay, 'Relay server reachable (TURN)', 'Relay server not reachable'), line(found.v6, 'IPv6 available', 'IPv6 not available')),
    el('p', { textContent: verdict }), el('button', { className: 'pri', textContent: 'Close', onclick: closeSheet })));
}
async function backup() {
  const data = await seal({ myId: settings.myId, name: settings.name, contacts: contacts.filter(c => c.ps) });
  const blob = new Blob([JSON.stringify({ v: 1, salt: localStorage.getItem('sc_salt'), data: b64u(data) })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'securechat-backup.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Backup saved. Keep the file safe.');
}
$('#bfile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); const pass = prompt('Passphrase you used when this backup was made:'); if (!pass) return;
    const k = await deriveKey(pass, Uint8Array.from(atob(j.salt), c => c.charCodeAt(0)));
    const o = await unsealWith(k, unb64u(j.data));
    settings.myId = o.myId; if (o.name) settings.name = o.name;
    for (const c of o.contacts) if (!contacts.some(x => x.pid === c.pid)) contacts.push(c);
    await saveSettings(); await saveContacts(); closeSheet(); await renderList(); watchContacts(); toast('Restored ' + o.contacts.length + ' friend(s)');
  } catch { toast('Could not restore. Wrong passphrase or file.'); }
};
$('#back').onclick = showList;
/* ---------- Minimise a call into a small floating window, so you can keep chatting ---------- */
(() => {
  const st = document.createElement('style');
  st.textContent = `
  #bMin{position:absolute;left:14px;top:calc(14px + env(safe-area-inset-top));width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center;padding:0;border:0;z-index:3;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
  #bMin svg{width:22px;height:22px}
  #call.rin #bMin,#call.mini #bMin{display:none}
  @keyframes miniIn{from{opacity:0;transform:scale(1.8)}to{opacity:1;transform:none}}
  #call.on.mini{inset:auto;top:calc(70px + env(safe-area-inset-top));right:12px;width:112px;height:152px;padding:0;border-radius:20px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.45);z-index:90;touch-action:none;animation:miniIn .38s cubic-bezier(.2,.9,.25,1.1)}
  #call.mini #lv,#call.mini #bAcc,#call.mini #bMute,#call.mini #bCam,#call.mini #bFlip{display:none!important}
  #call.mini #cinfo{top:14%}
  #call.mini #cinfo .av{width:52px;height:52px;font-size:1.3rem;margin:0 auto 6px;box-shadow:none}
  #call.mini #cn2{font-size:13px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px}
  #call.mini #cs2{font-size:12px}
  #call.mini.vcall #cinfo{display:none}
  #call.mini #cbar{padding:0 0 8px;gap:0}
  #call.mini #cbar #bEnd{width:34px;height:34px}
  #call.mini #cbar #bEnd svg{width:16px;height:16px}`;
  document.head.append(st);
  const b = el('button', { id: 'bMin', title: 'Minimise', innerHTML: ic('down') }); $('#call').append(b);
  const C = $('#call');
  const vv = window.visualViewport;
  const clamp = () => {
    if (!C.classList.contains('mini')) return;
    const r = { top: C.offsetTop, left: C.offsetLeft, width: C.offsetWidth, height: C.offsetHeight }, t0 = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight, l0 = vv ? vv.offsetLeft : 0, w = vv ? vv.width : innerWidth;
    if (want === null) want = r.top;
    const t = Math.max(t0 + 8, Math.min(t0 + h - r.height - 8, want)), l = Math.max(l0 + 6, Math.min(l0 + w - r.width - 6, r.left));
    if (Math.abs(t - r.top) > 1 || Math.abs(l - r.left) > 1) { C.style.top = t + 'px'; C.style.left = l + 'px'; C.style.right = 'auto'; }
  };
  if (vv) ['resize', 'scroll'].forEach(e => vv.addEventListener(e, clamp)); addEventListener('resize', clamp);
  window.minimizeCall = () => { if (C.classList.contains('on') && !C.classList.contains('rin')) { C.classList.add('mini'); want = null; requestAnimationFrame(clamp); } };
  let want = null;   // where the small window wants to sit (kept on screen even when the keyboard opens)
  const expand = () => { C.classList.remove('mini'); C.style.top = C.style.left = C.style.right = ''; want = null; };
  b.onclick = minimizeCall;
  let sx, sy, ox, oy, moved, drag = false;
  C.addEventListener('pointerdown', e => {
    if (!C.classList.contains('mini') || e.target.closest('#bEnd')) return;
    const r = C.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moved = false; drag = true; C.setPointerCapture(e.pointerId);
  });
  C.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true; if (!moved) return;
    const w = C.offsetWidth, h = C.offsetHeight;
    const t0 = vv ? vv.offsetTop : 0, hh = vv ? vv.height : innerHeight;
    C.style.left = Math.min(innerWidth - w - 6, Math.max(6, ox + dx)) + 'px'; C.style.top = Math.min(t0 + hh - h - 8, Math.max(t0 + 8, oy + dy)) + 'px'; C.style.right = 'auto'; want = parseFloat(C.style.top);
  });
  C.addEventListener('pointerup', () => { if (!drag) return; drag = false; if (!moved) expand(); });
  // when the whole app goes to the background, try the phone's own floating video window
  const pip = () => { const v = $('#rv'); if (document.pictureInPictureEnabled && call && v.srcObject && !document.pictureInPictureElement && v.style.visibility === 'visible') v.requestPictureInPicture().catch(() => {}); };
  try { navigator.mediaSession.setActionHandler('enterpictureinpicture', pip); } catch {}
  document.addEventListener('visibilitychange', () => { if (document.hidden) pip(); });
})();
$('#cMenu').onclick = () => openSheet(sh => {
  const c = contacts.find(x => x.id === curChat); if (!c) return;
  const ttl = el('select', {}, ...[[0, 'Off'], [3600, '1 hour'], [86400, '24 hours'], [604800, '7 days']].map(([v, t]) => el('option', { value: v, textContent: t, selected: c.ttl === v })));
  ttl.onchange = async () => { c.ttl = +ttl.value; await saveContacts(); sendRaw({ t: 'ttl', v: c.ttl }); purge(); toast('Disappearing messages updated'); };
  sh.append(el('h2', { textContent: c.name }));
  if (!isOn(c.id)) sh.append(el('button', { className: 'pri', textContent: 'Connect now', onclick: () => { closeSheet(); attempt = null; reach(c.id); } }));
  else sh.append(el('button', { textContent: 'Verify safety code', onclick: showSafety }));
  sh.append(el('p', { textContent: 'Disappearing messages' }), ttl,
    el('button', { textContent: 'Rename', onclick: async () => { const n = prompt('Name', c.name); if (n) { c.name = n.trim().slice(0, 40); await saveContacts(); closeSheet(); $('#cname').textContent = c.name; paintAv($('#cav'), c.name); } } }),
    el('button', { className: 'danger', textContent: 'Remove friend', onclick: async () => {
      if (!confirm('Remove this friend and all messages?')) return;
      contacts = contacts.filter(x => x.id !== c.id); delete ckCache[c.id]; await kvDel('m:' + c.id); delete msgsCache[c.id]; await saveContacts(); closeSheet(); if (isOn(c.id)) closePeer(); watchContacts(); showList();
    } }));
});
function showSafety() {
  openSheet(sh => {
    sh.append(el('h2', { textContent: 'Safety code' }),
      el('p', { textContent: 'Read this number to your friend on a call or in person. If both screens show the same number, nobody is intercepting the connection.' }),
      el('div', { className: 'safety', textContent: conn ? conn.safety : '—' }),
      el('button', { textContent: 'Close', onclick: closeSheet }));
  });
}

/* ---------- WebRTC core ---------- */
let pc = null, dc = null, polite = false, makingOffer = false, ignoreOffer = false, remoteStream = null;
let attempt = null;   // {cid, pc, t} — a connection we are currently trying to make
async function pack(d) {
  const s = JSON.stringify({ t: d.type[0], s: d.sdp });
  const cs = new Blob([enc.encode(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'SC1.' + b64u(new Uint8Array(await new Response(cs).arrayBuffer()));
}
async function unpack(text) {
  const m = (text || '').match(/SC1\.[A-Za-z0-9_-]+/); if (!m) throw new Error('Not a SecureChat code.');
  const ds = new Blob([unb64u(m[0].slice(4))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const o = JSON.parse(await new Response(ds).text());
  return { type: o.t === 'o' ? 'offer' : 'answer', sdp: o.s };
}
const fpOf = sdp => (sdp.match(/a=fingerprint:\S+ ([0-9A-Fa-f:]+)/) || [, ''])[1];
async function safetyCode() {
  const s = [fpOf(pc.localDescription.sdp), fpOf(pc.remoteDescription.sdp)].sort().join('|');
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  const out = []; for (let i = 0; i < 10; i += 2) out.push(String(((h[i] << 8) | h[i + 1]) % 100000).padStart(5, '0'));
  return out.join(' ');
}
function gathered() {
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, settings.stun ? 8000 : 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
/* STUN finds your public address. TURN is a relay that carries the (already end-to-end encrypted) traffic
   when two phones are on different networks and cannot reach each other directly. */
const PUBLIC_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
];
function iceConfig() {
  if (!settings.stun) return { iceServers: [] };
  const list = [...PUBLIC_ICE], t = settings.turn;
  if (t && t.url) list.unshift({ urls: t.url.split(/[\s,]+/).filter(Boolean), username: t.user || undefined, credential: t.pass || undefined });
  return { iceServers: list, iceTransportPolicy: settings.relayOnly ? 'relay' : 'all' };
}
function makePC() {
  try { return new RTCPeerConnection(iceConfig()); }
  catch (e) { toast('Your relay address looks invalid. Using the default one.'); return new RTCPeerConnection({ iceServers: PUBLIC_ICE }); }
}
function newPC() {
  closePeer();
  pc = makePC();
  const me = pc;
  pc.onconnectionstatechange = () => {
    if (pc !== me) return;
    if (pc.connectionState === 'failed' && !conn) { toast('Could not connect. Your network blocks direct links. Open Settings > Connection to check the relay.'); closePeer(); }
    else if (['failed', 'closed'].includes(pc.connectionState)) peerLost();
    else updateStatus();
  };
  pc.ontrack = e => {
    remoteStream = e.streams[0] || new MediaStream([e.track]);
    $('#rv').srcObject = remoteStream; $('#rv').play().catch(() => {}); updateRemoteView();
    e.track.onmute = e.track.onunmute = e.track.onended = updateRemoteView;
    remoteStream.onremovetrack = updateRemoteView;
  };
  pc.onicecandidate = e => { if (e.candidate && dc && dc.readyState === 'open') sendRaw({ t: 'ice', d: e.candidate }); };
  return pc;
}
function armRenegotiation() {
  pc.onnegotiationneeded = async () => {
    try { makingOffer = true; await pc.setLocalDescription(); sendRaw({ t: 'sdp', d: pc.localDescription }); }
    catch (e) { console.warn(e); } finally { makingOffer = false; }
  };
}
function closePeer() {
  const old = pc, oldDc = dc;
  pc = dc = null; conn = null; attempt = null;
  try { oldDc && oldDc.close(); } catch {} try { old && old.close(); } catch {}
  endCallLocal(); updateStatus();
}
function peerLost() {
  const was = conn; closePeer();
  if (was) { toast('Disconnected'); if (curChat === null) renderList(); }
}
function setupDC(cid) {
  const myDc = dc; let opened = false; const early = [];   // messages that arrive before our open handler has run
  dc.onopen = async () => {
    if (dc !== myDc || opened) return; opened = true;
    armRenegotiation();
    lastConn = cid; conn = { cid, safety: '…', rnd: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    attempt = null; pairing = false; stopRelay();
    const sendPair = re => sendRaw({ t: 'pair', id: settings.myId, name: settings.name, rnd: conn.rnd, re: !!re });
    sendPair(false);
    (async () => { for (const d of [800, 1700, 3000, 5000]) { await sleep(d); if (dc !== myDc || !conn || conn.gotPair) return; sendPair(false); } })();
    const c = contacts.find(x => x.id === cid); if (c && c.ttl) sendRaw({ t: 'ttl', v: c.ttl });
    for (const m of early.splice(0)) onWire(m);
    conn.safety = await safetyCode();
    updateStatus(); toast('Connected — encrypted');
    if (c && !c.ps) { closeSheet(); await openChat(cid); } else if (curChat === null) renderList();
    const ms = await getMsgs(cid);
    for (const m of ms.filter(m => m.from === 'me' && m.status === 'pending')) { await wire(m); m.status = 'sent'; }
    saveMsgs(cid); if (curChat === cid) renderMsgs();
  };
  dc.onclose = () => { if (dc === myDc && conn) peerLost(); };
  dc.onmessage = e => { const o = JSON.parse(e.data); if (opened) onWire(o); else early.push(o); };
  if (dc.readyState === 'open') dc.onopen();
}
const sendRaw = o => { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(o)); };
async function wire(m) {
  const data = m.data || '', CH = 12000, n = Math.ceil(data.length / CH);
  sendRaw({ t: 'msg', id: m.id, type: m.type, text: m.text, name: m.name, mime: m.mime, ts: m.ts, re: m.re, n });
  for (let i = 0; i < n; i++) {
    while (dc && dc.bufferedAmount > 1e6) await sleep(40);
    sendRaw({ t: 'chunk', id: m.id, i, d: data.slice(i * CH, (i + 1) * CH) });
  }
}
async function onWire(o) {
  const cid = conn && conn.cid;
  switch (o.t) {
    case 'pair': {
      const c = contacts.find(x => x.id === cid); if (!c) break;
      conn.gotPair = true;
      if (!o.re) sendRaw({ t: 'pair', id: settings.myId, name: settings.name, rnd: conn.rnd, re: true });
      if (c.pid && c.pid !== o.id) { toast('⚠️ This is not the same person you saved. Disconnected.'); closePeer(); break; }
      if (!c.ps) {
        const both = [conn.rnd, o.rnd].sort().join('|');
        c.ps = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(both))));
        c.pid = o.id; if (!c.name || c.name === 'New friend') c.name = (o.name || 'Friend').slice(0, 40);
        await saveContacts(); watchContacts();
        if (curChat === cid) { $('#cname').textContent = c.name; paintAv($('#cav'), c.name); }
      }
      break;
    }
    case 'msg': incoming[o.id] = { meta: o, parts: [] }; if (!o.n) finishIncoming(o.id); break;
    case 'chunk': { const x = incoming[o.id]; if (!x) break; x.parts.push(o.d); if (x.parts.length >= x.meta.n) finishIncoming(o.id); break; }
    case 'ack': { const ms = await getMsgs(cid); const m = ms.find(m => m.id === o.id); if (m) { m.status = 'delivered'; saveMsgs(cid); if (curChat === cid) updateTick(m.id, 'delivered'); } break; }
    case 'rx': { const ms = await getMsgs(cid), m = ms.find(x => x.id === o.id); if (!m) break; m.rx = m.rx || {}; if (o.e) m.rx.them = String(o.e).slice(0, 8); else delete m.rx.them; saveMsgs(cid); if (curChat === cid) refreshBubble(m.id); if (o.e) buzz(15); break; }
    case 'share': $('#rv').style.objectFit = o.on ? 'contain' : ''; if (o.on) toast('Friend is sharing their screen'); break;
    case 'cam': remoteCam = !!o.on; updateRemoteView(); break;
    case 'typing': if (curChat === cid) { $('#typing').textContent = 'typing…'; clearTimeout(typingTimer); typingTimer = setTimeout(() => $('#typing').textContent = '', 2500); } break;
    case 'del': { const ms = await getMsgs(cid), i = ms.findIndex(m => m.id === o.id); if (i >= 0) { ms.splice(i, 1); saveMsgs(cid); if (curChat === cid) renderMsgs(); } break; }
    case 'ttl': { const c = contacts.find(x => x.id === cid); if (c && c.ttl !== o.v) { c.ttl = o.v; saveContacts(); toast('Disappearing messages: ' + (o.v ? o.v / 3600 + 'h' : 'off')); } break; }
    case 'sdp': await onSdp(o.d); break;
    case 'ice': try { await pc.addIceCandidate(o.d); } catch (e) { if (!ignoreOffer) console.warn(e); } break;
    case 'call': onIncomingCall(o.video); break;
    case 'call-ok': if (call) { ring(false); call.answered = true; await attachLocal(); setCallState('Connected'); startTimer(); } break;
    case 'call-no': if (call) { toast('Call declined'); endCallLocal(); } break;
    case 'end': if (call) { toast('Call ended'); endCallLocal(); } break;
  }
}
async function finishIncoming(id) {
  const x = incoming[id]; delete incoming[id]; const o = x.meta, cid = conn && conn.cid; if (!cid) return;
  const ms = await getMsgs(cid);
  if (ms.some(m => m.id === o.id)) { sendRaw({ t: 'ack', id: o.id }); return; }
  ms.push({ id: o.id, from: 'them', type: o.type, text: o.text, name: o.name, mime: o.mime, ts: o.ts, re: o.re, data: x.parts.join('') });
  markGot(o.id); saveMsgs(cid); sendRaw({ t: 'ack', id: o.id });
  buzz(25);
  if (curChat === cid) { renderMsgs(true); $('#typing').textContent = ''; } else { unread[cid] = (unread[cid] || 0) + 1; if (curChat === null) renderList(); }
}
async function onSdp(d) {
  const collision = d.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
  ignoreOffer = !polite && collision; if (ignoreOffer) return;
  await pc.setRemoteDescription(d);
  if (d.type === 'offer') { await pc.setLocalDescription(); sendRaw({ t: 'sdp', d: pc.localDescription }); }
}

/* ---------- relay helpers (ntfy.sh): only encrypted notes pass through ---------- */
const RELAY = 'https://ntfy.sh/';
async function postRoom(topic, text) {
  const r = await fetch(RELAY + topic, { method: 'POST', body: text });
  if (!r.ok) throw new Error('Relay error ' + r.status);
}
async function sealNote(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64u(o);
}
async function openNote(key, str) {
  const b = unb64u(str);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
}

/* ----- first-time pairing with a room code (once per friend) ----- */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => { const b = crypto.getRandomValues(new Uint8Array(8)); const t = [...b].map(x => ALPHA[x & 31]).join(''); return t.slice(0, 4) + '-' + t.slice(4); };
const normCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function roomKeys(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('securechat-room-v2'), iterations: 250000, hash: 'SHA-256' }, base, 384));
  return { topic: 'sc' + hex(bits.slice(0, 16)), key: await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']) };
}
let relayES = null, relayTO = null, pairing = false;
function stopRelay() { if (relayES) { relayES.close(); relayES = null; } clearTimeout(relayTO); }
function listenRoom(topic, onmsg) {
  stopRelay();
  const es = new EventSource(RELAY + topic + '/sse?since=all'); relayES = es;
  es.onmessage = ev => { try { const j = JSON.parse(ev.data); if (j.event === 'message') onmsg(j.message); } catch {} };
  relayTO = setTimeout(() => { if (relayES === es) { stopRelay(); setRoomStatus('Code expired. Close this and start again.', false); } }, 10 * 60000);
}
function setRoomStatus(t, spin = true) {
  const e = $('#roomStatus'); if (!e) return; e.textContent = t;
  const s = $('#roomSpin'); if (s) s.classList.toggle('hidden', !spin);
}
function newPending() { const c = { id: uid(), name: 'New friend', ttl: 0 }; contacts.push(c); return c; }
function dropPending(id) { const c = contacts.find(x => x.id === id); if (c && !c.ps) contacts = contacts.filter(x => x.id !== id); }
async function inviteFlow() {
  const code = genCode(), link = location.origin + location.pathname + '#j=' + normCode(code);
  pairing = true;
  openSheet(sh => {
    const share = 'Join me on SecureChat.\nTap this link: ' + link + '\n(or open the app, tap + and enter code ' + code + ')';
    sh.append(el('h2', { textContent: 'Invite a friend' }),
      el('div', { className: 'bigcode', textContent: code }),
      el('p', { textContent: 'Send your friend the link below. When they open it, you two connect by themselves. Keep this screen open until it says connected.' }),
      el('div', { className: 'btns' },
        el('button', { className: 'pri', textContent: 'Share link', onclick: () => { if (navigator.share) navigator.share({ text: share }).catch(() => {}); else navigator.clipboard.writeText(share).then(() => toast('Link copied')); } }),
        el('button', { textContent: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(share); toast('Copied'); } catch { toast('Copy failed'); } } })),
      el('div', { id: 'roomSpin', className: 'spin' }),
      el('p', { id: 'roomStatus', textContent: 'Preparing…', style: 'text-align:center' }));
  });
  const c = newPending();
  try {
    const { topic, key } = await roomKeys(code);
    newPC(); polite = false; const my = pc;
    dc = pc.createDataChannel('chat'); setupDC(c.id);
    await pc.setLocalDescription(await pc.createOffer()); await gathered();
    const sdp = await pack(pc.localDescription);
    await postRoom(topic, JSON.stringify({ t: 'o', d: await sealNote(key, { sdp, ts: Date.now() }) }));
    setRoomStatus('Waiting for your friend…');
    let done = false;
    listenRoom(topic, async m => {
      if (done || pc !== my) return;
      try {
        const j = JSON.parse(m); if (j.t !== 'a') return;
        const o = await openNote(key, j.d); if (Date.now() - o.ts > 15 * 60000) return;
        done = true; stopRelay(); setRoomStatus('Connecting…');
        await pc.setRemoteDescription(await unpack(o.sdp));
      } catch (e) { console.warn(e); }
    });
  } catch (e) { dropPending(c.id); closePeer(); setRoomStatus('Cannot reach the connect server. Check your internet.', false); }
}
function joinAsk(prefill) {
  pairing = true;
  openSheet(sh => {
    const inp = el('input', { value: typeof prefill === 'string' ? prefill : '', placeholder: 'XXXX-XXXX', autocapitalize: 'characters', autocomplete: 'off', style: 'font:700 26px ui-monospace,monospace;text-align:center;letter-spacing:3px;text-transform:uppercase' });
    sh.append(el('h2', { textContent: 'Enter friend’s code' }), el('p', { textContent: 'Type the code your friend gave you. (If you got a link, just tap the link instead.)' }), inp,
      el('button', { className: 'pri', textContent: 'Connect', onclick: () => joinEasy(inp.value) }));
    setTimeout(() => inp.focus(), 300);
  });
}
async function joinEasy(codeText) {
  if (normCode(codeText).length !== 8) return toast('The code has 8 letters/numbers');
  pairing = true;
  openSheet(sh => sh.append(el('h2', { textContent: 'Connecting…' }), el('div', { id: 'roomSpin', className: 'spin' }), el('p', { id: 'roomStatus', textContent: 'Looking for your friend… keep this app open.', style: 'text-align:center' })));
  const c = newPending();
  try {
    const { topic, key } = await roomKeys(codeText); let done = false;
    listenRoom(topic, async m => {
      if (done) return;
      try {
        const j = JSON.parse(m); if (j.t !== 'o') return;
        const o = await openNote(key, j.d); if (Date.now() - o.ts > 15 * 60000) return;
        done = true; setRoomStatus('Found. Connecting…');
        newPC(); polite = true; pc.ondatachannel = e => { dc = e.channel; setupDC(c.id); };
        await pc.setRemoteDescription(await unpack(o.sdp)); await pc.setLocalDescription(await pc.createAnswer()); await gathered();
        await postRoom(topic, JSON.stringify({ t: 'a', d: await sealNote(key, { sdp: await pack(pc.localDescription), ts: Date.now() }) }));
        stopRelay(); setRoomStatus('Connecting… keep this app open.');
      } catch (e) { setRoomStatus('Problem: ' + (e.message || e), false); }
    });
  } catch (e) { dropPending(c.id); setRoomStatus('Cannot reach the connect server. Check your internet.', false); }
}
let linkCode = (location.hash.match(/[#&]j=([A-Za-z0-9]{8})/) || [])[1] || null;
function handleLinkJoin() {
  if (!linkCode) return;
  const code = linkCode; linkCode = null; history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => joinEasy(code), 400);
}

/* ----- saved friends: automatic reconnect, no codes ----- */
const ckCache = {};
async function ckeys(c) {
  if (ckCache[c.id]) return ckCache[c.id];
  const ps = unb64u(c.ps);
  const h = async tag => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...ps, ...enc.encode(tag)])));
  const t = await h('topic'), k = await h('key');
  return ckCache[c.id] = { topic: 'sc' + hex(t.slice(0, 16)), key: await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']) };
}
const amOfferer = c => settings.myId > c.pid;     // fixed roles avoid both sides offering at once
const postNote = async (k, t, payload) => postRoom(k.topic, JSON.stringify({ t, d: await sealNote(k.key, { ...payload, ts: Date.now(), from: settings.myId }) }));
let watchES = null, watchMap = {}, answering = false; const seen = new Set();
function stopWatch() { if (watchES) { watchES.close(); watchES = null; } }
async function watchContacts() {
  stopWatch(); if (!KEY) return;
  const cs = contacts.filter(c => c.ps); if (!cs.length) return;
  const map = {}; for (const c of cs) { const k = await ckeys(c); map[k.topic] = { c, k }; }
  watchMap = map;
  const es = new EventSource(RELAY + Object.keys(map).join(',') + '/sse?since=12h'); watchES = es;
  es.onmessage = ev => { try { const j = JSON.parse(ev.data); if (j.event === 'message' && watchMap[j.topic]) onContactNote(watchMap[j.topic], j.message, j.id); } catch {} };
}
async function onContactNote({ c, k }, m, id) {
  if (!KEY || (id && seen.has(id))) return; if (id) seen.add(id);
  try {
    const j = JSON.parse(m), o = await openNote(k.key, j.d);
    if (o.from === settings.myId) return;
    if (j.t === 'm') return onRelayMsg(c, o);
    if (j.t === 'r') return onRelayAck(c, o);
    if (Date.now() - o.ts > 150000) return;
    const busy = attempt && attempt.cid === c.id && attempt.pc && Date.now() - attempt.t < 20000;   // an attempt is already in progress
    if (j.t === 'k') { if (amOfferer(c) && !conn && !pairing && !busy) offerTo(c, k); }
    else if (j.t === 'o') { if (!amOfferer(c) && !conn && !pairing && !(attempt && attempt.oid && attempt.oid === o.oid)) answerTo(c, k, o.sdp, o.oid); }
    else if (j.t === 'a') {
      if (attempt && attempt.cid === c.id && attempt.oid && attempt.oid === o.oid && pc === attempt.pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(await unpack(o.sdp));
    }
  } catch (e) { /* not for us / bad note */ }
}
/* ----- messages left for a friend who is offline: encrypted, held by the relay for about 12 hours ----- */
const gotSet = () => (settings.got = settings.got || []);
const hasGot = id => gotSet().includes(id);
let gotTimer = null;
function markGot(id) { const g = gotSet(); if (g.includes(id)) return; g.push(id); if (g.length > 500) g.splice(0, 100); clearTimeout(gotTimer); gotTimer = setTimeout(() => KEY && saveSettings(), 800); }
async function onRelayMsg(c, o) {
  if (!o.id || hasGot(o.id)) return;
  const ms = await getMsgs(c.id); if (ms.some(m => m.id === o.id)) return;
  markGot(o.id);
  ms.push({ id: o.id, from: 'them', type: 'text', text: String(o.text || '').slice(0, 2000), ts: o.mts || o.ts, re: o.re, relay: true }); ms.sort((a, b) => a.ts - b.ts);
  saveMsgs(c.id); buzz(25);
  if (curChat === c.id) renderMsgs(); else { unread[c.id] = (unread[c.id] || 0) + 1; if (curChat === null) renderList(); }
  try { const k = await ckeys(c); await postNote(k, 'r', { id: o.id }); } catch {}
  try { if (document.hidden && window.Notification && Notification.permission === 'granted') new Notification('SecureChat', { body: 'New message', tag: 'sc-msg', silent: false }); } catch {}
}
async function onRelayAck(c, o) {
  const ms = await getMsgs(c.id), m = ms.find(x => x.id === o.id); if (!m || m.status === 'delivered') return;
  m.status = 'delivered'; saveMsgs(c.id); if (curChat === c.id) updateTick(m.id, 'delivered');
}
async function relayMsg(cid, m) {
  const c = contacts.find(x => x.id === cid); if (!c || !c.ps) return;
  try {
    const k = await ckeys(c); await postNote(k, 'm', { id: m.id, text: m.text, mts: m.ts, re: m.re });
    m.status = 'sent'; m.relay = true; saveMsgs(cid); if (curChat === cid) updateTick(m.id, 'sent');
  } catch {}
}
async function offerTo(c, k) {
  if (conn || pairing) return;
  newPC(); polite = false; const my = pc; const oid = uid();
  dc = pc.createDataChannel('chat'); setupDC(c.id); attempt = { cid: c.id, pc: my, t: Date.now(), oid }; updateStatus();
  try {
    await pc.setLocalDescription(await pc.createOffer()); await gathered(); if (pc !== my) return;
    await postNote(k, 'o', { sdp: await pack(pc.localDescription), oid });
  } catch (e) { console.warn(e); if (pc === my) closePeer(); }
}
async function answerTo(c, k, sdp, oid) {
  answering = true;
  try {
    newPC(); polite = true; const my = pc; attempt = { cid: c.id, pc: my, t: Date.now(), oid }; updateStatus();
    pc.ondatachannel = e => { dc = e.channel; setupDC(c.id); };
    await pc.setRemoteDescription(await unpack(sdp)); await pc.setLocalDescription(await pc.createAnswer()); await gathered();
    if (pc !== my) return; await postNote(k, 'a', { sdp: await pack(pc.localDescription), oid });
  } catch (e) { console.warn(e); } finally { answering = false; }
}
async function reach(cid) {
  const c = contacts.find(x => x.id === cid); if (!c || !c.ps || !KEY || isOn(cid) || pairing) return;
  if (attempt && attempt.cid === cid && attempt.pc && Date.now() - attempt.t < 30000) return;
  try {
    const k = await ckeys(c);
    if (amOfferer(c)) await offerTo(c, k);
    else { attempt = { cid, pc: null, t: Date.now() }; updateStatus(); await postNote(k, 'k', {}); }
  } catch (e) { attempt = null; updateStatus(); toast('Cannot reach the connect server. Check your internet.'); }
}
let lastConn = null;
setInterval(() => { const t = curChat || lastConn; if (KEY && t && (!document.hidden || kaOn) && !isOn(t)) reach(t); }, 15000);

/* ---------- Stay connected in the background ----------
   A web app is normally frozen by the phone soon after you leave it. Playing a silent sound (with the usual media
   notification) tells Android the app is still in use, so the connection and calls keep running. */
let kaEl = null, kaOn = false;
function silentWav() {
  const n = 8000, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, t) => [...t].forEach((c, i) => b[o + i] = c.charCodeAt(0));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + (i & 1);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function keepMeta() {
  try { const ms = navigator.mediaSession; if (!ms || call) return; ms.metadata = new MediaMetadata({ title: 'SecureChat', artist: 'Connected · end-to-end encrypted' }); ms.playbackState = 'playing'; } catch {}
}
function keepAlive() {
  if (!KEY || !UI.bg || !contacts.some(c => c.ps)) return stopKeepAlive();
  if (!kaEl) { kaEl = new Audio(silentWav()); kaEl.loop = true; kaEl.volume = 0.05; kaEl.setAttribute('playsinline', ''); }
  kaEl.play().then(() => { kaOn = true; keepMeta(); }).catch(() => { kaOn = false; });
}
function stopKeepAlive() { kaOn = false; try { kaEl && kaEl.pause(); } catch {} try { if (!call) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch {} }
document.addEventListener('pointerdown', () => { if (KEY && UI.bg && !kaOn) keepAlive(); }, { capture: true });

/* ---------- Chat extras: reply, reactions, emoji ---------- */
let replyTo = null, emojiOpen = false;
(() => {
  const st = document.createElement('style');
  st.textContent = `
  #msgs{overflow-x:hidden}
  .b{touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:transform .45s var(--spring)}
  .b.drag{transition:none}
  .b.hasrx{margin-bottom:14px}
  .b .rpi{position:absolute;left:-42px;top:50%;margin-top:-15px;width:30px;height:30px;border-radius:50%;background:var(--solid);color:var(--a1);display:grid;place-items:center;opacity:0;transform:scale(.4);transition:opacity .2s,transform .35s var(--spring);box-shadow:0 4px 12px rgba(0,0,0,.18);pointer-events:none}
  .b .rpi svg{width:16px;height:16px}
  .b.pull .rpi{opacity:1;transform:scale(1)}
  .b .rq{border-left:3px solid var(--a1);background:rgba(127,127,127,.18);border-radius:8px;padding:5px 9px;margin:0 0 6px;font-size:.82rem;line-height:1.3;cursor:pointer;display:flex;flex-direction:column;gap:1px;max-width:100%}
  .b .rq b{font-size:.76rem;color:var(--a1);font-weight:600}.b.me .rq b{color:#fff}
  .b .rq span{opacity:.85;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}
  .b .rx{position:absolute;bottom:-15px;right:12px;background:var(--solid);color:var(--text);border-radius:999px;padding:1px 7px;font-size:.95rem;line-height:1.5;box-shadow:0 3px 10px rgba(0,0,0,.2);white-space:nowrap}
  .b.them .rx{right:auto;left:12px}
  @keyframes rxpop{0%{transform:scale(.6)}60%{transform:scale(1.06)}100%{transform:none}}
  .b.rxpop .rx{animation:rxpop .5s var(--spring)}
  .b.flash{animation:bflash 1.1s var(--ease)}
  @keyframes bflash{0%,60%{filter:brightness(1.35)}100%{filter:none}}
  #rbar{display:flex;align-items:center;gap:10px;margin:0 12px;padding:0 12px;max-height:0;opacity:0;overflow:hidden;background:var(--solid);border-radius:16px 16px 0 0;transition:max-height .35s var(--sheet),opacity .25s,padding .35s var(--sheet)}
  #rbar.on{max-height:64px;opacity:1;padding:8px 12px}
  #rbar i{width:3px;align-self:stretch;background:var(--a1);border-radius:2px}
  #rbar div{flex:1;min-width:0;font-size:.82rem}#rbar b{display:block;color:var(--a1);font-size:.78rem}
  #rbar span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.8}
  #rbar button{width:30px;height:30px;padding:0;border-radius:50%;background:transparent;box-shadow:none;color:var(--dim);font-size:1.2rem;line-height:1}
  #rmenu{position:fixed;inset:0;z-index:95;background:rgba(10,14,25,.35);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);opacity:0;transition:opacity .25s}
  #rmenu.on{opacity:1}
  #rmenu .b{position:fixed;margin:0;transform:scale(.96);transition:transform .45s var(--spring);box-shadow:0 18px 50px rgba(0,0,0,.35)}
  #rmenu.on .b{transform:scale(1.03)}
  #rmenu .rbr{position:fixed;display:flex;gap:2px;padding:6px 8px;border-radius:999px;background:var(--solid);box-shadow:0 14px 40px rgba(0,0,0,.3);transform:scale(.3);opacity:0;transition:transform .5s var(--spring),opacity .2s;max-width:calc(100vw - 16px);overflow-x:auto}
  #rmenu.on .rbr{transform:none;opacity:1}
  #rmenu .rbr button{font-size:1.65rem;width:44px;height:44px;padding:0;background:none;box-shadow:none;border-radius:50%;transition:transform .25s var(--spring);flex:none}
  #rmenu .rbr button:active{transform:scale(1.35)}
  #rmenu .rbr button.sel{background:rgba(127,127,127,.25)}
  #rmenu .ract{position:fixed;min-width:190px;border-radius:16px;background:var(--solid);box-shadow:0 14px 40px rgba(0,0,0,.3);overflow:hidden;transform:scale(.6);opacity:0;transition:transform .45s var(--spring),opacity .2s}
  #rmenu.on .ract{transform:none;opacity:1}
  #rmenu .ract button{display:flex;align-items:center;justify-content:space-between;width:100%;border-radius:0;background:none;box-shadow:none;padding:13px 16px;font-size:1rem;color:var(--text);text-align:left;border-bottom:1px solid var(--line)}
  #rmenu .ract button:last-child{border:0}#rmenu .ract button.red{color:var(--red)}
  #rmenu .ract svg{width:18px;height:18px}
  #epanel{height:0;overflow:hidden;transition:height .4s var(--sheet);background:var(--solid);border-radius:20px 20px 0 0;display:flex;flex-direction:column;flex:none}
  #epanel.on{height:290px}
  #epanel .tabs{display:flex;gap:2px;padding:8px 10px 4px;align-items:center}
  #epanel .tabs button{font-size:1.25rem;width:38px;height:36px;padding:0;background:none;box-shadow:none;border-radius:10px;opacity:.55}
  #epanel .tabs button.on{opacity:1;background:rgba(127,127,127,.2)}
  #epanel .tabs .sp{flex:1}
  #epanel .tabs button.bk{opacity:.8;color:var(--text)}#epanel .tabs button.bk svg{width:22px;height:22px}
  #epanel .grid{flex:1;overflow-y:auto;overscroll-behavior:contain;display:grid;grid-template-columns:repeat(8,1fr);align-content:start;padding:2px 8px calc(10px + env(safe-area-inset-bottom))}
  #epanel .grid button{font-size:1.7rem;height:44px;padding:0;background:none;box-shadow:none;border-radius:10px;transition:transform .2s var(--spring)}
  #epanel .grid button:active{transform:scale(1.4);background:rgba(127,127,127,.2)}
  #emo{flex:none}`;
  document.head.append(st);

  /* --- emoji panel --- */
  const EMO = {
    '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🫢 🤫 🫠 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 😈 👿 💀 👻 👽 🤖 💩',
    '👍': '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 💪 👏 🙌 🫶 👐 🤲 ✍️ 🤳 💅 👀 👁️ 👅 👄 🧠 🙋 🤷 🤦 🙇 🫵 🫰',
    '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 😻 💋 💯 💢 💥 💫 💦 💨 ✨ 🔥 ⭐ 🌟 🎉 🎊 🎁 🎈 🏆 🎯',
    '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐢 🐍 🐙 🐬 🐳 🦈 🌸 🌹 🌻 🌲 🍀 🌈 ☀️ 🌙 ☁️ ⚡ ❄️ 🌍',
    '🍕': '🍎 🍌 🍇 🍓 🍉 🍑 🍍 🥭 🥑 🍅 🌽 🥕 🍞 🧀 🍳 🥞 🍔 🍟 🍕 🌭 🌮 🍜 🍝 🍣 🍤 🍚 🍰 🎂 🍩 🍪 🍫 🍿 ☕ 🍵 🥤 🍺 🍷',
    '⚽': '⚽ 🏀 🏏 🎮 🎧 🎵 🎶 🎬 📷 📱 💻 ⌚ 💡 📚 ✏️ 🎓 💼 🔑 🔒 🚗 ✈️ 🚀 🏠 ⏰ 💰 🕌 🤲'
  };
  const panel = el('div', { id: 'epanel' }), tabs = el('div', { className: 'tabs' }), grid = el('div', { className: 'grid' });
  const txt = $('#txt');
  const put = e => { const a = txt.selectionStart ?? txt.value.length, b = txt.selectionEnd ?? a; txt.setRangeText(e, a, b, 'end'); txt.dispatchEvent(new Event('input')); };
  const back = () => {
    let a = txt.selectionStart ?? txt.value.length, b = txt.selectionEnd ?? a; if (!txt.value) return;
    if (a === b) { const before = txt.value.slice(0, a), seg = window.Intl && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(before)] : Array.from(before).map(x => ({ segment: x })); const last = seg.length ? seg[seg.length - 1].segment.length : 0; a = Math.max(0, a - last); }
    txt.setRangeText('', a, b, 'end'); txt.dispatchEvent(new Event('input'));
  };
  const showCat = k => { [...tabs.querySelectorAll('button[data-k]')].forEach(x => x.classList.toggle('on', x.dataset.k === k)); grid.innerHTML = ''; grid.scrollTop = 0; EMO[k].split(' ').forEach(e => { const b = el('button', { textContent: e }); b.onclick = () => put(e); grid.append(b); }); };
  Object.keys(EMO).forEach(k => { const b = el('button', { textContent: k }); b.dataset.k = k; b.onclick = () => showCat(k); tabs.append(b); });
  tabs.append(el('span', { className: 'sp' })); const bk = el('button', { className: 'bk', innerHTML: ic('backsp') }); bk.onclick = back; tabs.append(bk);
  panel.append(tabs, grid); $('.composer').after(panel); showCat('😀');
  [panel, tabs, grid].forEach(n => n.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); }));
  const eb = el('button', { className: 'circ', id: 'emo', title: 'Emoji', innerHTML: ic('smile') }); $('#mic').before(eb);
  eb.addEventListener('pointerdown', e => e.preventDefault());
  window.closeEmoji = () => { if (!emojiOpen) return; emojiOpen = false; panel.classList.remove('on'); txt.removeAttribute('inputmode'); eb.innerHTML = ic('smile'); };
  window.openEmoji = () => { emojiOpen = true; panel.classList.add('on'); txt.blur(); txt.setAttribute('inputmode', 'none'); txt.focus({ preventScroll: true }); eb.innerHTML = '<span style="font-size:1.1rem">⌨️</span>'; setTimeout(() => { const m = $('#msgs'); m.scrollTop = m.scrollHeight; }, 420); };
  eb.onclick = () => { if (emojiOpen) { closeEmoji(); txt.blur(); txt.focus(); } else openEmoji(); };
  txt.addEventListener('focus', () => { if (emojiOpen && txt.getAttribute('inputmode') !== 'none') closeEmoji(); });

  /* --- reply bar --- */
  const rbar = el('div', { id: 'rbar' }); $('.composer').before(rbar);
  window.startReply = id => {
    const m = (msgsCache[curChat] || []).find(x => x.id === id); if (!m) return;
    replyTo = m; rbar.innerHTML = '';
    const x = el('button', { textContent: '✕' }); x.onclick = clearReply;
    rbar.append(el('i'), el('div', {}, el('b', { textContent: 'Replying to ' + (m.from === 'me' ? 'yourself' : nameOfChat()) }), el('span', { textContent: snipOf(m) })), x);
    rbar.classList.add('on'); txt.focus({ preventScroll: true }); buzz(10);
  };
  window.clearReply = () => { replyTo = null; rbar.classList.remove('on'); };

  /* --- reaction + action menu --- */
  const REACT = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
  window.closeMsgMenu = () => { const o = $('#rmenu'); if (!o) return; o.classList.remove('on'); setTimeout(() => o.remove(), 260); };
  async function react(m, e) {
    m.rx = m.rx || {}; if (m.rx.me === e) { delete m.rx.me; e = ''; } else m.rx.me = e;
    saveMsgs(curChat); refreshBubble(m.id); sendRaw({ t: 'rx', id: m.id, e }); buzz(15);
  }
  const openMenu = (node, m) => {
    closeMsgMenu(); try { txt.blur(); } catch {}
    const ov = el('div', { id: 'rmenu' }); ov.addEventListener('click', e => { if (e.target === ov) closeMsgMenu(); });
    const r = node.getBoundingClientRect(), W = innerWidth, H = innerHeight, mine = m.from === 'me';
    const cl = node.cloneNode(true); cl.classList.remove('pull', 'drag', 'pop', 'rxpop'); cl.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;max-width:none`; ov.append(cl);
    const bar = el('div', { className: 'rbr' }), act = el('div', { className: 'ract' });
    REACT.forEach(e => { const b = el('button', { textContent: e, className: m.rx && m.rx.me === e ? 'sel' : '' }); b.onclick = () => { closeMsgMenu(); react(m, e); }; bar.append(b); });
    const items = [['Reply', 'reply', () => startReply(m.id)]];
    if (m.text) items.push(['Copy', 'copy', async () => { try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { toast('Cannot copy'); } }]);
    items.push(['Delete', 'trash', () => { if (confirm('Delete this message' + (mine && conn ? ' for everyone?' : '?'))) deleteMsg(m.id, true); }, 'red']);
    items.forEach(([t, i, f, c]) => { const b = el('button', { className: c || '' }); b.append(el('span', { textContent: t })); b.insertAdjacentHTML('beforeend', ic(i)); b.onclick = () => { closeMsgMenu(); f(); }; act.append(b); });
    ov.append(bar, act); document.body.append(ov);
    const bw = bar.offsetWidth, bh = bar.offsetHeight, ah = act.offsetHeight, aw = act.offsetWidth;
    let top = r.top, bt = top - bh - 10, at = r.bottom + 10;
    if (bt < 70) { bt = 70; top = bt + bh + 10; cl.style.top = top + 'px'; at = top + r.height + 10; }
    if (at + ah > H - 10) { const sh = at + ah - (H - 10); top -= sh; bt -= sh; at -= sh; cl.style.top = top + 'px'; if (bt < 8) { bt = 8; } }
    bar.style.top = bt + 'px'; act.style.top = at + 'px';
    const bl = mine ? Math.max(8, Math.min(W - bw - 8, r.right - bw)) : Math.max(8, Math.min(W - bw - 8, r.left));
    const al = mine ? Math.max(8, Math.min(W - aw - 8, r.right - aw)) : Math.max(8, Math.min(W - aw - 8, r.left));
    bar.style.left = bl + 'px'; act.style.left = al + 'px'; bar.style.transformOrigin = (mine ? 'right' : 'left') + ' bottom'; act.style.transformOrigin = (mine ? 'right' : 'left') + ' top';
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('on')));
  };
  window.closeMsgMenu = closeMsgMenu;

  /* --- gestures on bubbles: long-press = menu, swipe right = reply, tap quote = jump --- */
  const box = $('#msgs'); let g = null, lp = null;
  const findB = t => t.closest && t.closest('.b');
  const msgOf = id => (msgsCache[curChat] || []).find(x => x.id === id);
  box.addEventListener('pointerdown', e => {
    const n = findB(e.target); if (!n || (e.pointerType === 'mouse' && e.button > 0)) return;
    g = { n, x: e.clientX, y: e.clientY, id: n.dataset.id, mode: null, fired: false };
    lp = setTimeout(() => { if (g && !g.mode) { g.fired = true; buzz(20); const m = msgOf(g.id); if (m) openMenu(g.n, m); } }, 420);
  });
  box.addEventListener('pointermove', e => {
    if (!g || g.fired) return; const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.mode) {
      if (dx > 10 && dx > Math.abs(dy) * 1.5) { g.mode = 'swipe'; clearTimeout(lp); g.n.classList.add('drag'); }
      else if (Math.abs(dy) > 8 || dx < -10) { g.mode = 'scroll'; clearTimeout(lp); }
    }
    if (g.mode === 'swipe') {
      const d = Math.min(76, dx * .55); g.n.style.transform = `translateX(${d}px)`;
      const pull = d >= 44; if (pull !== g.pull) { g.pull = pull; g.n.classList.toggle('pull', pull); if (pull) buzz(12); }
    }
  });
  const endG = () => {
    clearTimeout(lp); if (!g) return; const s = g; g = null;
    if (s.mode === 'swipe') { s.n.classList.remove('drag'); s.n.style.transform = ''; s.n.classList.remove('pull'); if (s.pull) startReply(s.id); }
  };
  box.addEventListener('pointerup', endG); box.addEventListener('pointercancel', endG);
  box.addEventListener('contextmenu', e => { const n = findB(e.target); if (n) { e.preventDefault(); if (!g || !g.fired) { const m = msgOf(n.dataset.id); if (m) openMenu(n, m); } } });
  box.addEventListener('click', e => {
    const q = e.target.closest && e.target.closest('.rq'); if (!q) return;
    const t = box.querySelector('[data-id="' + q.dataset.to + '"]'); if (!t) return toast('Original message is gone');
    t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  });
})();

/* ---------- sending ---------- */
async function addMsg(partial) {
  const cid = curChat; if (!cid) return;
  const online = isOn(cid);
  const m = Object.assign({ id: uid(), from: 'me', ts: Date.now(), status: online ? 'sent' : 'pending' }, partial);
  const ms = await getMsgs(cid); ms.push(m); saveMsgs(cid); renderMsgs(true);
  if (online) await wire(m);
  else if (m.type === 'text' && (m.text || '').length <= 1800) relayMsg(cid, m);
}
$('#send').onclick = async () => {
  const t = $('#txt').value.trim(); if (!t) return;
  const re = replyTo ? { id: replyTo.id, from: replyTo.from, text: snipOf(replyTo) } : undefined; clearReply();
  $('#txt').value = ''; $('#txt').style.height = ''; $('#txt').focus({ preventScroll: true });   // keep the keyboard open
  await addMsg({ type: 'text', text: t, re });
};
$('#send').addEventListener('pointerdown', e => e.preventDefault());   // tapping send must not steal focus from the text box
$('#txt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); $('#send').click(); } });
$('#txt').addEventListener('input', e => {
  e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
  sendRaw({ t: 'typing' });
});
const toDataURL = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
$('#attach').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 10 * 1024 * 1024) return toast('Max file size is 10 MB');
  await addMsg({ type: f.type.startsWith('image/') ? 'img' : 'file', name: f.name, mime: f.type, data: await toDataURL(f) });
};
let rec = null, recChunks = [];
$('#mic').onclick = async () => {
  if (rec) { rec.stop(); return; }
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(st); recChunks = [];
    rec.ondataavailable = e => recChunks.push(e.data);
    rec.onstop = async () => {
      st.getTracks().forEach(t => t.stop()); $('#mic').innerHTML = ic('mic'); $('#mic').classList.remove('rec');
      const blob = new Blob(recChunks, { type: rec.mimeType }); rec = null;
      if (blob.size > 50) await addMsg({ type: 'voice', mime: blob.type, data: await toDataURL(blob) });
    };
    rec.start(); $('#mic').innerHTML = ic('stop'); $('#mic').classList.add('rec'); toast('Recording… tap again to send');
  } catch { toast('Microphone not available'); }
};

/* ---------- calls ---------- */
let call = null, callTimer = null, ringTimer = null, actx = null, wakeLock = null;
async function getMedia(video, facing = 'user') {
  const st = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: video ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
  st.getVideoTracks().forEach(brightenTrack); return st;
}
/* Ask the camera itself for a brighter picture (only where the phone allows it) */
function brightenTrack(t) {
  try {
    const cap = t.getCapabilities ? t.getCapabilities() : {}, adv = [];
    if (cap.exposureMode && cap.exposureMode.includes('continuous')) adv.push({ exposureMode: 'continuous' });
    if (cap.exposureCompensation && UI.vbright > 1) { const e = cap.exposureCompensation; adv.push({ exposureCompensation: e.min + (e.max - e.min) * (UI.vbright > 1.2 ? 0.8 : 0.65) }); }
    if (adv.length) t.applyConstraints({ advanced: adv }).catch(() => {});
  } catch {}
}
function applyBright() {
  const f = UI.vbright > 1 ? `brightness(${UI.vbright}) contrast(1.05) saturate(1.05)` : '';
  ['#rv', '#lv'].forEach(q => { const e = $(q); if (e) e.style.filter = f; });
  if (call && call.stream) call.stream.getVideoTracks().forEach(brightenTrack);
}
function callUI(show, name) {
  $('#call').classList.toggle('on', show); if (!show) $('#call').classList.remove('mini'); if (!show) document.body.classList.remove('vcall');
  if (name != null) { $('#cn2').textContent = name; paintAv($('#cav2'), name); }
}
const setCallState = t => $('#cs2').textContent = t;
let remoteCam = true;
function updateRemoteView() {
  const rv = $('#rv'), rt = remoteStream && remoteStream.getVideoTracks().find(t => t.readyState === 'live');
  const v = !!rt && remoteCam !== false && (rv.videoWidth > 0 || !rt.muted);
  rv.style.visibility = v ? 'visible' : 'hidden'; $('#cinfo').classList.toggle('hidden', !!v); document.body.classList.toggle('vcall', !!v);
  let dg = $('#cdiag'); if (!dg) { dg = el('div', { id: 'cdiag' }); dg.style.cssText = 'margin-top:8px;font-size:.85rem;opacity:.75'; $('#cinfo').append(dg); }
  dg.textContent = !call || !call.answered ? '' : remoteCam === false ? 'Camera is off' : (rt && !v ? 'Waiting for video…' : '');
}
['loadedmetadata', 'resize', 'playing'].forEach(ev => $('#rv').addEventListener(ev, updateRemoteView));
function sendCam() { const t = call && call.stream && call.stream.getVideoTracks()[0]; sendRaw({ t: 'cam', on: !!(t && t.enabled && t.readyState === 'live') }); }
function callSession(on) {
  try {
    const ms = navigator.mediaSession; if (!ms) return;
    if (!on) { ms.metadata = null; ms.playbackState = 'none'; setTimeout(() => { if (kaOn) keepMeta(); }, 80); return; }
    ms.metadata = new MediaMetadata({ title: 'Call with ' + connName(), artist: 'SecureChat · encrypted' }); ms.playbackState = 'playing';
    for (const [a, f] of [['hangup', () => $('#bEnd').click()], ['togglemicrophone', () => $('#bMute').click()], ['togglecamera', () => $('#bCam').click()]]) { try { ms.setActionHandler(a, f); } catch {} }
  } catch {}
}
function startTimer() {
  callSession(true); const t0 = Date.now(); clearInterval(callTimer);
  callTimer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setCallState(String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')); }, 1000);
}
function ring(on) {
  clearInterval(ringTimer); $('#cinfo').classList.toggle('ringing', !!on); if (!on || !UI.ring) return;
  try {
    actx = actx || new AudioContext();
    const beep = () => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 440; g.gain.value = .08; o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .4); };
    beep(); ringTimer = setInterval(beep, 1500);
  } catch {}
}
const connName = () => (contacts.find(c => conn && c.id === conn.cid) || {}).name || '';
async function attachLocal() {
  if (!call || !call.stream) return;
  call.stream.getTracks().forEach(t => call.senders.push(pc.addTrack(t, call.stream)));
  const hasV = call.stream.getVideoTracks().length > 0;
  $('#lv').srcObject = call.stream; $('#lv').classList.toggle('hidden', !hasV); applyBright();
  $('#bCam').classList.toggle('off', !hasV); $('#bCam').innerHTML = ic(hasV ? 'video' : 'videooff');
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  sendCam();
}
async function startCall(video) {
  if (!conn || call) return;
  try {
    const stream = await getMedia(video);
    call = { video, stream, senders: [], answered: false, incoming: false };
    callUI(true, connName()); $('#cinfo').classList.remove('hidden'); setCallState('Calling…');
    $('#bAcc').classList.add('hidden'); ring(true);
    sendRaw({ t: 'call', video });
    call.wait = setTimeout(() => { if (call && !call.answered) { toast('No answer'); sendRaw({ t: 'end' }); endCallLocal(); } }, 45000);
  } catch { toast('Camera/microphone permission needed'); call = null; }
}
function onIncomingCall(video) {
  if (call) return sendRaw({ t: 'call-no' });
  call = { video, stream: null, senders: [], answered: false, incoming: true };
  callUI(true, connName()); $('#cinfo').classList.remove('hidden'); setCallState('Incoming ' + (video ? 'video' : 'audio') + ' call…');
  $('#bAcc').classList.remove('hidden'); $('#call').classList.add('rin'); ring(true); buzz([220, 120, 220, 120, 220]);
}
$('#bAcc').onclick = async () => {
  if (!call || !call.incoming) return; ring(false); $('#call').classList.remove('rin');
  try {
    call.stream = await getMedia(call.video); call.answered = true;
    $('#bAcc').classList.add('hidden'); sendRaw({ t: 'call-ok' }); await attachLocal(); setCallState('Connected'); startTimer();
  } catch { toast('Permission needed'); sendRaw({ t: 'call-no' }); endCallLocal(); }
};
$('#bEnd').onclick = () => {
  if (!call) return;
  if (call.incoming && !call.answered) sendRaw({ t: 'call-no' }); else sendRaw({ t: 'end' });
  endCallLocal();
};
function endCallLocal() {
  ring(false); clearInterval(callTimer); if (call && call.wait) clearTimeout(call.wait);
  if (call) {
    try { call.senders.forEach(s => pc && pc.signalingState !== 'closed' && pc.removeTrack(s)); } catch {}
    call.stream && call.stream.getTracks().forEach(t => t.stop());
  }
  stopShare(true); $('#bShare').classList.remove('live'); $('#rv').style.objectFit = ''; callSession(false); remoteCam = true; $('#call').classList.remove('rin'); call = null; remoteStream = null; $('#rv').srcObject = null; $('#rv').style.visibility = 'hidden'; $('#lv').srcObject = null; callUI(false);
  try { wakeLock && wakeLock.release(); } catch {} wakeLock = null;
}
$('#bMute').onclick = () => {
  if (!call || !call.stream) return; const t = call.stream.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; $('#bMute').classList.toggle('off', !t.enabled); $('#bMute').innerHTML = ic(t.enabled ? 'mic' : 'micoff');
};
$('#bCam').onclick = async () => {
  if (!call || !call.stream) return;
  let t = call.stream.getVideoTracks()[0];
  if (!t) {
    try {
      const s = await getMedia(true); t = s.getVideoTracks()[0]; s.getAudioTracks().forEach(a => a.stop());
      call.stream.addTrack(t); call.senders.push(pc.addTrack(t, call.stream));
      $('#lv').srcObject = call.stream; $('#lv').classList.remove('hidden'); $('#bCam').classList.remove('off'); $('#bCam').innerHTML = ic('video'); sendCam();
    } catch { toast('Camera not available'); }
    return;
  }
  t.enabled = !t.enabled; $('#bCam').classList.toggle('off', !t.enabled); $('#lv').classList.toggle('hidden', !t.enabled); $('#bCam').innerHTML = ic(t.enabled ? 'video' : 'videooff'); sendCam();
};
/* ---------- Screen sharing (with sound where the browser allows it) ---------- */
(() => {
  const st = document.createElement('style');
  st.textContent = `#cbar{gap:12px}#cbar button{width:56px;height:56px}#call.rin #bShare,#call.mini #bShare{display:none!important}#bShare.live{background:var(--green)!important;color:#fff}`;
  document.head.append(st);
  const b = el('button', { id: 'bShare', title: 'Share screen', innerHTML: ic('screen') }); $('#bEnd').before(b);
  b.onclick = () => (call && call.screen) ? stopShare() : startShare();
})();
async function startShare() {
  if (!call || !call.answered || !pc) return toast('Share your screen after the call is connected');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return toast('This browser cannot share the screen. It works in Chrome on a computer.');
  let ds;
  try { ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true }); } catch { return toast('Screen sharing was cancelled'); }
  const vt = ds.getVideoTracks()[0], at = ds.getAudioTracks()[0], cam = call.stream && call.stream.getVideoTracks()[0];
  const sender = cam && pc.getSenders().find(x => x.track === cam), added = [];
  try {
    if (sender) await sender.replaceTrack(vt); else { const s = pc.addTrack(vt, call.stream); added.push(s); }
    if (at) added.push(pc.addTrack(at, call.stream));
  } catch (e) { ds.getTracks().forEach(t => t.stop()); return toast('Could not start sharing'); }
  call.screen = { vt, at, cam, sender, added }; call.senders.push(...added);
  vt.onended = () => stopShare();
  $('#bShare').classList.add('live'); $('#lv').srcObject = new MediaStream([vt]); $('#lv').style.transform = 'none'; $('#lv').classList.remove('hidden');
  sendRaw({ t: 'share', on: true }); sendRaw({ t: 'cam', on: true });
  toast(at ? 'Sharing your screen with sound' : 'Sharing your screen (no sound)');
}
function stopShare(quiet) {
  const sc = call && call.screen; if (!sc) return; call.screen = null;
  try { if (sc.sender && sc.cam && sc.cam.readyState === 'live') sc.sender.replaceTrack(sc.cam); } catch {}
  sc.added.forEach(s => { try { pc && pc.signalingState !== 'closed' && pc.removeTrack(s); } catch {} call.senders = call.senders.filter(x => x !== s); });
  sc.vt.onended = null; sc.vt.stop(); sc.at && sc.at.stop();
  if (quiet) return;
  $('#bShare').classList.remove('live'); $('#lv').srcObject = call.stream; $('#lv').style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
  const hasCam = !!(sc.cam && sc.cam.enabled && sc.cam.readyState === 'live'); $('#lv').classList.toggle('hidden', !hasCam);
  sendRaw({ t: 'share', on: false }); sendCam();
}
let facing = 'user', flipping = false;
$('#bFlip').onclick = async () => {
  if (!call || !call.stream) return; const old = call.stream.getVideoTracks()[0]; if (!old) return;
  if (flipping) return; flipping = true;
  const prev = facing, next = facing === 'user' ? 'environment' : 'user', was = old.enabled;
  const sender = pc.getSenders().find(x => x.track === old);
  const open = async f => { // most phones can open only one camera at a time, so release the old one first
    const tries = [{ facingMode: { exact: f } }, { facingMode: { ideal: f } }];
    for (const v of tries) { try { return (await navigator.mediaDevices.getUserMedia({ video: { ...v, width: { ideal: 1280 }, height: { ideal: 720 } } })).getVideoTracks()[0]; } catch {} }
    return null;
  };
  try {
    old.stop(); let nt = await open(next), used = next;
    if (!nt) { nt = await open(prev); used = prev; }
    if (!nt) throw new Error('no camera');
    nt.enabled = was; brightenTrack(nt);
    if (sender) await sender.replaceTrack(nt);
    call.stream.removeTrack(old); call.stream.addTrack(nt); facing = used;
    $('#lv').srcObject = null; $('#lv').srcObject = call.stream;
    $('#lv').style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
    if (used === prev) toast('This phone cannot switch camera');
  } catch { toast('Cannot switch camera'); }
  flipping = false;
};
$('#aCall').onclick = () => startCall(false);
$('#vCall').onclick = () => startCall(true);

/* ---------- disappearing messages ---------- */
async function purge() {
  for (const c of contacts) {
    const lim = [c.ttl, settings.keepSec].filter(x => x > 0); if (!lim.length) continue; const ms = await getMsgs(c.id), before = ms.length, cut = Date.now() - Math.min(...lim) * 1000;
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].ts < cut) ms.splice(i, 1);
    if (ms.length !== before) { saveMsgs(c.id); if (curChat === c.id) renderMsgs(); }
  }
}
setInterval(() => { if (KEY) purge(); }, 30000);

/* ---------- Back button / swipe: go back inside the app; ask before leaving ---------- */
(() => {
  const push = () => { try { if (!(history.state && history.state.sc === 1)) history.pushState({ sc: 1 }, ''); } catch {} };
  history.replaceState({ sc: 0 }, ''); push();
  // browsers only keep a history entry that was added after a tap, so top it up on every tap
  addEventListener('pointerdown', push, true); addEventListener('touchstart', push, { capture: true, passive: true });
  let leaving = false;
  addEventListener('popstate', () => {
    if (leaving) return;
    if ($('#call').classList.contains('on')) { if (!$('#call').classList.contains('mini')) minimizeCall(); return push(); }
    if ($('#rmenu')) { closeMsgMenu(); return push(); }
    if ($('#modal').classList.contains('show')) { closeSheet(); return push(); }
    if (emojiOpen) { closeEmoji(); return push(); }
    if (replyTo) { clearReply(); return push(); }
    if (document.body.classList.contains('chat-open')) { showList(); return push(); }
    push();
    openSheet(sh => sh.append(el('h2', { textContent: 'Exit SecureChat?' }),
      el('p', { textContent: 'You will stop receiving calls until you open the app again.' }),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Stay', onclick: closeSheet }),
        el('button', { className: 'danger', textContent: 'Exit', onclick: () => {
          leaving = true; closeSheet(); lockNow && lockNow();
          try { window.close(); } catch {}
          setTimeout(() => history.go(-Math.max(1, history.length - 1)), 50);
        } }))));
  });
})();

/* The keyboard should shrink the page (so the composer sits above it and the call window stays in view), not push it up */
try { const mv = document.querySelector('meta[name=viewport]'); if (mv && !/interactive-widget/.test(mv.content)) mv.content += ',interactive-widget=resizes-content'; } catch {}

/* ---------- boot ---------- */
paintIcons();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if (!window.isSecureContext) { document.body.innerHTML = '<div class="empty">SecureChat needs HTTPS. Open it from your https:// link.</div>'; }
else initLock();
