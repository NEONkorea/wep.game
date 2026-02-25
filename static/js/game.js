// ════════════════════════════════════════════════
//  CANVAS SETUP
// ════════════════════════════════════════════════
const bgCanvas   = document.getElementById('bgCanvas');
const bgCtx      = bgCanvas.getContext('2d');
const gameCanvas = document.getElementById('gameCanvas');
const ctx        = gameCanvas.getContext('2d');

// 게임 내부 해상도 (게임 로직용)
let CW = 480;
let CH = 700;

// 캔버스 크기를 뷰포트에 맞게 설정
function resizeCanvas() {
  const wrapper = document.getElementById('gameWrapper');
  const width = wrapper.clientWidth;
  const height = wrapper.clientHeight;
  
  // 종횡비 유지 (480:700 = 0.686)
  const gameAspectRatio = 480 / 700;
  const viewportAspectRatio = width / height;
  
  let canvasWidth, canvasHeight;
  
  if (viewportAspectRatio > gameAspectRatio) {
    // 뷰포트가 더 넓음 -> 높이 기준
    canvasHeight = height;
    canvasWidth = height * gameAspectRatio;
  } else {
    // 뷰포트가 더 좁음 -> 너비 기준
    canvasWidth = width;
    canvasHeight = width / gameAspectRatio;
  }
  
  bgCanvas.width = CW;
  bgCanvas.height = CH;
  gameCanvas.width = CW;
  gameCanvas.height = CH;
  
  bgCanvas.style.width = canvasWidth + 'px';
  bgCanvas.style.height = canvasHeight + 'px';
  gameCanvas.style.width = canvasWidth + 'px';
  gameCanvas.style.height = canvasHeight + 'px';
  
  // DPI 스케일링 처리
  const dpr = window.devicePixelRatio || 1;
  if (dpr > 1) {
    bgCanvas.width *= dpr;
    bgCanvas.height *= dpr;
    gameCanvas.width *= dpr;
    gameCanvas.height *= dpr;
    bgCtx.scale(dpr, dpr);
    ctx.scale(dpr, dpr);
  }
}

// 초기 캔버스 크기 설정
resizeCanvas();

// 윈도우 크기 변경 시 캔버스 크기 조정
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 100);
});

// ════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════
const WORLD_H    = 7000;
const ZONE_H     = WORLD_H / 5;
const ORB_GRAV   = 0.20;   // 구슬 중력 (약함 - 느리게 떨어짐)
const PLYR_GRAV  = 0.42;   // 플레이어 낙하 중력
const CAM_SMOOTH = 0.09;
const ORB_R      = 7;

const ZONE_INFO = [
  { name:'심 연', labelColor:'#cc88ff' },
  { name:'지 하', labelColor:'#d4a855' },
  { name:'지 상', labelColor:'#66ee44' },
  { name:'하 늘', labelColor:'#55ccff' },
  { name:'우 주', labelColor:'#aaddff' },
];

// 배경 그라데이션 (구역별 top / bottom)
const BG_TOP = [0x060012, 0x100c04, 0x0a1800, 0x3377bb, 0x000008];
const BG_BOT = [0x1a0040, 0x241606, 0x163000, 0x99ccff, 0x000018];

// ════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════
let gameState  = 'start';
let camY       = 0;         // 화면 아래쪽이 worldY=camY
let targetCamY = 0;
let isPractice = false;     // 연습 모드 여부
let gameTimer  = 0;         // 게임 타이머 (밀리초)
let timerInterval = null;   // 타이머 인터벌

// 월드 좌표: Y=0 = 맨 아래, Y=WORLD_H = 맨 위
// 화면 변환: screenY = CH - (worldY - camY)

let player = {
  x: CW/2, wy: 0,   // 발 위치
  vy: 0,             // 수직 속도 (월드Y 기준, 양수=위)
  w: 22, h: 30,
  falling: false,
};

let orb        = null;
let particles  = [];
let snowflakes = [];
let bgStars    = [];
let platforms  = [];
let cloudOffsets = [];
let windStrength = 0;  // 하늘에서의 바람 세기
let windParticles = []; // 바람 파티클

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function toSY(wy)     { return CH - (wy - camY); }
function rng(a,b)     { return Math.random()*(b-a)+a; }
function rngInt(a,b)  { return Math.floor(rng(a,b+1)); }
function lerp(a,b,t)  { return a+(b-a)*t; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

function lerpHex(c1,c2,t){
  const r1=(c1>>16)&0xff, g1=(c1>>8)&0xff, b1=c1&0xff;
  const r2=(c2>>16)&0xff, g2=(c2>>8)&0xff, b2=c2&0xff;
  return `rgb(${Math.round(lerp(r1,r2,t))},${Math.round(lerp(g1,g2,t))},${Math.round(lerp(b1,b2,t))})`;
}

function seedRng(seed){
  let s=(seed*2654435761)>>>0;
  return ()=>{ s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/0xffffffff; };
}

// ════════════════════════════════════════════════
//  HITBOX — 원(구슬)과 AABB(발판) 충돌 판정
//  발판 AABB: x.left, x.right, wy.bot(아래), wy.top(위)
//  반환: null | { side:'top'|'bot'|'left'|'right' }
// ════════════════════════════════════════════════
function orbHit(ox, owy, p){
  const left  = p.x;
  const right = p.x + p.w;
  const bot   = p.wy;
  const top   = p.wy + p.h;

  // 원 중심에서 AABB 가장 가까운 점
  const nearX = clamp(ox,  left, right);
  const nearY = clamp(owy, bot,  top);
  const dx = ox  - nearX;
  const dy = owy - nearY;
  if (dx*dx + dy*dy > ORB_R*ORB_R) return null;

  // 내부 여부
  const inside = (ox>=left && ox<=right && owy>=bot && owy<=top);

  if (inside){
    // 가장 가까운 면으로 배출
    const dl=ox-left, dr=right-ox, db=owy-bot, dt=top-owy;
    const m=Math.min(dl,dr,db,dt);
    if      (m===dt) return {side:'top'};
    else if (m===db) return {side:'bot'};
    else if (m===dl) return {side:'left'};
    else             return {side:'right'};
  } else {
    // 외부: near point 기준 면 판별
    const adx=Math.abs(dx), ady=Math.abs(dy);
    if (ady>=adx){
      return dy>0 ? {side:'bot'} : {side:'top'};
    } else {
      return dx>0 ? {side:'left'} : {side:'right'};
    }
  }
}

// ════════════════════════════════════════════════
//  WORLD GENERATION
// ════════════════════════════════════════════════
function generateWorld(){
  platforms=[]; bgStars=[]; snowflakes=[]; cloudOffsets=[];
  
  // 하늘 지역에서 바람 방향 설정: 항상 왼쪽 (오른쪽에서 왼쪽으로 불어옴)
  // 음수값 = 왼쪽 방향, 강도 0.008~0.015 (더 강한 바람)
  windStrength = -rng(0.008, 0.015);

  // 시작 발판
  platforms.push({ x:CW/2-80, wy:120, w:160, h:18, type:'abyss_rock', zone:0, isStart:true, seed:Math.random() });

  // ZONE 0: 심연 (높이 차이 증가, 개수 유지)
  for(let wy=220; wy<ZONE_H-40; wy+=rng(100,150)){
    const w=rng(60,120), x=rng(18,CW-w-18);
    platforms.push({ x,wy,w,h:14,type:'abyss_rock',zone:0,seed:Math.random() });
    if(Math.random()<0.25){
      const ex=x+rng(-70,w+40);
      if(ex>10&&ex+50<CW)
        platforms.push({ x:ex,wy:wy+rng(-20,20),w:rng(35,60),h:30,type:'abyss_crystal',zone:0,seed:Math.random() });
    }
  }

  // ZONE 1: 지하 (높이 차이 증가, 개수 유지)
  for(let wy=ZONE_H+60; wy<ZONE_H*2-40; wy+=rng(95,145)){
    const w=rng(70,135), x=rng(15,CW-w-15);
    const ORE=['coal','iron','gold','diamond','emerald',null,null];
    platforms.push({ x,wy,w,h:18,type:'stone',zone:1,ore:ORE[rngInt(0,ORE.length-1)],seed:Math.random() });
    if(Math.random()<0.25)
      platforms.push({ x:rng(15,CW-55),wy:wy+rng(-30,30),w:rng(40,65),h:14,type:'stone',zone:1,ore:null,seed:Math.random() });
  }

  // ZONE 2: 지상 (높이 차이 증가, 개수 유지)
  for(let wy=ZONE_H*2+60; wy<ZONE_H*3-40; wy+=rng(95,140)){
    const w=rng(75,150), x=rng(15,CW-w-15);
    platforms.push({ x,wy,w,h:18,type:'grass',zone:2,trees:Math.random()<0.55?rngInt(1,2):0,seed:Math.random() });
  }

  // ZONE 3: 하늘 (높이 차이 증가, 개수 유지, 바람 영향)
  for(let wy=ZONE_H*3+60; wy<ZONE_H*4-40; wy+=rng(100,150)){
    const w=rng(65,150), x=rng(15,CW-w-15);
    const type=Math.random()<0.60?'cloud':'mountain_ledge';
    const idx=platforms.length;
    platforms.push({ x,wy,w,h:type==='cloud'?22:15,type,zone:3,seed:Math.random() });
    if(type==='cloud') cloudOffsets[idx]=rng(0,Math.PI*2);
  }

  // ZONE 4: 우주 (높이 차이 증가, 개수 유지)
  for(let wy=ZONE_H*4+60; wy<ZONE_H*5-160; wy+=rng(100,145)){
    const w=rng(50,100), x=rng(15,CW-w-15);
    platforms.push({ x,wy,w,h:14,type:'asteroid',zone:4,seed:Math.random() });
  }

  // 골
  platforms.push({ x:CW/2-80,wy:WORLD_H-100,w:160,h:22,type:'station',zone:4,isGoal:true,seed:0 });

  // 별
  for(let i=0;i<350;i++)
    bgStars.push({ x:rng(0,CW),wy:rng(0,WORLD_H),r:rng(0.4,2.0),alpha:rng(0.3,1.0),phase:rng(0,Math.PI*2) });

  // 눈송이
  for(let i=0;i<140;i++)
    snowflakes.push({ x:rng(0,CW),wy:rng(ZONE_H*3,ZONE_H*4),r:rng(0.8,2.8),vx:rng(-0.4,0.4),vy:-rng(0.4,1.2),alpha:rng(0.3,0.85) });
}

// ════════════════════════════════════════════════
//  PLAYER INIT
// ════════════════════════════════════════════════
function initPlayer(){
  const start=platforms.find(p=>p.isStart);
  player.x=start.x+start.w/2;
  player.wy=start.wy+start.h;
  player.vy=0; player.falling=false;
  camY=0; targetCamY=0;
  orb=null; particles=[]; windParticles=[];
}

// ════════════════════════════════════════════════
//  PLAYER PHYSICS
// ════════════════════════════════════════════════
function updatePlayer(){
  if(!player.falling) return;

  player.vy -= PLYR_GRAV;
  player.wy += player.vy;

  // 발판 윗면에 착지
  for(const p of platforms){
    const platTop = p.wy+p.h;
    if(
      player.wy <= platTop+2 &&
      player.wy >= platTop - Math.abs(player.vy)-4 &&
      player.x - player.w/2 < p.x+p.w &&
      player.x + player.w/2 > p.x &&
      player.vy <= 0
    ){
      player.wy=platTop; player.vy=0; player.falling=false;
      spawnBurst(player.x, player.wy, '160,200,255');
      updateUI();
      if(p.isGoal){ gameState='win'; setTimeout(()=>document.getElementById('winScreen').classList.add('show'),400); }
      return;
    }
  }

  // 맵 아래 바닥
  if(player.wy<=0){ player.wy=0; player.vy=0; player.falling=false; }

  targetCamY=player.wy-CH*0.35;
  targetCamY=Math.max(0,Math.min(WORLD_H-CH,targetCamY));
}

// ════════════════════════════════════════════════
//  ORB THROW
// ════════════════════════════════════════════════
function throwOrb(mouseX,mouseY){
  if(gameState!=='playing'||orb) return;
  // 플레이어가 떨어지는 중이면 구슬을 던질 수 없음
  if(player.falling) return;
  const pSY=toSY(player.wy)-player.h/2;
  const dx=mouseX-player.x, dy=mouseY-pSY;
  const dist=Math.hypot(dx,dy);
  if(dist<5) return;
  const speed=clamp(7+dist*0.015,7,13);  // 속도 감소: 11→7, 19→13, 0.025→0.015
  // 구슬이 플레이어에서 약간 거리를 두고 발사되도록 설정
  const offsetDist = 18;
  const offsetX = player.x + (dx/dist)*offsetDist;
  const offsetWY = player.wy-player.h/2 + (-(dy/dist))*offsetDist;
  orb={ x:offsetX, wy:offsetWY, vx:(dx/dist)*speed, vy:-(dy/dist)*speed, trail:[] };
}

// ════════════════════════════════════════════════
//  ORB UPDATE — 전면 히트박스, 사망 없음
// ════════════════════════════════════════════════
function updateOrb(){
  if(!orb) return;

  orb.trail.push({x:orb.x,wy:orb.wy});
  if(orb.trail.length>16) orb.trail.shift();

  // 약한 중력
  orb.vy -= ORB_GRAV;
  orb.x  += orb.vx;
  orb.wy += orb.vy;

  // 하늘 지역(ZONE 3)에서 바람 효과 적용
  const orbZone = Math.floor(orb.wy / ZONE_H);
  if(orbZone === 3){
    // 바람에 의해 구슬이 옆으로 밀려남 (훨씬 강한 효과)
    // windStrength는 음수값 (왼쪽 방향)
    orb.x += windStrength * 3;  // 기본 바람 * 3 (강한 이동)
    orb.vx += windStrength * 0.15;  // 구슬의 속도도 바람에 영향 (강함)
  }

  // 벽 충돌 처리 (순간이동)
  if(orb.x < ORB_R){
    doWallTeleport(0, orb.x, orb.wy);
    return;
  } else if(orb.x > CW - ORB_R){
    doWallTeleport(CW, orb.x, orb.wy);
    return;
  }

  // 구슬이 매우 아래로 벗어났을 때도 발판과 충돌 체크 계속
  // 화면 아래로 벗어나는 것만 제거
  if(orb.wy < -200){
    orb=null; return;
  }

  // 발판 히트박스 (윗면/아랫면/옆면 모두)
  for(const p of platforms){
    const hit=orbHit(orb.x, orb.wy, p);
    if(!hit) continue;
    doTeleport(p, hit, orb.x, orb.wy);
    return;
  }
}

// ════════════════════════════════════════════════
//  TELEPORT — 충돌 위치에 순간이동
// ════════════════════════════════════════════════
function doTeleport(p, hit, ox, owy){
  spawnBurst(ox, owy, '80,255,140');
  orb=null;

  // 모든 면: 정확한 충돌 위치에 순간이동
  player.x  = clamp(ox, player.w/2+2, CW-player.w/2-2);
  player.wy = owy;
  player.vy = 0;
  player.falling = true;

  spawnBurst(player.x, player.wy+player.h/2, '140,200,255');

  targetCamY = player.wy - CH*0.35;
  targetCamY = Math.max(0, Math.min(WORLD_H-CH, targetCamY));

  updateUI();

  if(p.isGoal && hit.side==='top'){
    gameState='win';
    
    // 타이머 중지
    if(timerInterval) clearInterval(timerInterval);
    
    // 게임 모드일 때만 타이머 표시
    if(!isPractice){
      const hours = Math.floor(gameTimer / 3600000);
      const minutes = Math.floor((gameTimer % 3600000) / 60000);
      const seconds = Math.floor((gameTimer % 60000) / 1000);
      const timerStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      document.getElementById('winTime').textContent = `걸린 시간: ${timerStr}`;
      document.getElementById('timer').style.display = 'none';
    }
    
    setTimeout(()=>document.getElementById('winScreen').classList.add('show'),400);
  }
}

// ════════════════════════════════════════════════
//  WALL TELEPORT — 벽에 충돌했을 때 순간이동
// ════════════════════════════════════════════════
function doWallTeleport(wallX, ox, owy){
  spawnBurst(ox, owy, '80,255,140');
  orb=null;

  // 벽 위치에 순간이동하고 낙하 시작
  player.x = wallX === 0 ? player.w/2+2 : CW-player.w/2-2;
  player.wy = owy;
  player.vy = 0;
  player.falling = true;

  spawnBurst(player.x, player.wy+player.h/2, '140,200,255');

  targetCamY = player.wy - CH*0.35;
  targetCamY = Math.max(0, Math.min(WORLD_H-CH, targetCamY));

  updateUI();
}

// ════════════════════════════════════════════════
//  BACKGROUND
// ════════════════════════════════════════════════
function drawBackground(){
  bgCtx.clearRect(0,0,CW,CH);
  const botWY=camY, topWY=camY+CH;
  for(let z=0;z<=4;z++){
    const zBot=z*ZONE_H, zTop=(z+1)*ZONE_H;
    const visBot=Math.max(botWY,zBot), visTop=Math.min(topWY,zTop);
    if(visTop<=visBot) continue;
    const sTop=CH-(visTop-camY), sBot=CH-(visBot-camY);
    const fracBot=(visBot-zBot)/ZONE_H, fracTop=(visTop-zBot)/ZONE_H;
    const grad=bgCtx.createLinearGradient(0,sTop,0,sBot);
    grad.addColorStop(0, lerpHex(BG_TOP[z],BG_BOT[z],1-fracTop));
    grad.addColorStop(1, lerpHex(BG_TOP[z],BG_BOT[z],1-fracBot));
    bgCtx.fillStyle=grad;
    bgCtx.fillRect(0,sTop,CW,sBot-sTop);
  }
  drawBgStars();
  drawMountains();
  drawSnowflakes();
}

function drawBgStars(){
  const t=Date.now()*0.001;
  bgStars.forEach(s=>{
    const sy=toSY(s.wy);
    if(sy<-4||sy>CH+4) return;
    const z=Math.floor(s.wy/ZONE_H);
    if(z!==0&&z!==4) return;
    const tw=0.55+0.45*Math.sin(t*1.8+s.phase);
    bgCtx.beginPath(); bgCtx.arc(s.x,sy,s.r,0,Math.PI*2);
    bgCtx.fillStyle=z===4?`rgba(200,220,255,${s.alpha*tw})`:`rgba(200,140,255,${s.alpha*tw})`;
    bgCtx.fill();
  });
}

const MOUNTAINS=[
  {ox:-40,wy:ZONE_H*3+260,hw:180,ph:320},
  {ox:90, wy:ZONE_H*3+230,hw:150,ph:280},
  {ox:250,wy:ZONE_H*3+270,hw:170,ph:350},
  {ox:390,wy:ZONE_H*3+240,hw:155,ph:300},
  {ox:520,wy:ZONE_H*3+255,hw:160,ph:290},
];
function drawMountains(){
  MOUNTAINS.forEach(m=>{
    const bY=toSY(m.wy), pY=toSY(m.wy+m.ph);
    if(pY>CH+20||bY<-20) return;
    bgCtx.beginPath();
    bgCtx.moveTo(m.ox-m.hw,bY); bgCtx.lineTo(m.ox,pY); bgCtx.lineTo(m.ox+m.hw,bY);
    bgCtx.closePath(); bgCtx.fillStyle='rgba(70,95,130,0.55)'; bgCtx.fill();
    bgCtx.beginPath();
    bgCtx.moveTo(m.ox-m.hw*0.28,pY+m.ph*0.18); bgCtx.lineTo(m.ox,pY); bgCtx.lineTo(m.ox+m.hw*0.28,pY+m.ph*0.18);
    bgCtx.closePath(); bgCtx.fillStyle='rgba(230,242,255,0.82)'; bgCtx.fill();
  });
}

function drawSnowflakes(){
  snowflakes.forEach(sf=>{
    const sy=toSY(sf.wy);
    if(sy<-6||sy>CH+6) return;
    bgCtx.beginPath(); bgCtx.arc(sf.x,sy,sf.r,0,Math.PI*2);
    bgCtx.fillStyle=`rgba(220,238,255,${sf.alpha})`; bgCtx.fill();
  });
}

// ════════════════════════════════════════════════
//  PLATFORM DRAWING
// ════════════════════════════════════════════════
const ORE_C={
  coal:   {fill:'#1a1a1a',glow:'rgba(40,40,40,0.5)'},
  iron:   {fill:'#cc9966',glow:'rgba(200,160,100,0.6)'},
  gold:   {fill:'#ffd700',glow:'rgba(255,210,0,0.85)'},
  diamond:{fill:'#44ddff',glow:'rgba(60,220,255,0.9)'},
  emerald:{fill:'#00cc44',glow:'rgba(0,200,60,0.85)'},
};

function drawPlatforms(){
  const t=Date.now()*0.001;
  platforms.forEach((p,idx)=>{
    const top=toSY(p.wy+p.h), bot=toSY(p.wy);
    if(bot<-60||top>CH+80) return;
    const ph=bot-top;
    ctx.save();

    switch(p.type){

      case 'abyss_rock':{
        const g=ctx.createLinearGradient(p.x,top,p.x,bot);
        g.addColorStop(0,'#3d1465'); g.addColorStop(1,'#1a052e');
        ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,3); ctx.fill();
        ctx.shadowColor='#9922ff'; ctx.shadowBlur=8;
        ctx.strokeStyle='rgba(170,70,255,0.55)'; ctx.lineWidth=1.2; ctx.stroke();
        ctx.shadowBlur=0; break;
      }

      case 'abyss_crystal':{
        const cx=p.x+p.w/2;
        const glow=0.5+0.5*Math.sin(t*2.2+p.seed*10);
        ctx.shadowColor=`rgba(200,100,255,${0.4+glow*0.4})`; ctx.shadowBlur=10+glow*8;
        ctx.fillStyle=`rgba(160,60,240,${0.35+glow*0.2})`;
        ctx.beginPath();
        ctx.moveTo(cx,top-ph*0.35);
        ctx.lineTo(cx+p.w*0.42,top+ph*0.38);
        ctx.lineTo(cx,bot);
        ctx.lineTo(cx-p.w*0.42,top+ph*0.38);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle=`rgba(220,140,255,${0.6+glow*0.3})`; ctx.lineWidth=1.4; ctx.stroke();
        ctx.shadowBlur=0; break;
      }

      case 'stone':{
        const g=ctx.createLinearGradient(p.x,top,p.x,bot);
        g.addColorStop(0,'#7a7060'); g.addColorStop(1,'#48403a');
        ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,2); ctx.fill();
        ctx.strokeStyle='rgba(0,0,0,0.28)'; ctx.lineWidth=1;
        [0.28,0.62].forEach(fx=>{
          ctx.beginPath(); ctx.moveTo(p.x+p.w*fx,top+1); ctx.lineTo(p.x+p.w*(fx+0.04),bot-1); ctx.stroke();
        });
        if(p.ore){
          const oc=ORE_C[p.ore]; if(oc){
            ctx.shadowColor=oc.glow; ctx.shadowBlur=p.ore==='coal'?2:7; ctx.fillStyle=oc.fill;
            for(let i=0;i<4;i++){
              const ox=p.x+p.w*0.12+(p.w*0.76)*(i/3);
              const oy=top+(bot-top)*(0.25+0.5*((i%2)===0?0:1));
              ctx.beginPath(); ctx.arc(ox,oy,2.8,0,Math.PI*2); ctx.fill();
            }
            ctx.shadowBlur=0;
          }
        }
        ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,2); ctx.stroke(); break;
      }

      case 'grass':{
        const g=ctx.createLinearGradient(p.x,top,p.x,bot);
        g.addColorStop(0,'#4fa620'); g.addColorStop(0.35,'#3d8c18');
        g.addColorStop(0.35,'#8b5e3c'); g.addColorStop(1,'#5a3a1a');
        ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,3); ctx.fill();
        ctx.fillStyle='#5dbf28';
        for(let gx=p.x+5;gx<p.x+p.w-4;gx+=9){
          ctx.beginPath(); ctx.moveTo(gx-3,top); ctx.lineTo(gx,top-5); ctx.lineTo(gx+3,top); ctx.fill();
        }
        if(p.trees>0){
          const gap=p.w/(p.trees+1);
          for(let ti=1;ti<=p.trees;ti++) drawTree(p.x+gap*ti,top);
        }
        break;
      }

      case 'cloud':{
        const wobble=Math.sin(t*0.9+(cloudOffsets[idx]||0))*3;
        const cx=p.x+p.w/2, cy=top+ph/2+wobble, rx=p.w/2, ry=ph/2;
        ctx.shadowColor='rgba(210,235,255,0.7)'; ctx.shadowBlur=14;
        ctx.fillStyle='rgba(235,245,255,0.90)';
        [[0,0,rx*0.65,ry],[rx*0.38,-ry*0.25,rx*0.5,ry*0.8],[-rx*0.38,-ry*0.25,rx*0.5,ry*0.8],
         [rx*0.72,ry*0.15,rx*0.35,ry*0.65],[-rx*0.72,ry*0.15,rx*0.35,ry*0.65]].forEach(([dx,dy,brx,bry])=>{
          ctx.beginPath(); ctx.ellipse(cx+dx,cy+dy,brx,bry,0,0,Math.PI*2); ctx.fill();
        });
        ctx.shadowBlur=0; break;
      }

      case 'mountain_ledge':{
        const g=ctx.createLinearGradient(p.x,top,p.x,bot);
        g.addColorStop(0,'#7888aa'); g.addColorStop(1,'#4a5568');
        ctx.fillStyle=g; ctx.beginPath();
        ctx.moveTo(p.x,bot); ctx.lineTo(p.x+p.w*0.15,top+2);
        ctx.lineTo(p.x+p.w/2,top); ctx.lineTo(p.x+p.w*0.85,top+2);
        ctx.lineTo(p.x+p.w,bot); ctx.closePath(); ctx.fill();
        ctx.fillStyle='rgba(228,240,255,0.88)'; ctx.beginPath();
        ctx.moveTo(p.x+p.w*0.3,top+ph*0.45); ctx.lineTo(p.x+p.w/2,top); ctx.lineTo(p.x+p.w*0.7,top+ph*0.45);
        ctx.closePath(); ctx.fill(); break;
      }

      case 'asteroid':{
        const cx2=p.x+p.w/2, cy2=top+ph/2, rBase=p.w*0.45;
        const ga=ctx.createRadialGradient(cx2-rBase*0.2,cy2-rBase*0.2,1,cx2,cy2,rBase);
        ga.addColorStop(0,'#6a6078'); ga.addColorStop(1,'#201820');
        ctx.fillStyle=ga;
        const sr=seedRng(p.seed);
        ctx.beginPath();
        for(let i=0;i<9;i++){
          const ang=(i/9)*Math.PI*2-Math.PI/2;
          const r=rBase*(0.75+sr()*0.45);
          const px2=cx2+Math.cos(ang)*r, py2=cy2+Math.sin(ang)*r*0.55;
          i===0?ctx.moveTo(px2,py2):ctx.lineTo(px2,py2);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle='rgba(180,160,200,0.25)'; ctx.lineWidth=1; ctx.stroke();
        ctx.fillStyle='rgba(0,0,0,0.28)';
        [[-0.2,-0.05,3.5],[0.25,0.1,2.2],[-0.05,0.15,1.8]].forEach(([dx,dy,r])=>{
          ctx.beginPath(); ctx.arc(cx2+dx*rBase,cy2+dy*rBase*0.55,r,0,Math.PI*2); ctx.fill();
        });
        break;
      }

      case 'station':{
        const g=ctx.createLinearGradient(p.x,top,p.x,bot);
        g.addColorStop(0,'#7acdff'); g.addColorStop(1,'#1a66aa');
        ctx.fillStyle=g; ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,5); ctx.fill();
        const pulse=0.55+0.45*Math.sin(t*2.5);
        ctx.shadowColor=`rgba(0,200,255,${0.5+pulse*0.4})`; ctx.shadowBlur=14+pulse*10;
        ctx.strokeStyle='#00eeff'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.roundRect(p.x,top,p.w,ph,5); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(0,100,180,0.7)';
        ctx.fillRect(p.x-30,top+6,26,10); ctx.fillRect(p.x+p.w+4,top+6,26,10);
        ctx.strokeStyle='rgba(100,220,255,0.5)'; ctx.lineWidth=0.8;
        ctx.strokeRect(p.x-30,top+6,26,10); ctx.strokeRect(p.x+p.w+4,top+6,26,10);
        ctx.fillStyle='#fff'; ctx.font='bold 11px "Nanum Gothic"';
        ctx.textAlign='center'; ctx.fillText('★ GOAL ★',p.x+p.w/2,top-7); break;
      }
    }
    ctx.restore();
  });
}

function drawTree(tx,baseY){
  ctx.fillStyle='#6b3a22'; ctx.fillRect(tx-3,baseY-24,6,24);
  [{yOff:24,hw:14,col:'#2d9618'},{yOff:17,hw:11,col:'#3aae1e'},{yOff:11,hw:7,col:'#28881a'}].forEach(l=>{
    ctx.fillStyle=l.col; ctx.beginPath();
    ctx.moveTo(tx,baseY-l.yOff-l.hw*1.1); ctx.lineTo(tx-l.hw,baseY-l.yOff); ctx.lineTo(tx+l.hw,baseY-l.yOff);
    ctx.closePath(); ctx.fill();
  });
}

// ════════════════════════════════════════════════
//  PLAYER DRAWING
// ════════════════════════════════════════════════
function drawPlayer(){
  const sy=toSY(player.wy), px=player.x-player.w/2, py=sy-player.h;
  const zone=Math.min(4,Math.floor(player.wy/ZONE_H));
  ctx.save();

  const gb=ctx.createLinearGradient(px,py+10,px,sy);
  gb.addColorStop(0,'#88aaff'); gb.addColorStop(1,'#334488');
  ctx.fillStyle=gb; ctx.beginPath(); ctx.roundRect(px+2,py+9,player.w-4,player.h-9,3); ctx.fill();

  ctx.fillStyle='#f0c888'; ctx.beginPath(); ctx.ellipse(player.x,py+6,9,9,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#222';
  ctx.beginPath(); ctx.arc(player.x-3,py+5,1.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(player.x+3,py+5,1.5,0,Math.PI*2); ctx.fill();

  if(zone===4){
    ctx.shadowColor='#00d4ff'; ctx.shadowBlur=10;
    ctx.strokeStyle='rgba(100,220,255,0.75)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(player.x,py+6,11,11,0,0,Math.PI*2); ctx.stroke(); ctx.shadowBlur=0;
  } else if(zone===3){
    ctx.fillStyle='#ee5533'; ctx.beginPath(); ctx.roundRect(px+2,py+14,player.w-4,5,2); ctx.fill();
  } else if(zone===1){
    ctx.fillStyle='#ffcc00'; ctx.beginPath(); ctx.roundRect(px+4,py-2,player.w-8,7,3); ctx.fill();
    ctx.fillStyle='rgba(255,255,200,0.8)'; ctx.beginPath(); ctx.arc(player.x,py+1,2.5,0,Math.PI*2); ctx.fill();
  }

  // 낙하 중 점선 테두리
  if(player.falling){
    ctx.strokeStyle='rgba(150,200,255,0.4)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.rect(px-2,py-2,player.w+4,player.h+4); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

// ════════════════════════════════════════════════
//  ORB DRAWING
// ════════════════════════════════════════════════
function drawOrb(){
  if(!orb) return;
  const sy=toSY(orb.wy);
  orb.trail.forEach((tr,i)=>{
    const tsy=toSY(tr.wy), alpha=(i/orb.trail.length)*0.45, r2=Math.max(0.1,ORB_R*(i/orb.trail.length)*0.65);
    ctx.beginPath(); ctx.arc(tr.x,tsy,r2,0,Math.PI*2);
    ctx.fillStyle=`rgba(100,255,140,${alpha})`; ctx.fill();
  });
  ctx.save();
  ctx.shadowColor='#60ff90'; ctx.shadowBlur=18;
  const go=ctx.createRadialGradient(orb.x,sy,0,orb.x,sy,ORB_R);
  go.addColorStop(0,'rgba(210,255,220,1)'); go.addColorStop(0.5,'rgba(80,230,110,0.85)'); go.addColorStop(1,'rgba(20,160,50,0)');
  ctx.fillStyle=go; ctx.beginPath(); ctx.arc(orb.x,sy,ORB_R,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ════════════════════════════════════════════════
//  PARTICLES
// ════════════════════════════════════════════════
function spawnBurst(wx,wy,rgb){
  for(let i=0;i<22;i++){
    const a=Math.random()*Math.PI*2, s=Math.random()*4.5+0.8;
    particles.push({ x:wx,wy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:Math.random()*3.2+0.8,rgb,alpha:0.9 });
  }
}
function updateParticles(){
  particles=particles.filter(p=>p.alpha>0.03);
  particles.forEach(p=>{ p.x+=p.vx; p.wy+=p.vy; p.vy-=0.08; p.alpha-=0.022; p.r*=0.97; });
}
function drawParticles(){
  particles.forEach(p=>{
    const sy=toSY(p.wy);
    ctx.beginPath(); ctx.arc(p.x,sy,Math.max(0.1,p.r),0,Math.PI*2);
    ctx.fillStyle=`rgba(${p.rgb},${p.alpha})`; ctx.fill();
  });
}

// ════════════════════════════════════════════════
//  SNOWFLAKES
// ════════════════════════════════════════════════
function updateSnowflakes(){
  const skyBot=ZONE_H*3, skyTop=ZONE_H*4;
  snowflakes.forEach(sf=>{
    sf.x+=sf.vx; sf.wy+=sf.vy;
    if(sf.wy<skyBot) sf.wy=skyTop;
    if(sf.x<0) sf.x=CW; if(sf.x>CW) sf.x=0;
  });
}

// ════════════════════════════════════════════════
//  WIND PARTICLES (하늘 지역 바람 애니메이션)
// ════════════════════════════════════════════════
function updateWindParticles(){
  // 하늘 지역에서만 바람 파티클 생성
  const skyBot=ZONE_H*3, skyTop=ZONE_H*4;
  const playerInSky = player.wy >= skyBot && player.wy < skyTop;
  const orbInSky = orb && orb.wy >= skyBot && orb.wy < skyTop;
  
  // 하늘 지역에 있으면 계속 바람 파티클 생성 (더 빈번하게)
  if(playerInSky || orbInSky || (camY >= skyBot - CH/2 && camY < skyTop)){
    // 높은 확률로 파티클 생성
    const particleChance = orbInSky ? 0.85 : 0.7;
    if(Math.random() < particleChance){
      const wx = CW + 20 + Math.random() * 40;  // 오른쪽에서 시작
      const wy = camY + Math.random() * CH;
      windParticles.push({
        x: wx,
        wy: wy,
        vx: -rng(2.5, 4.5),  // 더 빠른 속도로 왼쪽으로 이동
        vy: rng(-0.8, 0.8),
        alpha: rng(0.25, 0.55),  // 더 밝음
        length: rng(16, 32),  // 더 길게
        thickness: rng(2, 4)
      });
    }
  }
  
  // 바람 파티클 업데이트
  windParticles = windParticles.filter(wp => {
    wp.x += wp.vx;
    wp.wy += wp.vy;
    wp.alpha *= 0.96;  // 더 천천히 사라짐
    return wp.alpha > 0.01 && wp.x > -150 && wp.x < CW + 50;
  });
}

function drawWindParticles(){
  // 하늘 지역에서만 바람 파티클 표시
  const skyBot=ZONE_H*3, skyTop=ZONE_H*4;
  
  windParticles.forEach(wp=>{
    // 카메라 범위 내에만 그리기
    if(wp.wy >= camY - 150 && wp.wy <= camY + CH + 150){
      const sy = toSY(wp.wy);
      
      // 바람 선 그리기 (더 선명하게)
      ctx.strokeStyle = `rgba(100,180,255,${wp.alpha * 0.8})`;
      ctx.lineWidth = wp.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(wp.x, sy);
      ctx.lineTo(wp.x + wp.length * 0.6, sy - wp.length * 0.4);
      ctx.stroke();
      
      // 바람 입자의 끝에 점 추가 (더 선명한 효과)
      ctx.fillStyle = `rgba(150,200,255,${wp.alpha})`;
      ctx.beginPath();
      ctx.arc(wp.x + wp.length * 0.6, sy - wp.length * 0.4, wp.thickness * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ════════════════════════════════════════════════
//  CAMERA
// ════════════════════════════════════════════════
function updateCamera(){
  camY+=(targetCamY-camY)*CAM_SMOOTH;
  camY=Math.max(0,Math.min(WORLD_H-CH,camY));
}

// ════════════════════════════════════════════════
//  UI
// ════════════════════════════════════════════════
function updateUI(){
  const pct=clamp(player.wy/WORLD_H,0,1);
  const zone=Math.min(4,Math.floor(player.wy/ZONE_H));
  document.getElementById('zoneLabel').textContent=ZONE_INFO[zone].name;
  document.getElementById('zoneLabel').style.color=ZONE_INFO[zone].labelColor;
  document.getElementById('progressFill').style.width=(pct*100)+'%';
  document.getElementById('progressPct').textContent=Math.round(pct*100)+'%';
  const bars=['linear-gradient(90deg,#7b2ff7,#cc44ff)','linear-gradient(90deg,#8B6914,#ffd066)',
              'linear-gradient(90deg,#228B22,#88ee44)','linear-gradient(90deg,#1E90FF,#88ddff)',
              'linear-gradient(90deg,#4466aa,#00d4ff)'];
  document.getElementById('progressFill').style.background=bars[zone];
  
  // 동적 hint 텍스트
  const hintEl = document.getElementById('hint');
  if(player.falling){
    hintEl.textContent = '⚠️ 추락 중... 다음 발판을 노려라!';
    hintEl.style.color = 'rgba(255,150,150,0.5)';
  } else if(zone === 3){
    hintEl.textContent = '💨 바람에 주의하세요! (오른쪽←왼쪽)';
    hintEl.style.color = 'rgba(100,180,255,0.6)';
  } else {
    hintEl.textContent = '좌클릭으로 구슬을 던지세요';
    hintEl.style.color = 'rgba(255,255,255,0.35)';
  }
}

// ════════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════════
function gameLoop(ts){
  requestAnimationFrame(gameLoop);
  if(gameState==='playing'){
    updateOrb();
    updatePlayer();
    updateParticles();
    updateSnowflakes();
    updateWindParticles();
    updateCamera();
    updateUI();  // 매 프레임마다 UI 업데이트
  }
  drawBackground();
  ctx.clearRect(0,0,CW,CH);
  drawPlatforms();
  drawPlayer();
  drawOrb();
  drawParticles();
  drawWindParticles();
}

// ════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════
gameCanvas.addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const rect=gameCanvas.getBoundingClientRect();
  throwOrb((e.clientX-rect.left)*(CW/rect.width),(e.clientY-rect.top)*(CH/rect.height));
});
gameCanvas.addEventListener('touchstart',e=>{
  e.preventDefault();
  const rect=gameCanvas.getBoundingClientRect(), t=e.touches[0];
  throwOrb((t.clientX-rect.left)*(CW/rect.width),(t.clientY-rect.top)*(CH/rect.height));
},{passive:false});

// ════════════════════════════════════════════════
//  GAME CONTROL
// ════════════════════════════════════════════════
function startGame(){
  hideAll(); 
  generateWorld(); 
  initPlayer(); 
  gameState='playing'; 
  isPractice=false;
  updateUI();
  
  // 타이머 시작
  gameTimer = 0;
  document.getElementById('timer').style.display = 'block';
  if(timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    gameTimer += 10;
    updateTimerDisplay();
  }, 10);
  
  // 메인으로 버튼 숨기기
  document.getElementById('backToMainBtn').style.display = 'none';
}

function restartGame(){
  // 타이머 중지
  if(timerInterval) clearInterval(timerInterval);
  document.getElementById('timer').style.display = 'none';
  
  hideAll(); 
  generateWorld(); 
  initPlayer(); 
  particles=[]; 
  windParticles=[];
  orb=null; 
  gameState='playing'; 
  updateUI();
  
  if(!isPractice){
    // 게임 모드에서는 타이머 재시작
    gameTimer = 0;
    document.getElementById('timer').style.display = 'block';
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      gameTimer += 10;
      updateTimerDisplay();
    }, 10);
  }
}

function hideAll(){
  ['mainScreen','practiceScreen','deathScreen','winScreen'].forEach(id=>document.getElementById(id).classList.remove('show'));
}

function showPracticeScreen(){
  hideAll();
  document.getElementById('practiceScreen').classList.add('show');
}

function practicZone(zone){
  hideAll();
  generateWorld();
  initPlayer();
  gameState='playing';
  isPractice=true;
  
  // 해당 지역의 첫 플랫폼으로 순간이동
  const zonePlatforms = platforms.filter(p => p.zone === zone);
  if(zonePlatforms.length > 0){
    const firstPlatform = zonePlatforms[0];
    player.x = firstPlatform.x + firstPlatform.w/2;
    player.wy = firstPlatform.wy + firstPlatform.h;
    player.vy = 0;
    player.falling = false;
    targetCamY = player.wy - CH*0.35;
  }
  
  updateUI();
  
  // 타이머 숨기기
  document.getElementById('timer').style.display = 'none';
  if(timerInterval) clearInterval(timerInterval);
  
  // 메인으로 버튼 보이기
  document.getElementById('backToMainBtn').style.display = 'block';
}

function backToMain(){
  if(timerInterval) clearInterval(timerInterval);
  document.getElementById('timer').style.display = 'none';
  document.getElementById('backToMainBtn').style.display = 'none';
  
  hideAll();
  document.getElementById('mainScreen').classList.add('show');
  
  gameState='start';
  particles=[];
  windParticles=[];
  orb=null;
}

function updateTimerDisplay(){
  const hours = Math.floor(gameTimer / 3600000);
  const minutes = Math.floor((gameTimer % 3600000) / 60000);
  const seconds = Math.floor((gameTimer % 60000) / 1000);
  
  const timerStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('timer').textContent = timerStr;
}

// ════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════
generateWorld();
initPlayer();
requestAnimationFrame(gameLoop);
