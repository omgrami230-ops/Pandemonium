// Le Pandemonium - serveur sans dépendance : site statique + API de tournoi partagé.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dossier du site : on cherche index.html (public/ en priorité, sinon racine du dépôt, sinon un sous-dossier).
function findRoot() {
  const skip = new Set(['node_modules', '.git', 'data']);
  const queue = [[__dirname, 0]];
  const hits = [];
  while (queue.length) {
    const [dir, d] = queue.shift();
    if (fs.existsSync(path.join(dir, 'index.html'))) hits.push(dir);
    if (d >= 3) continue;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {}
    for (const it of items) if (it.isDirectory() && !skip.has(it.name)) queue.push([path.join(dir, it.name), d + 1]);
  }
  return hits.find(h => path.basename(h) === 'public') || hits[0] || path.join(__dirname, 'public');
}
const root = findRoot();
const FLAT = root === __dirname;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pandemonium.json');
const ADMIN = process.env.ADMIN_PASSWORD || '';
const PERSISTENT = !(process.env.RAILWAY_ENVIRONMENT && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH);
const MAX_BODY = 1024 * 1024;

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

// ---------- Données ----------
// config : numéros/monstres, équipes, durée. state : morts et combats. log : points marqués.
let db = { config: {}, state: {}, log: {}, rev: 0 };
fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db = { config: d.config || {}, state: d.state || {}, log: d.log || {}, rev: Number(d.rev) || 0 };
} catch (e) { /* premier démarrage */ }

function persist() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
function merge(a, b, depth) {
  const o = Object.assign({}, a);
  for (const k of Object.keys(b)) {
    if (BAD.has(k)) continue;
    o[k] = (isObj(a[k]) && isObj(b[k]) && depth < 8) ? merge(a[k], b[k], depth + 1) : b[k];
  }
  return o;
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function applyOp(b) {
  if (!b || typeof b !== 'object') return 'invalide';
  if (b.t === 'patch') {
    if ((b.doc !== 'config' && b.doc !== 'state') || !isObj(b.part)) return 'invalide';
    const next = merge(db[b.doc], b.part, 0);
    if (JSON.stringify(next).length > 400000) return 'trop_gros';
    db[b.doc] = next;
    return null;
  }
  if (b.t === 'addlog') {
    const e = b.entry || {};
    if (!/^[a-z]+-[12]$/.test(String(e.team)) || (e.kind !== 'kill' && e.kind !== 'adj')) return 'invalide';
    const key = str(e.key, 40);
    if (e.kind === 'kill' && Object.values(db.log).some(x => x.team === e.team && x.kind === 'kill' && x.key === key)) return null;
    if (Object.keys(db.log).length >= 5000) return 'trop_gros';
    const id = crypto.randomBytes(8).toString('hex');
    db.log[id] = { team: e.team, kind: e.kind, key, label: str(e.label, 200), pts: Math.max(-100000, Math.min(100000, parseInt(e.pts, 10) || 0)), ts: Date.now() };
    return null;
  }
  if (b.t === 'dellog') {
    delete db.log[String(b.id)];
    return null;
  }
  return 'invalide';
}

function view() {
  return { config: db.config, state: db.state, log: Object.keys(db.log).map(id => Object.assign({ id }, db.log[id])), rev: db.rev, persistent: PERSISTENT, now: Date.now() };
}

// ---------- Authentification Ministère ----------
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const okKey = k => !!ADMIN && crypto.timingSafeEqual(sha(k || ''), sha(ADMIN));
const fails = new Map();
const ipOf = req => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
function blocked(ip) { const f = fails.get(ip); return !!f && f.n >= 10 && Date.now() - f.t < 600000; }
function fail(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t >= 600000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}
function readBody(req, res, cb) {
  let size = 0; const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { json(res, 413, { error: 'trop_gros' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => { try { cb(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { json(res, 400, { error: 'json_invalide' }); } });
}

function api(req, res, u) {
  const p = u.pathname, ip = ipOf(req);
  if (p === '/api/data' && req.method === 'GET') {
    if (u.searchParams.get('rev') === String(db.rev)) return json(res, 200, { same: true, rev: db.rev, now: Date.now() });
    return json(res, 200, view());
  }
  if (p === '/api/login' && req.method === 'POST') {
    if (!ADMIN) return json(res, 503, { error: 'pas_de_mot_de_passe' });
    if (blocked(ip)) return json(res, 429, { error: 'trop_de_tentatives' });
    return readBody(req, res, b => {
      if (okKey(b && b.password)) return json(res, 200, { ok: true });
      fail(ip); json(res, 401, { error: 'mot_de_passe_incorrect' });
    });
  }
  if (p === '/api/op' && req.method === 'POST') {
    if (!ADMIN) return json(res, 503, { error: 'pas_de_mot_de_passe' });
    if (blocked(ip)) return json(res, 429, { error: 'trop_de_tentatives' });
    if (!okKey(req.headers['x-admin-key'])) { fail(ip); return json(res, 401, { error: 'non_autorise' }); }
    return readBody(req, res, b => {
      const before = JSON.stringify(db);
      const err = applyOp(b);
      if (err) { db = JSON.parse(before); return json(res, 400, { error: err }); }
      db.rev++;
      try { persist(); } catch (e) { console.error('Ecriture impossible :', e.message); }
      json(res, 200, view());
    });
  }
  json(res, 404, { error: 'introuvable' });
}

// ---------- Fichiers statiques ----------
function serveStatic(req, res, p) {
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  if (FLAT && /\.(js|json|txt)$/i.test(f)) { res.writeHead(404); return res.end('Introuvable'); }
  if (!f.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Interdit'); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable : fichier du site absent. Regardez les logs du déploiement sur Railway.'); }
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', 'Content-Length': st.size });
    fs.createReadStream(f).pipe(res);
  });
}

http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://x'); decodeURIComponent(u.pathname); }
  catch (e) { res.writeHead(400); return res.end(); }
  const p = decodeURIComponent(u.pathname);
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p.startsWith('/api/')) return api(req, res, u);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
}).listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('Le Pandemonium en ligne. Données :', DATA_FILE);
  console.log('Dossier du site :', root, '| index.html présent :', fs.existsSync(path.join(root, 'index.html')));
  if (!fs.existsSync(path.join(root, 'index.html'))) console.error('ERREUR : index.html introuvable nulle part. Contenu du dépôt :', fs.readdirSync(__dirname).join(', '));
  if (!ADMIN) console.warn('ATTENTION : ADMIN_PASSWORD n\'est pas défini, personne ne pourra modifier le tournoi.');
  if (!PERSISTENT) console.warn('ATTENTION : aucun volume Railway détecté, les données seront perdues à chaque déploiement.');
});
