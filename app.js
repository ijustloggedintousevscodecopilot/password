// app.js - Sudoku & KenKen generator/solver (client-only)
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

  const App = {
    currentUser: null,
    sudoku: { puzzle: [], solution: [] },
    kenken: { size: 4, cages: [], solution: [], cageByCell: [] },
    activeTab: 'sudoku'
  };

  // Public function called by auth.js
  window.showApp = function(username) {
    App.currentUser = username || (_auth?.getSession?.());
    $('#current-username').textContent = App.currentUser || '';

    $('#auth-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');

    initUIOnce();
    // Generate a starting puzzle if empty
    if (!App.sudoku.puzzle?.length) newSudoku();
  };

  // Logout button
  document.addEventListener('DOMContentLoaded', () => {
    $('#logout-btn')?.addEventListener('click', () => {
      _auth.logoutUser();
      location.reload();
    });
  });

  // One-time UI bindings
  let uiInited = false;
  function initUIOnce(){
    if (uiInited) return;
    uiInited = true;

    // Tabs
    $$('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        App.activeTab = tab;
        $('#panel-sudoku').classList.toggle('hidden', tab !== 'sudoku');
        $('#panel-kenken').classList.toggle('hidden', tab !== 'kenken');
        if (tab === 'kenken' && !App.kenken.cages.length) newKenKen();
      });
    });

    // Sudoku events
    $('#sudoku-new')?.addEventListener('click', newSudoku);
    $('#sudoku-solve')?.addEventListener('click', solveSudokuUI);
    $('#sudoku-check')?.addEventListener('click', checkSudokuUI);
    $('#sudoku-clear')?.addEventListener('click', clearSudokuUI);

    // KenKen events
    $('#kenken-new')?.addEventListener('click', newKenKen);
    $('#kenken-solve')?.addEventListener('click', solveKenKenUI);
    $('#kenken-check')?.addEventListener('click', checkKenKenUI);
    $('#kenken-clear')?.addEventListener('click', clearKenKenUI);
  }

  // ========== SUDOKU ==========
  function newSudoku() {
    const diff = $('#sudoku-diff').value; // easy/medium/hard
    const status = $('#sudoku-status');
    status.textContent = 'Generating...';
    setTimeout(() => {
      const solution = generateFullSudoku();
      const puzzle = carveSudoku(solution, diff);
      App.sudoku = { puzzle, solution };
      renderSudokuBoard(puzzle);
      status.textContent = '';
    }, 10);
  }

  function renderSudokuBoard(board) {
    const grid = $('#sudoku-board');
    grid.innerHTML = '';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r*9 + c;
        const val = board[i] || '';
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        if (r % 3 === 0) cell.classList.add('thick-top');
        if (c % 3 === 0) cell.classList.add('thick-left');
        if (r === 8) cell.classList.add('thick-bottom');
        if (c === 8) cell.classList.add('thick-right');

        const input = document.createElement('input');
        input.inputMode = 'numeric';
        input.maxLength = 1;
        input.pattern = '[1-9]';
        input.dataset.row = r;
        input.dataset.col = c;
        if (val) {
          input.value = String(val);
          input.readOnly = true;
          cell.classList.add('given');
        } else {
          input.placeholder = '';
          input.addEventListener('beforeinput', (e) => {
            if (e.data && !/[1-9]/.test(e.data)) e.preventDefault();
          });
          input.addEventListener('input', () => {
            input.value = input.value.replace(/[^1-9]/g, '').slice(0,1);
            cell.classList.remove('error','conflict');
          });
          input.addEventListener('keydown', (e) => {
            // arrows navigation
            let r = Number(input.dataset.row), c = Number(input.dataset.col);
            const move = (nr, nc) => {
              const tgt = $(`.sudoku-cell input[data-row="${nr}"][data-col="${nc}"]`);
              tgt?.focus();
            };
            if (e.key === 'ArrowUp' && r>0) { e.preventDefault(); move(r-1,c); }
            if (e.key === 'ArrowDown' && r<8) { e.preventDefault(); move(r+1,c); }
            if (e.key === 'ArrowLeft' && c>0) { e.preventDefault(); move(r,c-1); }
            if (e.key === 'ArrowRight' && c<8) { e.preventDefault(); move(r,c+1); }
            if (e.key === 'Backspace') { cell.classList.remove('error','conflict'); }
          });
        }

        cell.appendChild(input);
        grid.appendChild(cell);
      }
    }
  }

  function getSudokuBoardFromUI() {
    const arr = Array(81).fill(0);
    $$('#sudoku-board .sudoku-cell input').forEach(inp => {
      const r = Number(inp.dataset.row), c = Number(inp.dataset.col);
      const val = parseInt(inp.value, 10);
      arr[r*9+c] = (val >= 1 && val <= 9) ? val : 0;
    });
    return arr;
  }

  function clearSudokuUI() {
    $$('#sudoku-board .sudoku-cell').forEach(cell => {
      cell.classList.remove('error', 'conflict');
      const input = $('input', cell);
      if (!input.readOnly) input.value = '';
    });
  }

  function checkSudokuUI() {
    const grid = getSudokuBoardFromUI();
    // Clear flags
    $$('#sudoku-board .sudoku-cell').forEach(cell => cell.classList.remove('error','conflict'));

    // Compare to solution if filled
    let anyError = false;
    grid.forEach((v, i) => {
      if (v === 0) return;
      if (App.sudoku.solution[i] !== v) {
        anyError = true;
        $$('#sudoku-board .sudoku-cell')[i].classList.add('error');
      }
    });

    // Basic conflict check (duplicates in row/col/box)
    for (let r=0; r<9; r++){
      const seen = {};
      for (let c=0; c<9; c++){
        const idx = r*9+c;
        const v = grid[idx];
        if (v && seen[v]) $$('#sudoku-board .sudoku-cell')[idx].classList.add('conflict');
        seen[v] = true;
      }
    }
    for (let c=0; c<9; c++){
      const seen = {};
      for (let r=0; r<9; r++){
        const idx = r*9+c;
        const v = grid[idx];
        if (v && seen[v]) $$('#sudoku-board .sudoku-cell')[idx].classList.add('conflict');
        seen[v] = true;
      }
    }
    const status = $('#sudoku-status');
    if (anyError) status.textContent = 'There are mistakes highlighted in red.';
    else status.textContent = 'Looks good so far!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  }

  function solveSudokuUI() {
    const solved = App.sudoku.solution;
    $$('#sudoku-board .sudoku-cell input').forEach((inp, i) => {
      inp.value = solved[i] ? String(solved[i]) : '';
    });
  }

  // Sudoku generator/solver helpers
  function generateFullSudoku(){
    const board = Array(81).fill(0);
    const rowUsed = Array.from({length:9}, () => Array(10).fill(false));
    const colUsed = Array.from({length:9}, () => Array(10).fill(false));
    const boxUsed = Array.from({length:9}, () => Array(10).fill(false));

    const boxIndex = (r,c) => Math.floor(r/3)*3 + Math.floor(c/3);
    function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }

    function backtrack(pos=0){
      if (pos === 81) return true;
      const r = Math.floor(pos/9), c = pos%9, b = boxIndex(r,c);
      const nums = shuffle([1,2,3,4,5,6,7,8,9]);
      for (const n of nums){
        if (!rowUsed[r][n] && !colUsed[c][n] && !boxUsed[b][n]){
          rowUsed[r][n]=colUsed[c][n]=boxUsed[b][n]=true;
          board[pos]=n;
          if (backtrack(pos+1)) return true;
          rowUsed[r][n]=colUsed[c][n]=boxUsed[b][n]=false;
          board[pos]=0;
        }
      }
      return false;
    }
    backtrack(0);
    return board.slice();
  }

  function carveSudoku(solution, difficulty='medium'){
    const holesByDiff = { easy: 40, medium: 50, hard: 56 }; // number of empty cells
    const holes = holesByDiff[difficulty] ?? 50;
    const puzzle = solution.slice();
    const positions = [...Array(81).keys()];
    // random removal up to target (no uniqueness check for speed)
    shuffle(positions);
    let removed = 0;
    for (const pos of positions){
      if (removed >= holes) break;
      if (puzzle[pos] !== 0){
        puzzle[pos] = 0;
        removed++;
      }
    }
    return puzzle;

    function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
  }

  // ========== KENKEN ==========
  function newKenKen() {
    const size = parseInt($('#kenken-size').value, 10);
    $('#kenken-status').textContent = 'Generating...';
    setTimeout(() => {
      const { solution, cages, cageByCell } = generateKenKen(size);
      App.kenken = { size, solution, cages, cageByCell };
      renderKenKen(size, cages);
      $('#kenken-status').textContent = '';
    }, 10);
  }

  function renderKenKen(n, cages) {
    const board = $('#kenken-board');
    board.innerHTML = '';
    board.style.setProperty('--size', n);
    board.classList.add('kenken-grid');

    // Build cell->cage map
    const cageByCell = Array(n*n).fill(-1);
    for (const cage of cages) {
      for (const idx of cage.cells) cageByCell[idx] = cage.id;
    }

    // Determine border sides for cages
    const hasDiffNeighbor = (i, j, di, dj) => {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) return true; // outer border
      const a = cageByCell[i*n + j];
      const b = cageByCell[ni*n + nj];
      return a !== b;
    };

    const anchors = new Set(cages.map(c => c.anchor));
    for (let r=0; r<n; r++){
      for (let c=0; c<n; c++){
        const idx = r*n + c;
        const cell = document.createElement('div');
        cell.className = 'kenken-cell';
        if (hasDiffNeighbor(r,c,-1,0)) cell.classList.add('b-top');
        if (hasDiffNeighbor(r,c,0,1)) cell.classList.add('b-right');
        if (hasDiffNeighbor(r,c,1,0)) cell.classList.add('b-bottom');
        if (hasDiffNeighbor(r,c,0,-1)) cell.classList.add('b-left');

        const input = document.createElement('input');
        input.inputMode = 'numeric';
        input.maxLength = 1;
        input.dataset.idx = String(idx);
        input.addEventListener('beforeinput', (e) => {
          if (e.data && !/^\d$/.test(e.data)) e.preventDefault();
        });
        input.addEventListener('input', () => {
          const v = input.value.replace(/\D/g,'');
          input.value = v.slice(0, 2); // allow "10" for size 10, but we max at 6 in UI
          cell.classList.remove('error');
        });

        if (anchors.has(idx)) {
          const cage = cages.find(cg => cg.anchor === idx);
          const label = document.createElement('span');
          label.className = 'cage-label';
          label.textContent = `${cage.target}${cage.op || ''}`;
          cell.appendChild(label);
        }

        cell.appendChild(input);
        board.appendChild(cell);
      }
    }
  }

  function clearKenKenUI() {
    $$('#kenken-board .kenken-cell').forEach(cell => {
      cell.classList.remove('error');
      const inp = $('input', cell);
      if (inp) inp.value = '';
    });
  }

  function getKenKenGridFromUI() {
    const n = App.kenken.size;
    const arr = Array(n*n).fill(0);
    $$('#kenken-board .kenken-cell input').forEach(inp => {
      const idx = Number(inp.dataset.idx);
      const val = parseInt(inp.value, 10);
      arr[idx] = (val >= 1 && val <= n) ? val : 0;
    });
    return arr;
  }

  function checkKenKenUI() {
    const n = App.kenken.size;
    const vals = getKenKenGridFromUI();
    $$('#kenken-board .kenken-cell').forEach(c => c.classList.remove('error'));

    // Row/col duplicate checks
    for (let r=0; r<n; r++){
      const seen = {};
      for (let c=0; c<n; c++){
        const idx = r*n+c;
        const v = vals[idx];
        if (!v) continue;
        if (seen[v]) $$('#kenken-board .kenken-cell')[idx].classList.add('error');
        seen[v] = true;
      }
    }
    for (let c=0; c<n; c++){
      const seen = {};
      for (let r=0; r<n; r++){
        const idx = r*n+c;
        const v = vals[idx];
        if (!v) continue;
        if (seen[v]) $$('#kenken-board .kenken-cell')[idx].classList.add('error');
        seen[v] = true;
      }
    }

    // Cage checks
    for (const cage of App.kenken.cages) {
      const nums = cage.cells.map(i => vals[i]).filter(v => v>0);
      const allFilled = nums.length === cage.cells.length;
      if (!nums.length) continue;

      const ok = evaluateCagePartial(cage, nums, allFilled);
      if (!ok) {
        cage.cells.forEach(i => $$('#kenken-board .kenken-cell')[i].classList.add('error'));
      }
    }

    $('#kenken-status').textContent = 'Checked.';
    setTimeout(() => $('#kenken-status').textContent = '', 1500);
  }

  function solveKenKenUI() {
    const n = App.kenken.size;
    const cages = App.kenken.cages;
    const solved = solveKenKen(n, cages);
    if (!solved) {
      $('#kenken-status').textContent = 'No solution found (try regenerating).';
      return;
    }
    $$('#kenken-board .kenken-cell input').forEach((inp, idx) => {
      inp.value = solved[idx];
    });
    $('#kenken-status').textContent = 'Solved!';
    setTimeout(() => $('#kenken-status').textContent = '', 1500);
  }

  function evaluateCagePartial(cage, nums, allFilled){
    const op = cage.op || '';
    const target = cage.target;
    if (op === '' || cage.cells.length === 1) {
      return !allFilled || nums[0] === target;
    }
    if (op === '+') {
      const s = nums.reduce((a,b)=>a+b,0);
      return allFilled ? s === target : s <= target;
    }
    if (op === '*') {
      const p = nums.reduce((a,b)=>a*b,1);
      return allFilled ? p === target : p <= target;
    }
    if (op === '-') {
      if (!allFilled) return true;
      if (nums.length !== 2) return false;
      return Math.abs(nums[0] - nums[1]) === target;
    }
    if (op === '/') {
      if (!allFilled) return true;
      if (nums.length !== 2) return false;
      const [a,b] = nums;
      return (a/b === target && a % b === 0) || (b/a === target && b % a === 0);
    }
    return true;
  }

  // KenKen generator
  function generateKenKen(n){
    const solution = latinSquareRandom(n);
    const cages = buildKenKenCages(n, solution);
    const cageByCell = Array(n*n).fill(-1);
    cages.forEach(c => c.cells.forEach(idx => cageByCell[idx] = c.id));
    return { solution, cages, cageByCell };
  }

  function latinSquareRandom(n) {
    // Base Latin square then randomly permute rows, cols, and symbols
    let grid = Array.from({length:n}, (_, r) => Array.from({length:n}, (_, c) => (r+c)%n + 1));
    const shuffle = a => { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} };

    // permute rows within bands
    for (let k=0;k<3;k++){ const rows=[...Array(n).keys()]; shuffle(rows); grid = rows.map(r => grid[r]); }
    // permute columns
    let cols = [...Array(n).keys()]; shuffle(cols);
    grid = grid.map(row => cols.map(c => row[c]));
    // permute symbols
    const symbols = [...Array(n).keys()].map(i=>i+1); shuffle(symbols);
    grid = grid.map(row => row.map(v => symbols[v-1]));

    // flatten
    return grid.flat();
  }

  function buildKenKenCages(n, solution) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const cells = Array(n*n).fill(0).map((_,i)=>i);
    const unassigned = new Set(cells);
    let id = 0;
    const cages = [];

    function neighbors(idx) {
      const r = Math.floor(idx/n), c = idx % n;
      const list = [];
      if (r>0) list.push(idx-n);
      if (r<n-1) list.push(idx+n);
      if (c>0) list.push(idx-1);
      if (c<n-1) list.push(idx+1);
      return list.filter(j => unassigned.has(j));
    }

    while (unassigned.size > 0) {
      const start = [...unassigned][Math.floor(Math.random()*unassigned.size)];
      const size = chooseCageSize(n);
      const cageCells = [start];
      unassigned.delete(start);

      // grow cage
      while (cageCells.length < size) {
        const frontier = cageCells.flatMap(i => neighbors(i)).filter(j => !cageCells.includes(j));
        if (!frontier.length) break;
        const pick = frontier[Math.floor(Math.random()*frontier.length)];
        cageCells.push(pick);
        unassigned.delete(pick);
      }

      const vals = cageCells.map(i => solution[i]);
      const { op, target } = chooseCageOpAndTarget(vals);
      const anchor = cageCells.slice().sort((a,b)=>a-b)[0]; // smallest index as label anchor
      cages.push({ id: id++, cells: cageCells, op, target, anchor });
    }

    return cages;

    function chooseCageSize(n){
      // small cages make puzzles friendlier
      const r = Math.random();
      if (r < 0.5) return 2;
      if (r < 0.8) return 3;
      return 1; // occasional singletons
    }

    function chooseCageOpAndTarget(vals){
      if (vals.length === 1) return { op: '', target: vals[0] };
      if (vals.length === 2) {
        const [a,b] = vals;
        const ops = [];
        ops.push({op: '+', target: a+b});
        ops.push({op: '*', target: a*b});
        const diff = Math.abs(a-b);
        if (diff > 0) ops.push({op: '-', target: diff});
        if ((a%b===0) || (b%a===0)) {
          const t = a>b ? a/b : b/a;
          if (Number.isInteger(t) && t>0) ops.push({op: '/', target: t});
        }
        return ops[Math.floor(Math.random()*ops.length)];
      }
      // size >= 3 -> prefer + or *
      if (Math.random() < 0.75) {
        return { op: '+', target: vals.reduce((s,v)=>s+v,0) };
      } else {
        return { op: '*', target: vals.reduce((p,v)=>p*v,1) };
      }
    }
  }

  // KenKen solver (backtracking with MRV and basic cage pruning)
  function solveKenKen(n, cages) {
    const N = n*n;
    const cageByCell = Array(N).fill(-1);
    cages.forEach(c => c.cells.forEach(i => cageByCell[i]=c.id));

    const rowUsed = Array.from({length:n}, () => new Set());
    const colUsed = Array.from({length:n}, () => new Set());
    const assignment = Array(N).fill(0);

    // Precompute cage structures
    const cageMap = new Map();
    for (const cage of cages) cageMap.set(cage.id, cage);

    // MRV: compute candidates
    function candidates(idx) {
      const r = Math.floor(idx/n), c = idx % n;
      const used = new Set([...rowUsed[r], ...colUsed[c]]);
      const cage = cageMap.get(cageByCell[idx]);
      const vals = [];
      for (let v=1; v<=n; v++){
        if (used.has(v)) continue;
        if (!cageAllows(cage, idx, v)) continue;
        vals.push(v);
      }
      return vals;
    }

    function cageAllows(cage, idx, v) {
      const values = cage.cells.map(i => assignment[i] || (i===idx ? v : 0));
      const filled = values.filter(x=>x>0);
      const allFilled = filled.length === cage.cells.length;
      // reuse partial evaluator with placeholder zeros removed
      return evaluateCagePartial({op: cage.op, target: cage.target, cells: cage.cells}, filled, allFilled);
    }

    function selectUnassigned() {
      let bestIdx = -1, bestLen = Infinity, bestCand = null;
      for (let i=0; i<N; i++){
        if (assignment[i]) continue;
        const cand = candidates(i);
        if (cand.length < bestLen) {
          bestLen = cand.length;
          bestIdx = i;
          bestCand = cand;
          if (bestLen <= 1) break;
        }
      }
      return { idx: bestIdx, cand: bestCand || [] };
    }

    function backtrack() {
      const { idx, cand } = selectUnassigned();
      if (idx === -1) return true; // done
      const r = Math.floor(idx/n), c = idx % n;
      for (const v of cand) {
        assignment[idx] = v;
        rowUsed[r].add(v); colUsed[c].add(v);
        if (backtrack()) return true;
        rowUsed[r].delete(v); colUsed[c].delete(v);
        assignment[idx] = 0;
      }
      return false;
    }

    if (backtrack()) return assignment.slice();
    return null;
  }

  // ========== Utilities ==========

  // Expose some for debugging (optional)
  window._app = App;

})();