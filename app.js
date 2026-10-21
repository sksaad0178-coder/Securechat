'use strict';
/* SecureChat — serverless, end-to-end encrypted P2P messenger (WebRTC).
   - Messages/files/voice/calls travel directly between the two devices (DTLS/SRTP encrypted).
   - Chat history is encrypted on this device with AES-GCM using a key derived from your passphrase. */

const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => crypto.randomUUID();

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
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function unseal(buf) {
  const b = new Uint8Array(buf);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, KEY, b.slice(12))));
}

/* ---------- state ---------- */
let contacts = [];                 // {id,name,ttl}
let settings = { name: 'Me', stun: true };
const msgsCache = {};              // cid -> [msg]
let curChat = null;                // contact id open in UI
let conn = null;                   // {cid, safety}
let unread = {};
const incoming = {};
let typingTimer = null;

async function loadAll() {
  contacts = (await kvGet('contacts').then(b => b ? unseal(b) : [])) || [];
  const s = await kvGet('settings').then(b => b ? unseal(b) : null);
  if (s) settings = Object.assign(settings, s);
}
const saveContacts = async () => kvSet('contacts', await seal(contacts));
const saveSettings = async () => kvSet('settings', await seal(settings));
async function getMsgs(cid) {
  if (!msgsCache[cid]) { const b = await kvGet('m:' + cid); msgsCache[cid] = b ? await unseal(b) : []; }
  return msgsCache[cid];
}
const saveTimers = {};
function saveMsgs(cid) {
  clearTimeout(saveTimers[cid]);
  saveTimers[cid] = setTimeout(async () => kvSet('m:' + cid, await seal(msgsCache[cid] || [])), 300);
}

/* ---------- toast ---------- */
function toast(t) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t;
  document.body.append(d); setTimeout(() => d.remove(), 2600);
}

/* ---------- lock screen ---------- */
let failCount = 0, lockTimer = null;
async function initLock() {
  const check = await kvGet('check');
  const first = !check;
  $('#lockHelp').textContent = first
    ? 'Choose a strong passphrase (8+ characters). It encrypts everything stored on this device. There is no recovery if you forget it.'
    : 'Enter your passphrase to unlock.';
  $('#lockBtn').textContent = first ? 'Create' : 'Unlock';
  $('#pin2').classList.toggle('hidden', !first);
  $('#lockBtn').onclick = async () => {
    const p = $('#pin').value, err = $('#lockErr'); err.textContent = '';
    try {
      if (first) {
        if (p.length < 8) return err.textContent = 'Use at least 8 characters.';
        if (p !== $('#pin2').value) return err.textContent = 'Passphrases do not match.';
        const salt = crypto.getRandomValues(new Uint8Array(16));
        localStorage.setItem('sc_salt', btoa(String.fromCharCode(...salt)));
        KEY = await deriveKey(p, salt);
        await kvSet('check', await seal({ ok: 1 }));
      } else {
        if (failCount >= 3) await sleep(Math.min(30000, 2 ** failCount * 1000));
        const salt = Uint8Array.from(atob(localStorage.getItem('sc_salt')), c => c.charCodeAt(0));
        KEY = await deriveKey(p, salt);
        try { await unseal(check); } catch { KEY = null; failCount++; return err.textContent = 'Wrong passphrase.'; }
      }
      failCount = 0; $('#pin').value = $('#pin2').value = '';
      await loadAll();
      $('#lock').classList.add('hidden'); $('#app').classList.remove('hidden');
      showList();
    } catch (e) { err.textContent = 'Error: ' + e.message; }
  };
  $('#pin').onkeydown = $('#pin2').onkeydown = e => { if (e.key === 'Enter') $('#lockBtn').click(); };
}
function lockNow() {
  if (call) return;
  closePeer();
  KEY = null; contacts = []; for (const k in msgsCache) delete msgsCache[k];
  $('#app').classList.add('hidden'); $('#modal').classList.add('hidden'); $('#lock').classList.remove('hidden');
  initLock();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && KEY) lockTimer = setTimeout(lockNow, pc ? 10 * 60000 : 60000);
  else clearTimeout(lockTimer);
});

/* ---------- views ---------- */
const initials = n => (n || '?').trim().slice(0, 1).toUpperCase();
async function showList() {
  curChat = null; $('#vChat').classList.add('hidden'); $('#vList').classList.remove('hidden');
  const box = $('#chats'); box.innerHTML = '';
  if (!contacts.length) { box.innerHTML = '<div class="empty">No chats yet.<br>Tap ＋ to add a contact, then connect by swapping a short code.</div>'; return; }
  for (const c of contacts) {
    const ms = await getMsgs(c.id), last = ms[ms.length - 1];
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = '<div class="av"></div><div class="grow"><div class="n"></div><div class="l"></div></div><span class="badge hidden"></span><span class="dot"></span>';
    r.querySelector('.av').textContent = initials(c.name);
    r.querySelector('.n').textContent = c.name;
    r.querySelector('.l').textContent = last ? (last.type === 'text' ? last.text : '[' + last.type + ']') : 'No messages';
    const b = r.querySelector('.badge'); if (unread[c.id]) { b.textContent = unread[c.id]; b.classList.remove('hidden'); }
    if (conn && conn.cid === c.id) r.querySelector('.dot').classList.add('on');
    r.onclick = () => openChat(c.id);
    box.append(r);
  }
}
async function openChat(cid) {
  curChat = cid; unread[cid] = 0;
  const c = contacts.find(x => x.id === cid);
  $('#vList').classList.add('hidden'); $('#vChat').classList.remove('hidden');
  $('#cname').textContent = c.name; $('#cav').textContent = initials(c.name);
  updateStatus(); await renderMsgs();
}
function updateStatus() {
  if (!curChat) return;
  const on = conn && conn.cid === curChat && dc && dc.readyState === 'open';
  $('#cstat').textContent = on ? 'connected · encrypted' : 'offline — tap ⋮ › Connect';
  $('#aCall').disabled = $('#vCall').disabled = !on;
  $('#aCall').style.opacity = $('#vCall').style.opacity = on ? 1 : .35;
}
const tickOf = s => s === 'delivered' ? '✓✓' : s === 'sent' ? '✓' : s === 'pending' ? '⏳' : '';
function bubble(m) {
  const d = document.createElement('div'); d.className = 'b ' + (m.from === 'me' ? 'me' : 'them');
  if (m.type === 'img') { const i = new Image(); i.src = m.data; d.append(i); }
  else if (m.type === 'voice') { const a = document.createElement('audio'); a.controls = true; a.src = m.data; d.append(a); }
  else if (m.type === 'file') { const a = document.createElement('a'); a.href = m.data; a.download = m.name || 'file'; a.textContent = '📎 ' + (m.name || 'file'); d.append(a); }
  if (m.text) { const p = document.createElement('div'); p.textContent = m.text; d.append(p); }
  const meta = document.createElement('div'); meta.className = 'meta';
  meta.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (m.from === 'me' ? ' ' + tickOf(m.status) : '');
  const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Delete';
  del.onclick = () => { if (confirm('Delete this message' + (m.from === 'me' && conn ? ' for everyone?' : '?'))) deleteMsg(m.id, true); };
  meta.append(del); d.append(meta); return d;
}
async function renderMsgs() {
  if (!curChat) return;
  const box = $('#msgs'), ms = await getMsgs(curChat); box.innerHTML = '';
  for (const m of ms) box.append(bubble(m));
  box.scrollTop = box.scrollHeight;
}
async function deleteMsg(id, remote) {
  const cid = curChat; if (!cid) return;
  const ms = await getMsgs(cid), i = ms.findIndex(m => m.id === id);
  if (i < 0) return; const m = ms[i]; ms.splice(i, 1); saveMsgs(cid); renderMsgs();
  if (remote && m.from === 'me') sendRaw({ t: 'del', id });
}

/* ---------- contacts / settings UI ---------- */
function openSheet(build) {
  const sh = $('#sheet'); sh.innerHTML = ''; build(sh); $('#modal').classList.remove('hidden');
}
const closeSheet = () => { $('#modal').classList.add('hidden'); stopScan(); stopRelay(); };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(); });
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag); Object.assign(e, props);
  kids.forEach(k => e.append(k)); return e;
}
$('#newChat').onclick = () => openSheet(sh => {
  const inp = el('input', { placeholder: 'Contact name' });
  sh.append(el('h2', { textContent: 'New contact' }), el('p', { textContent: 'The name is only stored on your device.' }), inp,
    el('button', { className: 'pri', textContent: 'Add', onclick: async () => {
      const n = inp.value.trim(); if (!n) return;
      const c = { id: uid(), name: n, ttl: 0 }; contacts.push(c); await saveContacts(); closeSheet(); showList(); openChat(c.id);
    } }));
  setTimeout(() => inp.focus(), 50);
});
$('#openSettings').onclick = () => openSheet(sh => {
  const nm = el('input', { value: settings.name, placeholder: 'Your name' });
  const st = el('input', { type: 'checkbox', checked: settings.stun, style: 'width:auto' });
  sh.append(el('h2', { textContent: 'Settings' }),
    el('p', { textContent: 'Your name (shown to the person you connect with)' }), nm,
    el('label', {}, st, document.createTextNode(' Use a public STUN server to connect across the internet (it only learns your IP address, never your content). Turn off to connect only on the same Wi‑Fi.')),
    el('button', { className: 'pri', textContent: 'Save', onclick: async () => {
      settings.name = nm.value.trim() || 'Me'; settings.stun = st.checked; await saveSettings(); closeSheet(); toast('Saved');
    } }),
    el('button', { textContent: '🔒 Lock now', onclick: () => { closeSheet(); lockNow(); } }),
    el('button', { className: 'danger', textContent: 'Erase all data on this device', onclick: async () => {
      if (!confirm('Erase ALL chats, contacts and the passphrase from this device?')) return;
      closePeer(); await kvClear(); localStorage.clear(); location.reload();
    } }));
});
$('#back').onclick = showList;
$('#cMenu').onclick = () => openSheet(sh => {
  const c = contacts.find(x => x.id === curChat);
  const on = conn && conn.cid === curChat && dc && dc.readyState === 'open';
  const ttl = el('select', {}, ...[[0, 'Off'], [3600, '1 hour'], [86400, '24 hours'], [604800, '7 days']].map(([v, t]) => el('option', { value: v, textContent: t, selected: c.ttl === v })));
  ttl.onchange = async () => { c.ttl = +ttl.value; await saveContacts(); sendRaw({ t: 'ttl', v: c.ttl }); purge(); toast('Disappearing messages updated'); };
  sh.append(el('h2', { textContent: c.name }),
    el('button', { className: 'pri', textContent: on ? 'Connected ✓' : 'Connect…', onclick: () => { closeSheet(); if (!on) connectFlow(); } }));
  if (on) sh.append(el('button', { textContent: '🔐 Verify safety code', onclick: showSafety }));
  sh.append(el('p', { textContent: 'Disappearing messages' }), ttl,
    el('button', { textContent: 'Rename', onclick: async () => { const n = prompt('Name', c.name); if (n) { c.name = n.trim(); await saveContacts(); closeSheet(); openChat(c.id); } } }),
    el('button', { className: 'danger', textContent: 'Delete chat', onclick: async () => {
      if (!confirm('Delete this contact and all messages?')) return;
      contacts = contacts.filter(x => x.id !== c.id); await kvDel('m:' + c.id); delete msgsCache[c.id]; await saveContacts(); closeSheet(); showList();
    } }));
});
function showSafety() {
  openSheet(sh => {
    sh.append(el('h2', { textContent: 'Safety code' }),
      el('p', { textContent: 'Read this code to your contact over a voice call or in person. If both screens show the same number, nobody is intercepting your connection.' }),
      el('div', { className: 'safety', textContent: conn ? conn.safety : '—' }),
      el('button', { textContent: 'Close', onclick: closeSheet }));
  });
}

/* ---------- WebRTC core ---------- */
let pc = null, dc = null, polite = false, makingOffer = false, ignoreOffer = false, remoteStream = null;
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pack(d) {
  const s = JSON.stringify({ t: d.type[0], s: d.sdp });
  const cs = new Blob([enc.encode(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'SC1.' + b64u(new Uint8Array(await new Response(cs).arrayBuffer()));
}
async function unpack(text) {
  const m = (text || '').match(/SC1\.[A-Za-z0-9_-]+/); if (!m) throw new Error('That is not a SecureChat code.');
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
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' && !conn) { toast('Could not connect. Try both phones on the same Wi‑Fi, then Start again.'); closePeer(); }
    else if (['failed', 'closed'].includes(pc.connectionState)) peerLost();
    else if (pc.connectionState === 'disconnected') $('#cstat').textContent = 'reconnecting…';
    else updateStatus();
  };
  pc.ontrack = e => {
    remoteStream = e.streams[0] || new MediaStream([e.track]);
    $('#rv').srcObject = remoteStream; updateRemoteView();
    e.track.onmute = e.track.onunmute = e.track.onended = updateRemoteView;
    remoteStream.onremovetrack = updateRemoteView;
  };
  pc.onicecandidate = e => { if (e.candidate && dc && dc.readyState === 'open') sendRaw({ t: 'ice', d: e.candidate }); };
  pc.onnegotiationneeded = null;
  return pc;
}
function armRenegotiation() {
  pc.onnegotiationneeded = async () => {
    try { makingOffer = true; await pc.setLocalDescription(); sendRaw({ t: 'sdp', d: pc.localDescription }); }
    catch (e) { console.warn(e); } finally { makingOffer = false; }
  };
}
function closePeer() {
  try { dc && dc.close(); } catch {} try { pc && pc.close(); } catch {}
  dc = pc = null; conn = null; endCallLocal(); updateStatus();
}
function peerLost() { const was = conn; closePeer(); if (was) { toast('Disconnected'); if (!$('#vList').classList.contains('hidden')) showList(); } }
function setupDC(cid) {
  dc.onopen = async () => {
    armRenegotiation();
    conn = { cid, safety: await safetyCode() };
    sendRaw({ t: 'hi', name: settings.name });
    const c = contacts.find(x => x.id === cid); if (c && c.ttl) sendRaw({ t: 'ttl', v: c.ttl });
    updateStatus(); closeSheet(); toast('Connected — encrypted'); if (!curChat) showList();
    const ms = await getMsgs(cid);
    for (const m of ms.filter(m => m.from === 'me' && m.status === 'pending')) { await wire(m); m.status = 'sent'; }
    saveMsgs(cid); if (curChat === cid) renderMsgs();
  };
  dc.onclose = () => { if (conn) peerLost(); };
  dc.onmessage = e => onWire(JSON.parse(e.data));
  if (dc.readyState === 'open') dc.onopen();
}
const sendRaw = o => { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(o)); };
async function wire(m) {
  const data = m.data || '', CH = 12000, n = Math.ceil(data.length / CH);
  sendRaw({ t: 'msg', id: m.id, type: m.type, text: m.text, name: m.name, mime: m.mime, ts: m.ts, n });
  for (let i = 0; i < n; i++) {
    while (dc.bufferedAmount > 1e6) await sleep(40);
    sendRaw({ t: 'chunk', id: m.id, i, d: data.slice(i * CH, (i + 1) * CH) });
  }
}
async function onWire(o) {
  const cid = conn && conn.cid;
  switch (o.t) {
    case 'hi': break;
    case 'msg': incoming[o.id] = { meta: o, parts: [] }; if (!o.n) finishIncoming(o.id); break;
    case 'chunk': { const x = incoming[o.id]; if (!x) break; x.parts.push(o.d); if (x.parts.length >= x.meta.n) finishIncoming(o.id); break; }
    case 'ack': { const ms = await getMsgs(cid); const m = ms.find(m => m.id === o.id); if (m) { m.status = 'delivered'; saveMsgs(cid); if (curChat === cid) renderMsgs(); } break; }
    case 'typing': if (curChat === cid) { $('#typing').textContent = 'typing…'; clearTimeout(typingTimer); typingTimer = setTimeout(() => $('#typing').textContent = '', 2500); } break;
    case 'del': { const ms = await getMsgs(cid), i = ms.findIndex(m => m.id === o.id); if (i >= 0) { ms.splice(i, 1); saveMsgs(cid); if (curChat === cid) renderMsgs(); } break; }
    case 'ttl': { const c = contacts.find(x => x.id === cid); if (c && c.ttl !== o.v) { c.ttl = o.v; saveContacts(); toast('Disappearing messages: ' + (o.v ? o.v / 3600 + 'h' : 'off')); } break; }
    case 'sdp': await onSdp(o.d); break;
    case 'ice': try { await pc.addIceCandidate(o.d); } catch (e) { if (!ignoreOffer) console.warn(e); } break;
    case 'call': onIncomingCall(o.video); break;
    case 'call-ok': if (call) { call.answered = true; await attachLocal(); setCallState('Connected'); startTimer(); } break;
    case 'call-no': if (call) { toast('Call declined'); endCallLocal(); } break;
    case 'end': if (call) { toast('Call ended'); endCallLocal(); } break;
  }
}
async function finishIncoming(id) {
  const x = incoming[id]; delete incoming[id]; const o = x.meta, cid = conn && conn.cid; if (!cid) return;
  const ms = await getMsgs(cid);
  ms.push({ id: o.id, from: 'them', type: o.type, text: o.text, name: o.name, mime: o.mime, ts: o.ts, data: x.parts.join('') });
  saveMsgs(cid); sendRaw({ t: 'ack', id: o.id });
  if (curChat === cid) { renderMsgs(); $('#typing').textContent = ''; } else { unread[cid] = (unread[cid] || 0) + 1; if (!curChat) showList(); }
}
async function onSdp(d) {
  const collision = d.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
  ignoreOffer = !polite && collision; if (ignoreOffer) return;
  await pc.setRemoteDescription(d);
  if (d.type === 'offer') { await pc.setLocalDescription(); sendRaw({ t: 'sdp', d: pc.localDescription }); }
}

/* ---------- connect flow (swap codes) ---------- */
function codeBlock(code) {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  wrap.append(el('div', { className: 'code', textContent: code }),
    el('div', { className: 'btns' },
      el('button', { textContent: 'Copy', onclick: async () => { await navigator.clipboard.writeText(code); toast('Copied'); } }),
      navigator.share ? el('button', { textContent: 'Share…', onclick: () => navigator.share({ text: code }).catch(() => {}) }) : document.createTextNode('')));
  return wrap;
}
let scanStream = null, scanning = false;
function stopScan() { scanning = false; if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }
async function scanInto(textarea, video) {
  if (!('BarcodeDetector' in window)) return toast('QR scanning is not supported here — paste the code instead');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream; video.classList.remove('hidden'); await video.play();
    const det = new BarcodeDetector({ formats: ['qr_code'] }); scanning = true;
    while (scanning) {
      const r = await det.detect(video).catch(() => []);
      if (r.length && /SC1\./.test(r[0].rawValue)) { textarea.value = r[0].rawValue; stopScan(); video.classList.add('hidden'); toast('Code scanned'); break; }
      await sleep(250);
    }
  } catch { toast('Camera not available'); }
}
function connectFlow() {
  if (!curChat) return;
  const cid = curChat;
  openSheet(sh => {
    sh.append(el('h2', { textContent: 'Connect (easy way)' }),
      el('p', { textContent: 'Both of you open this app. One taps “Create room code” and tells the code to the other (message, call, anything). The other taps “Join with code” and types it. That is all.' }),
      el('button', { className: 'pri', textContent: '1. Create room code', onclick: () => hostEasy(cid) }),
      el('button', { className: 'pri', textContent: '2. Join with code', onclick: () => joinAsk(cid) }),
      el('p', { textContent: 'Problems with the relay? Manual way:' }),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Manual: Start', onclick: () => hostFlow(cid) }),
        el('button', { textContent: 'Manual: Join', onclick: () => joinFlow(cid) })));
  });
}

/* ---------- easy connect: room code via a public relay (ntfy.sh) ----------
   The relay only ever sees an AES-GCM encrypted blob. The key comes from the room code,
   which you tell your contact yourself. Messages and calls never go through the relay. */
const RELAY = 'https://ntfy.sh/';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => { const b = crypto.getRandomValues(new Uint8Array(10)); const t = [...b].map(x => ALPHA[x & 31]).join(''); return t.slice(0, 5) + '-' + t.slice(5); };
const normCode = c => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
async function roomKeys(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('securechat-room-v1'), iterations: 200000, hash: 'SHA-256' }, base, 384));
  const topic = 'sc' + [...bits.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}
async function roomSeal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64u(o);
}
async function roomOpen(key, str) {
  const b = unb64u(str);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
}
let relayES = null, relayTO = null;
function stopRelay() { if (relayES) { relayES.close(); relayES = null; } clearTimeout(relayTO); }
function listenRoom(topic, onmsg) {
  stopRelay();
  const es = new EventSource(RELAY + topic + '/sse?since=all'); relayES = es;
  es.onmessage = ev => { try { const j = JSON.parse(ev.data); if (j.event === 'message') onmsg(j.message); } catch {} };
  relayTO = setTimeout(() => { if (relayES === es) { stopRelay(); setRoomStatus('Room expired. Close and create a new one.'); } }, 10 * 60000);
}
async function postRoom(topic, text) {
  const r = await fetch(RELAY + topic, { method: 'POST', body: text });
  if (!r.ok) throw new Error('Relay error ' + r.status);
}
const setRoomStatus = t => { const e = $('#roomStatus'); if (e) e.textContent = t; };
function showRoomSheet(code) {
  openSheet(sh => {
    const share = 'SecureChat room code: ' + code + '\nOpen: ' + location.origin + location.pathname;
    sh.append(el('h2', { textContent: 'Your room code' }),
      el('div', { style: 'font:700 32px ui-monospace,monospace;letter-spacing:3px;text-align:center;padding:10px;user-select:all', textContent: code }),
      el('p', { textContent: 'Tell this code to your contact. They open SecureChat, add you, tap Connect › “Join with code” and type it. Keep this app open until it says connected.' }),
      el('div', { className: 'btns' },
        el('button', { textContent: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(share); toast('Copied'); } catch { toast('Copy failed'); } } }),
        navigator.share ? el('button', { textContent: 'Share…', onclick: () => navigator.share({ text: share }).catch(() => {}) }) : document.createTextNode('')),
      el('p', { id: 'roomStatus', textContent: 'Preparing…' }));
  });
}
async function hostEasy(cid) {
  const code = genCode(); showRoomSheet(code);
  try {
    const { topic, key } = await roomKeys(code);
    newPC(); polite = false; const myPc = pc;
    dc = pc.createDataChannel('chat'); setupDC(cid);
    await pc.setLocalDescription(await pc.createOffer()); await gathered();
    const sdp = await pack(pc.localDescription);
    await postRoom(topic, JSON.stringify({ t: 'o', d: await roomSeal(key, { sdp, ts: Date.now() }) }));
    setRoomStatus('Waiting for your contact to join…');
    let done = false;
    listenRoom(topic, async m => {
      if (done || pc !== myPc) return;
      try {
        const j = JSON.parse(m); if (j.t !== 'a') return;
        const o = await roomOpen(key, j.d); if (Date.now() - o.ts > 15 * 60000) return;
        done = true; stopRelay(); setRoomStatus('Connecting…');
        await pc.setRemoteDescription(await unpack(o.sdp));
      } catch (e) { console.warn(e); }
    });
  } catch (e) { closePeer(); setRoomStatus('Cannot reach the relay server. Check your internet, or use the manual way.'); }
}
function joinAsk(cid) {
  openSheet(sh => {
    const inp = el('input', { placeholder: 'XXXXX-XXXXX', autocapitalize: 'characters', autocomplete: 'off', style: 'font:700 24px ui-monospace,monospace;text-align:center;letter-spacing:2px;text-transform:uppercase' });
    sh.append(el('h2', { textContent: 'Join with code' }), el('p', { textContent: 'Type the room code your contact gave you.' }), inp,
      el('button', { className: 'pri', textContent: 'Join', onclick: () => joinEasy(cid, inp.value) }));
    setTimeout(() => inp.focus(), 50);
  });
}
async function joinEasy(cid, codeText) {
  if (normCode(codeText).length !== 10) return toast('The code has 10 letters/numbers');
  openSheet(sh => sh.append(el('h2', { textContent: 'Joining…' }), el('p', { id: 'roomStatus', textContent: 'Looking for the room… keep this app open.' })));
  try {
    const { topic, key } = await roomKeys(codeText); let done = false;
    listenRoom(topic, async m => {
      if (done) return;
      try {
        const j = JSON.parse(m); if (j.t !== 'o') return;
        const o = await roomOpen(key, j.d); if (Date.now() - o.ts > 15 * 60000) return;
        done = true; setRoomStatus('Found. Connecting…');
        newPC(); polite = true; pc.ondatachannel = e => { dc = e.channel; setupDC(cid); };
        await pc.setRemoteDescription(await unpack(o.sdp)); await pc.setLocalDescription(await pc.createAnswer()); await gathered();
        await postRoom(topic, JSON.stringify({ t: 'a', d: await roomSeal(key, { sdp: await pack(pc.localDescription), ts: Date.now() }) }));
        stopRelay(); setRoomStatus('Connecting… keep this app open.');
      } catch (e) { setRoomStatus('Problem: ' + (e.message || e) + '. Close and try again.'); }
    });
  } catch (e) { setRoomStatus('Cannot reach the relay server. Check your internet.'); }
}

async function hostFlow(cid) {
  openSheet(sh => sh.append(el('h2', { textContent: 'Preparing invite…' })));
  newPC(); polite = false;
  dc = pc.createDataChannel('chat'); setupDC(cid);
  await pc.setLocalDescription(await pc.createOffer()); await gathered();
  const code = await pack(pc.localDescription);
  openSheet(sh => {
    const ta = el('textarea', { rows: 3, placeholder: 'Paste your contact’s reply code here' });
    const vid = el('video', { id: 'scanv', playsInline: true, muted: true, className: 'hidden' }); vid.id = 'scanv';
    sh.append(el('h2', { textContent: '1. Send this invite' }), codeBlock(code),
      el('h2', { textContent: '2. Enter their reply' }), ta, vid,
      el('div', { className: 'btns' },
        el('button', { className: 'pri', textContent: 'Connect', onclick: async () => {
          try {
            stopScan(); if (!pc) return toast('Session expired. Close this and tap Start again.');
            await pc.setRemoteDescription(await unpack(ta.value)); toast('Connecting… keep this app open');
          } catch (e) { toast(e.message || 'Invalid code'); }
        } })));
  });
}
async function joinFlow(cid) {
  openSheet(sh => {
    const ta = el('textarea', { rows: 3, placeholder: 'Paste the invite code here' });
    const vid = el('video', { playsInline: true, muted: true, className: 'hidden' }); vid.id = 'scanv';
    sh.append(el('h2', { textContent: 'Enter the invite' }), ta, vid,
      el('div', { className: 'btns' },
        el('button', { className: 'pri', textContent: 'Create reply', onclick: async () => {
          try {
            stopScan(); const offer = await unpack(ta.value);
            newPC(); polite = true; pc.ondatachannel = e => { dc = e.channel; setupDC(cid); };
            await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); await gathered();
            const code = await pack(pc.localDescription);
            openSheet(s2 => s2.append(el('h2', { textContent: 'Show this reply to your contact' }),
              el('p', { textContent: 'Copy this code and send it to your contact. Then come BACK to this app and keep it open. It connects automatically when they enter it.' }), codeBlock(code)));
          } catch (e) { toast(e.message || 'Invalid code'); }
        } })));
  });
}

/* ---------- sending ---------- */
async function addMsg(partial) {
  const cid = curChat; if (!cid) return;
  const online = conn && conn.cid === cid && dc && dc.readyState === 'open';
  const m = Object.assign({ id: uid(), from: 'me', ts: Date.now(), status: online ? 'sent' : 'pending' }, partial);
  const ms = await getMsgs(cid); ms.push(m); saveMsgs(cid); renderMsgs();
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
      st.getTracks().forEach(t => t.stop()); $('#mic').textContent = '🎙️';
      const blob = new Blob(recChunks, { type: rec.mimeType }); rec = null;
      if (blob.size > 50) await addMsg({ type: 'voice', mime: blob.type, data: await toDataURL(blob) });
    };
    rec.start(); $('#mic').textContent = '⏹️'; toast('Recording… tap again to send');
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
  $('#call').classList.toggle('hidden', !show);
  if (name != null) { $('#cn2').textContent = name; $('#cav2').textContent = initials(name); }
}
const setCallState = t => $('#cs2').textContent = t;
function updateRemoteView() {
  const v = remoteStream && remoteStream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
  $('#rv').style.visibility = v ? 'visible' : 'hidden'; $('#cinfo').classList.toggle('hidden', !!v);
}
function startTimer() {
  const t0 = Date.now(); clearInterval(callTimer);
  callTimer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setCallState(String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')); }, 1000);
}
function ring(on) {
  clearInterval(ringTimer); if (!on) return;
  try {
    actx = actx || new AudioContext();
    const beep = () => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 440; g.gain.value = .08; o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .4); };
    beep(); ringTimer = setInterval(beep, 1500);
  } catch {}
}
async function attachLocal() {
  if (!call || !call.stream) return;
  call.stream.getTracks().forEach(t => call.senders.push(pc.addTrack(t, call.stream)));
  const hasV = call.stream.getVideoTracks().length > 0;
  $('#lv').srcObject = call.stream; $('#lv').classList.toggle('hidden', !hasV);
  $('#bCam').classList.toggle('off', !hasV);
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
async function startCall(video) {
  if (!conn || call) return;
  try {
    const stream = await getMedia(video);
    call = { video, stream, senders: [], answered: false, incoming: false };
    callUI(true, contacts.find(c => c.id === conn.cid).name); setCallState('Calling…');
    $('#bAcc').classList.add('hidden'); ring(true);
    sendRaw({ t: 'call', video });
    const wait = setTimeout(() => { if (call && !call.answered) { toast('No answer'); sendRaw({ t: 'end' }); endCallLocal(); } }, 45000);
    call.wait = wait;
  } catch { toast('Camera/microphone permission needed'); call = null; }
}
function onIncomingCall(video) {
  if (call) return sendRaw({ t: 'call-no' });
  call = { video, stream: null, senders: [], answered: false, incoming: true };
  callUI(true, contacts.find(c => c.id === conn.cid).name); setCallState('Incoming ' + (video ? 'video' : 'audio') + ' call…');
  $('#bAcc').classList.remove('hidden'); ring(true);
}
$('#bAcc').onclick = async () => {
  if (!call || !call.incoming) return; ring(false);
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
  call = null; remoteStream = null; $('#rv').srcObject = null; $('#lv').srcObject = null; callUI(false);
  try { wakeLock && wakeLock.release(); } catch {} wakeLock = null;
}
$('#bMute').onclick = () => {
  if (!call || !call.stream) return; const t = call.stream.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; $('#bMute').classList.toggle('off', !t.enabled); $('#bMute').textContent = t.enabled ? '🎤' : '🔇';
};
$('#bCam').onclick = async () => {
  if (!call || !call.stream) return;
  let t = call.stream.getVideoTracks()[0];
  if (!t) {
    try {
      const s = await getMedia(true); t = s.getVideoTracks()[0]; s.getAudioTracks().forEach(a => a.stop());
      call.stream.addTrack(t); call.senders.push(pc.addTrack(t, call.stream));
      $('#lv').srcObject = call.stream; $('#lv').classList.remove('hidden'); $('#bCam').classList.remove('off');
    } catch { toast('Camera not available'); }
    return;
  }
  t.enabled = !t.enabled; $('#bCam').classList.toggle('off', !t.enabled); $('#lv').classList.toggle('hidden', !t.enabled);
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if (!window.isSecureContext) { document.body.innerHTML = '<div class="empty">SecureChat needs HTTPS. Open it from your https:// link.</div>'; }
else initLock();
