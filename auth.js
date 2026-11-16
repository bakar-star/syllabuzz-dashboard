/* Syllabuzz accounts + cloud sync (Firebase Auth + Firestore).
   Local first: the app keeps using localStorage; this file mirrors the synced keys to
   users/{uid}/data/{key} and applies changes that arrive from other devices or the dashboard. */
const CFG = window.SB_CONFIG || {};
const FB = CFG.firebase || {};
const VER = '3.1';
const APP = !!window.AndroidBridge;
const SYNC = ['tt', 'tth', 'tta', 'ttsem', 'tas', 'ttl', 'ttk', 'ttf', 'tsh'];
const CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LS = localStorage;
const _set = Storage.prototype.setItem, _rm = Storage.prototype.removeItem;
const lget = k => { try { return LS.getItem(k) } catch (e) { return null } };
const lput = (k, v) => { try { _set.call(LS, k, v) } catch (e) {} };
const ldel = k => { try { _rm.call(LS, k) } catch (e) {} };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const configured = FB.apiKey && !/^YOUR_/.test(FB.apiKey);
let DEV = lget('sb_dev'); if (!DEV) { DEV = Math.random().toString(36).slice(2, 10); lput('sb_dev', DEV) }

let F = null, auth, db, user = null, unsubData = null, unsubProf = null;
let reconciled = false, status = '', pendingName = '', gateMode = false, flushT = null, lastSync = 0;
let dirty = new Set(); try { dirty = new Set(JSON.parse(lget('sb_dirty') || '[]')) } catch (e) {}
let applying = false;
const saveDirty = () => lput('sb_dirty', JSON.stringify([...dirty]));

/* ---- track local writes to the synced keys ---- */
Storage.prototype.setItem = function (k, v) { _set.call(this, k, v); if (this === LS && !applying) mark(k) };
Storage.prototype.removeItem = function (k) { _rm.call(this, k); if (this === LS && !applying) mark(k) };
function mark(k) {
  if (!user || SYNC.indexOf(k) < 0) return;
  dirty.add(k); saveDirty(); clearTimeout(flushT); flushT = setTimeout(flush, 1800);
}

/* ---- UI ---- */
const css = `
#sbAuth{position:fixed;inset:0;z-index:300;background:var(--bg);color:var(--tx);overflow:auto;padding:calc(var(--sat,0px) + 20px) 20px calc(var(--sab,0px) + 20px)}
#sbAuth[hidden]{display:none}
.sbc{max-width:380px;margin:0 auto;padding-top:4vh;position:relative}
.sbc h1{margin:10px 0 2px;font-size:1.5rem;text-align:center}.sbc .sbsub{margin:0 0 18px;text-align:center;color:var(--mut);font-size:.9rem}
.sbc .sbl{display:block;margin:0 auto;width:60px;height:60px}
.sbtabs{display:flex;gap:6px;padding:4px;border-radius:14px;border:1px solid var(--line);margin-bottom:14px}
.sbtabs button{flex:1;background:none;box-shadow:none;color:var(--mut);border:0;-webkit-backdrop-filter:none;backdrop-filter:none}
.sbtabs button.on{background:var(--ac);color:#fff}
.sbc input{width:100%;box-sizing:border-box;font:inherit;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--tx);margin-bottom:10px}
.sbc input:focus{outline:0;border-color:var(--ac)}
.sbc .sbb{width:100%;margin-top:2px}
.sbg{display:flex;align-items:center;justify-content:center;gap:10px}
.sbor{display:flex;align-items:center;gap:10px;color:var(--mut);font-size:.8rem;margin:14px 0}.sbor:before,.sbor:after{content:"";flex:1;height:1px;background:var(--line)}
.sbm{min-height:1.3em;margin:2px 0 8px;font-size:.85rem;color:#ef4444}.sbm.ok{color:#16a34a}
.sblnk{background:none!important;box-shadow:none!important;color:var(--ac)!important;border:0!important;width:100%;padding:8px;font-size:.88rem;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.sbcl{position:absolute;right:0;top:0;width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center}
.sbav{width:56px;height:56px;border-radius:50%;background:var(--ac);color:#fff;display:grid;place-items:center;font-size:1.4rem;font-weight:700;margin:0 auto 8px;overflow:hidden}
.sbav img{width:100%;height:100%;object-fit:cover}
.sbdanger b{color:#ef4444}
`;
const G = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
const LOGO = '<svg class="sbl" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="48" height="48" rx="14" fill="url(#sbg)"/><path d="M24 11c-5.5 0-9 4-9 9.5V27l-2.5 3.5h23L33 27v-6.5C33 15 29.5 11 24 11z" fill="#fff"/><path d="M20.5 34a3.5 3.5 0 007 0z" fill="#fff"/></svg>';

function buildUi() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const a = document.createElement('div'); a.id = 'sbAuth'; a.hidden = true;
  a.innerHTML = '<div class="sbc"><button class="g sbcl" id="sbClose" aria-label="Close">\u2715</button>' + LOGO +
    '<h1>Syllabuzz</h1><p class="sbsub" id="sbSub"></p>' +
    '<div class="sbtabs" role="tablist"><button id="sbTi" class="on">Log in</button><button id="sbTu">Sign up</button></div>' +
    '<button class="g sbb sbg" id="sbG">' + G + '<span id="sbGt">Continue with Google</span></button>' +
    '<div class="sbor">or use email</div>' +
    '<input id="sbName" type="text" placeholder="Your name" autocomplete="name" hidden>' +
    '<input id="sbEm" type="email" placeholder="Email" autocomplete="email" inputmode="email">' +
    '<input id="sbPw" type="password" placeholder="Password" autocomplete="current-password">' +
    '<p class="sbm" id="sbMsg" role="status"></p>' +
    '<button class="sbb" id="sbGo">Log in</button>' +
    '<button class="sblnk" id="sbFg">Forgot password?</button></div>';
  document.body.appendChild(a);
  const u = document.createElement('dialog'); u.id = 'sbUp';
  u.innerHTML = '<div><h2 style="margin:0 0 6px;font-size:1.15rem">Syllabuzz now has accounts</h2>' +
    '<p style="color:var(--mut);font-size:.9rem;margin:0 0 6px">Create a free account to back up your timetable, assignments and study cards, and use them on all your devices.</p>' +
    '<p style="color:var(--mut);font-size:.9rem;margin:0">Everything you already have stays put and is uploaded to your new account.</p>' +
    '<div class="act" style="flex-wrap:wrap"><button class="g" id="sbUpL">Later</button><button class="g" id="sbUpI">Log in</button><button id="sbUpS">Create account</button></div></div>';
  document.body.appendChild(u);
  const c = document.createElement('dialog'); c.id = 'sbAc'; document.body.appendChild(c);

  $('sbTi').onclick = () => tab('in'); $('sbTu').onclick = () => tab('up');
  $('sbClose').onclick = () => closeAuth();
  $('sbG').onclick = google; $('sbGo').onclick = submit; $('sbFg').onclick = forgot;
  $('sbPw').onkeydown = $('sbEm').onkeydown = e => { if (e.key === 'Enter') submit() };
  $('sbUpL').onclick = () => u.close();
  $('sbUpI').onclick = () => { u.close(); openAuth('in') };
  $('sbUpS').onclick = () => { u.close(); openAuth('up') };
}
let mode = 'in';
function tab(m) {
  mode = m; $('sbTi').classList.toggle('on', m === 'in'); $('sbTu').classList.toggle('on', m === 'up');
  $('sbName').hidden = m !== 'up'; $('sbGo').textContent = m === 'up' ? 'Create account' : 'Log in';
  $('sbFg').hidden = m === 'up'; $('sbPw').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  $('sbGt').textContent = m === 'up' ? 'Sign up with Google' : 'Continue with Google'; msg('');
}
function msg(t, ok) { const e = $('sbMsg'); e.textContent = t || ''; e.className = 'sbm' + (ok ? ' ok' : '') }
function openAuth(m, gate, note) {
  gateMode = !!gate; tab(m || 'in');
  $('sbClose').hidden = gateMode;
  $('sbSub').textContent = gateMode ? 'Log in or create an account to continue' : 'Back up and sync your timetable';
  if (note) msg(note);
  $('sbAuth').hidden = false;
}
function closeAuth() { if (!gateMode) $('sbAuth').hidden = true }
const ERR = {
  'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'Wrong email or password.',
  'auth/email-already-in-use': 'An account with this email already exists. Try logging in.', 'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/invalid-email': 'That email address does not look right.', 'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/too-many-requests': 'Too many attempts. Wait a bit and try again.', 'auth/user-disabled': 'This account has been disabled.',
  'auth/account-exists-with-different-credential': 'This email is already registered with a password. Log in with your email instead.'
};
const eMsg = e => ERR[e && e.code] || ('Something went wrong' + (e && e.code ? ' (' + e.code + ')' : '') + '.');
function busy(b) { ['sbGo', 'sbG', 'sbFg'].forEach(i => { $(i).disabled = b }) }

/* ---- auth actions ---- */
async function submit() {
  if (!F) return msg('Cannot reach the server. Check your connection.');
  const em = $('sbEm').value.trim(), pw = $('sbPw').value, nm = $('sbName').value.trim();
  if (!em || !pw) return msg('Enter your email and password.');
  if (mode === 'up' && !nm) return msg('Enter your name.');
  busy(true); msg('');
  try {
    if (mode === 'up') {
      pendingName = nm;
      const r = await F.createUserWithEmailAndPassword(auth, em, pw);
      try { await F.updateProfile(r.user, { displayName: nm }) } catch (e) {}
    } else await F.signInWithEmailAndPassword(auth, em, pw);
  } catch (e) { pendingName = ''; msg(eMsg(e)) }
  busy(false);
}
async function forgot() {
  const em = $('sbEm').value.trim();
  if (!em) return msg('Type your email above first.');
  try { await F.sendPasswordResetEmail(auth, em); msg('Password reset email sent. Check your inbox.', true) } catch (e) { msg(eMsg(e)) }
}
async function google() {
  if (!F) return msg('Cannot reach the server. Check your connection.');
  busy(true); msg('');
  try {
    if (APP) {
      const st = Math.random().toString(36).slice(2) + Date.now().toString(36); lput('sb_state', st);
      AndroidBridge.openExternal((CFG.webUrl || '').replace(/\/$/, '') + '/auth-bridge.html?state=' + st);
      msg('Finish signing in with Google in your browser, then come back here.', true);
    } else {
      const p = new F.GoogleAuthProvider();
      try { await F.signInWithPopup(auth, p) }
      catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { await F.signInWithRedirect(auth, p); return }
        if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) { busy(false); return }
        throw e;
      }
    }
  } catch (e) { msg(eMsg(e)) }
  busy(false);
}
/* the Android app calls this after the browser hands the Google token back */
window.onNativeAuth = async function () {
  let r = ''; try { r = AndroidBridge.pendingAuth() } catch (e) {}
  if (!r || !F) return;
  const p = r.split('\n');
  if (!p[1] || p[1] !== lget('sb_state')) { msg('Sign-in could not be verified. Please try again.'); $('sbAuth').hidden = false; return }
  ldel('sb_state'); busy(true);
  try { await F.signInWithCredential(auth, F.GoogleAuthProvider.credential(p[0])) } catch (e) { $('sbAuth').hidden = false; msg(eMsg(e)) }
  busy(false);
};

async function logout() {
  if (!confirm('Log out of Syllabuzz? Your data stays safe in your account and is removed from this device.')) return;
  try {
    await flush();
    await Promise.race([F.waitForPendingWrites(db), new Promise((_, j) => setTimeout(j, 6000))]);
  } catch (e) { if (!confirm('Some changes have not been uploaded yet. Log out anyway and lose them?')) return }
  await wipe(); location.reload();
}
async function wipe() {
  if (unsubData) unsubData(); if (unsubProf) unsubProf(); unsubData = unsubProf = null;
  applying = true; SYNC.forEach(ldel); ['sb_user', 'sb_owner', 'sb_dirty'].forEach(ldel); applying = false;
  dirty = new Set(); user = null; reconciled = false;
  if (APP) { try { AndroidBridge.sync('{}') } catch (e) {} }
  try { await F.signOut(auth) } catch (e) {}
}

/* ---- profile ---- */
async function profile(u) {
  const ref = F.doc(db, 'users', u.uid);
  let snap = null; try { snap = await F.getDoc(ref) } catch (e) {}
  const base = {
    email: u.email || '', photo: u.photoURL || '',
    provider: (u.providerData[0] && u.providerData[0].providerId) || 'password',
    platform: APP ? 'android' : 'web', appVersion: VER, lastSeen: F.serverTimestamp()
  };
  const nm = u.displayName || pendingName || (u.email || '').split('@')[0];
  try {
    if (snap && snap.exists()) { if (!snap.data().name) base.name = nm; await F.setDoc(ref, base, { merge: true }) }
    else await F.setDoc(ref, Object.assign({ name: nm, createdAt: F.serverTimestamp() }, base));
  } catch (e) {}
  pendingName = '';
}

/* ---- sync ---- */
function setStatus(s) { status = s; if (s === 'ok') lastSync = Date.now(); rerender() }
function rerender() { try { if (window.view === 'settings' && !document.querySelector('dialog[open]')) window.render() } catch (e) {} const d = $('sbAc'); if (d && d.open) acctFill() }
async function flush() {
  if (!user || !reconciled) return;
  const keys = [...dirty]; if (!keys.length) return;
  setStatus(navigator.onLine ? 'syncing' : 'offline');
  const sent = {}, b = F.writeBatch(db);
  keys.forEach(k => {
    const v = lget(k), r = F.doc(db, 'users', user.uid, 'data', k); sent[k] = v;
    if (v === null) b.delete(r); else b.set(r, { v, u: F.serverTimestamp(), by: APP ? 'app' : 'web', dev: DEV });
  });
  try {
    await b.commit();
    keys.forEach(k => { if (lget(k) === sent[k]) dirty.delete(k) }); saveDirty(); setStatus('ok');
  } catch (e) { setStatus(navigator.onLine ? 'error' : 'offline') }
}
function startData(u) {
  let first = true;
  unsubData = F.onSnapshot(F.collection(db, 'users', u.uid, 'data'), { includeMetadataChanges: true }, snap => {
    if (first) { if (snap.metadata.fromCache && navigator.onLine) return; first = false; reconcile(u, snap); return }
    const ch = [];
    snap.docChanges().forEach(c => { if (!c.doc.metadata.hasPendingWrites) ch.push(c) });
    if (ch.length) apply(ch);
  }, () => setStatus('error'));
}
function put(k, v) { applying = true; if (v === null) ldel(k); else lput(k, v); applying = false }
function reconcile(u, snap) {
  const cloud = {}; snap.forEach(d => { const x = d.data(); if (typeof x.v === 'string') cloud[d.id] = x.v });
  const cKeys = Object.keys(cloud).filter(k => SYNC.indexOf(k) >= 0);
  const lKeys = SYNC.filter(k => lget(k) !== null);
  const owned = lget('sb_owner') === u.uid;
  let changed = false, useCloud = true;
  if (!owned && cKeys.length && lKeys.length) {
    const differs = lKeys.some(k => cloud[k] !== lget(k)) || cKeys.some(k => lget(k) === null);
    if (differs) useCloud = confirm('This device already has timetable data, and your account has data saved too.\n\nOK: replace this device\u2019s data with your account\u2019s data.\nCancel: upload this device\u2019s data to your account instead.');
  }
  SYNC.forEach(k => {
    const c = cloud[k], l = lget(k);
    if (!owned && !useCloud) { if (l !== null) { if (c !== l) dirty.add(k) } else if (c !== undefined) dirty.add(k) /* removes it from cloud */ ; return }
    if (owned && dirty.has(k)) return;                       /* local edits made while offline win */
    if (c !== undefined) { if (c !== l) { put(k, c); changed = true } }
    else if (l !== null) { if (owned) { put(k, null); changed = true } else dirty.add(k) } /* first sign-in: upload */
  });
  lput('sb_owner', u.uid); saveDirty(); reconciled = true;
  if (dirty.size) flush(); else setStatus('ok');
  if (changed) refresh();
}
function apply(changes) {
  let changed = false;
  changes.forEach(c => {
    const k = c.doc.id; if (SYNC.indexOf(k) < 0 || dirty.has(k)) return;
    const v = c.type === 'removed' ? null : c.doc.data().v;
    if (typeof v !== 'string' && v !== null) return;
    if (v !== lget(k)) { put(k, v); changed = true }
  });
  if (changed) { lastSync = Date.now(); refresh() }
}
let tries = 0;
function refresh() {
  const busyUi = document.querySelector('dialog[open]') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
  if (busyUi && tries++ < 30) return setTimeout(refresh, 4000);
  tries = 0;
  let n = +sessionStorage.getItem('sb_rl') || 0, t = +sessionStorage.getItem('sb_rt') || 0;
  if (Date.now() - t > 15000) n = 0;
  if (n >= 3) return;
  sessionStorage.setItem('sb_rl', n + 1); sessionStorage.setItem('sb_rt', Date.now());
  try { if (window.doSync) window.doSync() } catch (e) {}
  location.reload();
}

/* ---- auth state ---- */
function who() { return window.SBUser }
function signedIn(u) {
  user = u; reconciled = false;
  window.SBUser = { uid: u.uid, email: u.email || '', name: u.displayName || pendingName || (u.email || '').split('@')[0], photo: u.photoURL || '' };
  lput('sb_user', JSON.stringify(window.SBUser)); lput('sb_ever', '1');
  $('sbAuth').hidden = true; gateMode = false; try { $('sbUp').close() } catch (e) {}
  profile(u).then(() => {
    unsubProf = F.onSnapshot(F.doc(db, 'users', u.uid), s => {
      const d = s.exists() ? s.data() : null;
      if (d && d.disabled === true) hardOut('This account has been disabled. Contact support.');
      if (d && d.name && window.SBUser && d.name !== window.SBUser.name) { window.SBUser.name = d.name; rerender() }
    }, () => {});
  });
  startData(u); rerender();
}
async function hardOut(note) { await wipe(); window.SBUser = null; openAuth('in', true, note); rerender() }
function signedOut() {
  window.SBUser = null; user = null;
  const hasData = !!(lget('tt') || lget('tsh') || lget('ttour'));
  const legacy = hasData && !lget('sb_ever');
  if (legacy && !CFG.requireLoginForExisting) { try { $('sbUp').showModal() } catch (e) {} }
  else openAuth('in', true);
  rerender();
}

/* ---- settings + account pieces used by the main page ---- */
window.sbOpen = () => openAuth('in', false);
window.sbBack = () => { const a = $('sbAuth'); if (a && !a.hidden && !gateMode) { a.hidden = true; return true } return false };
window.sbLogout = logout;
window.acctRows = function () {
  if (!configured) return '';
  const u = who();
  if (!u) return '<button class="g sr" onclick="sbOpen()"><span class="si">' + I('user') + '</span><span class="sx"><b>Log in or sign up</b><small>Back up and sync across devices</small></span>' + I('right', 'ch') + '</button>';
  const st = { syncing: 'Syncing\u2026', offline: 'Offline, will sync later', error: 'Sync problem, tap to retry', ok: 'Synced' }[status] || '';
  return '<button class="g sr" onclick="sbAcct()"><span class="si">' + I('user') + '</span><span class="sx"><b>' + esc(u.name || u.email) + '</b><small>' + esc(u.email) + (st ? ' \u00B7 ' + st : '') + '</small></span>' + I('right', 'ch') + '</button>';
};
window.logoutRow = function () {
  if (!configured || !who()) return '';
  return '<button class="g sr" onclick="sbLogout()"><span class="si" style="color:#ef4444">' + I('logout') + '</span><span class="sx"><b style="color:#ef4444">Log out</b><small>Remove this account from this device</small></span></button>';
};
window.sbAcct = () => { acctFill(); $('sbAc').showModal() };
window.sbSyncNow = async () => { if (!user) return; SYNC.forEach(k => dirty.add(k)); saveDirty(); await flush() };
function acctFill() {
  const u = who(), d = $('sbAc'); if (!u) return;
  const t = lastSync ? 'Last synced ' + new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not synced yet this session';
  d.innerHTML = '<div style="text-align:center"><div class="sbav">' + (u.photo ? '<img src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer">' : esc((u.name || u.email || '?').charAt(0).toUpperCase())) + '</div>' +
    '<h2 style="margin:0;font-size:1.1rem">' + esc(u.name) + '</h2><p style="margin:2px 0 10px;color:var(--mut);font-size:.88rem">' + esc(u.email) + '</p>' +
    '<p style="margin:0;color:var(--mut);font-size:.82rem">' + esc(t) + '</p></div>' +
    '<div class="act" style="flex-wrap:wrap;justify-content:center"><button class="g" onclick="sbSyncNow()">Sync now</button><button class="g" onclick="sbAc.close()">Close</button><button onclick="sbAc.close();sbLogout()" style="background:#ef4444">Log out</button></div>';
}

/* ---- boot ---- */
P.logout = '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>';
window.addEventListener('online', () => { if (user && reconciled) { if (!dirty.size) SYNC.length; flush() } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (APP) window.onNativeAuth(); if (user) profile(user) } });
window.addEventListener('focus', () => { if (APP) window.onNativeAuth() });

(async function boot() {
  if (!configured) return;           /* Firebase not set up yet: the app works exactly as before */
  buildUi();
  try {
    const [a, b, c] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    F = Object.assign({}, b, c);
    const app = a.initializeApp(FB);
    auth = b.initializeAuth(app, { persistence: [b.indexedDBLocalPersistence, b.browserLocalPersistence] });
    try { db = c.initializeFirestore(app, { localCache: c.persistentLocalCache() }) } catch (e) { db = c.getFirestore(app) }
  } catch (e) {
    /* SDK could not load (offline on first launch). Let a known user keep working offline. */
    let known = null; try { known = JSON.parse(lget('sb_user') || 'null') } catch (_) {}
    if (known) { window.SBUser = known; rerender(); return }
    openAuth('in', true, 'Cannot reach the server. Connect to the internet to log in.'); return;
  }
  F.onAuthStateChanged(auth, u => { if (u) signedIn(u); else signedOut() });
  F.getRedirectResult(auth).catch(e => { if (e && e.code) { $('sbAuth').hidden = false; msg(eMsg(e)) } });
  if (APP) window.onNativeAuth();
})();
