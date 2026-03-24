
const STORAGE_KEYS = {
  questions: 'etqb_questions',
  practiceRecords: 'etqb_practice_records',
  examRecords: 'etqb_exam_records',
  examQuestions: 'etqb_exam_questions',
  wrongQuestions: 'etqb_wrong_questions',
  favoriteQuestions: 'etqb_favorite_questions',
  fullBankApplied: 'etqb_full_bank_applied',
  fullBankSize: 'etqb_full_bank_size',
  examBankScope: 'etqb_exam_bank_scope',
  localSelectedUser: 'etqb_local_selected_user',
  localUsersMap: 'etqb_local_users_map',
  localLastSyncAt: 'etqb_local_last_sync_at'
};

const DEFAULT_CHAPTERS = [
  '第一章 电力市场基础',
  '第二章 电力市场服务',
  '第三章 电力中长期市场',
  '第四章 电力现货市场',
  '第五章 电力辅助服务市场',
  '第六章 市场合同',
  '第七章 信息披露',
  '第八章 电力市场技术支持系统及应用',
  '第九章 合规建设',
  '第十章 电力市场政策解析'
];

const TYPE_MAP = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题',
  calc: '计算题',
  essay: '论述题'
};

const AUTO_GRADE_TYPES = ['single', 'multiple', 'judge'];

const appState = {
  practice: null,
  exam: null,
  importPreview: [],
  selectedChapterIndex: 0,
  examBankScope: 'all',
  localUserId: 'default',
  localUserStatus: '本地用户未初始化',
  localUsers: []
};

const db = {
  questions: [],
  practiceRecords: [],
  examRecords: [],
  examQuestions: [],
  wrongQuestions: [],
  favoriteQuestions: []
};

function getChapters() {
  const fromBank = Array.from(new Set(
    db.questions
      .map((q) => String(q?.chapter || '').trim())
      .filter(Boolean)
  ));
  if (!fromBank.length) return [...DEFAULT_CHAPTERS];
  const orderMap = new Map(DEFAULT_CHAPTERS.map((ch, idx) => [ch, idx]));
  return fromBank.sort((a, b) => {
    const oa = orderMap.has(a) ? orderMap.get(a) : Number.MAX_SAFE_INTEGER;
    const ob = orderMap.has(b) ? orderMap.get(b) : Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

let localUserSyncTimer = null;
let localUserSyncInFlight = false;

function uid(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function normalizeLocalUserId(raw) {
  return String(raw || '').trim().slice(0, 64);
}

function getLocalSelectedUser() {
  const stored = normalizeLocalUserId(readStore(STORAGE_KEYS.localSelectedUser, 'default'));
  return stored || 'default';
}

function setLocalSelectedUser(userId) {
  const normalized = normalizeLocalUserId(userId) || 'default';
  appState.localUserId = normalized;
  writeStore(STORAGE_KEYS.localSelectedUser, normalized);
}

function setLocalUserStatus(text) {
  appState.localUserStatus = text;
  const el = document.getElementById('localUserStatus');
  if (el) el.textContent = text;
}

function buildProgressStatePayload() {
  return {
    practiceRecords: db.practiceRecords,
    examRecords: db.examRecords,
    examQuestions: db.examQuestions,
    wrongQuestions: db.wrongQuestions,
    favoriteQuestions: db.favoriteQuestions
  };
}

function applyProgressState(payload) {
  db.practiceRecords = Array.isArray(payload?.practiceRecords) ? payload.practiceRecords : [];
  db.examRecords = Array.isArray(payload?.examRecords) ? payload.examRecords : [];
  db.examQuestions = Array.isArray(payload?.examQuestions) ? payload.examQuestions : [];
  db.wrongQuestions = Array.isArray(payload?.wrongQuestions) ? payload.wrongQuestions : [];
  db.favoriteQuestions = Array.isArray(payload?.favoriteQuestions) ? payload.favoriteQuestions : [];
}

function getLocalUsersMap() {
  const m = readStore(STORAGE_KEYS.localUsersMap, {});
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  return m;
}

function writeLocalUsersMap(m) {
  writeStore(STORAGE_KEYS.localUsersMap, m || {});
}

function setProgressStateEmpty() {
  db.practiceRecords = [];
  db.examRecords = [];
  db.examQuestions = [];
  db.wrongQuestions = [];
  db.favoriteQuestions = [];
  appState.practice = null;
  appState.exam = null;
  appState.importPreview = [];
  writeStore(STORAGE_KEYS.localLastSyncAt, null);
}

async function refreshLocalUsers() {
  const map = getLocalUsersMap();
  const users = Object.entries(map).map(([userId, item]) => ({
    userId,
    updatedAt: String(item?.updatedAt || '')
  }));
  users.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || '') * -1);
  appState.localUsers = users;
  return true;
}

async function saveLocalUserState(showNotice = false) {
  if (!appState.localUserId || localUserSyncInFlight) return false;
  try {
    localUserSyncInFlight = true;
    const updatedAt = new Date().toISOString();
    const map = getLocalUsersMap();
    map[appState.localUserId] = {
      updatedAt,
      state: buildProgressStatePayload()
    };
    writeLocalUsersMap(map);
    writeStore(STORAGE_KEYS.localLastSyncAt, updatedAt);
    setLocalUserStatus(`当前用户：${appState.localUserId}（已保存 ${formatTime(updatedAt)}）`);
    if (showNotice) alert(`用户 ${appState.localUserId} 的进度已保存。`);
    await refreshLocalUsers();
    return true;
  } catch (err) {
    setLocalUserStatus(`本地保存失败：${err.message}`);
    if (showNotice) alert(`保存失败：${err.message}`);
    return false;
  } finally {
    localUserSyncInFlight = false;
  }
}

function scheduleLocalUserAutoSave() {
  if (!appState.localUserId) return;
  clearTimeout(localUserSyncTimer);
  localUserSyncTimer = setTimeout(() => { saveLocalUserState(false); }, 800);
}

async function loadLocalUserState(userId, showNotice = false) {
  const target = normalizeLocalUserId(userId);
  if (!target) return false;
  try {
    setLocalSelectedUser(target);
    const map = getLocalUsersMap();
    const item = map[target];
    if (item?.state) {
      applyProgressState(item.state);
      appState.practice = null;
      appState.exam = null;
      appState.importPreview = [];
      writeStore(STORAGE_KEYS.localLastSyncAt, item.updatedAt || new Date().toISOString());
      saveAll();
      setLocalUserStatus(`当前用户：${target}（已加载 ${formatTime(readStore(STORAGE_KEYS.localLastSyncAt, null))}）`);
      if (showNotice) alert(`已切换到用户 ${target}。`);
    } else {
      setProgressStateEmpty();
      saveAll();
      await saveLocalUserState(false);
      setLocalUserStatus(`当前用户：${target}（新用户，已创建空进度）`);
      if (showNotice) alert(`用户 ${target} 不存在，已新建并初始化。`);
    }
    await refreshLocalUsers();
    return true;
  } catch (err) {
    setLocalUserStatus(`读取用户失败：${err?.message || err}`);
    if (showNotice) alert(`切换用户失败：${err.message}`);
    return false;
  }
}

async function switchLocalUser(userId, showNotice = false) {
  const target = normalizeLocalUserId(userId);
  if (!target) {
    if (showNotice) alert('请输入用户名称。');
    return false;
  }
  if (target === appState.localUserId) return true;
  await saveLocalUserState(false);
  return loadLocalUserState(target, showNotice);
}

function saveAll() {
  writeStore(STORAGE_KEYS.questions, db.questions);
  writeStore(STORAGE_KEYS.practiceRecords, db.practiceRecords);
  writeStore(STORAGE_KEYS.examRecords, db.examRecords);
  writeStore(STORAGE_KEYS.examQuestions, db.examQuestions);
  writeStore(STORAGE_KEYS.wrongQuestions, db.wrongQuestions);
  writeStore(STORAGE_KEYS.favoriteQuestions, db.favoriteQuestions);
  scheduleLocalUserAutoSave();
}

function clearLearningRecords() {
  setProgressStateEmpty();
  saveAll();
}

function sampleQuestions() {
  return [
    { id:'q_1001', chapter:DEFAULT_CHAPTERS[0], questionType:'single', stem:'电力市场中，以下哪一项最能体现“市场化交易”特征？', options:['统一计划电量分配','通过市场规则形成交易价格','行政命令直接定价','取消全部结算机制'], correctAnswer:'B', analysis:'市场化交易的核心是通过竞价、撮合等机制形成价格与交易结果。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1002', chapter:DEFAULT_CHAPTERS[0], questionType:'single', stem:'电力市场成员通常不包括以下哪类主体？', options:['发电企业','售电公司','电力用户','天气预报机构（非市场主体）'], correctAnswer:'D', analysis:'常见市场成员包括发电侧、售电侧、用电侧及相关机构。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1003', chapter:DEFAULT_CHAPTERS[0], questionType:'multiple', stem:'关于电力市场交易组织，通常正确的说法有：', options:['交易规则应公开透明','交易结果应可追溯','可以完全脱离结算规则','市场信息应按要求披露'], correctAnswer:['A','B','D'], analysis:'交易组织强调公开透明、可追溯和规范披露。', difficulty:'中等', source:'示例题库', isActive:true },
    { id:'q_1004', chapter:DEFAULT_CHAPTERS[0], questionType:'judge', stem:'判断：电力现货市场出清价格通常由市场供需关系形成。', options:['正确','错误'], correctAnswer:'正确', analysis:'现货市场价格通常由供需和规则共同决定。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1005', chapter:DEFAULT_CHAPTERS[1], questionType:'single', stem:'售电公司开展业务前，通常需要满足的基本条件是：', options:['在交易平台注册并具备相应资质','仅需签署用户协议','无需履约能力证明','无需遵守信息披露要求'], correctAnswer:'A', analysis:'售电公司一般需完成市场准入及平台相关登记。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1006', chapter:DEFAULT_CHAPTERS[1], questionType:'multiple', stem:'电力市场服务机构在业务中应重点关注：', options:['合规运营','数据安全','风险控制','随意变更结算口径'], correctAnswer:['A','B','C'], analysis:'合规、数据安全与风控是市场服务的基础要求。', difficulty:'中等', source:'示例题库', isActive:true },
    { id:'q_1007', chapter:DEFAULT_CHAPTERS[1], questionType:'judge', stem:'判断：售电公司可以不经用户授权代理其参与市场交易。', options:['正确','错误'], correctAnswer:'错误', analysis:'通常需要合法授权与合同依据。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1008', chapter:DEFAULT_CHAPTERS[0], questionType:'single', stem:'以下哪项通常不属于中长期交易合同关键要素？', options:['电量','价格','履约周期','天气颜色偏好'], correctAnswer:'D', analysis:'合同关键要素应与交易执行和结算相关。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_1009', chapter:DEFAULT_CHAPTERS[1], questionType:'single', stem:'售电公司客户服务中，最关键的基础能力之一是：', options:['负荷预测与用能分析','随意更改用户档案','回避信息披露','取消结算校核'], correctAnswer:'A', analysis:'负荷预测能力直接影响购售电策略与服务质量。', difficulty:'中等', source:'示例题库', isActive:true },
    { id:'q_1010', chapter:DEFAULT_CHAPTERS[0], questionType:'judge', stem:'判断：多选题只要选到一个正确选项就可以得分。', options:['正确','错误'], correctAnswer:'错误', analysis:'本系统多选题必须与标准答案完全一致才得分。', difficulty:'基础', source:'示例题库', isActive:true },
    { id:'q_2001', chapter:DEFAULT_CHAPTERS[2], questionType:'blank', stem:'填空：中长期合同中常见的结算周期可以是“月度”或“____”。', options:[], correctAnswer:'周度/季度（按规则约定）', analysis:'不同省份规则会有差异，此处为示例参考答案。', difficulty:'中等', source:'示例题库', isActive:true },
    { id:'q_2002', chapter:DEFAULT_CHAPTERS[3], questionType:'short', stem:'简答：请简述电力现货市场出清的基本流程。', options:[], correctAnswer:'参考答案：报价提交、边界约束校核、优化出清、结果发布与结算。', analysis:'不同市场规则存在细节差异。', difficulty:'中等', source:'示例题库', isActive:true }
  ];
}

function normalizeQuestionList(list) {
  return (list || []).map((q, i) => {
    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const options = rawOptions.map((x) => String(x || '').trim()).filter((x) => x);
    let correctAnswer = q.correctAnswer;
    if (q.questionType === 'multiple' && !Array.isArray(correctAnswer)) {
      correctAnswer = String(correctAnswer || '').toUpperCase().match(/[A-E]/g) || [];
    }
    if (q.questionType === 'single' && Array.isArray(correctAnswer)) {
      correctAnswer = correctAnswer[0] || '';
    }
    return {
      id: q.id || `q_auto_${i + 1}`,
      chapter: q.chapter || DEFAULT_CHAPTERS[0],
      questionType: q.questionType || 'single',
      stem: q.stem || '',
      options,
      correctAnswer,
      analysis: q.analysis || '暂无解析',
      difficulty: q.difficulty || '未设置',
      source: q.source || '导入题库',
      isActive: q.isActive !== false
    };
  });
}

function getDefaultQuestionBank() {
  const full = window.FULL_QUESTION_BANK;
  if (Array.isArray(full) && full.length) return normalizeQuestionList(full);
  return sampleQuestions();
}

function loadData() {
  appState.localUserId = getLocalSelectedUser();
  appState.examBankScope = readStore(STORAGE_KEYS.examBankScope, 'all') || 'all';
  db.questions = readStore(STORAGE_KEYS.questions, []);
  db.practiceRecords = readStore(STORAGE_KEYS.practiceRecords, []);
  db.examRecords = readStore(STORAGE_KEYS.examRecords, []);
  db.examQuestions = readStore(STORAGE_KEYS.examQuestions, []);
  db.wrongQuestions = readStore(STORAGE_KEYS.wrongQuestions, []);
  db.favoriteQuestions = readStore(STORAGE_KEYS.favoriteQuestions, []);
  const fullBank = getDefaultQuestionBank();
  const fullBankSize = Array.isArray(fullBank) ? fullBank.length : 0;
  const storedFullBankSize = readStore(STORAGE_KEYS.fullBankSize, 0);
  if (db.questions.length === 0) {
    db.questions = fullBank;
    writeStore(STORAGE_KEYS.fullBankApplied, true);
    writeStore(STORAGE_KEYS.fullBankSize, fullBankSize);
    saveAll();
  } else {
    db.questions = normalizeQuestionList(db.questions);
    const applied = readStore(STORAGE_KEYS.fullBankApplied, false);
    if (Array.isArray(window.FULL_QUESTION_BANK) && window.FULL_QUESTION_BANK.length && (!applied || storedFullBankSize !== fullBankSize) && db.questions.length !== fullBank.length) {
      db.questions = fullBank;
      writeStore(STORAGE_KEYS.fullBankApplied, true);
      writeStore(STORAGE_KEYS.fullBankSize, fullBankSize);
      saveAll();
    }
  }

  const usersMap = getLocalUsersMap();
  const hasUsers = Object.keys(usersMap).length > 0;
  const hasLegacyProgress = db.practiceRecords.length || db.examRecords.length || db.examQuestions.length || db.wrongQuestions.length || db.favoriteQuestions.length;
  if (!hasUsers && hasLegacyProgress) {
    usersMap[appState.localUserId] = {
      updatedAt: new Date().toISOString(),
      state: buildProgressStatePayload()
    };
    writeLocalUsersMap(usersMap);
  }
}

function updateExamBankScopeFromUI() {
  const val = document.getElementById('examBankScope')?.value || 'all';
  appState.examBankScope = ['original', 'supplement', 'all'].includes(val) ? val : 'all';
  writeStore(STORAGE_KEYS.examBankScope, appState.examBankScope);
}

function escapeHtml(str) {
  return String(str || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function getQuestionById(id) { return db.questions.find((q) => q.id === id); }
function goto(route) { location.hash = route; }

function getStats() {
  const total = db.questions.filter((q) => q.isActive).length;
  const practicedSet = new Set(db.practiceRecords.map((r) => r.questionId));
  const graded = db.practiceRecords.filter((r) => typeof r.isCorrect === 'boolean');
  const correct = graded.filter((r) => r.isCorrect).length;
  const accuracy = graded.length ? ((correct / graded.length) * 100).toFixed(1) : '0.0';
  const recent = db.practiceRecords.reduce((max, r) => (!max || new Date(r.createdAt) > new Date(max.createdAt) ? r : max), null);
  const wrongCount = db.wrongQuestions.filter((w) => !w.isMastered).length;
  return { total, practiced: practicedSet.size, accuracy, recent: recent ? recent.createdAt : null, wrongCount };
}

function chapterStats(chapter) {
  const chapterQuestions = db.questions.filter((q) => q.chapter === chapter && q.isActive);
  const ids = new Set(chapterQuestions.map((q) => q.id));
  const chapterRecords = db.practiceRecords.filter((r) => ids.has(r.questionId) && typeof r.isCorrect === 'boolean');
  const correct = chapterRecords.filter((r) => r.isCorrect).length;
  return { count: chapterQuestions.length, accuracy: chapterRecords.length ? ((correct / chapterRecords.length) * 100).toFixed(1) : '0.0' };
}

function setHeader(title, subtitle) {
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;
}

function activeNav(hash) {
  const route = hash.startsWith('#/chapter/') ? '#/chapters' : hash.startsWith('#/exam-result/') ? '#/exam' : hash;
  document.querySelectorAll('#mainNav button').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
}

function renderDashboard() {
  const s = getStats();
  const chapters = getChapters();
  const localLastSync = readStore(STORAGE_KEYS.localLastSyncAt, null);
  const localUsers = Array.isArray(appState.localUsers) ? appState.localUsers : [];
  const userOptions = localUsers.length
    ? localUsers.map((u) => `<option value="${escapeHtml(u.userId)}" ${u.userId === appState.localUserId ? 'selected' : ''}>${escapeHtml(u.userId)}</option>`).join('')
    : `<option value="${escapeHtml(appState.localUserId)}">${escapeHtml(appState.localUserId)}</option>`;
  return `
  <div class="grid cards-5">
    <article class="card"><div class="label">总题量</div><div class="metric">${s.total}</div></article>
    <article class="card"><div class="label">已练习题数</div><div class="metric">${s.practiced}</div></article>
    <article class="card"><div class="label">正确率</div><div class="metric">${s.accuracy}%</div></article>
    <article class="card"><div class="label">最近一次练习</div><div class="metric" style="font-size:16px;">${formatTime(s.recent)}</div></article>
    <article class="card"><div class="label">错题数量</div><div class="metric">${s.wrongCount}</div></article>
  </div>
  <div class="card" style="margin-top:12px;">
    <h3>快捷入口</h3>
    <div class="row" style="margin-top:10px;">
      <button class="btn primary" data-route="#/chapters">按章节刷题</button>
      <button class="btn" data-route="#/exam">模拟考试</button>
      <button class="btn" data-route="#/wrongs">错题重刷</button>
      <button class="btn" data-route="#/favorites">收藏题目</button>
      <button class="btn" data-route="#/stats">学习统计</button>
      <button class="btn danger" data-act="clear-learning-records">清空学习记录</button>
    </div>
  </div>
  <div class="card" style="margin-top:12px;">
    <h3>本地用户进度</h3>
    <p class="hint" style="margin-top:6px;">无需服务器。数据保存在当前浏览器本地存储，不同用户使用独立进度。</p>
    <div class="filter" style="margin-top:8px;">
      <select id="localUserSelect">${userOptions}</select>
      <input id="localUserInput" type="text" placeholder="输入新用户名（如 lisi）" />
    </div>
    <div class="row" style="margin-top:8px;">
      <button class="btn" data-act="switch-local-user">切换用户</button>
      <button class="btn primary" data-act="save-local-user">保存当前进度</button>
      <button class="btn" data-act="refresh-local-users">刷新用户列表</button>
    </div>
    <p class="hint" id="localUserStatus" style="margin-top:8px;">${escapeHtml(appState.localUserStatus || `当前用户：${appState.localUserId}`)}</p>
    <p class="hint">最近本地保存：${formatTime(localLastSync)}</p>
  </div>
  <div class="grid cards-3" style="margin-top:12px;">
    ${chapters.slice(0,3).map((c,i)=>{const st=chapterStats(c);return `<article class="card"><h3>${c}</h3><p class="hint" style="margin-top:8px;">题量 ${st.count} | 正确率 ${st.accuracy}%</p><button class="btn" style="margin-top:10px;" data-route="#/chapter/${i}">进入章节</button></article>`;}).join('')}
  </div>`;
}

function renderChapters() {
  const chapters = getChapters();
  return `<div class="grid cards-3">${chapters.map((ch,idx)=>{const st=chapterStats(ch);return `<article class="card"><h3>${ch}</h3><p class="hint" style="margin-top:8px;">题量：${st.count}，历史正确率：${st.accuracy}%</p><div class="row" style="margin-top:10px;"><button class="btn primary" data-route="#/chapter/${idx}">选择题型</button></div></article>`;}).join('')}</div>`;
}

function countByChapterType(chapter, type) {
  return db.questions.filter((q) => q.chapter === chapter && q.questionType === type && q.isActive).length;
}

function renderChapterTypePage() {
  const chapters = getChapters();
  const chapter = chapters[appState.selectedChapterIndex] || chapters[0] || '未分类章节';
  return `<div class="card"><h3>${chapter}</h3><p class="hint" style="margin-top:8px;">请选择题型和练习方式（顺序/随机）。</p></div>
  <div class="grid cards-3" style="margin-top:12px;">
    ${Object.entries(TYPE_MAP).map(([type,label])=>`<article class="card"><h3>${label}</h3><p class="hint" style="margin-top:8px;">题量：${countByChapterType(chapter,type)}</p><div class="row" style="margin-top:10px;"><button class="btn primary" data-act="start-practice" data-mode="ordered" data-chapter="${chapter}" data-type="${type}">顺序练习</button><button class="btn" data-act="start-practice" data-mode="random" data-chapter="${chapter}" data-type="${type}">随机练习</button></div></article>`).join('')}
  </div>
  <div class="card" style="margin-top:12px;"><button class="btn" data-route="#/chapters">返回章节列表</button></div>`;
}

function shuffle(arr) {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

function startPracticeSession({ chapter, type, orderMode, questionIds, mode }) {
  let ids = questionIds;
  if (!ids) ids = db.questions.filter((q) => q.isActive && q.chapter === chapter && q.questionType === type).map((q) => q.id);
  if (!ids.length) { alert('当前筛选下暂无题目。'); return; }
  appState.practice = {
    id: uid('practice'),
    mode: mode || '章节练习',
    chapter: chapter || '混合',
    questionType: type || 'mixed',
    questionIds: orderMode === 'random' ? shuffle(ids) : ids,
    index: 0,
    answers: {},
    draftAnswers: {},
    questionStartAt: Date.now()
  };
  goto('#/practice');
}

function isFavorite(questionId) { return db.favoriteQuestions.some((f) => f.questionId === questionId); }
function wrongEntry(questionId) { return db.wrongQuestions.find((w) => w.questionId === questionId); }

function toggleFavorite(questionId) {
  const q = getQuestionById(questionId);
  if (!q) return;
  const idx = db.favoriteQuestions.findIndex((f) => f.questionId === questionId);
  if (idx >= 0) db.favoriteQuestions.splice(idx, 1);
  else db.favoriteQuestions.push({ id: uid('fav'), questionId, chapter: q.chapter, questionType: q.questionType, createdAt: new Date().toISOString() });
  saveAll();
}

function addWrong(questionId) {
  const q = getQuestionById(questionId);
  if (!q) return;
  const item = wrongEntry(questionId);
  if (!item) {
    db.wrongQuestions.push({ id: uid('wrong'), questionId, chapter: q.chapter, questionType: q.questionType, wrongCount: 1, isMastered: false, lastWrongAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  } else {
    item.wrongCount += 1;
    item.isMastered = false;
    item.lastWrongAt = new Date().toISOString();
  }
}

function setWrongMastered(questionId, mastered) {
  const item = wrongEntry(questionId);
  if (item) {
    item.isMastered = mastered;
    if (mastered) item.masteredAt = new Date().toISOString();
  }
}

function removeWrong(questionId) {
  const idx = db.wrongQuestions.findIndex((w) => w.questionId === questionId);
  if (idx >= 0) db.wrongQuestions.splice(idx, 1);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

function gradeQuestion(question, userAnswer) {
  if (!AUTO_GRADE_TYPES.includes(question.questionType)) return { isCorrect: null, score: 0 };
  if (question.questionType === 'single') return { isCorrect: userAnswer === question.correctAnswer, score: userAnswer === question.correctAnswer ? 1 : 0 };
  if (question.questionType === 'multiple') {
    const ok = arraysEqual(userAnswer || [], question.correctAnswer || []);
    return { isCorrect: ok, score: ok ? 1 : 0 };
  }
  if (question.questionType === 'judge') return { isCorrect: userAnswer === question.correctAnswer, score: userAnswer === question.correctAnswer ? 1 : 0 };
  return { isCorrect: null, score: 0 };
}

function collectPracticeAnswer(question) {
  if (question.questionType === 'single') {
    const checked = document.querySelector('input[name="answer-single"]:checked');
    return checked ? checked.value : null;
  }
  if (question.questionType === 'multiple') return [...document.querySelectorAll('input[name="answer-multiple"]:checked')].map((n) => n.value);
  if (question.questionType === 'judge') return appState.practice?.draftAnswers?.[question.id] || null;
  return null;
}

function toAnswerText(answer) {
  if (answer == null) return '-';
  if (Array.isArray(answer)) return answer.join(',');
  return String(answer);
}

function renderAnswerArea(question, answerState) {
  const submitted = !!answerState?.submitted;
  if (question.questionType === 'single') {
    const selected = answerState?.userAnswer;
    return `<div class="options">${question.options.map((op, i) => {
      const key = String.fromCharCode(65 + i);
      return `<label class="option"><input type="radio" name="answer-single" value="${key}" ${selected === key ? 'checked' : ''} ${submitted ? 'disabled' : ''}/> ${key}. ${escapeHtml(op)}</label>`;
    }).join('')}</div>`;
  }
  if (question.questionType === 'multiple') {
    const selected = Array.isArray(answerState?.userAnswer) ? answerState.userAnswer : [];
    return `<p class="notice">多选题必须全选对才得分，错选、漏选均 0 分。</p><div class="options" style="margin-top:8px;">${question.options.map((op, i) => {
      const key = String.fromCharCode(65 + i);
      return `<label class="option"><input type="checkbox" name="answer-multiple" value="${key}" ${selected.includes(key) ? 'checked' : ''} ${submitted ? 'disabled' : ''}/> ${key}. ${escapeHtml(op)}</label>`;
    }).join('')}</div>`;
  }
  if (question.questionType === 'judge') {
    const selected = answerState?.userAnswer || appState.practice?.draftAnswers?.[question.id];
    return `<div class="row"><button class="btn ${selected === '正确' ? 'primary' : ''}" data-act="pick-judge" data-value="正确" ${submitted ? 'disabled' : ''}>正确</button><button class="btn ${selected === '错误' ? 'danger' : ''}" data-act="pick-judge" data-value="错误" ${submitted ? 'disabled' : ''}>错误</button></div>`;
  }
  return `<p class="notice">当前题型暂不自动判分，仅支持查看题目与参考答案，不纳入自动评分考试。</p><p class="hint" style="margin-top:8px;">参考答案：${escapeHtml(toAnswerText(question.correctAnswer))}</p>`;
}

function renderPractice() {
  const p = appState.practice;
  if (!p) return `<div class="card"><p>暂无进行中的练习，请从章节列表或错题本开始。</p><button class="btn" style="margin-top:10px;" data-route="#/chapters">去刷题</button></div>`;
  const total = p.questionIds.length;
  const q = getQuestionById(p.questionIds[p.index]);
  if (!q) return `<div class="card"><p>当前题目不存在。</p></div>`;
  const ans = p.answers[q.id] || null;
  const answered = Object.values(p.answers).filter((x) => x.submitted).length;
  const graded = Object.values(p.answers).filter((x) => typeof x.isCorrect === 'boolean');
  const correct = graded.filter((x) => x.isCorrect).length;
  const scoreSum = Object.values(p.answers).reduce((s, x) => s + (Number(x.score) || 0), 0);
  const acc = graded.length ? ((correct / graded.length) * 100).toFixed(1) : '0.0';
  const progress = ((p.index + 1) / total) * 100;

  return `<div class="split"><article class="card">
    <div class="row" style="justify-content:space-between;align-items:center;">
      <div><span class="badge">${escapeHtml(p.mode)}</span><span class="badge">${escapeHtml(q.chapter)}</span><span class="badge">${TYPE_MAP[q.questionType] || q.questionType}</span></div>
      <div class="hint">题号 ${p.index + 1} / ${total}</div>
    </div>
    <div class="progress-box" style="margin-top:10px;"><div class="hint">进度 ${progress.toFixed(1)}%</div><div class="progress" style="margin-top:6px;"><span style="width:${progress}%;"></span></div></div>
    <div class="question-stem">${escapeHtml(q.stem)}</div>
    ${renderAnswerArea(q, ans)}
    <div class="row" style="margin-top:12px;">
      <button class="btn success" data-act="submit-practice" ${ans?.submitted ? 'disabled' : ''}>提交判分</button>
      <button class="btn" data-act="prev-practice" ${p.index === 0 ? 'disabled' : ''}>上一题</button>
      <button class="btn" data-act="next-practice" ${p.index >= total - 1 ? 'disabled' : ''}>下一题</button>
      <button class="btn" data-act="toggle-fav">${isFavorite(q.id) ? '取消收藏' : '收藏'}</button>
      <button class="btn" data-act="toggle-wrong">${wrongEntry(q.id) ? '移出错题本' : '加入错题本'}</button>
      <button class="btn" data-act="toggle-show-answer">查看答案</button>
      <button class="btn" data-act="toggle-show-analysis">查看解析</button>
    </div>
    ${ans?.submitted ? `<p style="margin-top:10px;" class="${ans.isCorrect ? 'correct-text' : 'wrong-text'}">${ans.isCorrect === null ? '本题不自动判分。' : ans.isCorrect ? '回答正确。' : '回答错误。'}</p>` : ''}
    ${ans?.showAnswer ? `<p style="margin-top:8px;"><strong>正确答案：</strong>${escapeHtml(toAnswerText(q.correctAnswer))}</p>` : ''}
    ${ans?.showAnalysis ? `<p style="margin-top:8px;"><strong>解析：</strong>${escapeHtml(q.analysis || '暂无解析')}</p>` : ''}
  </article>
  <aside class="card"><h3>本次练习概览</h3><div class="kv" style="margin-top:10px;"><div class="label">已作答</div><div>${answered} / ${total}</div><div class="label">自动判分题</div><div>${graded.length}</div><div class="label">当前得分</div><div>${scoreSum}</div><div class="label">当前正确率</div><div>${acc}%</div><div class="label">当前章节</div><div>${escapeHtml(p.chapter || '混合')}</div><div class="label">当前题型</div><div>${TYPE_MAP[p.questionType] || '混合'}</div></div><div class="row" style="margin-top:12px;"><button class="btn" data-route="#/chapters">返回章节</button><button class="btn" data-act="clear-practice">结束本次练习</button></div></aside></div>`;
}

function submitPracticeAnswer() {
  const p = appState.practice;
  if (!p) return;
  const q = getQuestionById(p.questionIds[p.index]);
  if (!q) return;
  if (p.answers[q.id]?.submitted) return;
  const userAnswer = collectPracticeAnswer(q);
  if (AUTO_GRADE_TYPES.includes(q.questionType)) {
    const empty = userAnswer == null || (Array.isArray(userAnswer) && userAnswer.length === 0);
    if (empty) { alert('请先作答再提交。'); return; }
  }
  const result = gradeQuestion(q, userAnswer);
  const now = new Date().toISOString();
  const spent = Math.max(1, Math.floor((Date.now() - p.questionStartAt) / 1000));
  p.answers[q.id] = { userAnswer, isCorrect: result.isCorrect, score: result.score, submitted: true, showAnswer: true, showAnalysis: true, submittedAt: now };
  db.practiceRecords.push({ id: uid('pr'), session: 'default-session', questionId: q.id, mode: p.mode, userAnswer, isCorrect: result.isCorrect, scoreObtained: result.score, timeSpentSeconds: spent, createdAt: now });
  if (result.isCorrect === false) addWrong(q.id);
  if (result.isCorrect === true && p.mode === '错题重刷') setWrongMastered(q.id, true);
  saveAll();
  render();
}

function drawRandomWithRepeat(pool, count) {
  if (!pool.length) return [];
  if (pool.length >= count) return shuffle(pool).slice(0, count);
  const result = [...pool];
  while (result.length < count) result.push(pool[Math.floor(Math.random() * pool.length)]);
  return shuffle(result).slice(0, count);
}

function examScopeLabel(scope) {
  if (scope === 'original') return '原始题库';
  if (scope === 'supplement') return '补充题库';
  return '全部考题';
}

function isSupplementQuestion(q) {
  const chapter = String(q?.chapter || '').trim();
  const source = String(q?.source || '').trim();
  const sourceLower = source.toLowerCase();

  if (chapter.includes('第十一章') || chapter.includes('补充题库')) return true;
  if (source.includes('补充题库') || source.includes('更新-电力交易员题库')) return true;
  if (sourceLower.includes('.pdf') && !sourceLower.includes('.doc') && !sourceLower.includes('.docx')) return true;
  return false;
}

function filterQuestionsByExamScope(scope) {
  const list = db.questions.filter((q) => q.isActive);
  if (scope === 'original') return list.filter((q) => !isSupplementQuestion(q));
  if (scope === 'supplement') return list.filter((q) => isSupplementQuestion(q));
  return list;
}

function startExam(scope = appState.examBankScope || 'all') {
  const scoped = filterQuestionsByExamScope(scope);
  const singlePool = scoped.filter((q) => q.questionType === 'single');
  const multiplePool = scoped.filter((q) => q.questionType === 'multiple');
  const judgePool = scoped.filter((q) => q.questionType === 'judge');
  if (!singlePool.length || !multiplePool.length || !judgePool.length) { alert('单选/多选/判断题至少各需要 1 道题。'); return; }

  const list = [
    ...drawRandomWithRepeat(singlePool, 100).map((q) => ({ questionId: q.id, questionType: 'single', score: 0.5 })),
    ...drawRandomWithRepeat(multiplePool, 30).map((q) => ({ questionId: q.id, questionType: 'multiple', score: 1 })),
    ...drawRandomWithRepeat(judgePool, 40).map((q) => ({ questionId: q.id, questionType: 'judge', score: 0.5 }))
  ];

  appState.exam = { id: uid('exam'), examName: `模拟考试（${examScopeLabel(scope)}） ${new Date().toLocaleString()}`, running: true, questions: list, index: 0, answers: {}, startAt: Date.now(), durationSeconds: 120*60, timer: null };
  startExamTimer();
  render();
}

function formatRemain(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function stopExamTimer() { if (appState.exam?.timer) { clearInterval(appState.exam.timer); appState.exam.timer = null; } }

function startExamTimer() {
  stopExamTimer();
  appState.exam.timer = setInterval(() => {
    if (!appState.exam?.running) { stopExamTimer(); return; }
    const elapsed = Math.floor((Date.now() - appState.exam.startAt) / 1000);
    const remain = appState.exam.durationSeconds - elapsed;
    const timerEl = document.getElementById('examTimer');
    if (timerEl) timerEl.textContent = formatRemain(Math.max(0, remain));
    if (remain <= 0) { stopExamTimer(); submitExam(true); }
  }, 1000);
}

function renderExamAnswerArea(question, answer) {
  if (question.questionType === 'single') {
    return `<div class="options">${question.options.map((op, i) => {
      const key = String.fromCharCode(65 + i);
      return `<label class="option"><input type="radio" name="exam-single" value="${key}" ${answer === key ? 'checked' : ''}/> ${key}. ${escapeHtml(op)}</label>`;
    }).join('')}</div>`;
  }
  if (question.questionType === 'multiple') {
    const selected = Array.isArray(answer) ? answer : [];
    return `<p class="notice">多选题必须全选对才得分。</p><div class="options" style="margin-top:8px;">${question.options.map((op, i) => {
      const key = String.fromCharCode(65 + i);
      return `<label class="option"><input type="checkbox" name="exam-multiple" value="${key}" ${selected.includes(key) ? 'checked' : ''}/> ${key}. ${escapeHtml(op)}</label>`;
    }).join('')}</div>`;
  }
  const selected = answer || '';
  return `<div class="row"><button class="btn ${selected === '正确' ? 'primary' : ''}" data-act="exam-pick-judge" data-value="正确">正确</button><button class="btn ${selected === '错误' ? 'danger' : ''}" data-act="exam-pick-judge" data-value="错误">错误</button></div>`;
}

function renderExamRunning() {
  const e = appState.exam;
  const total = e.questions.length;
  const q = getQuestionById(e.questions[e.index].questionId);
  if (!q) return '<div class="card">题目加载失败。</div>';
  const elapsed = Math.floor((Date.now() - e.startAt) / 1000);
  const remain = Math.max(0, e.durationSeconds - elapsed);
  const answeredCount = Object.keys(e.answers).length;
  return `<div class="split"><article class="card"><div class="row" style="justify-content:space-between;align-items:center;"><div><span class="badge">${TYPE_MAP[q.questionType]}</span><span class="badge">题号 ${e.index + 1}/${total}</span></div><div class="badge" style="background:#ffe9e9;color:#b02525;">剩余时间 <span id="examTimer">${formatRemain(remain)}</span></div></div><div class="question-stem">${escapeHtml(q.stem)}</div>${renderExamAnswerArea(q, e.answers[q.id])}<div class="row" style="margin-top:12px;"><button class="btn" data-act="exam-prev" ${e.index===0?'disabled':''}>上一题</button><button class="btn" data-act="exam-next" ${e.index===total-1?'disabled':''}>下一题</button><button class="btn warn" data-act="submit-exam">交卷</button></div></article><aside class="card"><h3>考试进度</h3><div class="kv" style="margin-top:10px;"><div class="label">总题数</div><div>${total}</div><div class="label">已作答</div><div>${answeredCount}</div><div class="label">单选题</div><div>100</div><div class="label">多选题</div><div>30</div><div class="label">判断题</div><div>40</div></div><p class="hint" style="margin-top:10px;">多选题必须全对才得分。</p></aside></div>`;
}

function captureExamAnswer() {
  const e = appState.exam;
  if (!e?.running) return;
  const q = getQuestionById(e.questions[e.index].questionId);
  if (!q) return;
  if (q.questionType === 'single') {
    const checked = document.querySelector('input[name="exam-single"]:checked');
    if (checked) e.answers[q.id] = checked.value;
  }
  if (q.questionType === 'multiple') e.answers[q.id] = [...document.querySelectorAll('input[name="exam-multiple"]:checked')].map((n) => n.value);
}

function submitExam(autoSubmit = false) {
  const e = appState.exam;
  if (!e?.running) return;
  captureExamAnswer();
  stopExamTimer();
  const submittedAt = new Date().toISOString();
  let singleScore = 0; let multipleScore = 0; let judgeScore = 0; let correctCount = 0;
  const details = [];

  e.questions.forEach((eq) => {
    const q = getQuestionById(eq.questionId);
    if (!q) return;
    const userAnswer = e.answers[q.id] ?? null;
    const result = gradeQuestion(q, userAnswer);
    const scoreObtained = result.isCorrect ? eq.score : 0;
    if (result.isCorrect) correctCount += 1;
    if (eq.questionType === 'single') singleScore += scoreObtained;
    if (eq.questionType === 'multiple') multipleScore += scoreObtained;
    if (eq.questionType === 'judge') judgeScore += scoreObtained;
    if (result.isCorrect === false) addWrong(q.id);

    db.practiceRecords.push({ id: uid('pr'), session: 'default-session', questionId: q.id, mode: '模拟考试', userAnswer, isCorrect: result.isCorrect, scoreObtained, timeSpentSeconds: 0, createdAt: submittedAt });
    details.push({ id: uid('eq'), examRecordId: e.id, questionId: q.id, questionType: q.questionType, stem: q.stem, userAnswer, correctAnswer: q.correctAnswer, isCorrect: result.isCorrect, scoreObtained });
  });

  db.examRecords.push({ id: e.id, examName: e.examName, singleCount: 100, multipleCount: 30, judgeCount: 40, singleScore: 0.5, multipleScore: 1, judgeScore: 0.5, totalScore: Number((singleScore + multipleScore + judgeScore).toFixed(2)), durationMinutes: 120, submittedAt, usedSeconds: Math.floor((Date.now() - e.startAt)/1000), accuracy: ((correctCount / 170) * 100).toFixed(1), singleScoreObtained: Number(singleScore.toFixed(2)), multipleScoreObtained: Number(multipleScore.toFixed(2)), judgeScoreObtained: Number(judgeScore.toFixed(2)), autoSubmit });
  db.examQuestions.push(...details);
  saveAll();
  appState.exam = null;
  goto(`#/exam-result/${e.id}`);
}

function renderExamHistoryTable() {
  const items = [...db.examRecords].sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt)).slice(0,20);
  if (!items.length) return '<p class="hint" style="margin-top:8px;">暂无考试记录。</p>';
  return `<table class="table" style="margin-top:8px;"><thead><tr><th>考试名称</th><th>成绩</th><th>正确率</th><th>用时</th><th>交卷时间</th><th>操作</th></tr></thead><tbody>${items.map((r)=>`<tr><td>${escapeHtml(r.examName)}</td><td>${r.totalScore}</td><td>${r.accuracy}%</td><td>${Math.floor((r.usedSeconds||0)/60)} 分</td><td>${formatTime(r.submittedAt)}</td><td><button class="btn" data-route="#/exam-result/${r.id}">详情</button></td></tr>`).join('')}</tbody></table>`;
}

function renderExamResult(id) {
  const record = db.examRecords.find((r) => r.id === id);
  if (!record) return '<div class="card"><p>未找到考试记录。</p><button class="btn" style="margin-top:10px;" data-route="#/exam">返回模拟考试</button></div>';
  const details = db.examQuestions.filter((q) => q.examRecordId === id);
  const wrongs = details.filter((d) => d.isCorrect === false);
  return `<div class="grid cards-4"><article class="card"><div class="label">总分</div><div class="metric">${record.totalScore}</div></article><article class="card"><div class="label">单选得分</div><div class="metric">${record.singleScoreObtained}</div></article><article class="card"><div class="label">多选得分</div><div class="metric">${record.multipleScoreObtained}</div></article><article class="card"><div class="label">判断得分</div><div class="metric">${record.judgeScoreObtained}</div></article></div>
  <div class="card" style="margin-top:12px;"><div class="kv"><div class="label">正确率</div><div>${record.accuracy}%</div><div class="label">用时</div><div>${Math.floor((record.usedSeconds||0)/60)} 分 ${(record.usedSeconds||0)%60} 秒</div><div class="label">交卷时间</div><div>${formatTime(record.submittedAt)}</div><div class="label">交卷类型</div><div>${record.autoSubmit ? '时间到自动交卷' : '主动交卷'}</div></div><div class="row" style="margin-top:10px;"><button class="btn" data-route="#/exam">返回模拟考试</button></div></div>
  <div class="card" style="margin-top:12px;"><h3>错题列表（已自动加入错题本）</h3>${wrongs.length ? `<table class="table" style="margin-top:8px;"><thead><tr><th>题型</th><th>题干</th><th>你的答案</th><th>正确答案</th><th>得分</th></tr></thead><tbody>${wrongs.map((w)=>`<tr><td>${TYPE_MAP[w.questionType]}</td><td>${escapeHtml(w.stem)}</td><td>${escapeHtml(toAnswerText(w.userAnswer))}</td><td>${escapeHtml(toAnswerText(w.correctAnswer))}</td><td>${w.scoreObtained}</td></tr>`).join('')}</tbody></table>` : '<p class="hint" style="margin-top:8px;">本次考试无错题。</p>'}</div>`;
}

function renderExam() {
  if (appState.exam?.running) return renderExamRunning();
  const scope = appState.examBankScope || 'all';
  const scoped = filterQuestionsByExamScope(scope);
  const pools = {
    single: scoped.filter((q) => q.questionType === 'single').length,
    multiple: scoped.filter((q) => q.questionType === 'multiple').length,
    judge: scoped.filter((q) => q.questionType === 'judge').length
  };
  const warns = [];
  if (!scoped.length) warns.push(`当前“${examScopeLabel(scope)}”下没有可用题目。`);
  if (pools.single < 100) warns.push(`单选题题库不足 100 道（当前 ${pools.single}），考试时将允许重复抽题。`);
  if (pools.multiple < 30) warns.push(`多选题题库不足 30 道（当前 ${pools.multiple}），考试时将允许重复抽题。`);
  if (pools.judge < 40) warns.push(`判断题题库不足 40 道（当前 ${pools.judge}），考试时将允许重复抽题。`);
  const total = pools.single + pools.multiple + pools.judge;

  return `<div class="card"><h3>试卷结构（固定）</h3><table class="table" style="margin-top:8px;"><thead><tr><th>题型</th><th>数量</th><th>每题分值</th><th>小计</th></tr></thead><tbody><tr><td>单选题</td><td>100</td><td>0.5</td><td>50</td></tr><tr><td>多选题</td><td>30</td><td>1.0</td><td>30</td></tr><tr><td>判断题</td><td>40</td><td>0.5</td><td>20</td></tr><tr><td><strong>总计</strong></td><td><strong>170</strong></td><td>-</td><td><strong>100</strong></td></tr></tbody></table><p class="hint" style="margin-top:8px;">考试时长默认 120 分钟，可提前交卷。</p><div class="filter" style="margin-top:10px;"><label class="hint">抽题题库</label><select id="examBankScope"><option value="original" ${scope==='original'?'selected':''}>原始题库（不含补充）</option><option value="supplement" ${scope==='supplement'?'selected':''}>补充题库</option><option value="all" ${scope==='all'?'selected':''}>全部考题</option></select><button class="btn" data-act="apply-exam-bank-scope">应用</button></div><div class="kv" style="margin-top:10px;"><div class="label">当前题库</div><div>${examScopeLabel(scope)}</div><div class="label">单选题</div><div>${pools.single}</div><div class="label">多选题</div><div>${pools.multiple}</div><div class="label">判断题</div><div>${pools.judge}</div><div class="label">总题数</div><div>${total}</div></div>${warns.length ? `<div class="notice" style="margin-top:10px;">${warns.map((w)=>`<div>${escapeHtml(w)}</div>`).join('')}</div>` : ''}<div class="row" style="margin-top:12px;"><button class="btn primary" data-act="start-exam">开始模拟考试</button></div></div><div class="card" style="margin-top:12px;"><h3>历史考试记录</h3>${renderExamHistoryTable()}</div>`;
}

function renderWrongs() {
  const chapters = getChapters();
  const chapterVal = document.getElementById('wrongChapterFilter')?.value || 'all';
  const typeVal = document.getElementById('wrongTypeFilter')?.value || 'all';
  const onlyUnmastered = document.getElementById('wrongUnmasteredOnly')?.checked || false;
  let list = [...db.wrongQuestions];
  if (chapterVal !== 'all') list = list.filter((w) => w.chapter === chapterVal);
  if (typeVal !== 'all') list = list.filter((w) => w.questionType === typeVal);
  if (onlyUnmastered) list = list.filter((w) => !w.isMastered);

  return `<div class="card"><div class="filter"><select id="wrongChapterFilter"><option value="all">全部章节</option>${chapters.map((c)=>`<option value="${c}" ${chapterVal===c?'selected':''}>${c}</option>`).join('')}</select><select id="wrongTypeFilter"><option value="all">全部题型</option>${Object.entries(TYPE_MAP).map(([k,v])=>`<option value="${k}" ${typeVal===k?'selected':''}>${v}</option>`).join('')}</select><label class="hint"><input type="checkbox" id="wrongUnmasteredOnly" ${onlyUnmastered ? 'checked' : ''}/> 只刷未掌握错题</label><button class="btn" data-act="apply-wrong-filter">筛选</button><button class="btn primary" data-act="start-wrong-practice">按当前筛选开始重刷</button></div>
  ${list.length ? `<table class="table"><thead><tr><th>章节</th><th>题型</th><th>题目</th><th>错题次数</th><th>状态</th><th>操作</th></tr></thead><tbody>${list.map((w)=>{const q=getQuestionById(w.questionId);return `<tr><td>${escapeHtml(w.chapter)}</td><td>${TYPE_MAP[w.questionType]}</td><td>${escapeHtml(q?.stem || '题目不存在')}</td><td>${w.wrongCount}</td><td>${w.isMastered ? '<span class="correct-text">已掌握</span>' : '<span class="wrong-text">未掌握</span>'}</td><td><div class="row"><button class="btn" data-act="mark-mastered" data-qid="${w.questionId}">${w.isMastered ? '标记未掌握' : '标记已掌握'}</button><button class="btn danger" data-act="remove-wrong" data-qid="${w.questionId}">移出错题本</button></div></td></tr>`;}).join('')}</tbody></table>` : '<p class="hint">暂无错题记录。</p>'}</div>`;
}

function renderFavorites() {
  const chapters = getChapters();
  const chapterVal = document.getElementById('favChapterFilter')?.value || 'all';
  const typeVal = document.getElementById('favTypeFilter')?.value || 'all';
  let list = [...db.favoriteQuestions];
  if (chapterVal !== 'all') list = list.filter((f) => f.chapter === chapterVal);
  if (typeVal !== 'all') list = list.filter((f) => f.questionType === typeVal);

  return `<div class="card"><div class="filter"><select id="favChapterFilter"><option value="all">全部章节</option>${chapters.map((c)=>`<option value="${c}" ${chapterVal===c?'selected':''}>${c}</option>`).join('')}</select><select id="favTypeFilter"><option value="all">全部题型</option>${Object.entries(TYPE_MAP).map(([k,v])=>`<option value="${k}" ${typeVal===k?'selected':''}>${v}</option>`).join('')}</select><button class="btn" data-act="apply-fav-filter">筛选</button></div>
  ${list.length ? `<table class="table"><thead><tr><th>章节</th><th>题型</th><th>题目</th><th>收藏时间</th><th>操作</th></tr></thead><tbody>${list.map((f)=>{const q=getQuestionById(f.questionId);return `<tr><td>${escapeHtml(f.chapter)}</td><td>${TYPE_MAP[f.questionType]}</td><td>${escapeHtml(q?.stem || '题目不存在')}</td><td>${formatTime(f.createdAt)}</td><td><button class="btn" data-act="unfav" data-qid="${f.questionId}">取消收藏</button></td></tr>`;}).join('')}</tbody></table>` : '<p class="hint">暂无收藏题目。</p>'}</div>`;
}

function buildLineSvg({ labels, values, color }) {
  const w = 600; const h = 210; const pad = 36;
  const max = Math.max(1, ...values);
  const stepX = labels.length > 1 ? (w - pad * 2) / (labels.length - 1) : 0;
  const points = values.map((v, i) => [pad + i * stepX, h - pad - (v / max) * (h - pad * 2)]);
  const line = points.map((p) => p.join(',')).join(' ');
  return `<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#ccd7e2"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#ccd7e2"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="3"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/><text x="${p[0]}" y="${h-12}" font-size="11" text-anchor="middle" fill="#617086">${labels[i]}</text><text x="${p[0]}" y="${p[1]-8}" font-size="11" text-anchor="middle" fill="#2b3a4a">${values[i]}</text>`).join('')}`;
}

function renderStats() {
  const graded = db.practiceRecords.filter((r) => typeof r.isCorrect === 'boolean');
  const correct = graded.filter((r) => r.isCorrect).length;
  const overallAcc = graded.length ? ((correct / graded.length) * 100).toFixed(1) : '0.0';
  const chapterRows = getChapters().map((ch) => {
    const ids = new Set(db.questions.filter((q) => q.chapter === ch).map((q) => q.id));
    const rows = graded.filter((r) => ids.has(r.questionId));
    const ok = rows.filter((r) => r.isCorrect).length;
    return `<tr><td>${ch}</td><td>${rows.length}</td><td>${rows.length ? ((ok / rows.length) * 100).toFixed(1) : '0.0'}%</td></tr>`;
  }).join('');

  return `<div class="grid cards-4"><article class="card"><div class="label">累计做题数</div><div class="metric">${db.practiceRecords.length}</div></article><article class="card"><div class="label">自动判分正确率</div><div class="metric">${overallAcc}%</div></article><article class="card"><div class="label">模拟考试次数</div><div class="metric">${db.examRecords.length}</div></article><article class="card"><div class="label">错题本数量</div><div class="metric">${db.wrongQuestions.length}</div></article></div>
  <div class="grid cards-2" style="margin-top:12px;"><article class="card"><h3>近7天练习趋势（作答次数）</h3><svg id="practiceTrend" class="chart" viewBox="0 0 600 210"></svg></article><article class="card"><h3>模拟考试成绩趋势</h3><svg id="examTrend" class="chart" viewBox="0 0 600 210"></svg></article></div>
  <div class="card" style="margin-top:12px;"><h3>章节掌握情况</h3><table class="table" style="margin-top:8px;"><thead><tr><th>章节</th><th>作答数</th><th>正确率</th></tr></thead><tbody>${chapterRows}</tbody></table></div>`;
}

function drawStatsCharts() {
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(d); }
  const labels = days.map((d) => `${d.getMonth() + 1}/${d.getDate()}`);
  const dayCount = days.map((d) => {
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    return db.practiceRecords.filter((r) => { const t = new Date(r.createdAt); return `${t.getFullYear()}-${t.getMonth()+1}-${t.getDate()}` === key; }).length;
  });
  const examLast = [...db.examRecords].sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)).slice(-7);
  const examLabels = examLast.length ? examLast.map((_, i) => `第${i + 1}次`) : ['暂无'];
  const examVals = examLast.length ? examLast.map((x) => x.totalScore) : [0];
  const pSvg = document.getElementById('practiceTrend');
  const eSvg = document.getElementById('examTrend');
  if (pSvg) pSvg.innerHTML = buildLineSvg({ labels, values: dayCount, color: '#0b6fa4' });
  if (eSvg) eSvg.innerHTML = buildLineSvg({ labels: examLabels, values: examVals, color: '#0aa67a' });
}

function parseImportText(raw) {
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 9) continue;
    const [chapter, type, stem, a, b, c, d, ans, analysis] = cols;
    let correctAnswer = ans.trim();
    if (type.trim() === 'multiple') correctAnswer = ans.includes('|') ? ans.split('|').map((x) => x.trim()) : ans.split('').map((x) => x.trim()).filter(Boolean);
    parsed.push({ id: uid('q'), chapter: chapter.trim(), questionType: type.trim(), stem: stem.trim(), options: [a, b, c, d].filter((x) => x && x.trim()), correctAnswer, analysis: analysis?.trim() || '暂无解析', difficulty: '未设置', source: '补充题库（本地导入）', isActive: true });
  }
  return parsed;
}

function renderImportPreview() {
  if (!appState.importPreview.length) return '<p class="hint">暂无预览数据。</p>';
  return `<table class="table"><thead><tr><th>章节</th><th>题型</th><th>题干</th><th>答案</th></tr></thead><tbody>${appState.importPreview.slice(0,20).map((q)=>`<tr><td>${escapeHtml(q.chapter)}</td><td>${escapeHtml(TYPE_MAP[q.questionType]||q.questionType)}</td><td>${escapeHtml(q.stem)}</td><td>${escapeHtml(toAnswerText(q.correctAnswer))}</td></tr>`).join('')}</tbody></table>${appState.importPreview.length>20 ? `<p class="hint">仅展示前 20 条，共 ${appState.importPreview.length} 条。</p>` : ''}`;
}

function renderManage() {
  return `<div class="card"><h3>数据模型（实体/数据表）</h3><table class="table" style="margin-top:8px;"><thead><tr><th>实体</th><th>关键字段</th></tr></thead><tbody><tr><td>Question</td><td>id, chapter, questionType, stem, options[], correctAnswer, analysis, difficulty, source, isActive</td></tr><tr><td>PracticeRecord</td><td>id, session, questionId, mode, userAnswer, isCorrect, scoreObtained, timeSpentSeconds, createdAt</td></tr><tr><td>ExamRecord</td><td>id, examName, singleCount, multipleCount, judgeCount, singleScore, multipleScore, judgeScore, totalScore, durationMinutes, submittedAt</td></tr><tr><td>ExamQuestion</td><td>id, examRecordId, questionId, questionType, userAnswer, isCorrect, scoreObtained</td></tr><tr><td>WrongQuestion</td><td>id, questionId, chapter, questionType, wrongCount, isMastered, lastWrongAt</td></tr><tr><td>FavoriteQuestion</td><td>id, questionId, chapter, questionType, createdAt</td></tr></tbody></table></div><div class="card" style="margin-top:12px;"><h3>批量导入题库（预留）</h3><p class="hint" style="margin-top:8px;">当前提供“粘贴文本导入”结构，后续可扩展为 Word/Excel 文件上传。格式：章节,题型,题干,选项A,选项B,选项C,选项D,答案,解析</p><textarea id="importText" placeholder="示例：\n第一章 电力市场基础,single,电力市场的核心特征是？,计划分配,市场定价,取消结算,单一主体定价,B,市场化机制形成价格"></textarea><div class="row" style="margin-top:10px;"><button class="btn" data-act="preview-import">预览解析</button><button class="btn primary" data-act="confirm-import">确认导入</button><button class="btn" data-act="reset-sample">重置为全量题库</button></div><div style="margin-top:10px;">${renderImportPreview()}</div></div>`;
}

function render() {
  const hash = location.hash || '#/dashboard';
  const view = document.getElementById('view');
  activeNav(hash);
  if (hash.startsWith('#/chapter/')) {
    const idx = Number(hash.split('/')[2] || 0);
    const chapters = getChapters();
    appState.selectedChapterIndex = Math.min(Math.max(idx, 0), Math.max(chapters.length - 1, 0));
    view.innerHTML = renderChapterTypePage();
    setHeader('章节题型选择', '按章节 + 题型开始刷题');
    return;
  }
  if (hash === '#/dashboard') { view.innerHTML = renderDashboard(); setHeader('首页仪表盘', '查看学习进度并快速开始刷题'); }
  else if (hash === '#/chapters') { view.innerHTML = renderChapters(); setHeader('章节列表', '选择章节进入题型刷题'); }
  else if (hash === '#/practice') { view.innerHTML = renderPractice(); setHeader('刷题页', '支持立即判分、收藏、错题管理'); }
  else if (hash === '#/exam') { view.innerHTML = renderExam(); setHeader('模拟考试', '可选原始题库/补充题库/全部考题进行组卷'); }
  else if (hash.startsWith('#/exam-result/')) { view.innerHTML = renderExamResult(hash.split('/')[2]); setHeader('考试结果', '查看总分、错题、用时与考试详情'); }
  else if (hash === '#/wrongs') { view.innerHTML = renderWrongs(); setHeader('错题本', '按章节/题型筛选并重刷未掌握错题'); }
  else if (hash === '#/favorites') { view.innerHTML = renderFavorites(); setHeader('收藏夹', '管理重点题目并快速复习'); }
  else if (hash === '#/stats') { view.innerHTML = renderStats(); setHeader('学习统计', '近7天练习趋势与考试成绩趋势'); drawStatsCharts(); }
  else if (hash === '#/manage') { view.innerHTML = renderManage(); setHeader('题库管理', '预留批量导入结构，便于后续 Word 题库扩充'); }
  else goto('#/dashboard');
}

function closeMobileMenu() { document.getElementById('sidebar').classList.remove('open'); }

function updatePracticeAnswerByInput(target) {
  const p = appState.practice;
  if (!p) return;
  const q = getQuestionById(p.questionIds[p.index]);
  if (!q) return;
  if (q.questionType === 'single' && target.name === 'answer-single') p.answers[q.id] = { ...(p.answers[q.id] || {}), userAnswer: target.value };
  if (q.questionType === 'multiple' && target.name === 'answer-multiple') p.answers[q.id] = { ...(p.answers[q.id] || {}), userAnswer: [...document.querySelectorAll('input[name="answer-multiple"]:checked')].map((n) => n.value) };
}

function bindEvents() {
  window.addEventListener('hashchange', () => { render(); closeMobileMenu(); });

  document.body.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.id === 'menuToggle') { document.getElementById('sidebar').classList.toggle('open'); return; }
    if (t.dataset.route) { goto(t.dataset.route); return; }
    const act = t.dataset.act;
    if (!act) return;

    if (act === 'refresh-local-users') {
      refreshLocalUsers().then(() => render());
      return;
    }

    if (act === 'save-local-user') {
      const inputUser = document.getElementById('localUserInput')?.value || '';
      const selectUser = document.getElementById('localUserSelect')?.value || '';
      const target = normalizeLocalUserId(inputUser || selectUser || appState.localUserId);
      if (!target) {
        alert('请输入用户名称。');
        return;
      }
      if (target !== appState.localUserId) {
        switchLocalUser(target, false)
          .then((ok) => { if (!ok) return; return saveLocalUserState(true); })
          .then(() => render());
      } else {
        saveLocalUserState(true).then(() => render());
      }
      return;
    }

    if (act === 'switch-local-user') {
      const inputUser = document.getElementById('localUserInput')?.value || '';
      const selectUser = document.getElementById('localUserSelect')?.value || '';
      const target = normalizeLocalUserId(inputUser || selectUser);
      if (!target) {
        alert('请选择或输入用户。');
        return;
      }
      switchLocalUser(target, true).then((ok) => {
        if (!ok) return;
        render();
      });
      return;
    }

    if (act === 'clear-learning-records') {
      if (!confirm('确认清空所有学习记录并从头开始？此操作不会删除题库内容，且不可恢复。')) return;
      clearLearningRecords();
      alert('学习记录已清空。');
      goto('#/dashboard');
      render();
      return;
    }

    if (act === 'start-practice') { startPracticeSession({ chapter: t.dataset.chapter, type: t.dataset.type, orderMode: t.dataset.mode, mode: '章节练习' }); return; }

    if (act === 'prev-practice') { if (appState.practice && appState.practice.index > 0) { appState.practice.index -= 1; appState.practice.questionStartAt = Date.now(); render(); } return; }
    if (act === 'next-practice') { if (appState.practice && appState.practice.index < appState.practice.questionIds.length - 1) { appState.practice.index += 1; appState.practice.questionStartAt = Date.now(); render(); } return; }

    if (act === 'pick-judge') {
      const p = appState.practice;
      if (!p) return;
      const q = getQuestionById(p.questionIds[p.index]);
      p.draftAnswers[q.id] = t.dataset.value;
      p.answers[q.id] = { ...(p.answers[q.id] || {}), userAnswer: t.dataset.value };
      render();
      return;
    }

    if (act === 'submit-practice') { submitPracticeAnswer(); return; }

    if (act === 'toggle-fav') { const p = appState.practice; if (!p) return; toggleFavorite(p.questionIds[p.index]); render(); return; }

    if (act === 'toggle-wrong') {
      const p = appState.practice;
      if (!p) return;
      const qid = p.questionIds[p.index];
      if (wrongEntry(qid)) removeWrong(qid); else addWrong(qid);
      saveAll();
      render();
      return;
    }

    if (act === 'toggle-show-answer' || act === 'toggle-show-analysis') {
      const p = appState.practice;
      if (!p) return;
      const qid = p.questionIds[p.index];
      const cur = p.answers[qid] || {};
      if (act === 'toggle-show-answer') cur.showAnswer = !cur.showAnswer;
      if (act === 'toggle-show-analysis') cur.showAnalysis = !cur.showAnalysis;
      p.answers[qid] = cur;
      render();
      return;
    }

    if (act === 'clear-practice') { appState.practice = null; goto('#/chapters'); return; }

    if (act === 'apply-exam-bank-scope') { updateExamBankScopeFromUI(); render(); return; }
    if (act === 'start-exam') { updateExamBankScopeFromUI(); startExam(appState.examBankScope); return; }
    if (act === 'exam-prev') { captureExamAnswer(); if (appState.exam.index > 0) appState.exam.index -= 1; render(); return; }
    if (act === 'exam-next') { captureExamAnswer(); if (appState.exam.index < appState.exam.questions.length - 1) appState.exam.index += 1; render(); return; }

    if (act === 'exam-pick-judge') {
      const ex = appState.exam;
      if (!ex?.running) return;
      const q = getQuestionById(ex.questions[ex.index].questionId);
      ex.answers[q.id] = t.dataset.value;
      render();
      return;
    }

    if (act === 'submit-exam') { if (confirm('确认交卷？')) submitExam(false); return; }

    if (act === 'apply-wrong-filter' || act === 'apply-fav-filter') { render(); return; }

    if (act === 'start-wrong-practice') {
      const chapterVal = document.getElementById('wrongChapterFilter')?.value || 'all';
      const typeVal = document.getElementById('wrongTypeFilter')?.value || 'all';
      const onlyUnmastered = document.getElementById('wrongUnmasteredOnly')?.checked || false;
      let list = [...db.wrongQuestions];
      if (chapterVal !== 'all') list = list.filter((w) => w.chapter === chapterVal);
      if (typeVal !== 'all') list = list.filter((w) => w.questionType === typeVal);
      if (onlyUnmastered) list = list.filter((w) => !w.isMastered);
      const qids = list.map((x) => x.questionId).filter((id) => !!getQuestionById(id));
      startPracticeSession({ questionIds: qids, orderMode: 'ordered', mode: '错题重刷' });
      return;
    }

    if (act === 'mark-mastered') { const item = wrongEntry(t.dataset.qid); if (item) setWrongMastered(t.dataset.qid, !item.isMastered); saveAll(); render(); return; }
    if (act === 'remove-wrong') { removeWrong(t.dataset.qid); saveAll(); render(); return; }
    if (act === 'unfav') { toggleFavorite(t.dataset.qid); render(); return; }

    if (act === 'preview-import') { appState.importPreview = parseImportText(document.getElementById('importText')?.value || ''); render(); return; }

    if (act === 'confirm-import') {
      if (!appState.importPreview.length) { alert('请先预览并确认可导入数据。'); return; }
      db.questions.push(...appState.importPreview);
      appState.importPreview = [];
      saveAll();
      alert('导入完成。');
      render();
      return;
    }

    if (act === 'reset-sample') {
      if (!confirm('确认重置题库与练习数据为全量导入状态？')) return;
      db.questions = getDefaultQuestionBank();
      db.practiceRecords = [];
      db.examRecords = [];
      db.examQuestions = [];
      db.wrongQuestions = [];
      db.favoriteQuestions = [];
      appState.importPreview = [];
      appState.practice = null;
      appState.exam = null;
      writeStore(STORAGE_KEYS.fullBankApplied, true);
      writeStore(STORAGE_KEYS.fullBankSize, db.questions.length);
      saveAll();
      render();
    }
  });

  document.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement) {
      if (t.name === 'answer-single' || t.name === 'answer-multiple') updatePracticeAnswerByInput(t);
      if (t.name === 'exam-single' || t.name === 'exam-multiple') captureExamAnswer();
      return;
    }
    if (t instanceof HTMLSelectElement && t.id === 'examBankScope') {
      updateExamBankScopeFromUI();
      render();
    }
  });
}

async function init() {
  loadData();
  bindEvents();
  setLocalSelectedUser(appState.localUserId || getLocalSelectedUser());
  const localReady = await refreshLocalUsers();
  if (localReady) {
    const switched = await loadLocalUserState(appState.localUserId, false);
    if (!switched) setLocalUserStatus(`当前用户：${appState.localUserId}`);
  }
  if (!location.hash) location.hash = '#/dashboard';
  render();
}

init();
