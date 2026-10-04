// Função serverless da Vercel: guarda os dados do painel num Redis (Upstash) protegido por senha.
// Variáveis de ambiente: PAINEL_SENHA (você define) e KV_REST_API_URL / KV_REST_API_TOKEN (vêm da integração Upstash).
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'painelpupuy:data';

function senhaOk(recebida) {
  const esperada = process.env.PAINEL_SENHA || '';
  if (!esperada || typeof recebida !== 'string') return false;
  const a = crypto.createHash('sha256').update(recebida).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN || !process.env.PAINEL_SENHA) {
    return res.status(500).json({ erro: 'Servidor sem configuração (banco ou senha).' });
  }
  if (!senhaOk(req.headers['x-painel-senha'])) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  const auth = { Authorization: `Bearer ${TOKEN}` };
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${URL_}/get/${encodeURIComponent(KEY)}`, { headers: auth });
      const { result } = await r.json();
      if (!result) return res.status(404).json({ erro: 'Sem dados ainda.' });
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(result);
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.items)) return res.status(400).json({ erro: 'Dados inválidos.' });
      const r = await fetch(`${URL_}/set/${encodeURIComponent(KEY)}`, {
        method: 'POST', headers: auth, body: JSON.stringify(body),
      });
      if (!r.ok) return res.status(502).json({ erro: 'Falha ao gravar no banco.' });
      return res.status(204).end();
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  } catch {
    return res.status(500).json({ erro: 'Erro interno.' });
  }
};
