// ══════════════════════════════════════════
//  SUPABASE 설정 — 본인 프로젝트 값으로 교체!
// ══════════════════════════════════════════
const SUPABASE_URL = 'https://dviulqrlqclxqglyzesx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Xe32PliE-pUHvbw4cN9U7A_BgC4aUug';

const sb = {
  async insert(nickname, score) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rankings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ nickname, score })
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async getTop10() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rankings?select=nickname,score&order=score.desc&limit=10`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};

// ══════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════
let score = 0;
let timeLeft = 15;
let currentBlock = -1;
let nextBlock = -1;
let gameTimer = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function startCountdown() {
  showScreen('countdown-screen');
  const numEl = document.getElementById('countdown-num');
  let count = 3;
  numEl.textContent = count;
  const tick = () => {
    count--;
    if (count <= 0) { startGame(); return; }
    numEl.style.animation = 'none';
    numEl.offsetHeight;
    numEl.style.animation = 'countPop 0.9s steps(4) forwards';
    numEl.textContent = count;
    setTimeout(tick, 900);
  };
  setTimeout(tick, 900);
}

function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('div');
    b.className = 'block';
    b.dataset.idx = i;
    b.addEventListener('click', () => onBlockClick(i));
    grid.appendChild(b);
  }
}

function getBlock(i) {
  return document.querySelector(`.block[data-idx="${i}"]`);
}

function randomBlock(exclude = []) {
  let idx;
  do { idx = Math.floor(Math.random() * 9); } while (exclude.includes(idx));
  return idx;
}

function setBlocks(cur, nxt) {
  document.querySelectorAll('.block').forEach(b => { b.className = 'block'; });
  if (cur >= 0) getBlock(cur).classList.add('yellow');
  if (nxt >= 0) getBlock(nxt).classList.add('navy');
}

function startGame() {
  score = 0;
  timeLeft = 15;
  document.getElementById('score-value').textContent = 0;
  const tv = document.getElementById('timer-value');
  tv.textContent = 15;
  tv.classList.remove('urgent');
  buildGrid();
  showScreen('game-screen');
  currentBlock = randomBlock();
  nextBlock = randomBlock([currentBlock]);
  setBlocks(currentBlock, nextBlock);
  gameTimer = setInterval(() => {
    timeLeft--;
    const tv = document.getElementById('timer-value');
    tv.textContent = timeLeft;
    if (timeLeft <= 5) tv.classList.add('urgent');
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function advanceBlock() {
  currentBlock = nextBlock;
  nextBlock = randomBlock([currentBlock]);
  setBlocks(currentBlock, nextBlock);
}

function onBlockClick(idx) {
  if (timeLeft <= 0) return;
  if (idx === currentBlock) {
    score++;
    document.getElementById('score-value').textContent = score;
    getBlock(idx).classList.add('hit');
    advanceBlock();
  }
}

function endGame() {
  clearInterval(gameTimer);
  document.querySelectorAll('.block').forEach(b => b.className = 'block');
  document.getElementById('result-score').textContent = score;
  const ranks = [
    [0,  'BEGINNER...다시 해봐!'],
    [5,  'NOT BAD! 조금만 더!'],
    [10, 'GOOD JOB! 빠른 손!'],
    [15, 'EXCELLENT!! 최강!'],
    [20, 'PIXEL MASTER'],
  ];
  let rank = ranks[0][1];
  for (const [threshold, label] of ranks) {
    if (score >= threshold) rank = label;
  }
  document.getElementById('result-rank').textContent = rank;
  showScreen('result-screen');
}

function goMain() {
  clearInterval(gameTimer);
  showScreen('main-screen');
  loadMainRanking();
}

// ══════════════════════════════════════════
//  닉네임 모달
// ══════════════════════════════════════════
function openRegisterModal() {
  const modal = document.getElementById('nickname-modal');
  modal.classList.add('active');
  document.getElementById('nickname-input').value = '';
  document.getElementById('nickname-input').focus();
  document.getElementById('modal-error').textContent = '';
  document.getElementById('register-btn').disabled = false;
  document.getElementById('register-btn').textContent = '등록하기';
}

function closeRegisterModal() {
  document.getElementById('nickname-modal').classList.remove('active');
}

async function submitRanking() {
  const nickname = document.getElementById('nickname-input').value.trim();
  if (!nickname) {
    document.getElementById('modal-error').textContent = '닉네임을 입력해주세요!';
    return;
  }
  if (nickname.length > 12) {
    document.getElementById('modal-error').textContent = '12자 이내로 입력해주세요!';
    return;
  }
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  btn.textContent = '등록 중...';
  try {
    await sb.insert(nickname, score);
    closeRegisterModal();
    showRankingScreen();
  } catch (e) {
    console.error(e);
    document.getElementById('modal-error').textContent = '등록 실패! 다시 시도해주세요.';
    btn.disabled = false;
    btn.textContent = '등록하기';
  }
}

// ══════════════════════════════════════════
//  랭킹 화면
// ══════════════════════════════════════════
async function showRankingScreen() {
  showScreen('ranking-screen');
  const list = document.getElementById('ranking-list');
  list.innerHTML = '<div class="rank-loading">불러오는 중...</div>';
  try {
    const data = await sb.getTop10();
    renderRankingList(list, data);
  } catch (e) {
    list.innerHTML = '<div class="rank-loading">랭킹을 불러올 수 없습니다.</div>';
  }
}

function renderRankingList(container, data) {
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="rank-loading">아직 등록된 랭킹이 없습니다!</div>';
    return;
  }
  const medals = ['GOLD', 'SILVER', 'BRONZE'];
  container.innerHTML = data.map((row, i) => `
    <div class="rank-row ${i < 3 ? 'rank-top rank-top-' + i : ''}">
      <span class="rank-pos">${i < 3 ? medals[i] : '#' + (i + 1)}</span>
      <span class="rank-name">${escapeHtml(row.nickname)}</span>
      <span class="rank-score">${row.score} pts</span>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

async function loadMainRanking() {
  const list = document.getElementById('main-ranking-list');
  if (!list) return;
  list.innerHTML = '<div class="rank-loading">불러오는 중...</div>';
  try {
    const data = await sb.getTop10();
    renderRankingList(list, data);
  } catch {
    list.innerHTML = '<div class="rank-loading">랭킹을 불러올 수 없습니다.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nickname-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitRanking();
  });
  loadMainRanking();
});