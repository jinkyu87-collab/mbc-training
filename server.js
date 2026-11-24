// 문화방송 파견근로자 사전교육 서버
// 에이스휴먼파워(주)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ace1234!';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('mbc::' + ADMIN_PASSWORD).digest('hex');
const MIN_WATCH = parseInt(process.env.MIN_WATCH_SECONDS || '360', 10); // 최소 시청 약 6분 20초 (교육 약 7분)
const CLIENT_NAME = process.env.CLIENT_NAME || '문화방송';
const AGENCY_NAME = process.env.AGENCY_NAME || '에이스휴먼파워';
const CERT_PREFIX = process.env.CERT_PREFIX || 'MBC';
const SITES = (process.env.SITES || '').split(',').map(s => s.trim()).filter(Boolean);
const CONTACTS = (process.env.CONTACTS || '').split('|').map(s => s.trim()).filter(Boolean); // 첫 출근 확인 연락처 (| 로 구분)
const PASS_SCORE = 4; // 5문항 중 4문항 이상

// ───────── 확인 퀴즈 (정답은 서버에만 보관) ─────────
const QUIZ = [
  { q: '동료가 출입증을 깜빡했다며 문을 잡아 달라고 합니다. 올바른 행동은?',
    options: ['급하다고 하니 함께 들여보낸다', '내 출입증을 잠깐 빌려준다', '함께 들이지 않고 보안데스크로 안내한다', '모르는 척 지나간다'], answer: 2,
    explain: '출입증은 본인만 사용합니다. 권한이 없거나 카드가 인식되지 않으면 보안데스크나 현장 담당자에게 확인하도록 안내합니다.' },
  { q: '선배가 사다리에 올라가 조명 각도만 바꿔 달라고 합니다. 담당 업무가 아니라면?',
    options: ['각도만 바꾸는 거니 잠깐 올라간다', '조명·전기 담당자에게 확인하고 직접 올라가지 않는다', '리프트를 직접 조작한다', '아래에서 사다리를 잡아 주며 함께 작업한다'], answer: 1,
    explain: '담당 업무와 교육, 현장 승인이 확인되지 않았다면 사다리나 리프트에 오르지 않고, 조명과 전원은 지정 담당자에게 맡깁니다.' },
  { q: '인터넷에서 찾은 사진을 본방송과 예고 릴스에 쓰자는 요청을 받았습니다. 먼저 할 일은?',
    options: ['출처만 적으면 되므로 바로 쓴다', '본방송에만 쓰고 릴스는 몰래 올린다', '사용 매체별로 이용 범위를 제작·권리 담당자에게 확인한다', '다운로드가 되면 사용해도 된다'], answer: 2,
    explain: '내려받을 수 있다고 사용 허락이 있는 것은 아닙니다. 본방송, 다시보기, SNS 사용 범위를 각각 확인하고, 확인된 범위 안에서만 씁니다.' },
  { q: '출연자 연락처 파일을 엉뚱한 주소로 보냈습니다. 무엇을 먼저 해야 할까요?',
    options: ['회수 여부를 확인한 뒤에 보고한다', '추가 전송을 멈추고 지정 담당자에게 즉시 알린다', '아무에게도 말하지 않고 넘어간다', '받은 사람에게 개인 메신저로 부탁한다'], answer: 1,
    explain: '회수 여부를 기다리지 말고, 누구에게 어떤 자료를 언제 보냈는지 지정 담당자에게 바로 알립니다.' },
  { q: '촬영장에서 조명 스탠드가 넘어졌습니다. 다친 사람이 없다면 올바른 행동은?',
    options: ['다친 사람이 없으니 보고하지 않는다', '혼자 세워 두고 일을 계속한다', '주변에 알리고 안전한 곳으로 이동한 뒤 현장 책임자에게 즉시 보고한다', '퇴근 후에 말한다'], answer: 2,
    explain: '다친 사람이 없는 아차사고도 보고합니다. 어디서, 무슨 일이, 다친 사람은 있는지, 어떤 조치를 했는지 짧게 전하세요.' },
];

// ───────── 저장소: DATABASE_URL 있으면 Postgres, 없으면 JSON 파일 ─────────
function createStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
    });
    return {
      kind: 'postgres',
      async init() {
        await pool.query(`CREATE TABLE IF NOT EXISTS training_records (
          id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
      },
      async get(id) {
        const r = await pool.query('SELECT data FROM training_records WHERE id=$1', [id]);
        return r.rows[0] ? r.rows[0].data : null;
      },
      async put(rec) {
        await pool.query(
          'INSERT INTO training_records(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
          [rec.id, rec]);
      },
      async list() {
        const r = await pool.query('SELECT data FROM training_records ORDER BY created_at DESC');
        return r.rows.map(x => x.data);
      },
      async remove(id) { await pool.query('DELETE FROM training_records WHERE id=$1', [id]); },
    };
  }
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'records.json');
  let map = new Map();
  const persist = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...map.values()]));
    fs.renameSync(tmp, file);
  };
  return {
    kind: 'file:' + file,
    async init() {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file)) {
        for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) map.set(r.id, r);
      }
    },
    async get(id) { return map.get(id) || null; },
    async put(rec) { map.set(rec.id, rec); persist(); },
    async list() { return [...map.values()].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')); },
    async remove(id) { map.delete(id); persist(); },
  };
}
const store = createStore();

// ───────── 유틸 ─────────
const now = () => new Date();
const kstDate = d => {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
};
const makeCertNo = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) s += chars[b % chars.length];
  return `${CERT_PREFIX}-${kstDate(now())}-${s}`;
};
const maskName = n => !n ? '' : n.length <= 2 ? n[0] + '*' : n[0] + '*'.repeat(n.length - 2) + n[n.length - 1];
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const exp = Date.now() + 12 * 3600 * 1000; return `${exp}.${sign('admin:' + exp)}`; };
const checkToken = t => {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign('admin:' + exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
};
const elapsedSec = rec => Math.floor((Date.now() - new Date(rec.startedAt).getTime()) / 1000);
const clean = (s, max) => String(s || '').trim().slice(0, max);
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ───────── 앱 ─────────
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '400kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/verify', (req, res) => res.sendFile(path.join(__dirname, 'public', 'verify.html')));

app.get('/api/config', (req, res) => {
  res.json({ client: CLIENT_NAME, agency: AGENCY_NAME, sites: SITES, contacts: CONTACTS, minWatch: MIN_WATCH, passScore: PASS_SCORE, quizTotal: QUIZ.length });
});

app.get('/api/quiz', (req, res) => {
  res.json(QUIZ.map((x, i) => ({ id: i, q: x.q, options: x.options })));
});

// 1) 교육 시작 (인적사항 등록)
app.post('/api/sessions', ah(async (req, res) => {
  const name = clean(req.body.name, 20);
  const birth = clean(req.body.birth, 6).replace(/\D/g, '');
  const phone = clean(req.body.phone, 20).replace(/\D/g, '');
  const site = clean(req.body.site, 60);
  if (name.length < 2) return res.status(400).json({ error: '이름을 정확히 입력해 주세요.' });
  if (birth.length !== 6) return res.status(400).json({ error: '생년월일 6자리를 입력해 주세요. (예: 850312)' });
  if (phone.length < 10 || phone.length > 11) return res.status(400).json({ error: '휴대폰 번호를 정확히 입력해 주세요.' });
  if (!site) return res.status(400).json({ error: '투입 부서를 입력해 주세요.' });
  if (!req.body.consent) return res.status(400).json({ error: '개인정보 수집·이용에 동의해야 교육을 시작할 수 있습니다.' });
  const rec = {
    id: crypto.randomUUID(), status: 'started', name, birth, phone, site, agency: AGENCY_NAME,
    startedAt: now().toISOString(), completedAt: null, watchSeconds: 0, lastSlide: 0,
    quizScore: null, quizAttempts: 0, quizPassed: false, certNo: null, signature: null,
    ip: req.ip, ua: clean(req.headers['user-agent'], 200),
  };
  await store.put(rec);
  res.json({ id: rec.id, minWatch: MIN_WATCH });
}));

app.get('/api/sessions/:id', ah(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  res.json({ status: rec.status, quizPassed: rec.quizPassed, certNo: rec.certNo });
}));

// 2) 시청 진행 보고 (실제 경과시간보다 많이 기록될 수 없음)
app.post('/api/sessions/:id/progress', ah(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  if (rec.status === 'completed') return res.json({ ok: true });
  const v = Math.max(0, parseInt(req.body.visibleSeconds, 10) || 0);
  rec.watchSeconds = Math.max(rec.watchSeconds || 0, Math.min(v, elapsedSec(rec) + 5));
  rec.lastSlide = parseInt(req.body.slide, 10) || 0;
  await store.put(rec);
  res.json({ ok: true, watchSeconds: rec.watchSeconds });
}));

// 3) 확인 퀴즈 채점
app.post('/api/sessions/:id/quiz', ah(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  if (rec.watchSeconds < MIN_WATCH || elapsedSec(rec) < MIN_WATCH) {
    return res.status(400).json({ error: '교육 시청 시간이 부족합니다. 교육 화면을 끝까지 시청해 주세요.', code: 'WATCH' });
  }
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const wrong = [];
  QUIZ.forEach((x, i) => { if (Number(answers[i]) !== x.answer) wrong.push({ id: i, explain: x.explain }); });
  const score = QUIZ.length - wrong.length;
  rec.quizAttempts = (rec.quizAttempts || 0) + 1;
  rec.quizScore = Math.max(rec.quizScore || 0, score);
  if (score >= PASS_SCORE) rec.quizPassed = true;
  await store.put(rec);
  res.json({ score, total: QUIZ.length, passed: score >= PASS_SCORE, wrong });
}));

// 4) 서약·서명 → 이수 완료
app.post('/api/sessions/:id/complete', ah(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  if (rec.status === 'completed') return res.json(certOf(rec));
  if (!rec.quizPassed) return res.status(400).json({ error: '확인 퀴즈를 먼저 통과해 주세요.' });
  const sig = String(req.body.signature || '');
  if (!sig.startsWith('data:image/png;base64,') || sig.length > 300000) return res.status(400).json({ error: '서명을 다시 해 주세요.' });
  if (!req.body.pledge) return res.status(400).json({ error: '준수 서약에 모두 체크해 주세요.' });
  rec.signature = sig;
  rec.status = 'completed';
  rec.completedAt = now().toISOString();
  rec.certNo = makeCertNo();
  await store.put(rec);
  res.json(certOf(rec));
}));
const certOf = rec => ({ certNo: rec.certNo, name: rec.name, site: rec.site, completedAt: rec.completedAt, watchSeconds: rec.watchSeconds, quizScore: rec.quizScore, total: QUIZ.length });

// 이수번호 조회 (현장 관리자용, 이름 일부 가림)
app.get('/api/verify/:certNo', ah(async (req, res) => {
  const no = clean(req.params.certNo, 30).toUpperCase();
  const rec = (await store.list()).find(r => r.certNo === no);
  if (!rec) return res.status(404).json({ error: '해당 이수번호를 찾을 수 없습니다.' });
  res.json({ certNo: rec.certNo, name: maskName(rec.name), site: rec.site, completedAt: rec.completedAt });
}));

// ───────── 관리자 ─────────
app.post('/api/admin/login', (req, res) => {
  const pw = String(req.body.password || '');
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: '비밀번호가 맞지 않습니다.' });
  res.json({ token: makeToken() });
});
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!checkToken(t)) return res.status(401).json({ error: '다시 로그인해 주세요.' });
  next();
};
app.get('/api/admin/records', auth, ah(async (req, res) => {
  const rows = (await store.list()).map(({ signature, ...r }) => ({ ...r, hasSignature: !!signature }));
  res.json({ records: rows, minWatch: MIN_WATCH, quizTotal: QUIZ.length });
}));
app.get('/api/admin/records/:id/signature', auth, ah(async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  res.json({ signature: rec.signature });
}));
app.delete('/api/admin/records/:id', auth, ah(async (req, res) => {
  await store.remove(req.params.id);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

store.init().then(() => {
  app.listen(PORT, () => console.log(`[교육서버] http://localhost:${PORT}  storage=${store.kind}  minWatch=${MIN_WATCH}s`));
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠ ADMIN_PASSWORD 미설정 — 기본 비밀번호 사용 중. 배포 시 반드시 설정하세요.');
}).catch(e => { console.error('저장소 초기화 실패', e); process.exit(1); });
