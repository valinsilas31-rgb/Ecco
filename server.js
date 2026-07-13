const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Datastore = require('nedb-promises');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // MUDE ISSO!

// --- Banco de dados NeDB (arquivos locais, zero compilação) ---
const db = {
  keys: Datastore.create({ filename: path.join(__dirname, 'data', 'keys.db'), autoload: true }),
  users: Datastore.create({ filename: path.join(__dirname, 'data', 'users.db'), autoload: true }),
  logs: Datastore.create({ filename: path.join(__dirname, 'data', 'logs.db'), autoload: true }),
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---
function hashHWID(hwidData) {
  const combined = `${hwidData.uuid}-${hwidData.diskSerial}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

async function log(username, action, hwid, ip, success, message) {
  await db.logs.insert({
    username: username || 'unknown',
    action, hwid: hwid || '', ip: ip || '',
    success, message,
    timestamp: new Date().toISOString()
  });
}

function checkAdminAuth(req, res) {
  const auth = req.headers['x-admin-password'];
  if (auth !== ADMIN_PASSWORD) {
    res.status(401).json({ success: false, message: 'Não autorizado.' });
    return false;
  }
  return true;
}

function isKeyExpired(key) {
  if (!key.expires_at) return false;
  return new Date(key.expires_at) < new Date();
}

// ============================================================
// API DO CLIENTE (APP)
// ============================================================

// Validação simples de KEY (para cheat externo)
app.get('/api/validate', async (req, res) => {
  const { license, hwid } = req.query;
  const ip = req.ip;

  if (!license) {
    return res.json({ success: false, valid: false, message: 'Parâmetro license é obrigatório' });
  }

  if (!hwid) {
    return res.json({ success: false, valid: false, message: 'Parâmetro hwid é obrigatório' });
  }

  // Buscar a key no banco
  const key = await db.keys.findOne({ id: license });

  if (!key) {
    await log(null, 'validate', hwid, ip, false, 'Key não encontrada');
    return res.json({ success: false, valid: false, status: 'invalid', message: 'Licença não encontrada ou inválida' });
  }

  // Verificar se está revogada
  if (key.revoked) {
    await log(key.username || 'unknown', 'validate', hwid, ip, false, 'Key revogada');
    return res.json({ success: false, valid: false, status: 'revoked', message: 'Esta licença foi revogada' });
  }

  // Verificar expiração
  if (isKeyExpired(key)) {
    await log(key.username || 'unknown', 'validate', hwid, ip, false, 'Key expirada');
    return res.json({ success: false, valid: false, status: 'expired', message: 'Licença expirada' });
  }

  // Verificar HWID (se já estiver registrado)
  if (key.hwid === null) {
    // Primeira ativação - registra o HWID
    await db.keys.update({ id: license }, { $set: { hwid: hwid } });
    await log(key.username || license, 'validate_first', hwid, ip, true, 'Primeira ativação - HWID registrado');
  } else if (key.hwid !== hwid) {
    // HWID diferente
    await log(key.username || license, 'validate', hwid, ip, false, 'HWID não autorizado');
    return res.json({ success: false, valid: false, status: 'hwid_mismatch', message: 'HWID não autorizado para esta licença' });
  }

  // Licença válida!
  await log(key.username || license, 'validate', hwid, ip, true, 'Validação bem-sucedida');
  
  return res.json({
    success: true,
    valid: true,
    status: 'active',
    message: 'Licença válida',
    username: key.username || 'User',
    expiry: key.expires_at ? new Date(key.expires_at).getTime() / 1000 : 9999999999,
    hwid: key.hwid
  });
});

// Registrar nova conta
app.post('/api/register', async (req, res) => {
  const { username, password, key, hwid } = req.body;
  const ip = req.ip;

  if (!username || !password || !key || !hwid) {
    return res.json({ success: false, message: 'Todos os campos são obrigatórios.' });
  }

  const existingKey = await db.keys.findOne({ id: key });
  if (!existingKey) {
    await log(username, 'register', null, ip, false, 'Key inválida');
    return res.json({ success: false, message: 'Chave de licença inválida.' });
  }
  if (existingKey.revoked) {
    await log(username, 'register', null, ip, false, 'Key revogada');
    return res.json({ success: false, message: 'Esta chave foi revogada.' });
  }
  if (existingKey.used) {
    await log(username, 'register', null, ip, false, 'Key já usada');
    return res.json({ success: false, message: 'Esta chave já foi utilizada.' });
  }
  if (isKeyExpired(existingKey)) {
    await log(username, 'register', null, ip, false, 'Key expirada');
    return res.json({ success: false, message: 'Esta chave expirou.' });
  }

  const existingUser = await db.users.findOne({ username });
  if (existingUser) {
    return res.json({ success: false, message: 'Nome de usuário já em uso.' });
  }

  const hwidHash = hashHWID(hwid);
  const hashedPassword = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  await db.keys.update({ id: key }, { $set: { used: true, hwid: hwidHash, username } });
  await db.users.insert({ username, password: hashedPassword, key_id: key, hwid: hwidHash, created_at: now, last_login: null, blocked: false });

  await log(username, 'register', hwidHash, ip, true, 'Conta criada com sucesso');
  return res.json({ success: true, message: 'Conta criada com sucesso!' });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password, hwid } = req.body;
  const ip = req.ip;

  if (!username || !password || !hwid) {
    return res.json({ success: false, message: 'Todos os campos são obrigatórios.' });
  }

  const user = await db.users.findOne({ username });
  if (!user) {
    await log(username, 'login', null, ip, false, 'Usuário não encontrado');
    return res.json({ success: false, message: 'Usuário ou senha inválidos.' });
  }
  if (user.blocked) {
    await log(username, 'login', null, ip, false, 'Usuário bloqueado');
    return res.json({ success: false, message: 'Sua conta foi bloqueada. Entre em contato com o suporte.' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    await log(username, 'login', null, ip, false, 'Senha incorreta');
    return res.json({ success: false, message: 'Usuário ou senha inválidos.' });
  }

  const key = await db.keys.findOne({ id: user.key_id });
  if (!key || key.revoked) {
    await log(username, 'login', null, ip, false, 'Key revogada');
    return res.json({ success: false, message: 'Sua licença foi revogada. Entre em contato com o suporte.' });
  }
  if (isKeyExpired(key)) {
    await log(username, 'login', null, ip, false, 'Key expirada');
    return res.json({ success: false, message: 'Sua licença expirou.' });
  }

  const hwidHash = hashHWID(hwid);
  if (user.hwid && user.hwid !== hwidHash) {
    await log(username, 'login', hwidHash, ip, false, 'HWID diferente — uso em outro PC bloqueado');
    return res.json({ success: false, message: 'Este login está vinculado a outro dispositivo.' });
  }

  // Se HWID ainda não definido (reset), vincular agora
  if (!user.hwid) {
    await db.users.update({ username }, { $set: { hwid: hwidHash } });
    await db.keys.update({ id: user.key_id }, { $set: { hwid: hwidHash } });
  }

  await db.users.update({ username }, { $set: { last_login: new Date().toISOString() } });
  await log(username, 'login', hwidHash, ip, true, 'Login bem-sucedido');
  return res.json({ success: true, message: 'Login realizado com sucesso!' });
});

// ============================================================
// API ADMIN
// ============================================================

app.get('/api/admin/stats', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const totalKeys = await db.keys.count({});
  const usedKeys = await db.keys.count({ used: true });
  const revokedKeys = await db.keys.count({ revoked: true });
  const totalUsers = await db.users.count({});
  const blockedUsers = await db.users.count({ blocked: true });
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const recentLogs = await db.logs.count({ timestamp: { $gt: yesterday } });
  res.json({ success: true, stats: { totalKeys, usedKeys, revokedKeys, totalUsers, blockedUsers, recentLogs } });
});

app.get('/api/admin/keys', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const keys = await db.keys.find({}).sort({ created_at: -1 });
  res.json({ success: true, data: keys });
});

app.get('/api/admin/users', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const users = await db.users.find({}, { password: 0 }).sort({ created_at: -1 });
  res.json({ success: true, data: users });
});

app.get('/api/admin/logs', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const logs = await db.logs.find({}).sort({ timestamp: -1 }).limit(200);
  res.json({ success: true, data: logs });
});

app.post('/api/admin/generate-keys', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const { quantity = 1, expires_in_days, note } = req.body;
  const created = [];
  const now = new Date().toISOString();

  for (let i = 0; i < Math.min(quantity, 100); i++) {
    const id = `COREUP-${uuidv4().toUpperCase().slice(0, 8)}-${uuidv4().toUpperCase().slice(0, 4)}`;
    const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000).toISOString() : null;
    await db.keys.insert({ id, created_at: now, expires_at: expiresAt, used: false, revoked: false, hwid: null, username: null, note: note || '' });
    created.push(id);
  }
  res.json({ success: true, keys: created });
});

app.post('/api/admin/revoke-key', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  await db.keys.update({ id: req.body.key_id }, { $set: { revoked: true } });
  res.json({ success: true, message: 'Key revogada.' });
});

app.post('/api/admin/reset-hwid', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const key = await db.keys.findOne({ id: req.body.key_id });
  if (!key) return res.json({ success: false, message: 'Key não encontrada.' });
  await db.keys.update({ id: req.body.key_id }, { $set: { hwid: null } });
  if (key.username) await db.users.update({ username: key.username }, { $set: { hwid: null } });
  res.json({ success: true, message: 'HWID resetado com sucesso.' });
});

app.post('/api/admin/toggle-block-user', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const user = await db.users.findOne({ username: req.body.username });
  if (!user) return res.json({ success: false, message: 'Usuário não encontrado.' });
  const newState = !user.blocked;
  await db.users.update({ username: req.body.username }, { $set: { blocked: newState } });
  res.json({ success: true, blocked: newState, message: newState ? 'Usuário bloqueado.' : 'Usuário desbloqueado.' });
});

app.post('/api/admin/delete-user', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const user = await db.users.findOne({ username: req.body.username });
  if (!user) return res.json({ success: false, message: 'Usuário não encontrado.' });
  await db.keys.update({ id: user.key_id }, { $set: { used: false, hwid: null, username: null } });
  await db.users.remove({ username: req.body.username }, {});
  res.json({ success: true, message: 'Usuário deletado e key liberada.' });
});

// Criar pasta data se não existir
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

app.listen(PORT, () => {
  console.log(`\n🚀 Core UP License Server na porta ${PORT}`);
  console.log(`🔐 Painel Admin: http://localhost:${PORT}`);
  console.log(`🔑 Senha admin: ${ADMIN_PASSWORD}`);
  console.log(`\n⚠️  MUDE a ADMIN_PASSWORD antes de colocar online!\n`);
});
