// auth.js - local account auth (localStorage + SHA-256)
// Note: purely client-side. For learning/solo use; not secure for shared devices.

(function () {
  const USERS_KEY = 'gp_users';
  const SESSION_KEY = 'gp_session';

  // utils
  const enc = new TextEncoder();
  const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));

  function getUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  function setSession(username) { localStorage.setItem(SESSION_KEY, username); }
  function getSession() { return localStorage.getItem(SESSION_KEY); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function generateSalt(len = 16) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return toHex(arr);
  }

  async function hashPassword(password, saltHex) {
    if (!window.crypto?.subtle) {
      // Fallback (weak) if SubtleCrypto isn't available
      return btoa(`${saltHex}:${password}`);
    }
    const saltBytes = fromHex(saltHex);
    const pwBytes = enc.encode(password);
    const full = new Uint8Array(saltBytes.length + pwBytes.length);
    full.set(saltBytes, 0);
    full.set(pwBytes, saltBytes.length);
    const digest = await crypto.subtle.digest('SHA-256', full);
    return toHex(digest);
  }

  async function registerUser(username, password) {
    username = username.trim();
    if (username.length < 3) throw new Error('Username must be at least 3 chars.');
    if (password.length < 8) throw new Error('Password must be at least 8 chars.');

    const users = getUsers();
    if (users[username]) throw new Error('Username already exists.');

    const salt = generateSalt(16);
    const hash = await hashPassword(password, salt);

    users[username] = { salt, hash, createdAt: Date.now() };
    saveUsers(users);
    setSession(username);
    return true;
  }

  async function loginUser(username, password) {
    username = username.trim();
    const users = getUsers();
    const u = users[username];
    if (!u) throw new Error('Invalid username or password.');

    const hash = await hashPassword(password, u.salt);
    if (hash !== u.hash) throw new Error('Invalid username or password.');

    setSession(username);
    return true;
  }

  function logoutUser() { clearSession(); }

  // UI wiring
  function $(sel) { return document.querySelector(sel); }

  function showLogin() {
    $('#tab-login').classList.add('active');
    $('#tab-signup').classList.remove('active');
    $('#login-form').classList.remove('hidden');
    $('#signup-form').classList.add('hidden');
    $('#login-msg').textContent = '';
  }
  function showSignup() {
    $('#tab-signup').classList.add('active');
    $('#tab-login').classList.remove('active');
    $('#signup-form').classList.remove('hidden');
    $('#login-form').classList.add('hidden');
    $('#signup-msg').textContent = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tabLogin = $('#tab-login');
    const tabSignup = $('#tab-signup');
    tabLogin?.addEventListener('click', showLogin);
    tabSignup?.addEventListener('click', showSignup);

    const loginForm = $('#login-form');
    const signupForm = $('#signup-form');
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#login-username').value;
      const password = $('#login-password').value;
      const msg = $('#login-msg');
      msg.classList.remove('error', 'ok');
      msg.textContent = 'Signing in...';
      try {
        await loginUser(username, password);
        msg.classList.add('ok');
        msg.textContent = 'Welcome!';
        // show app
        if (window.showApp) window.showApp(username);
      } catch (err) {
        msg.classList.add('error');
        msg.textContent = err.message || 'Login failed';
      }
    });

    signupForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#signup-username').value;
      const password = $('#signup-password').value;
      const password2 = $('#signup-password2').value;
      const msg = $('#signup-msg');
      msg.classList.remove('error', 'ok');
      if (password !== password2) {
        msg.classList.add('error');
        msg.textContent = 'Passwords do not match.';
        return;
      }
      msg.textContent = 'Creating account...';
      try {
        await registerUser(username, password);
        msg.classList.add('ok');
        msg.textContent = 'Account created. Redirecting...';
        if (window.showApp) window.showApp(username);
      } catch (err) {
        msg.classList.add('error');
        msg.textContent = err.message || 'Sign up failed';
      }
    });

    // Auto-login if session exists
    const sessionUser = getSession();
    if (sessionUser && window.showApp) {
      window.showApp(sessionUser);
    }
  });

  // Expose logout to app.js
  window._auth = { getSession, logoutUser };
})();