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
const UI_DEFAULT = { theme: 'auto', accent: 'blue', fs: 16, wall: 'aurora', bubble: 'round', motion: true, ring: true, vib: true };
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
const DEFAULTS = () => ({ name: '', stun: true, noStore: true, lockMin: 5, myId: '' });
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
      await showList(); watchContacts(); handleLinkJoin();
    } catch (e) { err.textContent = 'Error: ' + e.message; }
  };
  $('#pin').onkeydown = $('#pin2').onkeydown = e => { if (e.key === 'Enter') $('#lockBtn').click(); };
}
function lockNow() {
  if (call) return;
  stopWatch(); stopRelay(); closePeer();
  KEY = null; contacts = []; settings = DEFAULTS(); unread = {};
  for (const k in msgsCache) delete msgsCache[k];
  for (const k in ckCache) delete ckCache[k];
  curChat = null; document.body.classList.remove('chat-open');
  $('#app').classList.add('hidden'); $('#modal').classList.remove('show'); $('#lock').classList.remove('hidden');
  initLock();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (KEY && settings.lockMin > 0) lockTimer = setTimeout(lockNow, settings.lockMin * 60000); }
  else { clearTimeout(lockTimer); if (KEY) { watchContacts(); if (curChat && !isOn(curChat)) reach(curChat); } }
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
  curChat = cid; unread[cid] = 0;
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
function bubble(m) {
  const d = document.createElement('div'); d.className = 'b ' + (m.from === 'me' ? 'me' : 'them'); d.dataset.id = m.id;
  if (m.type === 'img') { const i = new Image(); i.src = m.data; d.append(i); }
  else if (m.type === 'voice') { const a = document.createElement('audio'); a.controls = true; a.src = m.data; d.append(a); }
  else if (m.type === 'file') { const a = document.createElement('a'); a.href = m.data; a.download = m.name || 'file'; a.textContent = (m.name || 'file'); d.append(a); }
  if (m.text) { const p = document.createElement('div'); p.textContent = m.text; d.append(p); }
  const meta = document.createElement('div'); meta.className = 'meta';
  const tm = document.createElement('span'); tm.className = 'tm';
  tm.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (m.from === 'me' ? ' ' + tickOf(m.status) : '');
  const del = document.createElement('button'); del.innerHTML = ic('trash'); del.title = 'Delete';
  del.onclick = () => { if (confirm('Delete this message' + (m.from === 'me' && conn ? ' for everyone?' : '?'))) deleteMsg(m.id, true); };
  meta.append(tm, del); d.append(meta); return d;
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
      setRow('Smooth animations', 'Turn off for a plainer, faster feel', toggleCtl(UI.motion, v => { UI.motion = v; saveUI(); }))),
    grpT('Sound and alerts'),
    grp(setRow('Call ringtone', null, toggleCtl(UI.ring, v => { UI.ring = v; saveUI(); })),
      setRow('Vibrate', 'For new messages and calls', toggleCtl(UI.vib, v => { UI.vib = v; saveUI(); buzz(40); }))),
    grpT('Privacy'),
    grp(setRow('Do not save messages', 'Chats stay in memory only and vanish when the app locks or closes.', toggleCtl(settings.noStore, async v => {
        settings.noStore = v; await saveSettings(); if (v) for (const c of contacts) await kvDel('m:' + c.id);
      })),
      setRow('Auto-lock after leaving', null, lm)),
    grpT('Profile'),
    grp(setRow('Your name', 'Friends see this', nm, true)),
    grpT('Connection'),
    grp(setRow('Use a public STUN server', 'Needed to connect over the internet. It only sees your IP address, never your content.', toggleCtl(settings.stun, async v => { settings.stun = v; await saveSettings(); }))),
    el('button', { className: 'pri', textContent: 'Done', onclick: async () => { settings.name = nm.value.trim().slice(0, 40) || settings.name; await saveSettings(); closeSheet(); toast('Saved'); } }),
    el('button', { textContent: 'Back up my friends', onclick: backup }),
    el('button', { textContent: 'Restore from backup', onclick: () => $('#bfile').click() }),
    el('button', { textContent: 'Lock now', onclick: () => { closeSheet(); setTimeout(lockNow, 300); } }),
    el('button', { className: 'danger', textContent: 'Erase everything on this phone', onclick: async () => {
      if (!confirm('Erase ALL friends, chats and your passphrase from this phone?')) return;
      closePeer(); await kvClear(); localStorage.clear(); location.reload();
    } }));
});
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
    const t = setTimeout(res, 5000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
function newPC() {
  closePeer();
  pc = new RTCPeerConnection({ iceServers: settings.stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
  const me = pc;
  pc.onconnectionstatechange = () => {
    if (pc !== me) return;
    if (pc.connectionState === 'failed' && !conn) { toast('Could not connect. Try both phones on the same Wi‑Fi.'); closePeer(); }
    else if (['failed', 'closed'].includes(pc.connectionState)) peerLost();
    else updateStatus();
  };
  pc.ontrack = e => {
    remoteStream = e.streams[0] || new MediaStream([e.track]);
    $('#rv').srcObject = remoteStream; updateRemoteView();
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
    conn = { cid, safety: '…', rnd: b64u(crypto.getRandomValues(new Uint8Array(16))) };
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
  sendRaw({ t: 'msg', id: m.id, type: m.type, text: m.text, name: m.name, mime: m.mime, ts: m.ts, n });
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
  ms.push({ id: o.id, from: 'them', type: o.type, text: o.text, name: o.name, mime: o.mime, ts: o.ts, data: x.parts.join('') });
  saveMsgs(cid); sendRaw({ t: 'ack', id: o.id });
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
  const es = new EventSource(RELAY + Object.keys(map).join(',') + '/sse?since=3m'); watchES = es;
  es.onmessage = ev => { try { const j = JSON.parse(ev.data); if (j.event === 'message' && watchMap[j.topic]) onContactNote(watchMap[j.topic], j.message, j.id); } catch {} };
}
async function onContactNote({ c, k }, m, id) {
  if (!KEY || (id && seen.has(id))) return; if (id) seen.add(id);
  try {
    const j = JSON.parse(m), o = await openNote(k.key, j.d);
    if (o.from === settings.myId || Date.now() - o.ts > 150000) return;
    const busy = attempt && attempt.cid === c.id && attempt.pc && Date.now() - attempt.t < 20000;   // an attempt is already in progress
    if (j.t === 'k') { if (amOfferer(c) && !conn && !pairing && !busy) offerTo(c, k); }
    else if (j.t === 'o') { if (!amOfferer(c) && !conn && !pairing && !(attempt && attempt.oid && attempt.oid === o.oid)) answerTo(c, k, o.sdp, o.oid); }
    else if (j.t === 'a') {
      if (attempt && attempt.cid === c.id && attempt.oid && attempt.oid === o.oid && pc === attempt.pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(await unpack(o.sdp));
    }
  } catch (e) { /* not for us / bad note */ }
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
setInterval(() => { if (KEY && curChat && !document.hidden && !isOn(curChat)) reach(curChat); }, 15000);

/* ---------- sending ---------- */
async function addMsg(partial) {
  const cid = curChat; if (!cid) return;
  const online = isOn(cid);
  const m = Object.assign({ id: uid(), from: 'me', ts: Date.now(), status: online ? 'sent' : 'pending' }, partial);
  const ms = await getMsgs(cid); ms.push(m); saveMsgs(cid); renderMsgs(true);
  if (online) await wire(m);
}
$('#send').onclick = async () => {
  const t = $('#txt').value.trim(); if (!t) return;
  $('#txt').value = ''; $('#txt').style.height = ''; await addMsg({ type: 'text', text: t });
};
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
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: video ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}
function callUI(show, name) {
  $('#call').classList.toggle('on', show); if (!show) document.body.classList.remove('vcall');
  if (name != null) { $('#cn2').textContent = name; paintAv($('#cav2'), name); }
}
const setCallState = t => $('#cs2').textContent = t;
function updateRemoteView() {
  const v = remoteStream && remoteStream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
  $('#rv').style.visibility = v ? 'visible' : 'hidden'; $('#cinfo').classList.toggle('hidden', !!v); document.body.classList.toggle('vcall', !!v);
}
function startTimer() {
  const t0 = Date.now(); clearInterval(callTimer);
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
  $('#lv').srcObject = call.stream; $('#lv').classList.toggle('hidden', !hasV);
  $('#bCam').classList.toggle('off', !hasV); $('#bCam').innerHTML = ic(hasV ? 'video' : 'videooff');
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
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
  $('#call').classList.remove('rin'); call = null; remoteStream = null; $('#rv').srcObject = null; $('#rv').style.visibility = 'hidden'; $('#lv').srcObject = null; callUI(false);
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
      $('#lv').srcObject = call.stream; $('#lv').classList.remove('hidden'); $('#bCam').classList.remove('off'); $('#bCam').innerHTML = ic('video');
    } catch { toast('Camera not available'); }
    return;
  }
  t.enabled = !t.enabled; $('#bCam').classList.toggle('off', !t.enabled); $('#lv').classList.toggle('hidden', !t.enabled); $('#bCam').innerHTML = ic(t.enabled ? 'video' : 'videooff');
};
let facing = 'user';
$('#bFlip').onclick = async () => {
  if (!call || !call.stream) return; const old = call.stream.getVideoTracks()[0]; if (!old) return;
  facing = facing === 'user' ? 'environment' : 'user';
  try {
    const s = await getMedia(true, facing), nt = s.getVideoTracks()[0]; s.getAudioTracks().forEach(a => a.stop());
    const sender = pc.getSenders().find(x => x.track === old); if (sender) await sender.replaceTrack(nt);
    call.stream.removeTrack(old); old.stop(); call.stream.addTrack(nt); $('#lv').srcObject = call.stream;
    $('#lv').style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
  } catch { toast('Cannot switch camera'); }
};
$('#aCall').onclick = () => startCall(false);
$('#vCall').onclick = () => startCall(true);

/* ---------- disappearing messages ---------- */
async function purge() {
  for (const c of contacts) {
    if (!c.ttl) continue; const ms = await getMsgs(c.id), before = ms.length, cut = Date.now() - c.ttl * 1000;
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].ts < cut) ms.splice(i, 1);
    if (ms.length !== before) { saveMsgs(c.id); if (curChat === c.id) renderMsgs(); }
  }
}
setInterval(() => { if (KEY) purge(); }, 30000);

/* ---------- boot ---------- */
paintIcons();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if (!window.isSecureContext) { document.body.innerHTML = '<div class="empty">SecureChat needs HTTPS. Open it from your https:// link.</div>'; }
else initLock();
