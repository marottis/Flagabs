const API = "https://flagabs-production.up.railway.app";

/* ---------- DOM ---------- */
const dom = {
  home: document.getElementById("section-home"),
  play: document.getElementById("section-play"),
  scores: document.getElementById("section-scores"),

  playerLabel: document.getElementById("player-label"),
  modeLabel: document.getElementById("mode-label"),

  score: document.getElementById("score"),
  progress: document.getElementById("progress"),
  flag: document.getElementById("flag"),
  options: document.getElementById("options"),
  timerBar: document.getElementById("timer-bar"),

  // name gate
  nameGate: document.getElementById("namegate"),
  playerNameInput: document.getElementById("player-name"),
  nameError: document.getElementById("name-error"),

  // gameover
  gameover: document.getElementById("gameover"),
  gameoverTitle: document.getElementById("gameover-title"),
  finalStats: document.getElementById("final-stats"),
  saveResult: document.getElementById("save-result"),
  saveError: document.getElementById("save-error"),

  // ranking
  ranking: document.getElementById("ranking"),
  rankingSubtitle: document.getElementById("ranking-subtitle"),
};

/* ---------- Config ---------- */
const CLASSIC_COUNT = 99999; // classic = todas
const DAILY_COUNT = 10;      // daily = 10 bandeiras por dia

/* ---------- SPA helpers ---------- */
function show(el){ el?.classList.remove("hidden"); }
function hide(el){ el?.classList.add("hidden"); }

function showSection(id){
  [dom.home, dom.play, dom.scores].forEach(s => s?.classList.add("hidden"));
  const t = id === "home" ? dom.home : id === "play" ? dom.play : dom.scores;
  t?.classList.remove("hidden");
  if(id === "scores") loadRanking();
}

function goHome(){
  hide(dom.gameover);
  hide(dom.nameGate);
  showSection("home");
}

/* ---------- Date helpers (LOCAL day) ---------- */
function pad2(n){ return String(n).padStart(2,"0"); }
function localDayKey(){
  const d = new Date(); // local timezone (Brasil)
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

/* ---------- Seeded shuffle (Daily) ---------- */
function seedFromString(str){
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed){
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seedStr){
  const a=[...arr];
  const rng = mulberry32(seedFromString(seedStr));
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(rng()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ---------- Random shuffle (Classic) ---------- */
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ---------- State ---------- */
let playerName = "";
let selectedMode = "classic";  // chosen on Play Now (before start)
let currentMode = "classic";   // actual running mode (after start)
let dailyKey = localDayKey();

let countries = [];
let order = [];
let index = 0;
let answer = "";
let score = 0;

let qStart = 0;
let runStart = 0;
let rafId = null;

let finalScore = 0;
let finalTime = 0;

let rankingMode = "classic";

/* ---------- Name Gate ---------- */
function openNameGate(mode="classic"){
  selectedMode = mode;
  if(dom.playerNameInput) dom.playerNameInput.value = playerName || "";
  if(dom.nameError) dom.nameError.textContent = "";
  show(dom.nameGate);
  setTimeout(()=>dom.playerNameInput?.focus(),0);
}

function closeNameGate(){
  hide(dom.nameGate);
}

function confirmNameAndStart(){
  const name = (dom.playerNameInput?.value || "").trim();
  if(!name){
    dom.nameError.textContent = "Name is required.";
    return;
  }

  playerName = name;
  currentMode = selectedMode;
  dailyKey = localDayKey();

  dom.playerLabel.textContent = playerName;
  dom.modeLabel.textContent = currentMode === "daily" ? `Daily (${dailyKey})` : "Classic";

  hide(dom.nameGate);
  showSection("play");
  resetGame();
}

/* Enter key = Start */
if(dom.playerNameInput){
  dom.playerNameInput.addEventListener("keydown",(e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      confirmNameAndStart();
    }
  });
}

/* ---------- Data ---------- */
async function loadCountries(){
  const res = await fetch(`${API}/countries`);
  countries = await res.json();
}

/* ---------- Timer 10s ---------- */
function stopTimer(){
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function startTimer(){
  qStart = performance.now();
  stopTimer();

  const tick = () => {
    const elapsed = (performance.now() - qStart) / 1000;
    const left = 10 - elapsed;
    const pct = Math.max(0, (left / 10) * 100);
    if(dom.timerBar) dom.timerBar.style.width = pct + "%";

    if(left <= 0){
      stopTimer();
      gameOver(false);
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

/* ---------- Build order ---------- */
function buildOrder(){
  if(currentMode === "daily"){
    // same order for everyone that day
    const shuffled = seededShuffle(countries, `daily:${dailyKey}`);
    return shuffled.slice(0, Math.min(DAILY_COUNT, shuffled.length));
  }
  // classic
  return shuffle(countries).slice(0, Math.min(CLASSIC_COUNT, countries.length));
}

/* ---------- Render ---------- */
function renderQuestion(){
  stopTimer();

  if(!runStart) runStart = performance.now();

  if(index >= order.length){
    gameOver(true);
    return;
  }

  const cur = order[index];
  answer = cur[1];

  if(dom.flag) dom.flag.src = `https://flagcdn.com/w640/${cur[0]}.png`;
  if(dom.score) dom.score.textContent = String(score);
  if(dom.progress) dom.progress.textContent = `${index+1}/${order.length}`;

  let opts = [answer];
  while(opts.length < 4){
    const r = order[Math.floor(Math.random()*order.length)][1];
    if(!opts.includes(r)) opts.push(r);
  }
  opts = shuffle(opts);

  if(dom.options){
    dom.options.innerHTML = "";
    opts.forEach(opt => {
      const b = document.createElement("button");
      b.className = "option";
      b.textContent = opt;
      b.onclick = () => onAnswer(opt, b);
      dom.options.appendChild(b);
    });
  }

  startTimer();
}

/* ---------- Answer ---------- */
function onAnswer(opt, btn){
  stopTimer();

  const buttons = dom.options ? Array.from(dom.options.querySelectorAll(".option")) : [];
  buttons.forEach(b => b.disabled = true);

  if(opt === answer){
    btn.classList.add("correct");
    score++;
    index++;
    setTimeout(renderQuestion, 120);
  }else{
    btn.classList.add("wrong");
    buttons.forEach(b => {
      if(b.textContent === answer) b.classList.add("correct");
    });
    setTimeout(() => gameOver(false), 220);
  }
}

/* ---------- Game Over + Auto Save ---------- */
async function gameOver(completed){
  stopTimer();

  const totalSeconds = runStart ? (performance.now() - runStart)/1000 : 0;
  finalScore = score;
  finalTime = totalSeconds;

  const avg = (finalScore ? finalTime/finalScore : 0).toFixed(2);
  const title = completed ? "✅ Completed!" : "❌ Game Over";

  if(dom.gameoverTitle) dom.gameoverTitle.textContent = completed ? "Completed!" : "Game Over";

  if(dom.finalStats){
    dom.finalStats.innerHTML = `
      <b>${title}</b><br><br>
      Player: ${playerName}<br>
      Mode: ${currentMode === "daily" ? `Daily (${dailyKey})` : "Classic"}<br>
      Score: ${finalScore}<br>
      Time: ${finalTime.toFixed(1)}s<br>
      Avg: ${avg}s/flag
    `;
  }

  if(dom.saveResult) dom.saveResult.textContent = "Saving score...";
  if(dom.saveError) dom.saveError.textContent = "";

  show(dom.gameover);

  // auto-save
  try{
    const payload = {
      name: playerName,
      score: finalScore,
      time: finalTime,
      mode: currentMode,
      date: currentMode === "daily" ? dailyKey : null
    };

    const res = await fetch(`${API}/score`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(()=>({}));
    dom.saveResult.textContent = data?.updated
      ? "✅ Saved to ranking!"
      : "ℹ️ Not your best score (ranking unchanged).";
  }catch(e){
    dom.saveResult.textContent = "";
    dom.saveError.textContent = "Could not save score (server offline).";
  }
}

/* ---------- Start / Reset ---------- */
async function resetGame(){
  if(!playerName){
    openNameGate("classic");
    return;
  }

  hide(dom.gameover);
  stopTimer();

  score = 0;
  index = 0;
  answer = "";
  runStart = 0;

  if(!countries.length){
    await loadCountries();
  }

  dailyKey = localDayKey();
  if(dom.modeLabel){
    dom.modeLabel.textContent = currentMode === "daily" ? `Daily (${dailyKey})` : "Classic";
  }

  order = buildOrder();
  renderQuestion();
}

function playAgain(){
  hide(dom.gameover);
  resetGame();
}

/* ---------- Ranking ---------- */
function setRankingMode(m){
  rankingMode = m;
  loadRanking();
}

async function loadRanking(){
  if(!dom.ranking) return;

  const today = localDayKey();

  if(dom.rankingSubtitle){
    dom.rankingSubtitle.textContent =
      rankingMode === "daily"
        ? `Top 10 — Daily (${today})`
        : "Top 10 — Classic";
  }

  dom.ranking.textContent = "Loading...";

  try{
    const qs = rankingMode === "daily"
      ? `?mode=daily&date=${encodeURIComponent(today)}`
      : `?mode=classic`;

    const res = await fetch(`${API}/ranking${qs}`);
    const data = await res.json();

    if(!Array.isArray(data) || data.length === 0){
      dom.ranking.textContent = "No records yet.";
      return;
    }

    dom.ranking.innerHTML = data
      .slice(0, 10)
      .map((r, i) => `${i+1}. ${r.name} — ${r.score} pts — ${Number(r.time).toFixed(1)}s`)
      .join("<br>");
  }catch{
    dom.ranking.textContent = "Ranking unavailable (server offline).";
  }
}

/* expose */
window.showSection = showSection;
window.goHome = goHome;
window.openNameGate = openNameGate;
window.closeNameGate = closeNameGate;
window.confirmNameAndStart = confirmNameAndStart;
window.resetGame = resetGame;
window.playAgain = playAgain;
window.setRankingMode = setRankingMode;

/* boot */
(function boot(){
  showSection("home");
})();
