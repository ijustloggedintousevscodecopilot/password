/* Password Generator + Theme + Local Account & Vault + Email Recovery (opt-in)
   All client-side, no network calls. Uses crypto.getRandomValues and Web Crypto.
*/
(() => {
  'use strict';

  // Utilities
  const $ = sel => document.querySelector(sel);
  const statusEl = $('#status');
  const pwEl = $('#password');
  const copyBtn = $('#copyBtn');
  const regenBtn = $('#regenBtn');
  const toggleBtn = $('#toggleVisibility');
  const lengthRange = $('#length');
  const lengthNumber = $('#lengthNumber');
  const useLower = $('#useLower');
  const useUpper = $('#useUpper');
  const useNumbers = $('#useNumbers');
  const useSymbols = $('#useSymbols');
  const excludeSimilar = $('#excludeSimilar');
  const excludeAmbiguous = $('#excludeAmbiguous');
  const strengthFill = $('#strengthFill');
  const strengthText = $('#strengthText');
  const entropyText = $('#entropyText');
  const progressBar = document.querySelector('.progress');

  // Theme
  const themeSelect = $('#themeSelect');

  // Auth & Vault UI
  const accountStatus = $('#accountStatus');
  const authForms = $('#authForms');
  const tabs = document.querySelectorAll('.tabs .tab');
  const loginForm = $('#loginForm');
  const loginUser = $('#loginUser');
  const loginPass = $('#loginPass');
  const forgotBtn = $('#forgotBtn');
  const recoverForm = $('#recoverForm');
  const recUsername = $('#recUsername');
  const recPinLogin = $('#recPinLogin');
  const backToLogin = $('#backToLogin');
  const registerForm = $('#registerForm');
  const regUser = $('#regUser');
  const regPass = $('#regPass');
  const regPass2 = $('#regPass2');
  const enableRecovery = $('#enableRecovery');
  const recoveryFields = $('#recoveryFields');
  const recEmail = $('#recEmail');
  const recPin = $('#recPin');
  const recPin2 = $('#recPin2');
  const recoveryWarning = $('#recoveryWarning');
  const vaultUI = $('#vaultUI');
  const signedInUser = $('#signedInUser');
  const signOutBtn = $('#signOutBtn');
  const entryLabel = $('#entryLabel');
  const entryUser = $('#entryUser');
  const saveBtn = $('#saveBtn');
  const saveInlineBtn = $('#saveInlineBtn');
  const searchInput = $('#search');
  const vaultList = $('#vaultList');

  // Enforce offline privacy guard early
  if (typeof window.enforceOfflineMode === 'function') {
    try { window.enforceOfflineMode(); } catch { /* ignore */ }
  }

  // THEME
  function applyTheme(mode) {
    const root = document.documentElement;
    if (!mode || mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    try { localStorage.setItem('pwgen.theme', mode || 'auto'); } catch (_) {}
  }
  function initTheme() {
    let saved = 'auto';
    try { saved = localStorage.getItem('pwgen.theme') || 'auto'; } catch (_) {}
    if (themeSelect) themeSelect.value = saved;
    applyTheme(saved);
  }
  if (themeSelect) themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  initTheme();

  // Character sets
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NUM = '0123456789';
  const SYM_BASE = `!@#$%^&*()-_=+[]{};:,.<>/?|~\\'"\``;

  const SIMILAR = new Set(['l','I','1','O','0','o']);
  const AMBIGUOUS = new Set(['{','}','[',']','(',')','/','\\','\'','"','`','~',',',';',':','.','<','>']);

  function filterChars(chars, opts) {
    let arr = [...chars];
    if (opts.excludeSimilar) arr = arr.filter(c => !SIMILAR.has(c));
    if (opts.excludeAmbiguous && chars !== LOWER && chars !== UPPER && chars !== NUM) {
      arr = arr.filter(c => !AMBIGUOUS.has(c));
    }
    return arr.join('');
  }

  function buildPools(opts) {
    const pools = [];
    if (opts.useLower) pools.push(filterChars(LOWER, opts));
    if (opts.useUpper) pools.push(filterChars(UPPER, opts));
    if (opts.useNumbers) pools.push(filterChars(NUM, opts));
    if (opts.useSymbols) pools.push(filterChars(SYM_BASE, opts));
    const pool = [...new Set(pools.join(''))].join('');
    return { pools, pool };
  }

  function cryptoRandomInt(max) {
    if (max <= 0 || !Number.isFinite(max)) throw new Error('Invalid max');
    const uint32Max = 0x100000000;
    const limit = Math.floor(uint32Max / max) * max;
    const buf = new Uint32Array(1);
    let r;
    do { crypto.getRandomValues(buf); r = buf[0]; } while (r >= limit);
    return r % max;
  }

  function pickChar(str) {
    const i = cryptoRandomInt(str.length);
    return str[i];
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = cryptoRandomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function ensureMinLengthForSets(len, setCount) {
    return Math.max(len, setCount);
  }

  function generatePassword(opts) {
    const { pools, pool } = buildPools(opts);
    const setCount = pools.filter(s => s.length > 0).length;

    if (setCount === 0) throw new Error('Please select at least one character set.');
    if (pool.length === 0) throw new Error('Your exclusions removed all characters. Loosen exclusions or enable more sets.');

    const length = ensureMinLengthForSets(opts.length, setCount);
    const chars = [];
    for (const group of pools) if (group.length > 0) chars.push(pickChar(group));
    while (chars.length < length) chars.push(pickChar(pool));
    shuffleArray(chars);
    return chars.join('');
  }

  function estimateEntropyBits(len, poolSize) { return (!poolSize || !len) ? 0 : len * Math.log2(poolSize); }
  function classifyStrength(bits) {
    if (bits >= 128) return { label: 'Excellent', color: 'linear-gradient(90deg, #10b981, #22c55e)', score: 100 };
    if (bits >= 80)  return { label: 'Strong',    color: '#10b981', score: Math.min(100, Math.round(bits / 128 * 100)) };
    if (bits >= 45)  return { label: 'Moderate',  color: '#f59e0b', score: Math.min(100, Math.round(bits / 128 * 100)) };
    return                 { label: 'Weak',      color: '#ef4444', score: Math.min(100, Math.round(bits / 128 * 100)) };
  }
  function updateStrengthDisplay(pw, opts) {
    const { pool } = buildPools(opts);
    const bits = estimateEntropyBits(pw.length, pool.length);
    const cls = classifyStrength(bits);
    strengthFill.style.width = `${cls.score}%`;
    strengthFill.style.background = cls.color;
    strengthText.textContent = cls.label;
    entropyText.textContent = `~${Math.round(bits)} bits`;
    progressBar.setAttribute('aria-valuenow', String(cls.score));
  }

  function syncLengthInputs(val) {
    const v = Math.max(8, Math.min(64, Number(val) || 16));
    lengthRange.value = String(v);
    lengthNumber.value = String(v);
    return v;
  }

  function getOptions() {
    return {
      length: syncLengthInputs(lengthRange.value),
      useLower: useLower.checked,
      useUpper: useUpper.checked,
      useNumbers: useNumbers.checked,
      useSymbols: useSymbols.checked,
      excludeSimilar: excludeSimilar.checked,
      excludeAmbiguous: excludeAmbiguous.checked
    };
  }

  function setStatus(msg, type = 'ok') {
    statusEl.textContent = msg || '';
    statusEl.style.color = type === 'ok' ? 'var(--success)' :
                           type === 'warn' ? 'var(--warning)' :
                           'var(--danger)';
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  function generateAndDisplay(auto = false) {
    setStatus('');
    const opts = getOptions();
    try {
      const { pools } = buildPools(opts);
      const required = pools.filter(s => s.length > 0).length;
      if (opts.length < required) {
        const newLen = required;
        syncLengthInputs(newLen);
        opts.length = newLen;
      }
      const pw = generatePassword(opts);
      pwEl.value = pw;
      updateStrengthDisplay(pw, opts);
      if (!auto) setStatus('New password generated.', 'ok');
      copyBtn.disabled = pw.length === 0;
    } catch (err) {
      pwEl.value = '';
      updateStrengthDisplay('', { length: 0, useLower: false });
      setStatus(err.message || 'Could not generate password.', 'error');
      copyBtn.disabled = true;
    }
  }

  // Generator listeners
  lengthRange.addEventListener('input', () => generateAndDisplay(true));
  lengthNumber.addEventListener('input', () => { syncLengthInputs(lengthNumber.value); generateAndDisplay(true); });
  [useLower, useUpper, useNumbers, useSymbols, excludeSimilar, excludeAmbiguous].forEach(el => {
    el.addEventListener('change', () => generateAndDisplay(true));
  });
  regenBtn.addEventListener('click', () => generateAndDisplay(false));
  toggleBtn.addEventListener('click', () => {
    const isHidden = pwEl.type === 'password';
    pwEl.type = isHidden ? 'text' : 'password';
    toggleBtn.setAttribute('aria-pressed', String(isHidden));
    toggleBtn.title = isHidden ? 'Hide password' : 'Show password';
  });
  copyBtn.addEventListener('click', async () => {
    if (!pwEl.value) return;
    const ok = await copyToClipboard(pwEl.value);
    setStatus(ok ? 'Copied to clipboard.' : 'Copy failed. Select and copy manually.', ok ? 'ok' : 'error');
  });

  // ------------------------
  // Auth & Vault (local only)
  // ------------------------
  function setAccountStatus(msg, type = 'muted') {
    accountStatus.textContent = msg || '';
    accountStatus.style.color = type === 'error' ? 'var(--danger)' :
                                type === 'ok' ? 'var(--success)' : 'var(--muted)';
  }

  function switchTab(name) {
    tabs.forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    registerForm.classList.toggle('hidden', name !== 'register');
    loginForm.classList.toggle('hidden', name !== 'login');
    recoverForm.classList.add('hidden');
  }
  tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  async function refreshAuthUI() {
    const loggedIn = window.Vault && window.Vault.isLoggedIn();
    if (loggedIn) {
      authForms.classList.add('hidden');
      vaultUI.classList.remove('hidden');
      signedInUser.textContent = window.Vault.activeUser();
      setAccountStatus('Vault unlocked', 'ok');
      saveInlineBtn.hidden = false;
      renderVaultList();
    } else {
      authForms.classList.remove('hidden');
      vaultUI.classList.add('hidden');
      setAccountStatus('Not signed in');
      saveInlineBtn.hidden = true;
      const last = (window.Vault && window.Vault.getLastActiveUser && window.Vault.getLastActiveUser()) || '';
      if (last) loginUser.value = last;
    }
  }

  function maskPassword(pw) {
    const n = Math.max(6, Math.min(12, pw.length));
    return '•'.repeat(n);
  }
  function formatDate(ts) { try { return new Date(ts).toLocaleString(); } catch { return ''; } }

  function renderVaultList() {
    if (!window.Vault || !window.Vault.isLoggedIn()) return;
    const q = (searchInput.value || '').toLowerCase();
    const items = (window.Vault.listItems() || []).filter(it => {
      const hay = `${it.label} ${it.username}`.toLowerCase();
      return hay.includes(q);
    });
    vaultList.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li'); li.dataset.id = it.id;
      const left = document.createElement('div');
      const title = document.createElement('div'); title.className = 'title'; title.textContent = it.label || 'Untitled';
      const sub = document.createElement('div'); sub.className = 'sub';
      sub.textContent = [it.username || '', `updated ${formatDate(it.updatedAt || it.createdAt)}`].filter(Boolean).join(' • ');
      const pw = document.createElement('div'); pw.className = 'pw'; pw.textContent = maskPassword(it.password); pw.dataset.revealed = 'false';
      left.appendChild(title); left.appendChild(sub); left.appendChild(pw);

      const right = document.createElement('div'); right.className = 'btn-group';
      const copy = document.createElement('button'); copy.className = 'btn sm primary'; copy.textContent = 'Copy'; copy.setAttribute('data-act', 'copy');
      const toggle = document.createElement('button'); toggle.className = 'btn sm secondary'; toggle.textContent = 'Show'; toggle.setAttribute('data-act', 'reveal');
      const del = document.createElement('button'); del.className = 'btn sm'; del.textContent = 'Delete'; del.setAttribute('data-act', 'delete');
      right.appendChild(copy); right.appendChild(toggle); right.appendChild(del);

      li.appendChild(left); li.appendChild(right);
      vaultList.appendChild(li);
    }
  }

  vaultList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const li = btn.closest('li'); if (!li) return;
    const id = li.dataset.id; const act = btn.getAttribute('data-act');
    const item = window.Vault.getItem(id); if (!item) return;
    if (act === 'copy') {
      const ok = await copyToClipboard(item.password || '');
      setAccountStatus(ok ? `Password copied for "${item.label}"` : 'Copy failed', ok ? 'ok' : 'error');
    } else if (act === 'reveal') {
      const pwDiv = li.querySelector('.pw');
      const isShown = pwDiv.dataset.revealed === 'true';
      pwDiv.textContent = isShown ? maskPassword(item.password) : (item.password || '');
      pwDiv.dataset.revealed = String(!isShown);
      btn.textContent = isShown ? 'Show' : 'Hide';
    } else if (act === 'delete') {
      const confirmDel = confirm(`Delete "${item.label}" from your vault?`);
      if (confirmDel) { await window.Vault.deleteItem(id); renderVaultList(); setAccountStatus('Deleted entry', 'ok'); }
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.Vault.login(loginUser.value, loginPass.value);
      loginPass.value = '';
      await refreshAuthUI();
    } catch (err) {
      setAccountStatus(err.message || 'Sign-in failed', 'error');
    }
  });

  // Forgot password -> show recovery form
  forgotBtn.addEventListener('click', () => {
    recUsername.value = (loginUser.value || '').trim();
    recoverForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  });
  backToLogin.addEventListener('click', () => {
    recoverForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  recoverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { email, password } = await window.Vault.recoverMasterPassword(recUsername.value, recPinLogin.value);
      sendRecoveryEmail(email, recUsername.value, password);
      setAccountStatus('Opening your email client with a recovery draft…', 'ok');
      recPinLogin.value = '';
      // Return to login
      recoverForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
    } catch (err) {
      setAccountStatus(err.message || 'Recovery failed', 'error');
    }
  });

  function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')); }

  // Registration
  enableRecovery.addEventListener('change', () => {
    const on = enableRecovery.checked;
    recoveryFields.classList.toggle('hidden', !on);
    recoveryWarning.style.display = on ? 'block' : 'none';
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (regPass.value !== regPass2.value) { setAccountStatus('Passwords do not match', 'error'); return; }

    let recovery = null;
    if (enableRecovery.checked) {
      if (!isValidEmail(recEmail.value)) { setAccountStatus('Enter a valid recovery email.', 'error'); return; }
      if ((recPin.value || '').length < 6) { setAccountStatus('Recovery PIN must be at least 6 characters.', 'error'); return; }
      if (recPin.value !== recPin2.value) { setAccountStatus('Recovery PINs do not match.', 'error'); return; }
      recovery = { email: recEmail.value, pin: recPin.value };
    }

    try {
      await window.Vault.createAccount(regUser.value, regPass.value, recovery);
      regPass.value = ''; regPass2.value = '';
      recPin.value = ''; recPin2.value = '';
      await refreshAuthUI();
    } catch (err) {
      setAccountStatus(err.message || 'Account creation failed', 'error');
    }
  });

  signOutBtn.addEventListener('click', () => { window.Vault.logout(); refreshAuthUI(); });

  async function saveCurrentPassword() {
    if (!window.Vault.isLoggedIn()) return;
    const pw = pwEl.value || '';
    if (!pw) { setAccountStatus('No password to save.', 'error'); return; }
    const label = (entryLabel.value || '').trim() || 'Untitled';
    const user = (entryUser.value || '').trim();
    try {
      await window.Vault.addItem({ label, username: user, password: pw });
      entryLabel.value = ''; entryUser.value = '';
      renderVaultList();
      setAccountStatus('Saved to vault', 'ok');
    } catch (err) {
      setAccountStatus(err.message || 'Save failed', 'error');
    }
  }
  saveBtn.addEventListener('click', saveCurrentPassword);
  saveInlineBtn.addEventListener('click', saveCurrentPassword);
  searchInput.addEventListener('input', renderVaultList);

  function sendRecoveryEmail(to, username, masterPassword) {
    const subject = encodeURIComponent(`Master password recovery for ${username}`);
    const body = encodeURIComponent(
`This email was composed locally by your Password Generator app.

Username: ${username}
Master password: ${masterPassword}

Security note: email is not a secure channel. Consider changing your master password after use.`
    );
    const href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
    // Open default mail client with prefilled draft
    window.location.href = href;
  }

  // Initial generation + auth UI
  generateAndDisplay(true);
  refreshAuthUI();
})();