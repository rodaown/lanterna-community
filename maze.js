/*
 * maze.js — formato dei livelli di Lanterna (lettura, scrittura, controllo, generazione).
 * Lo usano sia il gioco sia l'editor. Funziona nel browser (window.Maze) e in Node (require).
 *
 * Formato di un file di livello:
 *
 *   ; righe che iniziano con ";" sono commenti
 *   name: Il cortile
 *   torch: 3
 *   par: 38
 *   speed: 0.25
 *   ---
 *   #########
 *   #S..#...#
 *   #.#.#.#.#
 *   #.#...#E#
 *   #########
 *
 *   #  muro        .  pavimento     S  partenza (una sola)
 *   E  uscita (una sola)            *  gemma (facoltativa)
 *   M  Ombra (nemico che dorme finché la lanterna non lo illumina)
 *   K  chiave (facoltativa, al massimo una): finché non la prendi l'uscita resta chiusa
 *   F  falò (punto di salvataggio: se un'Ombra ti prende riparti da qui)
 *   H  Ombra cacciatrice: una volta sveglia ti segue sempre (al buio non può prenderti)
 *   V  fiamma viva (si raccoglie e si lancia lungo il corridoio: svela il buio, sveglia le Ombre)
 *   L  barattolo di lucciole (si raccoglie e si posa: attira le Ombre e le libera quando lo raggiungono)
 *   C  cristallo nella roccia (è un muro; quando la lanterna lo illumina si accende per sempre)
 *   Cripta (dungeon dentro il labirinto; se c'è, la chiave dell'uscita la porta il Guardiano):
 *   R  pavimento della cripta (entrando le porte si chiudono e arrivano le ondate di Ombre)
 *   G  porta della cripta (aperta finché non entri; si riapre quando il Guardiano è liberato)
 *   B  braciere (ci passi sopra per accenderlo: libera le Ombre accanto; colpisce il Guardiano e si spegne)
 *   T  tomba (da qui escono le Ombre delle ondate)
 *   X  altare (da qui sorge il Guardiano; se manca, dal centro della cripta)
 *   waves (facoltativo): ondate della cripta, separate da virgole: "3, 3+1" = 3 Ombre, poi 3 Ombre + 1 cacciatrice.
 *   guardian (facoltativo): colpi di luce per liberare il Guardiano (se manca: 3).
 *   Fuori dal disegno si considera tutto muro.
 *   flash (facoltativo): lampi a disposizione all'inizio del livello (se manca: 1).
 *   story (facoltativo): testo del cartello che apre il livello. diary: pagina del diario del maestro.
 *   epilogue (facoltativo): racconto a immagini dopo il livello. "epilogue: 1" = fine dell'Atto I,
 *     "epilogue: finale" = fine dell'Atto II.
 *   name.xx / tip.xx / story.xx / diary.xx: traduzioni (xx = en, fr, es, de). Senza lingua = italiano.
 *   tip (solo tutorial, anche più righe): "tip: quando | testo". quando = start, at COLONNA,RIGA,
 *     oppure un evento: fear, wake, lost, caught, gem, flash, kill, burn, fire, dark, light, map, key, locked,
 *     crystal, fireball, throw, lure, lureplace, lureburst, hunter, crypt, wave, guardian, guardianhit,
 *     brazier, cryptdone, gift, item.
 *   speed (facoltativo): secondi che un'Ombra impiega per ogni casella (più alto = più lenta). Se manca: 0.7.
 */
(function (root) {
  'use strict';

  const WALL = '#', FLOOR = '.', START = 'S', EXIT = 'E', GEM = '*', ENEMY = 'M', FIRE = 'F', KEY = 'K';
  const HUNTER = 'H', FIREBALL = 'V', LURE = 'L', CRYSTAL = 'C';
  const CRYPT = 'R', GATE = 'G', BRAZIER = 'B', TOMB = 'T', ALTAR = 'X';
  const WHISPER = 'W';   // sound effect: an invisible floor cell; a whisper is heard when Scintilla walks on it or next to it (once per level)
  const LAMP = 'I';      // Atto III: a street lamp in the wall; lit when you pass next to it, its light keeps the Ombre away
  const MIRROR_A = '/', MIRROR_B = '\\';   // Atto III: mirrors (you can turn them); they send the lantern light on at 90°
  const DOOR = 'Q';      // Atto III: a door of the Comune, opened only by a beam of light reflected by a mirror
  const GUARD = 'U';     // Atto III: a guard of the Comune (patrols its corridor, sees the lantern light); the cell itself is floor
  const SOUND_CELLS = 'WZPADN'; // all sound-effect cells (W and its alternatives, see whispers.js); all behave as floor
  const ALLOWED = new Set([WALL, FLOOR, START, EXIT, GEM, ENEMY, FIRE, KEY, HUNTER, FIREBALL, LURE, CRYSTAL, CRYPT, GATE, BRAZIER, TOMB, ALTAR, GUARD, LAMP, MIRROR_A, MIRROR_B, DOOR, ...SOUND_CELLS]);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DEFAULT_SPEED = 0.7; // secondi a casella per le Ombre

  /* ---------- lettura ---------- */
  function parseLevel(text) {
    const errors = [];
    const lines = String(text).replace(/\r/g, '').split('\n');
    const sep = lines.findIndex(l => l.trim() === '---');
    const meta = {};
    const extraLines = [];   // header lines the editor must keep as they are (tip, flash, …)
    let first = 0;
    if (sep === -1) {
      errors.push({ line: 1, msg: 'Manca la riga "---" che separa l\'intestazione dal disegno del labirinto.' });
    } else {
      for (let i = 0; i < sep; i++) {
        const l = lines[i].trim();
        if (!l || l.startsWith(';')) continue;
        // "chiave: valore", oppure "chiave.xx: valore" per un testo tradotto (xx = en, fr, es, de, …)
        const m = l.match(/^([A-Za-z_]+)(?:\.([A-Za-z]{2}))?\s*:\s*(.*)$/);
        if (!m) { errors.push({ line: i + 1, msg: `Riga di intestazione non valida: "${l}". Usa il formato chiave: valore.` }); continue; }
        const key = m[1].toLowerCase(), lang = m[2] ? m[2].toLowerCase() : null, val = m[3].trim();
        if (lang && !['name', 'tip', 'story', 'diary'].includes(key)) { errors.push({ line: i + 1, msg: `Solo name, tip, story e diary possono avere una lingua (.${lang}).` }); continue; }
        if (key === 'tip') {
          // tutorial hint: "tip: <when> | <text>"  (when = start, at COL,ROW, or an event name)
          const bar = val.indexOf('|');
          if (bar < 0) { errors.push({ line: i + 1, msg: 'Riga tip non valida: usa "tip: quando | testo".' }); continue; }
          const tip = { when: val.slice(0, bar).trim().toLowerCase(), text: val.slice(bar + 1).trim(), line: i + 1 };
          if (lang) {
            meta.tipsByLang = meta.tipsByLang || {};
            (meta.tipsByLang[lang] = meta.tipsByLang[lang] || []).push(tip);
          }
          else (meta.tips = meta.tips || []).push(tip);
        } else if (key === 'guard' && !lang) {
          // Atto III: how a guard moves. "guard: COL,ROW route|loop|post …" (see guardPlan below)
          (meta.guardLines = meta.guardLines || []).push({ val, line: i + 1 });
        } else if (lang) {
          meta.texts = meta.texts || {};
          (meta.texts[key] = meta.texts[key] || {})[lang] = val;
        } else meta[key] = val;
        if (lang || !['name', 'torch', 'par', 'speed'].includes(key)) extraLines.push(l);
      }
      first = sep + 1;
    }

    let rows = lines.slice(first).map(l => l.replace(/\s+$/, ''));
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    let lead = 0;
    while (rows.length && rows[0] === '') { rows.shift(); lead++; }
    const lineOf = r => first + lead + r + 1;

    const h = rows.length;
    const w = h ? rows[0].length : 0;
    if (!h || !w) errors.push({ line: first + 1, msg: 'Il disegno del labirinto è vuoto.' });

    let start = null, exit = null, key = null, gems = 0, starts = 0, exits = 0, keys = 0;
    const enemies = [], fires = [];
    const crypt = { cells: [], gates: [], braziers: [], tombs: [], altar: null };
    rows.forEach((row, y) => {
      if (row.length !== w) errors.push({ line: lineOf(y), msg: `Questa riga è lunga ${row.length} caratteri, la prima ne ha ${w}. Tutte le righe devono avere la stessa lunghezza.` });
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (!ALLOWED.has(c)) { errors.push({ line: lineOf(y), msg: `Carattere non riconosciuto "${c}" in colonna ${x + 1}. Usa # . S E * M F K H V L C R G B T X U I / \\ Q e i suoni W Z P A D N` }); continue; }
        if (c === START) { starts++; start = { x, y }; }
        if (c === EXIT) { exits++; exit = { x, y }; }
        if (c === GEM) gems++;
        if (c === KEY) { keys++; key = { x, y }; }
        if (c === ENEMY) enemies.push({ x, y });
        if (c === HUNTER) enemies.push({ x, y, kind: 'hunter' });
        if (c === FIRE) fires.push({ x, y });
        if (c === CRYPT || c === BRAZIER || c === TOMB || c === ALTAR) crypt.cells.push({ x, y });
        if (c === GATE) crypt.gates.push({ x, y });
        if (c === BRAZIER) crypt.braziers.push({ x, y });
        if (c === TOMB) crypt.tombs.push({ x, y });
        if (c === ALTAR) crypt.altar = { x, y };
      }
    });
    if (starts !== 1) errors.push({ line: null, msg: starts ? `Ci sono ${starts} partenze (S): deve essercene una sola.` : 'Manca la partenza (S).' });
    if (keys > 1) errors.push({ line: null, msg: `Ci sono ${keys} chiavi (K): ce ne può essere al massimo una.` });
    if (exits !== 1) errors.push({ line: null, msg: exits ? `Ci sono ${exits} uscite (E): deve essercene una sola.` : 'Manca l\'uscita (E).' });
    let cryptInfo = null;
    if (crypt.cells.length || crypt.gates.length) {
      if (!crypt.gates.length) errors.push({ line: null, msg: 'La cripta non ha porte (G).' });
      if (!crypt.tombs.length) errors.push({ line: null, msg: 'La cripta non ha tombe (T) da cui escono le Ombre.' });
      // "crypt: bonus" = a secret crypt inside a normal level: optional, waves only (no Guardian), the prize is
      // "reward: N" flashes; the level keeps its own key (K) if it has one
      const bonus = String(meta.crypt || '').trim().toLowerCase() === 'bonus';
      if (keys && !bonus) errors.push({ line: null, msg: 'Con la cripta la chiave la porta il Guardiano: togli la K dal disegno.' });
      if (bonus && crypt.altar) errors.push({ line: null, msg: 'Il Guardiano (X) c\'è solo nelle cripte col Guardiano: nelle cripte segrete ("crypt: bonus") toglilo dal disegno.' });
      if (!crypt.altar && crypt.cells.length && !bonus) {     // the Guardian rises from the middle of the crypt
        const mx = crypt.cells.reduce((a, c) => a + c.x, 0) / crypt.cells.length, my = crypt.cells.reduce((a, c) => a + c.y, 0) / crypt.cells.length;
        crypt.altar = crypt.cells.reduce((b, c) => (c.x - mx) ** 2 + (c.y - my) ** 2 < (b.x - mx) ** 2 + (b.y - my) ** 2 ? c : b);
      }
      const waves = String(meta.waves || (bonus ? '3' : '3, 3+1')).split(',').map(t => t.trim()).filter(Boolean).map(t => {
        const [n, h] = t.split('+').map(v => parseInt(v, 10));
        return { n: Math.max(0, Math.min(9, n || 0)), h: Math.max(0, Math.min(4, h || 0)) };
      });
      const hp = parseInt(meta.guardian, 10);
      const reward = parseInt(meta.reward, 10);
      cryptInfo = { ...crypt, waves, hp: Number.isFinite(hp) ? Math.max(1, Math.min(9, hp)) : 3, bonus, reward: Number.isFinite(reward) ? Math.max(1, Math.min(9, reward)) : 3 };
      if (crypt.altar && !bonus) key = crypt.altar;  // the key is where the Guardian is set free
      // secret crypts: a level can have more than one; each separate room (its floor + its doors) is a crypt on its own
      cryptInfo.rooms = [cryptInfo];
      if (bonus) {
        const at = new Map(), rooms = [];
        crypt.cells.concat(crypt.gates).forEach(q => at.set(q.y * w + q.x, q));
        const seen = new Set();
        for (const [k0] of at) {
          if (seen.has(k0)) continue;
          const room = { cells: [], gates: [], braziers: [], tombs: [], altar: null }, todo = [k0]; seen.add(k0);
          while (todo.length) {
            const k = todo.pop(), q = at.get(k), c = rows[q.y][q.x];
            if (c === GATE) room.gates.push(q); else room.cells.push(q);
            if (c === BRAZIER) room.braziers.push(q);
            if (c === TOMB) room.tombs.push(q);
            for (const n of [k - 1, k + 1, k - w, k + w]) if (at.has(n) && !seen.has(n) && Math.abs((n % w) - q.x) <= 1) { seen.add(n); todo.push(n); }
          }
          if (room.cells.length) rooms.push(room);
        }
        rooms.forEach((r, i) => {
          const where = `La cripta segreta n. ${i + 1} (vicino a colonna ${r.cells[0].x + 1}, riga ${r.cells[0].y + 1})`;
          if (!r.gates.length) errors.push({ line: null, msg: `${where} non ha porte (G).` });
          if (!r.tombs.length) errors.push({ line: null, msg: `${where} non ha tombe (T).` });
        });
        if (rooms.length) cryptInfo.rooms = rooms.map(r => Object.assign({}, cryptInfo, r, { rooms: undefined }));
      }
    }
    const level = { meta, extraLines, rows, w, h, start, exit, key, gems, enemies, fires, errors, par: null, torch: null, name: meta.name || '', crypt: cryptInfo };
    if (!errors.length) {
      const dist = bfs(level, start);
      const d = dist[exit.y * w + exit.x];
      if (d < 0) errors.push({ line: null, msg: 'L\'uscita non è raggiungibile dalla partenza.' });
      else if (key) {
        // with a key the shortest route is start → key → exit
        const toKey = dist[key.y * w + key.x], keyToExit = bfs(level, key)[exit.y * w + exit.x];
        if (toKey < 0) errors.push({ line: null, msg: 'La chiave non è raggiungibile dalla partenza.' });
        else level.shortest = toKey + keyToExit;
      } else level.shortest = d;
      level.warnings = [];
      const fromStart = bfs(level, start);
      enemies.forEach(e => {
        const de = fromStart[e.y * w + e.x];
        if (de >= 0 && de < 8) level.warnings.push({ line: lineOf(e.y), msg: `Un'Ombra in colonna ${e.x + 1} è a soli ${de} passi dalla partenza.` });
      });
    }
    level.warnings = level.warnings || [];
    // guards (Atto III): every "U" cell, and how each one moves ("guard:" lines in the header, written by the editor)
    //   guard: 12,5 route 18,5 18,11   → up and down along the stops (12,5 → 18,5 → 18,11 → 18,5 → …)
    //   guard: 12,5 loop 18,5 18,11    → a closed round (after the last stop it walks back to the first)
    //   guard: 12,5 post 3             → a sentry: stands still and turns round every 3 s
    //   no line (or "auto")            → up and down the longest straight corridor through its cell
    // columns and rows count from 1, like the editor and the "tip: at" lines
    level.guards = [];
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === GUARD) level.guards.push({ x, y }); });
    level.guardPlans = [];
    for (const { val, line } of meta.guardLines || []) {
      const plan = guardPlan(val);
      if (plan.error) { errors.push({ line, msg: plan.error }); continue; }
      if (cellAt(level, plan.x, plan.y) !== GUARD) { errors.push({ line, msg: `La riga guard: parla della casella colonna ${plan.x + 1}, riga ${plan.y + 1}, ma lì non c'è una guardia (U).` }); continue; }
      if (level.guardPlans.some(q => q.x === plan.x && q.y === plan.y)) { errors.push({ line, msg: `Due righe guard: per la stessa guardia (colonna ${plan.x + 1}, riga ${plan.y + 1}).` }); continue; }
      let bad = null;
      const stops = [{ x: plan.x, y: plan.y }, ...plan.pts];
      for (let i = 1; i < stops.length && !bad; i++) {
        const q = stops[i];
        if (q.x < 0 || q.y < 0 || q.x >= w || q.y >= h) bad = `La tappa ${i} (colonna ${q.x + 1}, riga ${q.y + 1}) è fuori dal labirinto.`;
        else if (!isOpen(level, q.x, q.y)) bad = `La tappa ${i} (colonna ${q.x + 1}, riga ${q.y + 1}) è su un muro.`;
        else {
          const d = bfs(level, stops[i - 1])[q.y * w + q.x];
          if (d < 0) bad = `La tappa ${i} (colonna ${q.x + 1}, riga ${q.y + 1}) non si raggiunge dalla tappa prima.`;
          else if (d > 80) bad = `La tappa ${i} è a ${d} passi dalla tappa prima: al massimo 80, aggiungi una tappa in mezzo.`;
        }
      }
      if (!bad && plan.mode === 'loop' && stops.length > 1) {
        const d = bfs(level, stops[stops.length - 1])[plan.y * w + plan.x];
        if (d < 0 || d > 80) bad = 'Nel giro chiuso l\'ultima tappa deve poter tornare alla guardia (al massimo 80 passi).';
      }
      if (bad) { errors.push({ line, msg: bad }); continue; }
      level.guardPlans.push(plan);
    }
    const torch = parseInt(meta.torch, 10);
    level.torch = Number.isFinite(torch) ? Math.max(1, Math.min(10, torch)) : 3;
    if (meta.torch && !Number.isFinite(torch)) errors.push({ line: null, msg: `torch deve essere un numero, trovato "${meta.torch}".` });
    const speed = parseFloat(String(meta.speed || '').replace(',', '.'));
    level.speed = Number.isFinite(speed) ? Math.max(0.1, Math.min(3, speed)) : DEFAULT_SPEED;
    if (meta.speed && !Number.isFinite(speed)) errors.push({ line: null, msg: `speed deve essere un numero (secondi a casella, per esempio 0.25), trovato "${meta.speed}".` });
    const dr = parseFloat(String(meta.drain || '').replace(',', '.'));
    level.drain = Number.isFinite(dr) && dr > 0 ? Math.max(2, Math.min(60, dr)) : null;   // Atto III: the lantern light shrinks by 1 every N seconds
    if (meta.drain && !Number.isFinite(dr)) errors.push({ line: null, msg: `drain deve essere un numero di secondi (per esempio 8), trovato "${meta.drain}".` });
    const fl = parseInt(meta.flash, 10);
    level.flash = Number.isFinite(fl) ? Math.max(0, Math.min(20, fl)) : null;   // lampi at start (null = game default)
    level.tips = meta.tips || [];                 // plain "tip:" lines = Italian
    level.tipsByLang = meta.tipsByLang || {};     // "tip.en:", "tip.fr:", …
    const texts = meta.texts || {};
    level.names = texts.name || {};               // "name.en:", "name.fr:", …
    level.story = meta.story || '';               // opening card of the level (story mode)
    level.diary = meta.diary || '';               // page of the master's diary found in this level
    const ep = String(meta.epilogue || '').trim();
    level.epilogue = !ep || ep === '0' ? '' : ep === '1' ? 'epilogue' : ep;   // story played after this level ('epilogue', 'finale', …)
    level.texts = texts;                          // translations: texts.story.en, texts.diary.fr, …
    const par = parseInt(meta.par, 10);
    level.par = Number.isFinite(par) ? par : (level.shortest ?? null);
    return level;
  }

  // "12,5 route 18,5 18,11" → { x: 11, y: 4, mode: 'route', pts: [{x:17,y:4}, {x:17,y:10}], turn: 2.5 }
  const GUARD_MODES = ['auto', 'route', 'loop', 'post'];
  function guardPlan(val) {
    const parts = String(val).trim().split(/\s+/);
    const pt = t => { const m = /^(\d+),(\d+)$/.exec(t || ''); return m ? { x: parseInt(m[1], 10) - 1, y: parseInt(m[2], 10) - 1 } : null; };
    const at = pt(parts[0]);
    if (!at) return { error: `Riga guard: non valida: "${val}". Scrivi per esempio "guard: 12,5 route 18,5 18,11".` };
    const mode = (parts[1] || 'auto').toLowerCase();
    if (!GUARD_MODES.includes(mode)) return { error: `Movimento della guardia sconosciuto: "${parts[1]}". Usa route, loop, post o auto.` };
    const plan = { x: at.x, y: at.y, mode, pts: [], turn: 2.5 };
    if (mode === 'post') {
      const t = parseFloat(String(parts[2] || '').replace(',', '.'));
      if (parts[2] && !Number.isFinite(t)) return { error: `Sentinella: "${parts[2]}" non è un numero di secondi.` };
      if (Number.isFinite(t)) plan.turn = Math.max(1, Math.min(10, t));
    } else if (mode === 'route' || mode === 'loop') {
      for (const t of parts.slice(2)) { const q = pt(t); if (!q) return { error: `Tappa non valida: "${t}". Scrivi colonna,riga (per esempio 18,5).` }; plan.pts.push(q); }
      if (!plan.pts.length) return { error: 'Questa guardia ha il movimento a tappe ma nessuna tappa: aggiungine almeno una.' };
    }
    return plan;
  }
  function guardLine(plan) {
    const c = q => `${q.x + 1},${q.y + 1}`;
    if (plan.mode === 'post') return `guard: ${c(plan)} post ${plan.turn}`;
    if (plan.mode === 'route' || plan.mode === 'loop') return `guard: ${c(plan)} ${plan.mode} ${plan.pts.map(c).join(' ')}`;
    return null;
  }

  /* ---------- scrittura ---------- */
  function serialize({ name, torch, par, speed, extra, rows }) {
    const head = [];
    if (name) head.push(`name: ${name}`);
    if (torch != null) head.push(`torch: ${torch}`);
    if (par != null) head.push(`par: ${par}`);
    if (speed != null) head.push(`speed: ${speed}`);
    if (extra && extra.length) head.push(...extra);
    return head.join('\n') + '\n---\n' + rows.join('\n') + '\n';
  }

  /* ---------- utilità ---------- */
  const cellAt = (lv, x, y) => (x < 0 || y < 0 || x >= lv.w || y >= lv.h) ? WALL : lv.rows[y][x];
  // a door of the Comune (Q) counts as open here: the level must be solvable once the beams have opened it
  const isOpen = (lv, x, y) => { const c = cellAt(lv, x, y); return c !== WALL && c !== CRYSTAL && c !== LAMP && c !== MIRROR_A && c !== MIRROR_B; };

  function bfs(lv, from) {
    const { w, h } = lv;
    const dist = new Int32Array(w * h).fill(-1);
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    dist[from.y * w + from.x] = 0; q[tail++] = from.y * w + from.x;
    while (head < tail) {
      const i = q[head++], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!isOpen(lv, nx, ny)) continue;
        const j = ny * w + nx;
        if (dist[j] !== -1) continue;
        dist[j] = dist[i] + 1; q[tail++] = j;
      }
    }
    return dist;
  }

  function shortestPath(lv) {
    if (!lv.start || !lv.exit) return [];
    const dist = bfs(lv, lv.exit);
    const path = [];
    let { x, y } = lv.start;
    if (dist[y * lv.w + x] < 0) return [];
    while (!(x === lv.exit.x && y === lv.exit.y)) {
      path.push({ x, y });
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (isOpen(lv, nx, ny) && dist[ny * lv.w + nx] === dist[y * lv.w + x] - 1) { x = nx; y = ny; break; }
      }
    }
    path.push({ x, y });
    return path;
  }

  function stats(lv) {
    let floor = 0, deadEnds = 0, junctions = 0, enemies = 0, fires = 0;
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      if (!isOpen(lv, x, y)) continue;
      floor++;
      const c = cellAt(lv, x, y);
      if (c === ENEMY || c === HUNTER) enemies++;
      if (c === FIRE) fires++;
      const n = DIRS.filter(([dx, dy]) => isOpen(lv, x + dx, y + dy)).length;
      if (n === 1) deadEnds++;
      if (n >= 3) junctions++;
    }
    return { floor, deadEnds, junctions, enemies, fires };
  }

  /* ---------- generazione ---------- */
  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Labirinto "perfetto" (un solo percorso tra due punti) con l'algoritmo del backtracker,
   * poi eventuali anelli (loops) togliendo muri dai vicoli ciechi.
   * w e h vengono resi dispari. braid: 0..1, quota di vicoli ciechi da aprire.
   * gems: quante gemme, messe di preferenza in fondo ai vicoli ciechi.
   * La partenza è in alto a sinistra, l'uscita nel punto più lontano.
   */
  function generate({ w = 41, h = 41, braid = 0, gems = 0, enemies = 0, fires = 0, seed = Date.now() } = {}) {
    w = Math.max(7, w | 1); h = Math.max(7, h | 1);
    const rand = rng(seed);
    const g = Array.from({ length: h }, () => Array(w).fill(WALL));
    const cw = (w - 1) / 2, ch = (h - 1) / 2;
    const visited = new Uint8Array(cw * ch);
    const stack = [[0, 0]];
    visited[0] = 1; g[1][1] = FLOOR;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !visited[ny * cw + nx]) opts.push([nx, ny, dx, dy]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = opts[Math.floor(rand() * opts.length)];
      visited[ny * cw + nx] = 1;
      g[2 * cy + 1 + dy][2 * cx + 1 + dx] = FLOOR;
      g[2 * ny + 1][2 * nx + 1] = FLOOR;
      stack.push([nx, ny]);
    }

    const open = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1 && g[y][x] !== WALL;
    const neighbours = (x, y) => DIRS.filter(([dx, dy]) => open(x + dx, y + dy)).length;

    if (braid > 0) {
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
        if (neighbours(x, y) !== 1 || rand() >= braid) continue;
        const walls = DIRS.filter(([dx, dy]) => {
          const wx = x + dx, wy = y + dy, tx = x + 2 * dx, ty = y + 2 * dy;
          return g[wy] && g[wy][wx] === WALL && tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1;
        });
        if (!walls.length) continue;
        const [dx, dy] = walls[Math.floor(rand() * walls.length)];
        g[y + dy][x + dx] = FLOOR;
      }
    }

    g[1][1] = START;
    const rows0 = g.map(r => r.join(''));
    const lv0 = { rows: rows0, w, h };
    const dist = bfs(lv0, { x: 1, y: 1 });
    let far = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > dist[far]) far = i;
    const ex = far % w, ey = (far / w) | 0;
    g[ey][ex] = EXIT;

    if (gems > 0) {
      const dead = [], other = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (g[y][x] !== FLOOR) continue;
        (neighbours(x, y) === 1 ? dead : other).push([x, y]);
      }
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const pool = shuffle(dead).concat(shuffle(other));
      for (let i = 0; i < Math.min(gems, pool.length); i++) g[pool[i][1]][pool[i][0]] = GEM;
    }

    // falò: distribuiti a intervalli regolari lungo il percorso più breve
    if (fires > 0) {
      const lvp = { rows: g.map(r => r.join('')), w, h, start: { x: 1, y: 1 }, exit: { x: ex, y: ey } };
      const path = shortestPath(lvp);
      for (let i = 1; i <= fires; i++) {
        const p = path[Math.round(path.length * i / (fires + 1))];
        if (p && g[p.y][p.x] === FLOOR) g[p.y][p.x] = FIRE;
      }
    }
    // Ombre: su caselle libere lontane dalla partenza (almeno 12 passi) e non attaccate all'uscita
    if (enemies > 0) {
      const lvd = { rows: g.map(r => r.join('')), w, h };
      const ds = bfs(lvd, { x: 1, y: 1 }), de = bfs(lvd, { x: ex, y: ey });
      const cand = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (g[y][x] === FLOOR && ds[i] >= 12 && de[i] >= 4) cand.push([x, y]);
      }
      for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
      const placed = [];
      for (const [x, y] of cand) {
        if (placed.length >= enemies) break;
        if (placed.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) < 8)) continue;
        g[y][x] = ENEMY; placed.push([x, y]);
      }
    }

    const rows = g.map(r => r.join(''));
    const lv = { rows, w, h, start: { x: 1, y: 1 }, exit: { x: ex, y: ey } };
    return { rows, w, h, par: bfs(lv, lv.start)[ey * w + ex] };
  }

  const Maze = { DEFAULT_SPEED, WALL, FLOOR, START, EXIT, GEM, ENEMY, FIRE, KEY, HUNTER, FIREBALL, LURE, CRYSTAL, CRYPT, GATE, BRAZIER, TOMB, ALTAR, GUARD, LAMP, MIRROR_A, MIRROR_B, DOOR, WHISPER, SOUND_CELLS, DIRS, guardPlan, guardLine, parseLevel, serialize, bfs, shortestPath, stats, generate, cellAt, isOpen };
  if (typeof module !== 'undefined' && module.exports) module.exports = Maze;
  else root.Maze = Maze;
})(typeof window !== 'undefined' ? window : this);
