/* Offline Privacy Guard + Local Vault (encrypted) + Optional Email Recovery
   - Disables network APIs.
   - Provides local account creation and encrypted vault using Web Crypto.
   - Optional recovery: master password encrypted with a Recovery PIN; can compose a mailto draft.
*/
(() => {
  'use strict';

  // ---------------------------
  // Offline privacy guard
  // ---------------------------
  if (!window.enforceOfflineMode) {
    function block(name) { throw new Error('Network disabled by OfflineMode'); }
    function enforceOfflineMode() {
      try {
        if (typeof window.fetch === 'function') {
          Object.defineProperty(window, 'fetch', { value: function(){ block('fetch'); }, configurable: false, writable: false });
        }
        if (typeof window.XMLHttpRequest !== 'undefined') {
          const XHR = window.XMLHttpRequest;
          if (XHR && XHR.prototype) {
            XHR.prototype.open = function(){ block('XMLHttpRequest.open'); };
            XHR.prototype.send = function(){ block('XMLHttpRequest.send'); };
          }
        }
        if (typeof window.WebSocket !== 'undefined') {
          Object.defineProperty(window, 'WebSocket', { value: function(){ block('WebSocket'); }, configurable: false, writable: false });
        }
        if (typeof window.EventSource !== 'undefined') {
          Object.defineProperty(window, 'EventSource', { value: function(){ block('EventSource'); }, configurable: false, writable: false });
        }
        if (navigator && typeof navigator.sendBeacon === 'function') {
          Object.defineProperty(navigator, 'sendBeacon', { value: function(){ return false; }, configurable: false, writable: false });
        }
        return true;
      } catch { return false; }
    }
    window.enforceOfflineMode = enforceOfflineMode;
  }

  // ---------------------------
  // Local Vault (encrypted)
  // ---------------------------
  if (!window.Vault) {
    const STORE_KEY = 'pwgen.vault';
    const te = new TextEncoder();
    const td = new TextDecoder();
    const DEFAULT_ITER = 200000; // PBKDF2 iterations for master key
    const REC_ITER = 150000;     // PBKDF2 iterations for recovery key

    function getRandomBytes(len) { const b = new Uint8Array(len); crypto.getRandomValues(b); return b; }
    function bufToB64(buf) {
      const bytes = new Uint8Array(buf);
      let s = ''; for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }
    function b64ToBuf(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    function sha256(buf) { return crypto.subtle.digest('SHA-256', buf); }
    function normUser(u) { return String(u || '').trim(); }
    function normEmail(e) { return String(e || '').trim().toLowerCase(); }

    function loadStore() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return { version: 1, accounts: {}, activeUser: null };
        const obj = JSON.parse(raw);
        obj.version ??= 1; obj.accounts ??= {};
        return obj;
      } catch {
        return { version: 1, accounts: {}, activeUser: null };
      }
    }
    function saveStore(store) { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }

    const session = { user: null, keyBytes: null, aesKey: null, vault: null };

    async function derive(password, saltBuf, iterations) {
      const passBytes = te.encode(password);
      const baseKey = await crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']);
      const keyBytes = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' },
        baseKey, 256
      );
      const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']);
      // Best-effort clear
      for (let i = 0; i < passBytes.length; i++) passBytes[i] = 0;
      return { keyBytes, aesKey };
    }

    async function encryptVaultObject(obj, aesKey) {
      const iv = getRandomBytes(12);
      const plaintext = te.encode(JSON.stringify(obj));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
      return { ivB64: bufToB64(iv.buffer), cipherB64: bufToB64(cipher) };
    }
    async function decryptVaultObject(ivB64, cipherB64, aesKey) {
      const iv = new Uint8Array(b64ToBuf(ivB64));
      const cipherBuf = b64ToBuf(cipherB64);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBuf);
      const text = td.decode(plainBuf);
      return JSON.parse(text);
    }

    // Recovery helpers: derive key from PIN + email, with random salt.
    async function deriveRecoveryKey(pin, email, saltBuf, iterations = REC_ITER) {
      const secret = te.encode(`${String(pin)}|${String(email)}`);
      const baseKey = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
      const keyBytes = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' }, baseKey, 256
      );
      const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']);
      // Best-effort clear
      for (let i = 0; i < secret.length; i++) secret[i] = 0;
      return aesKey;
    }

    async function createAccount(username, password, recovery = null) {
      username = normUser(username);
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error('Username must be 3–32 chars: letters, numbers, . _ -');
      if (String(password).length < 8) throw new Error('Master password must be at least 8 characters.');
      const store = loadStore();
      if (store.accounts[username]) throw new Error('Username already exists on this device.');

      const salt = getRandomBytes(16);
      const iterations = DEFAULT_ITER;
      const { keyBytes, aesKey } = await derive(password, salt.buffer, iterations);
      const keyCheckB64 = bufToB64(await sha256(keyBytes));
      const vaultObj = { version: 1, items: [] };
      const enc = await encryptVaultObject(vaultObj, aesKey);

      const acc = {
        saltB64: bufToB64(salt.buffer),
        iterations,
        keyCheckB64,
        vault: enc,
        createdAt: new Date().toISOString()
      };

      // Optional recovery setup
      if (recovery && recovery.email && recovery.pin) {
        const email = normEmail(recovery.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid recovery email.');
        if (String(recovery.pin).length < 6) throw new Error('Recovery PIN too short.');
        const recSalt = getRandomBytes(16);
        const recKey = await deriveRecoveryKey(String(recovery.pin), email, recSalt.buffer);
        const iv = getRandomBytes(12);
        const plain = te.encode(String(password)); // store master password encrypted
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, recKey, plain);
        acc.recovery = {
          email,
          saltB64: bufToB64(recSalt.buffer),
          ivB64: bufToB64(iv.buffer),
          cipherB64: bufToB64(cipher),
          iterations: REC_ITER,
          enabledAt: new Date().toISOString()
        };
      }

      store.accounts[username] = acc;
      store.activeUser = username;
      saveStore(store);

      // Initialize session
      session.user = username;
      session.keyBytes = keyBytes;
      session.aesKey = aesKey;
      session.vault = vaultObj;
      return true;
    }

    async function login(username, password) {
      username = normUser(username);
      const store = loadStore();
      const acc = store.accounts[username];
      if (!acc) throw new Error('Account not found on this device.');
      const { keyBytes, aesKey } = await derive(password, b64ToBuf(acc.saltB64), acc.iterations || DEFAULT_ITER);
      const check = bufToB64(await sha256(keyBytes));
      if (check !== acc.keyCheckB64) throw new Error('Invalid password.');
      const vault = await decryptVaultObject(acc.vault.ivB64, acc.vault.cipherB64, aesKey);

      store.activeUser = username;
      saveStore(store);

      session.user = username;
      session.keyBytes = keyBytes;
      session.aesKey = aesKey;
      session.vault = vault;
      return true;
    }

    function isLoggedIn() { return !!session.user; }
    function activeUser() { return session.user || null; }

    async function persist() {
      if (!session.user || !session.aesKey || !session.vault) throw new Error('Not signed in');
      const store = loadStore();
      const acc = store.accounts[session.user];
      if (!acc) throw new Error('Account missing');
      acc.vault = await encryptVaultObject(session.vault, session.aesKey);
      store.accounts[session.user] = acc;
      saveStore(store);
      return true;
    }

    function listItems() {
      if (!session.vault) return [];
      return [...session.vault.items].sort((a,b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    }

    function randomId() {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      let b64 = btoa(String.fromCharCode(...a));
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, '');
    }

    async function addItem({ label, username, password, notes }) {
      if (!session.vault) throw new Error('Not signed in');
      const item = {
        id: randomId(),
        label: String(label || '').trim() || 'Untitled',
        username: String(username || '').trim(),
        password: String(password || ''),
        notes: String(notes || ''),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      session.vault.items.push(item);
      await persist();
      return item.id;
    }

    async function deleteItem(id) {
      if (!session.vault) throw new Error('Not signed in');
      const idx = session.vault.items.findIndex(i => i.id === id);
      if (idx >= 0) { session.vault.items.splice(idx, 1); await persist(); return true; }
      return false;
    }

    async function updateItem(id, patch) {
      if (!session.vault) throw new Error('Not signed in');
      const item = session.vault.items.find(i => i.id === id);
      if (!item) throw new Error('Item not found');
      Object.assign(item, patch);
      item.updatedAt = Date.now();
      await persist();
      return true;
    }

    function getItem(id) {
      if (!session.vault) return null;
      return session.vault.items.find(i => i.id === id) || null;
    }

    function logout() {
      const store = loadStore();
      store.activeUser = null;
      saveStore(store);
      session.user = null;
      if (session.keyBytes) { new Uint8Array(session.keyBytes).fill(0); session.keyBytes = null; }
      session.aesKey = null;
      session.vault = null;
      return true;
    }

    function getKnownUsers() {
      const store = loadStore();
      return Object.keys(store.accounts || {});
    }
    function getLastActiveUser() {
      const store = loadStore();
      return store.activeUser || null;
    }

    function hasRecovery(username) {
      const store = loadStore();
      const acc = store.accounts[normUser(username)];
      return !!(acc && acc.recovery && acc.recovery.email);
    }
    function getRecoveryEmail(username) {
      const store = loadStore();
      const acc = store.accounts[normUser(username)];
      return acc && acc.recovery ? acc.recovery.email : null;
    }

    async function recoverMasterPassword(username, pin) {
      username = normUser(username);
      const store = loadStore();
      const acc = store.accounts[username];
      if (!acc || !acc.recovery) throw new Error('Recovery is not enabled for this account.');
      const email = acc.recovery.email;
      const saltBuf = b64ToBuf(acc.recovery.saltB64);
      const iv = new Uint8Array(b64ToBuf(acc.recovery.ivB64));
      const cipherBuf = b64ToBuf(acc.recovery.cipherB64);
      const key = await deriveRecoveryKey(String(pin), email, saltBuf, acc.recovery.iterations || REC_ITER);
      try {
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
        const masterPassword = td.decode(plainBuf);
        return { email, password: masterPassword };
      } catch {
        throw new Error('Invalid Recovery PIN.');
      }
    }

    window.Vault = {
      createAccount, login, logout, isLoggedIn, activeUser,
      listItems, addItem, deleteItem, updateItem, getItem,
      getKnownUsers, getLastActiveUser,
      hasRecovery, getRecoveryEmail, recoverMasterPassword
    };
  }
})();