'use strict';

// ============================================================
// HUNTER OF THE BOSS — Open World Edition
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const SW = canvas.width;      // screen width
const SH = canvas.height;     // screen height

// Night overlay offscreen canvas
const nightCanvas = document.createElement('canvas');
nightCanvas.width = SW; nightCanvas.height = SH;
const nightCtx = nightCanvas.getContext('2d');
nightCtx.imageSmoothingEnabled = false;
let WORLD_W = 20000;
let WORLD_H = 20000;
let DAY_CYCLE = 600; // seconds for full day/night cycle
const SAVE_KEY = 'wzrd_world_v2';

// ---------- Infinite world chunk system ----------
const CHUNK_SIZE   = 2000;  // 2000×2000 px per chunk
const CHUNK_RADIUS = 2;     // load 5×5 chunks around player

// ---------- Dungeon constants ----------
const DUNGEON_TILE = 32;
const DUNGEON_COLS = 60;
const DUNGEON_ROWS = 40;
// Room definitions: [c0,c1] cols, [r0,r1] rows (inclusive)
const DUNGEON_ROOMS = [
  { c0: 2,  c1: 13, r0: 14, r1: 27, type: 'start'    },
  { c0: 17, c1: 28, r0: 5,  r1: 17, type: 'side'     },
  { c0: 17, c1: 28, r0: 24, r1: 36, type: 'loot'     },
  { c0: 32, c1: 46, r0: 13, r1: 29, type: 'center'   },
  { c0: 50, c1: 58, r0: 5,  r1: 16, type: 'treasure' },
  { c0: 50, c1: 58, r0: 24, r1: 37, type: 'boss'     },
];
const DUNGEON_CORRIDORS = [
  { c0: 14, c1: 16, r0: 14, r1: 16 }, // start → side
  { c0: 14, c1: 16, r0: 25, r1: 27 }, // start → loot
  { c0: 29, c1: 31, r0: 14, r1: 16 }, // side → center
  { c0: 29, c1: 31, r0: 25, r1: 27 }, // loot → center
  { c0: 47, c1: 49, r0: 13, r1: 15 }, // center → treasure
  { c0: 47, c1: 49, r0: 25, r1: 27 }, // center → boss
];

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------- Noise + Biomes ----------
function hashInt(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
function noise2(ix, iy) { return (hashInt(ix * 127 + iy * 311 + 42) & 0xffff) / 65535; }
function smoothN(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
  return noise2(ix,iy)*(1-ux)*(1-uy) + noise2(ix+1,iy)*ux*(1-uy) + noise2(ix,iy+1)*(1-ux)*uy + noise2(ix+1,iy+1)*ux*uy;
}
const BS = 200; // biome scale
function getBiome(wx, wy) {
  if (smoothN(wx/90+500, wy/90+500) > 0.83) return 5; // water lake
  const n = (smoothN(wx/BS, wy/BS) + smoothN(wx/BS*0.5+100, wy/BS*0.5+200)*0.5) / 1.5;
  if (n < 0.25) return 2; // desert
  if (n < 0.44) return 0; // plains
  if (n < 0.63) return 1; // forest
  if (n < 0.79) return 3; // swamp
  return 4; // mountains
}
const BIOME_COLORS = [
  ['#1d3320','#234029','#284a30'], // plains
  ['#0f2010','#152815','#1a3018'], // forest
  ['#5a4a22','#6a5a2a','#504018'], // desert
  ['#182818','#1a2c1a','#1e2c18'], // swamp
  ['#363434','#3e3c3c','#424040'], // mountains
  ['#1a2a7a','#1e3088','#182070'], // water
];

// Deterministyczny losowy dla każdego chunka — ten sam seed = ten sam chunk
function chunkRand(cx, cy, idx) {
  return (hashInt(((cx & 0x7fff) * 73856093) ^ ((cy & 0x7fff) * 19349663) ^ ((idx & 0xffff) * 83492791)) >>> 0) / 4294967295;
}

// ---------- Camera ----------
const camera = { x: 0, y: 0 };

// ---------- Input ----------
const keys = Object.create(null);
const mouseScreen = { x: SW / 2, y: SH / 2 };
const mouseWorld = { x: WORLD_W / 2, y: WORLD_H / 2 };
let mouseDown = false;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Tab') { e.preventDefault(); }
  if (e.code === 'Escape' && state.running) {
    if (state.craftingOpen)  { state.craftingOpen = false; return; }
    if (state.furnaceOpen)   { state.furnaceOpen = false; return; }
    if (state.inventoryOpen) { state.inventoryOpen = false; return; }
    if (state.equipOpen)     { state.equipOpen = false; return; }
    if (state.buildMode) { state.buildMode = false; state.buildRotated = false; return; }
    state.paused = !state.paused;
    if (state.paused) { pauseOverlay.classList.remove('hidden'); saveWorld(); }
    else              { pauseOverlay.classList.add('hidden'); }
    return;
  }
  if (!state.running) return;
  if (state.paused) return;
  if (state.craftingOpen) {
    const rr = getRecipes();
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') { state.craftingSelected = (state.craftingSelected - 1 + rr.length) % rr.length; e.preventDefault(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { state.craftingSelected = (state.craftingSelected + 1) % rr.length; e.preventDefault(); return; }
    if (e.code === 'KeyE' || e.code === 'Enter') { doCraft(rr[state.craftingSelected]); return; }
    if (e.code === 'KeyU') { upgradeCraftingTable(); return; }
    return;
  }
  if (state.furnaceOpen) {
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') { state.furnaceSelected = (state.furnaceSelected - 1 + FURNACE_RECIPES.length) % FURNACE_RECIPES.length; e.preventDefault(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { state.furnaceSelected = (state.furnaceSelected + 1) % FURNACE_RECIPES.length; e.preventDefault(); return; }
    if (e.code === 'KeyE' || e.code === 'Enter') { doFurnace(FURNACE_RECIPES[state.furnaceSelected]); return; }
    return;
  }
  if (state.equipOpen) {
    const SLOT_KEYS = ['weapon', 'armor', 'boots', 'helm'];
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') { state.equipSlotSel = (state.equipSlotSel - 1 + 4) % 4; e.preventDefault(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { state.equipSlotSel = (state.equipSlotSel + 1) % 4; e.preventDefault(); return; }
    if (e.code === 'ArrowLeft'  || e.code === 'KeyA') {
      const wb = getEquippableFromHotbar(SLOT_KEYS[state.equipSlotSel]);
      if (wb.length) { state.equipHotbarCursor = (state.equipHotbarCursor - 1 + wb.length) % wb.length; e.preventDefault(); }
      return;
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      const wb = getEquippableFromHotbar(SLOT_KEYS[state.equipSlotSel]);
      if (wb.length) { state.equipHotbarCursor = (state.equipHotbarCursor + 1) % wb.length; e.preventDefault(); }
      return;
    }
    if (e.code === 'KeyE' || e.code === 'Enter') {
      const slotKey = SLOT_KEYS[state.equipSlotSel];
      const wb = getEquippableFromHotbar(slotKey);
      if (wb.length) {
        const entry = wb[state.equipHotbarCursor % wb.length];
        applyEquipDef(entry.def);
        player.hotbar[entry.hotbarIdx] = null;
        state.equipHotbarCursor = 0;
      }
      return;
    }
    if (e.code === 'KeyR') {
      unequipSlot(SLOT_KEYS[state.equipSlotSel]);
      return;
    }
    if (e.code === 'Tab' || e.code === 'KeyI') { state.equipOpen = false; state.inventoryOpen = false; return; }
    return;
  }
  if (state.inventoryOpen) {
    if (e.code === 'KeyI' || e.code === 'Tab') { state.inventoryOpen = false; return; }
    return;
  }
  if (e.code === 'KeyI') { state.inventoryOpen = !state.inventoryOpen; state.equipOpen = false; return; }
  if (e.code === 'Tab')  { state.equipOpen = !state.equipOpen; state.equipSlotSel = 0; state.equipHotbarCursor = 0; state.inventoryOpen = false; return; }
  if (e.code === 'KeyX') { castSkill(1); return; }
  if (e.code === 'KeyC') { castSkill(2); return; }
  if (e.code === 'KeyV') { castSkill(3); return; }
  if (e.code === 'KeyF') { useHotbarItem(); return; }
  if (e.code === 'KeyE') handleInteract();
  if (e.code === 'KeyB') toggleBuildMode();
  // 1-9 = hotbar slot (gdy nie w trybie budowania)
  if (!state.buildMode && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5)) - 1;
    if (n >= 0 && n <= 8) { player.hotbarSel = n; return; }
  }
  if (state.buildMode) {
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5)) - 1;
      if (n >= 0 && n < BUILDINGS.length) { state.buildSelected = n; state.buildRotated = false; }
    } else if (e.code === 'KeyR') {
      const bid = BUILDINGS[state.buildSelected].id;
      if (bid === 'wall' || bid === 'door') state.buildRotated = !state.buildRotated;
    }
  } else {
    if (e.code === 'KeyR') { castSkill(4); return; }
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouseScreen.x = (e.clientX - r.left) * (SW / r.width);
  mouseScreen.y = (e.clientY - r.top) * (SH / r.height);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (!state.running || state.paused) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  if (state.buildMode) {
    state.buildSelected = (state.buildSelected + dir + BUILDINGS.length) % BUILDINGS.length;
  } else {
    player.hotbarSel = (player.hotbarSel + dir + 9) % 9;
  }
}, { passive: false });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 && state.buildMode) { state.buildMode = false; return; }
  if (e.button === 0 && state.buildMode) { placeBuildingAtMouse(); return; }
  if (e.button === 2 && state.running && !state.paused) { player._rmbPressed = true; return; }
  mouseDown = true;
});
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('blur', () => { mouseDown = false; });

function updateMouseWorld() {
  mouseWorld.x = mouseScreen.x + camera.x;
  mouseWorld.y = mouseScreen.y + camera.y;
}

// ---------- Persistent save ----------
const save = {
  get money() { return parseInt(localStorage.getItem('wpa_money') || '0', 10); },
  set money(v) { localStorage.setItem('wpa_money', v); },
  get unlocked() {
    try { return JSON.parse(localStorage.getItem('wpa_unlocked') || '["mage"]'); }
    catch { return ['mage']; }
  },
  set unlocked(v) { localStorage.setItem('wpa_unlocked', JSON.stringify(v)); },
  unlock(cls) {
    const u = this.unlocked;
    if (!u.includes(cls)) { u.push(cls); this.unlocked = u; }
  },
  has(cls) { return this.unlocked.includes(cls); },
  get playerName() { return localStorage.getItem('wpa_name') || ''; },
  set playerName(v) { localStorage.setItem('wpa_name', String(v).trim()); },
  // Umiejętności: { classId: [1,2,3,4] } — indeksy odblokowanych slotów
  get skills() { try{return JSON.parse(localStorage.getItem('wpa_skills')||'{}');}catch{return{};} },
  set skills(v) { localStorage.setItem('wpa_skills',JSON.stringify(v)); },
  hasSkill(cls, idx) {
    if (idx === 0) return true; // skill 1 (Space) zawsze odblokowany
    const s = this.skills;
    return !!(s[cls] && s[cls].includes(idx));
  },
  unlockSkill(cls, idx) {
    const s = this.skills;
    if (!s[cls]) s[cls] = [];
    if (!s[cls].includes(idx)) { s[cls].push(idx); this.skills = s; }
  },
};

const CLASS_PRICES = {
  archer: 100, doctor: 100, knight: 100, shaman: 100, ninja: 100,
  gravedigger: 250, berserker: 250, pyromancer: 250, cleric: 250, hunter: 250, shadow: 250,
  crusader: 4000, witch: 4000, alchemist: 4000, bard: 4000,
  necromancer: 3500, paladin: 3500, druid: 3500, vampire: 3500,
  frostmage: 3500, stormcaller: 3500, runeknight: 3500, illusionist: 3500,
  void: 4500,
};

// ---------- HUD ----------
const hpBar = document.getElementById('hpBar');
const mpBar = document.getElementById('mpBar');
const waveLabel = document.getElementById('waveLabel');
const enemyCount = document.getElementById('enemyCount');
const killCountEl = document.getElementById('killCount');
const scoreEl = document.getElementById('score');
const moneyEl = document.getElementById('moneyCount');
const bossBarWrap = document.getElementById('bossBarWrap');
const bossBar = document.getElementById('bossBar');
const overlay = document.getElementById('overlay');
const endOverlay = document.getElementById('endOverlay');
const endTitle = document.getElementById('endTitle');
const endText = document.getElementById('endText');

const mainMenu    = document.getElementById('mainMenu');
const singleMenu  = document.getElementById('singleMenu');
const charsMenu   = document.getElementById('charsMenu');
const classSelect = document.getElementById('classSelect');
const pauseOverlay = document.getElementById('pauseOverlay');

// helpers — show one overlay panel, hide the rest
function showPanel(id) {
  ['accountSetup','mainMenu','singleMenu','charsMenu','classSelect','shopMenu'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.toggle('hidden', p !== id);
  });
}

function updateMainMenuName() {
  const el = document.getElementById('mainMenuGreet');
  if (el) el.textContent = 'Witaj, ' + (save.playerName || 'Gracz') + '!';
}

// ---- MAIN MENU ----
document.getElementById('singlePlayerBtn').onclick = () => showPanel('singleMenu');
document.getElementById('multiPlayerBtn').onclick  = () => {};  // disabled

// ---- SINGLE PLAYER MENU ----
document.getElementById('singleBackBtn').onclick  = () => showPanel('mainMenu');
document.getElementById('createWorldBtn').onclick = () => { refreshClassCards(); showPanel('classSelect'); };
document.getElementById('myCharsBtn').onclick     = () => { buildMyChars(); showPanel('charsMenu'); };
document.getElementById('continueBtn').onclick    = () => { continueGame(); };
document.getElementById('deleteSaveBtn').onclick  = () => { if (confirm('Usunąć zapis świata?')) { deleteSave(); refreshSaveButtons(); } };

document.getElementById('singlePlayerBtn').addEventListener('click', refreshSaveButtons, { once: false });

// ---- TWOJE POSTACIE ----
document.getElementById('charsBackBtn').onclick = () => showPanel('singleMenu');

// ---- CLASS SELECT back ----
document.getElementById('backBtn').onclick = () => showPanel('singleMenu');

// ---- Twoje Postacie — buduj siatkę odblokowanych klas ----
function buildMyChars() {
  const grid = document.getElementById('myCharsGrid');
  const noMsg = document.getElementById('noCharsMsg');
  if (!grid) return;
  grid.innerHTML = '';

  const TIER_LABEL = { 0:'Bazowa', 100:'Standard', 250:'Elitarna', 600:'Epicka', 800:'Legendarna' };
  const TIER_COLOR = { 0:'#4a3880', 100:'#1a4a2a', 250:'#7a3a00', 600:'#3a0a6a', 800:'#6a5000' };
  const TIER_BORDER= { 0:'#7a5ad8', 100:'#40a855', 250:'#e87a20', 600:'#aa44ff', 800:'#ffd700' };

  const unlocked = Object.keys(CLASSES).filter(id => !CLASS_PRICES[id] || save.has(id));

  if (unlocked.length === 0) {
    grid.style.display = 'none';
    noMsg.style.display = 'block';
    return;
  }
  grid.style.display = '';
  noMsg.style.display = 'none';

  unlocked.forEach(id => {
    const cls = CLASSES[id];
    const price = CLASS_PRICES[id] || 0;
    const tierLabel  = TIER_LABEL[price]  || 'Specjalna';
    const tierColor  = TIER_COLOR[price]  || '#2a2a4a';
    const tierBorder = TIER_BORDER[price] || '#8888aa';

    const card = document.createElement('button');
    card.className = 'classCard myCharCard';
    card.style.cssText = `background:${tierColor};border-color:${tierBorder};position:relative;`;

    const tierBadge = document.createElement('div');
    tierBadge.className = 'lockBadge';
    tierBadge.textContent = tierLabel;
    tierBadge.style.cssText = `color:${tierBorder};font-size:10px;position:absolute;top:4px;right:6px;`;

    // Kopiuj ikonę z classSelect (canvas)
    const srcIcon = document.getElementById('icon' + id.charAt(0).toUpperCase() + id.slice(1));
    const iconWrap = document.createElement('div');
    iconWrap.className = 'classIcon';
    if (srcIcon && srcIcon.tagName === 'CANVAS') {
      const cv = document.createElement('canvas');
      cv.width = srcIcon.width; cv.height = srcIcon.height;
      cv.getContext('2d').drawImage(srcIcon, 0, 0);
      iconWrap.appendChild(cv);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'className';
    nameEl.textContent = (cls.name || id).toUpperCase();

    const statsEl = document.createElement('div');
    statsEl.className = 'classStats';
    statsEl.textContent = `${cls.hp} HP · ${cls.mp} MP · Szybkość ${cls.speed}`;

    const playBtn = document.createElement('div');
    playBtn.style.cssText = 'margin-top:6px;font-size:12px;color:#ffd700;letter-spacing:1px;font-weight:bold;';
    playBtn.textContent = '▶ ZAGRAJ';

    card.append(tierBadge, iconWrap, nameEl, statsEl, playBtn);
    card.onclick = () => startGame(id);
    grid.appendChild(card);
  });
}

function refreshClassCards() {
  const wallet = save.money;
  const walletEl = document.getElementById('walletDisplay');
  if (walletEl) walletEl.textContent = `Portfel: $${wallet}`;
  document.querySelectorAll('.classCard').forEach(card => {
    const cls = card.dataset.class;
    const price = CLASS_PRICES[cls];
    const locked = price !== undefined && !save.has(cls);
    card.classList.toggle('classLocked', locked);
    let badge = card.querySelector('.lockBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'lockBadge';
      card.prepend(badge);
    }
    if (locked) {
      const canAfford = wallet >= price;
      badge.textContent = canAfford ? `$${price} — ODBLOKUJ` : `🔒 $${price}`;
      badge.style.color = canAfford ? '#ffd700' : '#ff6060';
    } else {
      badge.textContent = '';
    }
  });
}

document.querySelectorAll('.classCard').forEach(card => {
  card.addEventListener('click', () => {
    const cls = card.dataset.class;
    if (save.has(cls) || !CLASS_PRICES[cls]) {
      startGame(cls);
    } else {
      const price = CLASS_PRICES[cls];
      if (save.money >= price) {
        save.money = save.money - price;
        save.unlock(cls);
        refreshClassCards();
      }
    }
  });
});

refreshClassCards();
refreshSaveButtons();
if (!save.playerName) {
  showPanel('accountSetup');
  setTimeout(() => document.getElementById('playerNameInput').focus(), 80);
} else {
  updateMainMenuName();
}


// ============================================================
// SKLEP (LOBBY)
// ============================================================

// Legacy data — zachowane dla kompatybilności, koła usunięte
const WHEELS = [
  {
    name: 'basic', price: 150,
    classes: ['mage', 'archer', 'doctor', 'knight', 'shaman', 'ninja'],
    colors: ['#6040ff','#44aa44','#cc4488','#4488cc','#ddaa22','#888888'],
    labels: ['CZARODZIEJ','ŁUCZNIK','DOKTOREK','RYCERZ','SZAMAN','NINJA'],
  },
  {
    name: 'elite', price: 400,
    classes: ['mage','archer','doctor','knight','shaman','ninja','gravedigger','berserker','pyromancer','cleric','hunter','shadow'],
    colors: ['#6040ff','#44aa44','#cc4488','#4488cc','#ddaa22','#888888','#886622','#cc3300','#ff6600','#ffffaa','#668833','#aa44ff'],
    labels: ['CZARODZIEJ','ŁUCZNIK','DOKTOREK','RYCERZ','SZAMAN','NINJA','GRABARZ','BERSER.','PIROM.','KAPŁAN','ŁOWCA','CIEŃ'],
  },
  {
    name: 'mystic', price: 800,
    classes: ['necromancer','paladin','druid','vampire','frostmage','stormcaller','runeknight','illusionist','crusader','witch','alchemist','bard'],
    colors: ['#44cc22','#ffd700','#66dd44','#cc1122','#88ddff','#aaeeff','#cc44ff','#ee88ff','#ffd700','#aaff22','#88cc22','#44aaff'],
    labels: ['NEKROMANTA','PALADYN','DRUID','WAMPIR','L.MAG','WŁ.BURZY','R.RYCERZ','ILUZJON.','KRZYŻOW.','WIEDŹMA','ALCHEMIK','BARD'],
  },
];

const wheelStates = [
  { spinning: false, angle: 0, targetAngle: 0, startAngle: 0, startTime: 0, duration: 0, resultCls: null },
  { spinning: false, angle: 0, targetAngle: 0, startAngle: 0, startTime: 0, duration: 0, resultCls: null },
  { spinning: false, angle: 0, targetAngle: 0, startAngle: 0, startTime: 0, duration: 0, resultCls: null },
];

let wheelAnimId = null;

function drawWheelCanvas(wi) {
  const wdef = WHEELS[wi];
  const ws = wheelStates[wi];
  const cvs = document.getElementById(`wheel${wi}Canvas`);
  if (!cvs) return;
  const wctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 4;
  const n = wdef.classes.length;
  const slice = (Math.PI * 2) / n;

  wctx.clearRect(0, 0, W, H);

  for (let i = 0; i < n; i++) {
    const a0 = ws.angle + i * slice - Math.PI / 2;
    const a1 = a0 + slice;
    wctx.beginPath();
    wctx.moveTo(cx, cy);
    wctx.arc(cx, cy, r, a0, a1);
    wctx.closePath();
    wctx.fillStyle = wdef.colors[i];
    wctx.fill();
    wctx.strokeStyle = '#0a0818';
    wctx.lineWidth = 2;
    wctx.stroke();

    wctx.save();
    wctx.translate(cx, cy);
    wctx.rotate(a0 + slice / 2);
    wctx.textAlign = 'right';
    wctx.font = 'bold 9px "Courier New"';
    wctx.fillStyle = '#fff';
    wctx.shadowColor = '#000';
    wctx.shadowBlur = 3;
    wctx.fillText(wdef.labels[i], r - 6, 3);
    wctx.restore();
  }

  // Center circle
  wctx.beginPath();
  wctx.arc(cx, cy, 10, 0, Math.PI * 2);
  wctx.fillStyle = '#1a0a30';
  wctx.fill();
  wctx.strokeStyle = '#d0a0ff';
  wctx.lineWidth = 2;
  wctx.stroke();

  // Pointer (top)
  wctx.beginPath();
  wctx.moveTo(cx - 8, 4);
  wctx.lineTo(cx + 8, 4);
  wctx.lineTo(cx, 20);
  wctx.closePath();
  wctx.fillStyle = '#ffd700';
  wctx.fill();
  wctx.strokeStyle = '#000';
  wctx.lineWidth = 1;
  wctx.stroke();
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function wheelAnimLoop(now) {
  let anySpinning = false;
  for (let wi = 0; wi < 3; wi++) {
    const ws = wheelStates[wi];
    if (!ws.spinning) continue;
    anySpinning = true;
    const elapsed = (now - ws.startTime) / 1000;
    const t = Math.min(elapsed / ws.duration, 1);
    ws.angle = ws.startAngle + (ws.targetAngle - ws.startAngle) * easeOut(t);
    drawWheelCanvas(wi);
    if (t >= 1) {
      ws.spinning = false;
      ws.angle = ws.targetAngle % (Math.PI * 2);
      drawWheelCanvas(wi);
      showWheelResult(wi);
    }
  }
  if (anySpinning) wheelAnimId = requestAnimationFrame(wheelAnimLoop);
  else wheelAnimId = null;
}

function spinWheel(wi) {
  const wdef = WHEELS[wi];
  const ws = wheelStates[wi];
  if (ws.spinning) return;
  if (save.money < wdef.price) {
    const resEl = document.getElementById(`wheel${wi}Result`);
    if (resEl) { resEl.style.color = '#ff4444'; resEl.textContent = 'Za mało kasy!'; }
    return;
  }
  save.money -= wdef.price;
  refreshShopWallet();
  refreshClassCards();

  const n = wdef.classes.length;
  const slice = (Math.PI * 2) / n;
  const resultIdx = Math.floor(Math.random() * n);
  ws.resultCls = wdef.classes[resultIdx];

  // Spin so that resultIdx slot lands under pointer (top = angle 0)
  // Slot i is at angle: ws.angle + i*slice - PI/2
  // We want slot resultIdx top edge at pointer => after spin: angle + resultIdx*slice - PI/2 + slice/2 = 0 (mod 2PI)
  // => targetAngle = -resultIdx*slice - slice/2 + PI/2 + k*2PI  (pick k so we spin at least 5 full rotations)
  const baseTarget = -resultIdx * slice - slice / 2 + Math.PI / 2;
  const extraRots = (Math.PI * 2) * (5 + Math.floor(Math.random() * 4));
  ws.startAngle = ws.angle;
  ws.targetAngle = ws.startAngle + extraRots + ((baseTarget - ws.startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  ws.duration = 3.5 + Math.random() * 1.5;
  ws.startTime = performance.now();
  ws.spinning = true;

  const btn = document.getElementById(`wheel${wi}Btn`);
  if (btn) btn.disabled = true;
  const resEl = document.getElementById(`wheel${wi}Result`);
  if (resEl) { resEl.style.color = '#d0a0ff'; resEl.textContent = '...kręci się...'; }

  if (!wheelAnimId) wheelAnimId = requestAnimationFrame(wheelAnimLoop);
}

function showWheelResult(wi) {
  const ws = wheelStates[wi];
  const cls = ws.resultCls;
  const wdef = WHEELS[wi];
  const n = wdef.classes.length;
  const idx = wdef.classes.indexOf(cls);
  const label = wdef.labels[idx] || cls.toUpperCase();
  const resEl = document.getElementById(`wheel${wi}Result`);
  const btn = document.getElementById(`wheel${wi}Btn`);

  const alreadyHad = save.has(cls);
  save.unlock(cls);
  refreshClassCards();

  if (resEl) {
    if (alreadyHad) {
      save.money += Math.round(wdef.price * 0.5);
      refreshShopWallet();
      refreshClassCards();
      resEl.style.color = '#ffd700';
      resEl.textContent = `${label} — masz już! (+$${Math.round(wdef.price * 0.5)})`;
    } else {
      resEl.style.color = '#40ff88';
      resEl.textContent = `ODBLOKOWANO: ${label}!`;
    }
  }
  if (btn) btn.disabled = false;
}

function openPrismBox() {
  const PRICE = 4500;
  if (save.money < PRICE) {
    const res = document.getElementById('prismBoxResult');
    if (res) { res.style.color = '#ff4444'; res.textContent = 'Za mało kasy! (potrzebujesz $4500)'; }
    return;
  }
  save.money -= PRICE;
  refreshShopWallet();

  const roll = Math.random() * 100;
  let wonCls, wonLabel, wonColor;
  if (roll < 0.1) {
    // 0.1% — Void
    wonCls = 'void';
    wonLabel = '??? (VOID!)';
    wonColor = '#cc44ff';
  } else if (roll < 15.1) {
    // 15% — legendarne (crusader, witch, alchemist, bard)
    const legendaries = ['crusader', 'witch', 'alchemist', 'bard'];
    wonCls = legendaries[Math.floor(Math.random() * legendaries.length)];
    const lnames = { crusader: 'Krzyżowiec', witch: 'Wiedźma', alchemist: 'Alchemik', bard: 'Bard' };
    wonLabel = lnames[wonCls] + ' (LEGENDARNE)';
    wonColor = '#ffd700';
  } else {
    // 84.9% — mityczne (epickie)
    const mythics = ['necromancer','paladin','druid','vampire','frostmage','stormcaller','runeknight','illusionist'];
    wonCls = mythics[Math.floor(Math.random() * mythics.length)];
    const mnames = { necromancer:'Nekromanta', paladin:'Paladyn', druid:'Druid', vampire:'Wampir', frostmage:'Lodowy Mag', stormcaller:'Wł. Burzy', runeknight:'Run. Rycerz', illusionist:'Iluzjonista' };
    wonLabel = mnames[wonCls] + ' (MITYCZNE)';
    wonColor = '#cc44ff';
  }

  const alreadyHad = save.has(wonCls);
  save.unlock(wonCls);
  refreshClassCards();

  const res = document.getElementById('prismBoxResult');
  if (res) {
    if (alreadyHad) {
      const refund = Math.round(PRICE * 0.3);
      save.money += refund;
      refreshShopWallet();
      res.style.color = '#ffd700';
      res.textContent = `${wonLabel} — już posiadasz! (+$${refund} zwrot)`;
    } else {
      res.style.color = wonColor;
      res.textContent = `ODBLOKOWANO: ${wonLabel}!`;
    }
  }
  buildShopGrid('shopVoidGrid', SHOP_CLASSES.void);
}

function refreshShopWallet() {
  const el = document.getElementById('shopWalletDisplay');
  if (el) el.textContent = `Portfel: $${save.money}`;
}

const shopMenu = document.getElementById('shopMenu');

// Ceny skili (slot 0=Space gratis, 1=X, 2=C, 3=V, 4=R)
const SKILL_PRICES = [0, 150, 300, 500, 800];

// Dane klas dla siatki sklepu
const SHOP_CLASSES = {
  base:  [
    {id:'mage',   name:'Czarodziej',price:0},   {id:'archer',  name:'Łucznik',   price:100},
    {id:'doctor', name:'Doktorek',  price:100},  {id:'knight',  name:'Rycerz',    price:100},
    {id:'shaman', name:'Szaman',    price:100},  {id:'ninja',   name:'Ninja',     price:100},
  ],
  elite: [
    {id:'gravedigger',name:'Grabarz',  price:250},{id:'berserker',name:'Berserker',price:250},
    {id:'pyromancer', name:'Piromanta',price:250},{id:'cleric',   name:'Kapłan',   price:250},
    {id:'hunter',     name:'Łowca',   price:250},{id:'shadow',   name:'Cień',     price:250},
  ],
  epic:  [
    {id:'necromancer',name:'Nekromanta',  price:3500},{id:'paladin',   name:'Paladyn',     price:3500},
    {id:'druid',      name:'Druid',       price:3500},{id:'vampire',   name:'Wampir',      price:3500},
    {id:'frostmage',  name:'Lodowy Mag',  price:3500},{id:'stormcaller',name:'Wł. Burzy', price:3500},
    {id:'runeknight', name:'Run. Rycerz', price:3500},{id:'illusionist',name:'Iluzjonista',price:3500},
  ],
  legendary: [
    {id:'crusader',  name:'Krzyżowiec', price:4000},{id:'witch',     name:'Wiedźma',    price:4000},
    {id:'alchemist', name:'Alchemik',   price:4000},{id:'bard',      name:'Bard',       price:4000},
  ],
  void: [
    {id:'void', name:'???', price:4500},
  ],
};

const GRID_TIER_CLASS = {
  shopClassGrid: '',
  shopEliteGrid: 'classElite',
  shopLegendaryGrid: 'classLegendary',
  shopEpicGrid: 'classEpic',
  shopVoidGrid: 'classEpic',
};

function buildShopGrid(gridId, classes) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  const tierCls = GRID_TIER_CLASS[gridId] || '';
  classes.forEach(c => {
    const btn = document.createElement('button');
    const isVoid = c.id === 'void';
    const isUnlocked = save.has(c.id);
    btn.className = 'classCard' + (tierCls ? ' ' + tierCls : '') + (isVoid ? ' classVoid' : '');
    btn.dataset.cls = c.id;
    const locked = !isUnlocked && c.price > 0;
    const canAfford = save.money >= c.price;
    const displayName = isVoid ? (isUnlocked ? 'VOID' : '???') : c.name.toUpperCase();
    if (isVoid && !isUnlocked) {
      btn.style.cssText = 'background:#000;color:#330033;border:1px solid #220022;filter:brightness(0.5)';
    }
    btn.innerHTML = `<div class="className">${displayName}</div><div class="classStats" style="color:${locked?(canAfford?'#ffd700':'#ff6060'):'#9bff9b'}">${locked?'$'+c.price+' — '+(canAfford?'KUP':'ZA MAŁO'):'ODBLOKOWANA'}</div>`;
    btn.onclick = () => {
      if (isVoid && !isUnlocked) return; // nie można kupić void normalnie
      if (!locked) { startGame(c.id); shopMenu.classList.add('hidden'); overlay.classList.add('hidden'); return; }
      if (canAfford) { save.money -= c.price; save.unlock(c.id); buildShopGrid(gridId, classes); refreshShopWallet(); refreshClassCards(); }
    };
    grid.appendChild(btn);
  });
}

function shopShowTab(tab) {
  const tabs = ['chars','skills','ctrl','prism'];
  tabs.forEach(t => {
    const el = document.getElementById('shopTab'+t.charAt(0).toUpperCase()+t.slice(1));
    const btn = document.getElementById('shopTab'+t.charAt(0).toUpperCase()+t.slice(1)+'Btn');
    if (el) el.style.display = t===tab ? '' : 'none';
    if (btn) btn.style.background = t===tab ? (t==='prism'?'#330044':'#3a1880') : (t==='prism'?'#1a0028':'#1a0a30');
  });
  if (tab === 'skills') buildShopClassSelector();
}

function buildShopClassSelector() {
  const sel = document.getElementById('shopSkillClassSelector');
  if (!sel) return;
  sel.innerHTML = '';
  const allCls = [...SHOP_CLASSES.base, ...SHOP_CLASSES.elite, ...SHOP_CLASSES.legendary, ...SHOP_CLASSES.epic, ...SHOP_CLASSES.void];
  allCls.forEach(c => {
    if (!save.has(c.id)) return;
    const unlocked = [1,2,3,4].filter(i => save.hasSkill(c.id, i)).length;
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:4px 10px;background:#1a0a30;color:#d0a0ff;border:1px solid #5a3da0;font-family:inherit;font-size:11px;cursor:pointer;border-radius:2px';
    btn.innerHTML = `${c.name}<br><small style="color:#605070">${unlocked}/4</small>`;
    btn.onclick = () => buildShopSkills(c.id);
    sel.appendChild(btn);
  });
  if (!sel.children.length) sel.innerHTML = '<p style="color:#604060;font-size:11px">Najpierw kup postać!</p>';
}

function buildShopSkills(classId) {
  const list = document.getElementById('shopSkillsList');
  if (!list) return;
  const cls = CLASSES[classId];
  const skills = CLASS_SKILLS[classId];
  if (!skills) return;
  const clsName = cls ? cls.name : classId;
  list.innerHTML = `<div style="color:#d0a0ff;font-weight:bold;font-size:13px;margin-bottom:6px">${clsName} — Umiejętności</div>`;
  const keyLabels = ['Spacja','X','C','V','R'];
  for (let i = 1; i <= 4; i++) {
    const sk = skills[i];
    if (!sk) continue;
    const unlocked = save.hasSkill(classId, i);
    const price = SKILL_PRICES[i];
    const canAfford = save.money >= price;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:3px 0;padding:6px 8px;background:rgba(20,8,40,0.9);border:1px solid '+(unlocked?'#3a1880':'#2a1040')+';font-family:"Courier New",monospace;font-size:11px';
    const dot = `<span style="display:inline-block;width:10px;height:10px;background:${sk.col};border-radius:2px;flex-shrink:0"></span>`;
    const info = `<span style="flex:1;text-align:left"><b style="color:${unlocked?sk.col:'#604060'}">[${keyLabels[i]}] ${sk.n}</b> <span style="color:#504060;font-size:10px">${sk.cd?sk.cd+'s CD ':''} ${sk.mp?sk.mp+' MP':''}</span></span>`;
    const action = unlocked
      ? `<span style="color:#9bff9b;font-size:10px">✓ KUPIONA</span>`
      : `<button onclick="shopBuySkill('${classId}',${i})" style="padding:3px 8px;background:${canAfford?'#2a0a60':'#160830'};color:${canAfford?'#d0a0ff':'#604070'};border:1px solid ${canAfford?'#7a3da0':'#3a1060'};font-family:inherit;font-size:10px;cursor:${canAfford?'pointer':'default'}">${canAfford?'KUP $'+price:'$'+price+' ZA MAŁO'}</button>`;
    row.innerHTML = dot + info + action;
    list.appendChild(row);
  }
}

function shopBuySkill(classId, slotIdx) {
  const price = SKILL_PRICES[slotIdx];
  if (save.money < price || save.hasSkill(classId, slotIdx)) return;
  save.money -= price;
  save.unlockSkill(classId, slotIdx);
  refreshShopWallet();
  buildShopSkills(classId);
  buildShopClassSelector();
}

document.getElementById('shopBtn').onclick = () => {
  showPanel('shopMenu');
  refreshShopWallet();
  buildShopGrid('shopClassGrid',      SHOP_CLASSES.base);
  buildShopGrid('shopEliteGrid',      SHOP_CLASSES.elite);
  buildShopGrid('shopEpicGrid',       SHOP_CLASSES.epic);
  buildShopGrid('shopLegendaryGrid',  SHOP_CLASSES.legendary);
  buildShopGrid('shopVoidGrid',       SHOP_CLASSES.void);
  shopShowTab('chars');
  buildShopClassSelector();
};

document.getElementById('shopBackBtn').onclick = () => {
  showPanel('mainMenu');
};

// ---- ACCOUNT SETUP ----
document.getElementById('confirmNameBtn').onclick = () => {
  const val = document.getElementById('playerNameInput').value.trim();
  if (val.length < 2 || val.length > 20) {
    document.getElementById('nameError').style.display = '';
    return;
  }
  document.getElementById('nameError').style.display = 'none';
  save.playerName = val;
  updateMainMenuName();
  showPanel('mainMenu');
};
document.getElementById('playerNameInput').addEventListener('keydown', (e) => {
  if (e.code === 'Enter') document.getElementById('confirmNameBtn').click();
});
document.getElementById('changeNameBtn').onclick = () => {
  document.getElementById('playerNameInput').value = save.playerName;
  document.getElementById('nameError').style.display = 'none';
  showPanel('accountSetup');
  setTimeout(() => document.getElementById('playerNameInput').focus(), 50);
};

document.getElementById('restartBtn').onclick = () => {
  endOverlay.classList.add('hidden');
  overlay.classList.remove('hidden');
  showPanel('mainMenu');
};

document.getElementById('resumeBtn').onclick = () => {
  state.paused = false;
  pauseOverlay.classList.add('hidden');
  canvas.focus();
};

document.getElementById('saveNowBtn').onclick = () => {
  saveWorld();
  const msg = document.getElementById('saveConfirmMsg');
  msg.style.display = 'block';
  setTimeout(() => { msg.style.display = 'none'; }, 2000);
};

document.getElementById('menuBtn').onclick = () => {
  save.money = save.money + state.money;
  state.running = false;
  state.paused = false;
  pauseOverlay.classList.add('hidden');
  endOverlay.classList.add('hidden');
  overlay.classList.remove('hidden');
  showPanel('mainMenu');
  refreshClassCards();
};

// ---------- Class definitions ----------
const CLASSES = {
  mage: {
    name: 'Czarodziej',
    hp: 90, mp: 100, speed: 180,
    fireRate: 0.22,
    skillDrainPerSec: 32,
  },
  archer: {
    name: 'Łucznik',
    hp: 75, mp: 80, speed: 220,
    fireRate: 0.14,
    skillDrainPerSec: 22,
  },
  doctor: {
    name: 'Doktorek',
    hp: 120, mp: 120, speed: 160,
    fireRate: 0.30,
    skillDrainPerSec: 18,
  },
  knight: {
    name: 'Rycerz',
    hp: 155, mp: 60, speed: 148,
    fireRate: 0.36,
    skillDrainPerSec: 28,
  },
  shaman: {
    name: 'Szaman',
    hp: 88, mp: 130, speed: 172,
    fireRate: 0.26,
    skillDrainPerSec: 30,
  },
  ninja: {
    name: 'Ninja',
    hp: 65, mp: 72, speed: 265,
    fireRate: 0.09,
    skillDrainPerSec: 20,
  },
  // ---- Klasy Elitarne ($250) ----
  gravedigger: { name: 'Grabarz',  hp: 75,  mp: 88,  speed: 132, fireRate: 0.38, skillDrainPerSec: 30 },
  berserker:   { name: 'Berserker',hp: 138, mp: 28,  speed: 188, fireRate: 0.58, skillDrainPerSec: 48 },
  pyromancer:  { name: 'Piromanta',hp: 58,  mp: 105, speed: 136, fireRate: 0.44, skillDrainPerSec: 36 },
  cleric:      { name: 'Kapłan',   hp: 96,  mp: 118, speed: 120, fireRate: 0.34, skillDrainPerSec: 26 },
  hunter:      { name: 'Łowca',    hp: 60,  mp: 65,  speed: 195, fireRate: 0.29, skillDrainPerSec: 24 },
  shadow:      { name: 'Cień',     hp: 46,  mp: 70,  speed: 240, fireRate: 0.19, skillDrainPerSec: 20 },
  // ---- Klasy Legendarne ($400) ----
  crusader:    { name: 'Krzyżowiec', hp: 180, mp: 85,  speed: 132, fireRate: 0.40, skillDrainPerSec: 36 },
  witch:       { name: 'Wiedźma',    hp: 68,  mp: 155, speed: 180, fireRate: 0.28, skillDrainPerSec: 32 },
  alchemist:   { name: 'Alchemik',   hp: 100, mp: 112, speed: 175, fireRate: 0.36, skillDrainPerSec: 30 },
  bard:        { name: 'Bard',       hp: 82,  mp: 140, speed: 198, fireRate: 0.26, skillDrainPerSec: 28 },
  // ---- Klasy Epickie ($600) ----
  necromancer: { name: 'Nekromanta',    hp: 88,  mp: 195, speed: 142, fireRate: 0.42, skillDrainPerSec: 38 },
  paladin:     { name: 'Paladyn',       hp: 205, mp: 78,  speed: 128, fireRate: 0.56, skillDrainPerSec: 40 },
  druid:       { name: 'Druid',         hp: 104, mp: 162, speed: 160, fireRate: 0.34, skillDrainPerSec: 32 },
  vampire:     { name: 'Wampir',        hp: 60,  mp: 75,  speed: 205, fireRate: 0.38, skillDrainPerSec: 42 },
  frostmage:   { name: 'Lodowy Mag',    hp: 74,  mp: 205, speed: 148, fireRate: 0.33, skillDrainPerSec: 34 },
  stormcaller: { name: 'Władca Burzy',  hp: 80,  mp: 152, speed: 158, fireRate: 0.28, skillDrainPerSec: 32 },
  runeknight:  { name: 'Runowy Rycerz', hp: 178, mp: 92,  speed: 136, fireRate: 0.64, skillDrainPerSec: 44 },
  illusionist: { name: 'Iluzjonista',   hp: 64,  mp: 122, speed: 268, fireRate: 0.20, skillDrainPerSec: 22 },
  void:        { name: 'Void',          hp: 55,  mp: 190, speed: 195, fireRate: 0.22, skillDrainPerSec: 28 },
};

// ============================================================
// SYSTEM UMIEJĘTNOŚCI — 5 skili na klasę (Space/X/C/V/R)
// ============================================================

// Wspólne executory skili (SKX)
const SKX = {
  ring(n,d,s,k,life=0.9,r=6){const p=player;for(let i=0;i<n;i++){const a=(i/n)*TAU;state.projectiles.push({x:p.x,y:p.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r,dmg:d+p.dmgBonus,life,kind:k,pierce:1,angle:a});}addParticles(p.x,p.y,'#ffffff',n,s*0.25,0.4);screenShake(3);},
  aim(n,d,s,k,spread=0.2){const a0=Math.atan2(mouseWorld.y-player.y,mouseWorld.x-player.x);const ox=Math.cos(a0)*14,oy=Math.sin(a0)*14-4;for(let i=0;i<n;i++){const a=a0+(i-(n-1)/2)*spread;state.projectiles.push({x:player.x+ox,y:player.y+oy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:6,dmg:d+player.dmgBonus,life:1.3,kind:k,pierce:2,angle:a});}addParticles(player.x+ox,player.y+oy,'#ffffff',n*3,80,0.3);},
  burst(n,d,s,k){const t=mouseWorld;for(let i=0;i<n;i++){const a=(i/n)*TAU;state.projectiles.push({x:t.x,y:t.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:6,dmg:d+player.dmgBonus,life:0.8,kind:k,pierce:0,angle:a});}addParticles(t.x,t.y,'#ffffff',n*2,s*0.3,0.4);screenShake(4);},
  pool(r,d,c){state.hazards.push({x:mouseWorld.x,y:mouseWorld.y,vx:0,vy:0,r,dmg:d,life:4.5,kind:'pool',tickAcc:0,color:c});addParticles(mouseWorld.x,mouseWorld.y,c,22,120,0.5);screenShake(4);},
  meteor(r,d,c='#ff4400'){const t=mouseWorld;const n=10;for(let i=0;i<n;i++){const a=(i/n)*TAU;state.hazards.push({x:t.x,y:t.y,vx:Math.cos(a)*160,vy:Math.sin(a)*160,r:r*0.4,dmg:Math.round(d*0.35),life:1.8,color:c});}state.hazards.push({x:t.x,y:t.y,vx:0,vy:0,r,dmg:d,life:0.5,color:c,kind:'pool',tickAcc:0});addParticles(t.x,t.y,c,44,240,0.7);screenShake(10);addFloater(t.x,t.y-22,'BOOM!',c);},
  blink(){addParticles(player.x,player.y,'#8844ff',15,150,0.5);player.x=clamp(mouseWorld.x,0,999940);player.y=clamp(mouseWorld.y,0,999940);player.invuln=Math.max(player.invuln,0.5);addParticles(player.x,player.y,'#cc88ff',15,150,0.5);screenShake(3);},
  charge(){const a=Math.atan2(mouseWorld.y-player.y,mouseWorld.x-player.x);player.dashTime=0.32;player.dashVx=Math.cos(a)*640;player.dashVy=Math.sin(a)*640;player.invuln=Math.max(player.invuln,0.4);addParticles(player.x,player.y,'#ffd66b',12,180,0.4);},
  invuln(dur){player.invuln=Math.max(player.invuln,dur);addParticles(player.x,player.y,'#8ad8ff',18,100,dur*0.4);addFloater(player.x,player.y-22,'NIETYKALNY!','#8ad8ff');},
  speed(dur,amt){player._speedBoosts.push({t:dur,a:amt});player.speed+=amt;addFloater(player.x,player.y-22,'+'+amt+' SZYBK.!','#9bff9b');},
  heal(amt){player.hp=Math.min(player.hpMax,player.hp+amt);addParticles(player.x,player.y,'#9bff9b',18,90,0.5);addFloater(player.x,player.y-22,'+'+amt+' HP','#9bff9b');},
};

// 5 umiejętności na klasę: slot 0 = Space (istniejący), slot 1-4 = X/C/V/R (nowe)
// {n: nazwa, cd: max cooldown (s), mp: koszt many, k: klawisz, col: kolor, ex: executor}
const CLASS_SKILLS = {
  mage:       [{n:'Miotacz',       cd:0, mp:0, k:'Space',col:'#ff6633'},{n:'Krąg Ognia',    cd:6, mp:35,k:'X',col:'#ff8844',ex:()=>SKX.ring(12,22,460,'fire')},{n:'Pula Ognia',    cd:9, mp:38,k:'C',col:'#ff4400',ex:()=>SKX.pool(60,8,'#ff4400')},{n:'Meteor',         cd:14,mp:60,k:'V',col:'#ff2200',ex:()=>SKX.meteor(70,55,'#ff4400')},{n:'Błysk',          cd:5, mp:18,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  archer:     [{n:'Multishot',     cd:0, mp:0, k:'Space',col:'#e8e0c0'},{n:'Salwa',          cd:4, mp:25,k:'X',col:'#ffd66b',ex:()=>SKX.aim(5,16,750,'arrow',0.22)},{n:'Zasłona Dymu',  cd:8, mp:28,k:'C',col:'#8888aa',ex:()=>{SKX.invuln(1.5);SKX.speed(2,45);}},{n:'Deszcz Strzał',  cd:12,mp:50,k:'V',col:'#e8e080',ex:()=>SKX.burst(16,18,300,'arrow')},{n:'Sprint',         cd:5, mp:18,k:'R',col:'#9bff9b',ex:()=>SKX.speed(3,80)}],
  doctor:     [{n:'Aura Leczenia', cd:0, mp:0, k:'Space',col:'#9bff9b'},{n:'Salwa Strzykaw.',cd:3, mp:20,k:'X',col:'#8ad8ff',ex:()=>SKX.aim(3,12,480,'syringe',0.18)},{n:'Pole Leczenia',  cd:10,mp:35,k:'C',col:'#44ff88',ex:()=>{SKX.pool(55,0,'#44ff88');SKX.heal(25);}},{n:'Defibrylacja',   cd:14,mp:0, k:'V',col:'#ffff44',ex:()=>SKX.heal(player.hp<player.hpMax*0.3?80:35)},{n:'Stymulant',      cd:8, mp:25,k:'R',col:'#ffaa44',ex:()=>{SKX.speed(4,60);}}],
  knight:     [{n:'Okrzyk Bojowy', cd:0, mp:0, k:'Space',col:'#ffd66b'},{n:'Ostrza w Krąg',  cd:5, mp:30,k:'X',col:'#e0e8ff',ex:()=>SKX.ring(8,28,400,'blade')},{n:'Blok',            cd:10,mp:35,k:'C',col:'#8ad8ff',ex:()=>SKX.invuln(2.2)},{n:'Szarża',          cd:6, mp:25,k:'V',col:'#ff8844',ex:()=>SKX.charge()},{n:'Wicher Ostrzy',  cd:8, mp:40,k:'R',col:'#c0d0ff',ex:()=>SKX.ring(12,24,360,'blade',0.5)}],
  shaman:     [{n:'Burza Piorunów',cd:0, mp:0, k:'Space',col:'#8ae8ff'},{n:'Krąg Piorunów',  cd:5, mp:32,k:'X',col:'#8ae8ff',ex:()=>SKX.ring(8,20,580,'lightning')},{n:'Pula Burzy',     cd:9, mp:35,k:'C',col:'#44aaff',ex:()=>SKX.pool(55,9,'#4488ff')},{n:'Piorun Bogów',   cd:13,mp:55,k:'V',col:'#ffe44a',ex:()=>SKX.meteor(65,50,'#ffe44a')},{n:'Duch Wiatru',    cd:5, mp:20,k:'R',col:'#55ccff',ex:()=>SKX.speed(2.5,60)}],
  ninja:      [{n:'Cień — Wybuch', cd:0, mp:0, k:'Space',col:'#c8c8d8'},{n:'Zasłona Dymu',   cd:5, mp:25,k:'X',col:'#8888aa',ex:()=>{SKX.invuln(1.8);SKX.speed(2,70);}},{n:'Gwiazdy w Krąg', cd:6, mp:30,k:'C',col:'#c8c8d8',ex:()=>SKX.ring(12,12,720,'shuriken',0.8)},{n:'Deszcz Gwiazd',  cd:9, mp:38,k:'V',col:'#aaaacc',ex:()=>SKX.burst(12,14,560,'shuriken')},{n:'Krok Cienia',    cd:3, mp:18,k:'R',col:'#9955ff',ex:()=>SKX.blink()}],
  gravedigger:[{n:'Kości z Ziemi', cd:0, mp:0, k:'Space',col:'#e0dcc8'},{n:'Krąg Kości',     cd:5, mp:28,k:'X',col:'#e0dcc8',ex:()=>SKX.ring(10,20,320,'bone',1.6,8)},{n:'Pole Śmierci',  cd:9, mp:35,k:'C',col:'#8a7a60',ex:()=>SKX.pool(55,8,'#8a7060')},{n:'Burza Kości',    cd:11,mp:45,k:'V',col:'#d0ccb8',ex:()=>SKX.burst(14,18,280,'bone')},{n:'Zejście',        cd:4, mp:20,k:'R',col:'#887060',ex:()=>SKX.blink()}],
  berserker:  [{n:'Szał Berserkera',cd:0,mp:0, k:'Space',col:'#ff4422'},{n:'Rzut Toporem',   cd:4, mp:25,k:'X',col:'#ff6633',ex:()=>SKX.aim(1,50,460,'axe',0)},{n:'Skok Bojowy',    cd:6, mp:30,k:'C',col:'#ff8844',ex:()=>SKX.charge()},{n:'Wicher Toporów', cd:9, mp:40,k:'V',col:'#ff4400',ex:()=>SKX.ring(8,32,360,'axe',0.5,14)},{n:'Wściekłość',     cd:12,mp:45,k:'R',col:'#cc1122',ex:()=>{SKX.speed(4,70);SKX.invuln(0.8);}}],
  pyromancer: [{n:'Deszcz Ognia',  cd:0, mp:0, k:'Space',col:'#ff6622'},{n:'Salwa Inferno',  cd:4, mp:30,k:'X',col:'#ff8822',ex:()=>SKX.aim(3,24,300,'inferno',0.2)},{n:'Mega Wybuch',    cd:8, mp:42,k:'C',col:'#ff4400',ex:()=>SKX.meteor(80,60,'#ff4400')},{n:'Wulkan Ognia',   cd:11,mp:52,k:'V',col:'#ff2200',ex:()=>{SKX.pool(80,10,'#ff3300');SKX.meteor(60,40,'#ff6600');}},{n:'Kula Plazmy',    cd:5, mp:22,k:'R',col:'#ff8800',ex:()=>SKX.aim(1,38,220,'inferno',0)}],
  cleric:     [{n:'Błogosławieństwo',cd:0,mp:0,k:'Space',col:'#ffffaa'},{n:'Święty Salw',     cd:4, mp:22,k:'X',col:'#ffffaa',ex:()=>SKX.aim(3,16,520,'holy',0.18)},{n:'Święty Krąg',    cd:8, mp:38,k:'C',col:'#ffd680',ex:()=>SKX.ring(10,18,380,'holy',1.2)},{n:'Wielkie Leczenie',cd:12,mp:0,k:'V',col:'#ffff44',ex:()=>SKX.heal(70)},{n:'Boska Ochrona',  cd:9, mp:40,k:'R',col:'#8ad8ff',ex:()=>SKX.invuln(2.5)}],
  hunter:     [{n:'Pułapka',       cd:0, mp:0, k:'Space',col:'#88aa44'},{n:'3 Bumerangi',     cd:5, mp:30,k:'X',col:'#88aa44',ex:()=>{for(let i=-1;i<=1;i++){const a=Math.atan2(mouseWorld.y-player.y,mouseWorld.x-player.x)+i*0.22;state.projectiles.push({x:player.x,y:player.y,vx:Math.cos(a)*560,vy:Math.sin(a)*560,r:7,dmg:18+player.dmgBonus,life:3,kind:'boomerang',pierce:99,angle:a,boomerang:true,distTraveled:0,maxDist:280,returning:false});}}},{n:'Oko Orła',        cd:8, mp:25,k:'C',col:'#66aa22',ex:()=>{player._eagleEye=3;addFloater(player.x,player.y-22,'OKO ORŁA!','#66aa22');}},{n:'4 Pułapki',       cd:12,mp:40,k:'V',col:'#449922',ex:()=>{for(const[ox,oy]of[[1,0],[-1,0],[0,1],[0,-1]]){state.projectiles.push({x:mouseWorld.x+ox*50,y:mouseWorld.y+oy*50,vx:0,vy:0,r:14,dmg:0,life:10,kind:'trap',pierce:99,trapDmg:60+player.dmgBonus*2});}}},{n:'Sprint',         cd:5, mp:18,k:'R',col:'#9bff9b',ex:()=>SKX.speed(3,80)}],
  shadow:     [{n:'Krok Cienia',   cd:0, mp:0, k:'Space',col:'#9955ff'},{n:'Ciemność',        cd:5, mp:25,k:'X',col:'#6633aa',ex:()=>{SKX.invuln(2);SKX.speed(2.5,70);}},{n:'Ostrza w Krąg',  cd:6, mp:30,k:'C',col:'#9955ff',ex:()=>SKX.ring(10,18,500,'shadowblade')},{n:'Mgła Cieni',     cd:9, mp:38,k:'V',col:'#7744cc',ex:()=>SKX.burst(12,16,480,'shadowblade')},{n:'Mroczna Forma',  cd:10,mp:40,k:'R',col:'#aa44ff',ex:()=>{SKX.speed(4,80);SKX.invuln(4);}}],
  crusader:   [{n:'Święta Aura',     cd:0, mp:0, k:'Space',col:'#ffe8aa'},{n:'Pierścień Młotów', cd:5, mp:30,k:'X',col:'#ffe8aa',ex:()=>SKX.ring(8,34,400,'holyblade',0.5,14)},{n:'Tarcza Boska',    cd:9, mp:35,k:'C',col:'#8ad8ff',ex:()=>SKX.invuln(2.2)},{n:'Szarża Krzyżowca',cd:6,mp:25,k:'V',col:'#ff8844',ex:()=>SKX.charge()},{n:'Gniew Boży',      cd:13,mp:55,k:'R',col:'#ffdd44',ex:()=>SKX.meteor(80,70,'#ffdd44')}],
  witch:      [{n:'Klątwa',          cd:0, mp:0, k:'Space',col:'#88ff44'},{n:'Krąg Trucizny',   cd:5, mp:30,k:'X',col:'#66cc22',ex:()=>SKX.ring(10,24,360,'venom',1.8)},{n:'Kocioł Czarów',  cd:9, mp:38,k:'C',col:'#44aa00',ex:()=>SKX.pool(60,10,'#33aa00')},{n:'Zaraza',          cd:11,mp:48,k:'V',col:'#88ee44',ex:()=>SKX.burst(12,20,300,'venom')},{n:'Znikanie',        cd:4, mp:18,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  alchemist:  [{n:'Bomba Kwasowa',   cd:0, mp:0, k:'Space',col:'#aaff22'},{n:'Salwa Bomb',       cd:4, mp:28,k:'X',col:'#ff8822',ex:()=>SKX.aim(3,26,260,'inferno',0.22)},{n:'Kałuża Kwasu',   cd:9, mp:35,k:'C',col:'#88aa00',ex:()=>SKX.pool(65,9,'#88aa00')},{n:'Wielka Eksplozja',cd:12,mp:55,k:'V',col:'#ff4400',ex:()=>SKX.meteor(85,65,'#ff8800')},{n:'Eliksir Szybkości',cd:7,mp:22,k:'R',col:'#9bff9b',ex:()=>{SKX.speed(4,60);SKX.heal(25);}}],
  bard:       [{n:'Fala Dźwiękowa',  cd:0, mp:0, k:'Space',col:'#aaeeff'},{n:'Harmonia Dźwięku', cd:5, mp:30,k:'X',col:'#88ccff',ex:()=>SKX.ring(12,20,620,'lightning')},{n:'Pieśń Bitewna',  cd:8, mp:28,k:'C',col:'#9bff9b',ex:()=>{SKX.speed(4,65);addFloater(player.x,player.y-22,'PIEŚŃ BITEWNA!','#9bff9b');}},{n:'Hymn Leczenia',  cd:10,mp:35,k:'V',col:'#ffffaa',ex:()=>SKX.heal(60)},{n:'Crescendo',       cd:13,mp:55,k:'R',col:'#44aaff',ex:()=>SKX.meteor(72,58,'#44aaff')}],
  necromancer:[{n:'Trucizna',      cd:0, mp:0, k:'Space',col:'#44cc22'},{n:'Krąg Jadu',       cd:5, mp:30,k:'X',col:'#44cc22',ex:()=>SKX.ring(8,26,330,'venom',2.0)},{n:'Pole Zarazy',    cd:9, mp:38,k:'C',col:'#2a7a14',ex:()=>SKX.pool(60,9,'#2a7a14')},{n:'Plaga',           cd:11,mp:50,k:'V',col:'#66dd44',ex:()=>SKX.burst(10,22,300,'venom')},{n:'Błysk',          cd:4, mp:18,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  paladin:    [{n:'Boska Aura',    cd:0, mp:0, k:'Space',col:'#ffe8aa'},{n:'Święte Ostrza',   cd:4, mp:28,k:'X',col:'#ffe8aa',ex:()=>SKX.aim(5,32,660,'holyblade',0.2)},{n:'Tarcza Boska',   cd:9, mp:35,k:'C',col:'#8ad8ff',ex:()=>SKX.invuln(2.5)},{n:'Sąd Ostateczny', cd:13,mp:60,k:'V',col:'#ffdd44',ex:()=>SKX.meteor(80,70,'#ffdd44')},{n:'Szarża Paladyna',cd:5, mp:22,k:'R',col:'#ff8844',ex:()=>SKX.charge()}],
  druid:      [{n:'Kolce Natury',  cd:0, mp:0, k:'Space',col:'#44aa22'},{n:'Krąg Kolców',     cd:5, mp:30,k:'X',col:'#44aa22',ex:()=>SKX.ring(10,22,540,'thorn')},{n:'Pole Natury',    cd:9, mp:35,k:'C',col:'#2a7a14',ex:()=>SKX.pool(55,8,'#2a7a14')},{n:'Wybuch Natury',  cd:11,mp:48,k:'V',col:'#66dd44',ex:()=>SKX.burst(12,20,420,'thorn')},{n:'Dziki Bieg',     cd:5, mp:18,k:'R',col:'#9bff9b',ex:()=>SKX.speed(3,70)}],
  vampire:    [{n:'Pochłanianie Krwi',cd:0,mp:0,k:'Space',col:'#cc1122'},{n:'Krąg Krwi',      cd:8, mp:40,k:'X',col:'#cc1122',ex:()=>SKX.ring(7,13,400,'blood')},{n:'Mgła Krwi',      cd:13,mp:55,k:'C',col:'#990a18',ex:()=>SKX.burst(6,12,340,'blood')},{n:'Szał Krwi',      cd:18,mp:65,k:'V',col:'#ff2244',ex:()=>{SKX.heal(18);SKX.speed(2,45);}},{n:'Błysk Wampira',  cd:7, mp:28,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  frostmage:  [{n:'Blizzard',      cd:0, mp:0, k:'Space',col:'#8ad8ff'},{n:'Krąg Mrozu',      cd:5, mp:32,k:'X',col:'#8ad8ff',ex:()=>SKX.ring(10,24,560,'frost')},{n:'Pole Lodu',      cd:9, mp:38,k:'C',col:'#4488ff',ex:()=>SKX.pool(60,9,'#4488ff')},{n:'Lodowiec',       cd:13,mp:55,k:'V',col:'#88ddff',ex:()=>SKX.meteor(75,55,'#88ddff')},{n:'Lodowy Błysk',   cd:4, mp:18,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  stormcaller:[{n:'Władca Burzy',  cd:0, mp:0, k:'Space',col:'#aaeeff'},{n:'Krąg Burzy',      cd:5, mp:30,k:'X',col:'#aaeeff',ex:()=>SKX.ring(10,28,700,'lightning')},{n:'Pole Burzy',     cd:8, mp:35,k:'C',col:'#4488ff',ex:()=>SKX.pool(55,9,'#4488ff')},{n:'Piorun Bogów',   cd:12,mp:55,k:'V',col:'#ffe44a',ex:()=>SKX.meteor(70,60,'#ffe44a')},{n:'Blyskawiczny Skok',cd:4,mp:20,k:'R',col:'#aaeeff',ex:()=>SKX.charge()}],
  runeknight: [{n:'Runiczna Aura', cd:0, mp:0, k:'Space',col:'#cc44ff'},{n:'Krąg Run',        cd:5, mp:32,k:'X',col:'#cc44ff',ex:()=>SKX.ring(8,36,480,'rune',0.5,16)},{n:'Runiczna Tarcza',cd:9,mp:38,k:'C',col:'#8844ff',ex:()=>SKX.invuln(2.5)},{n:'Runiczna Salwa', cd:11,mp:50,k:'V',col:'#aa44ff',ex:()=>SKX.burst(8,32,440,'rune')},{n:'Runowy Skok',    cd:4, mp:22,k:'R',col:'#cc44ff',ex:()=>SKX.charge()}],
  illusionist:[{n:'Iluzja',        cd:0, mp:0, k:'Space',col:'#aa33ff'},{n:'Ostrza w Krąg',   cd:5, mp:28,k:'X',col:'#9933cc',ex:()=>SKX.ring(10,22,520,'shadowblade')},{n:'Zanik',          cd:7, mp:30,k:'C',col:'#6622aa',ex:()=>{SKX.invuln(1.8);SKX.speed(2.5,75);}},{n:'Fontanna Iluzji',cd:10,mp:40,k:'V',col:'#cc55ff',ex:()=>SKX.burst(14,20,500,'shadowblade')},{n:'Błysk Iluzji',   cd:3, mp:15,k:'R',col:'#aa44ff',ex:()=>SKX.blink()}],
  void:       [{n:'Pustka',        cd:0, mp:0, k:'Space',col:'#330044'},{n:'Krąg Nicości',    cd:6, mp:35,k:'X',col:'#220033',ex:()=>SKX.ring(12,38,600,'void',1.2)},{n:'Pochłanianie',   cd:10,mp:44,k:'C',col:'#110022',ex:()=>{SKX.heal(40);SKX.invuln(1.5);addFloater(player.x,player.y-22,'POCHŁONIETO!','#cc44ff');}},{n:'Fala Nicości',   cd:12,mp:55,k:'V',col:'#440055',ex:()=>SKX.burst(16,35,500,'void')},{n:'Znikanie',        cd:4, mp:20,k:'R',col:'#330044',ex:()=>SKX.blink()}],
};

// ---------- Boss types ----------
const BOSS_TYPES = [
  { id: 'lich',   name: 'Mroczny Lichbringer', hp: 4200,  w: 56, h: 64, speed: 92,  dmg: 30 },
  { id: 'demon',  name: 'Płomienny Demon',     hp: 5500,  w: 60, h: 68, speed: 135, dmg: 38 },
  { id: 'ice',    name: 'Lodowa Królowa',      hp: 4500,  w: 48, h: 70, speed: 102, dmg: 32 },
  { id: 'titan',  name: 'Tytan Kamienny',      hp: 9000,  w: 72, h: 80, speed: 62,  dmg: 48 },
  { id: 'necro',  name: 'Nekromanta',          hp: 5800,  w: 52, h: 60, speed: 82,  dmg: 34 },
  { id: 'spider', name: 'Pajączyca',           hp: 5200,  w: 64, h: 48, speed: 172, dmg: 30 },
  { id: 'wraith', name: 'Zjawa Pustki',        hp: 7000,  w: 44, h: 68, speed: 120, dmg: 38 },
  { id: 'drake',  name: 'Smok Burzy',          hp: 6500,  w: 80, h: 56, speed: 85,  dmg: 32 },
];

// ============================================================
//   BOSS ARENA SYSTEM
// ============================================================
const BOSS_ARENA_DEFS = [
  { id: 'arena_lich',   bossId: 'lich',   name: 'Komnata Lichbringera',  triggerR: 185, col: '#9944ff' },
  { id: 'arena_demon',  bossId: 'demon',  name: 'Piekielna Arena',       triggerR: 200, col: '#ff4422' },
  { id: 'arena_titan',  bossId: 'titan',  name: 'Koloseum Tytana',       triggerR: 215, col: '#997744' },
  { id: 'arena_spider', bossId: 'spider', name: 'Sieć Pajączycy',        triggerR: 195, col: '#44aa22' },
  { id: 'arena_ice',    bossId: 'ice',    name: 'Lodowy Pałac',          triggerR: 190, col: '#88ddff' },
  { id: 'arena_necro',  bossId: 'necro',  name: 'Grobowiec Nekromanty',  triggerR: 200, col: '#9933aa' },
  { id: 'arena_wraith', bossId: 'wraith', name: 'Wrota Próżni',          triggerR: 195, col: '#6040ff' },
  { id: 'arena_drake',  bossId: 'drake',  name: 'Burza Smoka',           triggerR: 210, col: '#ffe44a' },
];

// ---------- Buildings ----------
const BUILDINGS = [
  { id: 'campfire',  name: 'Ognisko',        cost: { wood: 2, stone: 1 },           w: 20, h: 20 },
  { id: 'wall',      name: 'Mur',            cost: { wood: 0, stone: 3 },           w: 32, h: 16 },
  { id: 'tower',     name: 'Wieża',          cost: { wood: 2, stone: 5 },           w: 24, h: 36 },
  { id: 'door',      name: 'Drzwi',          cost: { wood: 3, stone: 0 },           w: 24, h: 12 },
  { id: 'crafting',  name: 'Stol Rzemiosla', cost: { wood: 4, stone: 2 },           w: 28, h: 20 },
  { id: 'furnace',   name: 'Piec',           cost: { wood: 3, stone: 6 },           w: 30, h: 26 },
  { id: 'spawner',   name: 'Expiarka',       cost: { wood: 4, stone: 3, bone: 3 },  w: 26, h: 26 },
  { id: 'lantern',   name: 'Latarnia',       cost: { wood: 2, stone: 1 },           w: 10, h: 28 },
  { id: 'barricade', name: 'Barykada',       cost: { wood: 5, bone: 2 },            w: 36, h: 14 },
];

// --- Crafting recipes — 3 poziomy ---
const RECIPES_L1 = [
  { name: 'Zbroja Kamienna', cost: { wood: 0, stone: 5, gold: 0 }, effect: 'armor',  desc: '+40 MAX HP',     level: 1 },
  { name: 'Pochodnia',       cost: { wood: 3, stone: 1, gold: 0 }, effect: 'torch',  desc: '+25 szybkość',  level: 1 },
  { name: 'Kryształ MP',     cost: { wood: 2, stone: 2, gold: 0 }, effect: 'mpcrys', desc: '+30 MAX MP',    level: 1 },
  { name: 'Ostrze Obrażeń',  cost: { wood: 1, stone: 3, gold: 0 }, effect: 'blade',  desc: '+8 obrażeń',   level: 1 },
  { name: 'Buty Wiatrowe',   cost: { wood: 5, stone: 0, gold: 0 }, effect: 'boots2', desc: '+30 szybkość', level: 1 },
  { name: 'Eliksir Życia',   cost: { wood: 2, stone: 1, gold: 0 }, effect: 'potion', desc: 'Lecz 50 HP',   level: 1 },
];
const RECIPES_L2 = [
  { name: 'Miecz Stalowy',   cost: { wood: 2, stone: 6, gold: 50  }, effect: 'sword',  desc: 'Broń: 45 ATK',      level: 2 },
  { name: 'Łuk Kompozytowy', cost: { wood: 6, stone: 2, gold: 45  }, effect: 'bow',    desc: 'Łuk: 20+przebicie', level: 2 },
  { name: 'Kostur Arcański', cost: { wood: 2, stone: 4, gold: 55  }, effect: 'staff',  desc: 'Magia: 38 ATK',     level: 2 },
  { name: 'Zbroja Stalowa',  cost: { wood: 1, stone: 8, gold: 60  }, effect: 'armor2', desc: '+80 MAX HP',        level: 2 },
  { name: 'Buty Runiczne',   cost: { wood: 4, stone: 4, gold: 40  }, effect: 'boots3', desc: '+50 szybkość',      level: 2 },
  { name: 'Tarcza Drzewna',  cost: { wood: 5, stone: 3, gold: 35  }, effect: 'shield', desc: '+15 pancerza',      level: 2 },
];
const RECIPES_L3 = [
  { name: 'Miecz Runiczny',  cost: { wood: 5, stone: 10, gold: 150 }, effect: 'sword2', desc: 'Broń: 80+krit',   level: 3 },
  { name: 'Maczuga Ognia',   cost: { wood: 3, stone: 8,  gold: 130 }, effect: 'mace',   desc: 'Broń: 60+ogień',  level: 3 },
  { name: 'Łuk Magiczny',    cost: { wood: 8, stone: 3,  gold: 140 }, effect: 'bow2',   desc: 'Łuk: 35+pier.5',  level: 3 },
  { name: 'Pancerz Smoka',   cost: { wood: 3, stone: 12, gold: 200 }, effect: 'armor3', desc: '+150 MAX HP',      level: 3 },
  { name: 'Eliksir Mocny',   cost: { wood: 4, stone: 2,  gold: 80  }, effect: 'mpot',   desc: 'Lecz 80 HP',      level: 3 },
];
function getRecipes() {
  const lvl = state.craftingLevel || 1;
  const res = [...RECIPES_L1];
  if (lvl >= 2) res.push(...RECIPES_L2);
  if (lvl >= 3) res.push(...RECIPES_L3);
  return res;
}
const CRAFTING_UPGRADE_COST = [0, 200, 500]; // cost to go level 1→2, 2→3

// --- Hotbar weapon definitions ---
const HOTBAR_WEAPONS = {
  bone_sword: { name: 'Miecz Kostny', label: 'KOŚĆ', type: 'melee', dmg: 55, range: 85, arc: 1.1, cd: 0.60, color: '#d0ccb8' },
  sword:  { name: 'Miecz Stalowy',   type: 'melee',  dmg: 45, range: 80,  arc: 0.8,  cd: 0.55, color: '#c0d8ff' },
  sword2: { name: 'Miecz Runiczny',  type: 'melee',  dmg: 80, range: 95,  arc: 0.9,  cd: 0.45, color: '#cc44ff', crit: 0.3 },
  mace:   { name: 'Maczuga Ognia',   type: 'melee',  dmg: 60, range: 75,  arc: 0.75, cd: 0.75, color: '#ff8844', fire: true },
  bow:    { name: 'Łuk Kompozytowy', type: 'ranged', dmg: 20, pierce: 3,  spd: 900,  cd: 0.28, color: '#c8e8c0', kind: 'arrow' },
  bow2:   { name: 'Łuk Magiczny',    type: 'ranged', dmg: 35, pierce: 5,  spd: 1100, cd: 0.22, color: '#44aaff', kind: 'arrow' },
  staff:  { name: 'Kostur Arcański', type: 'ranged', dmg: 38, pierce: 0,  spd: 700,  cd: 0.32, color: '#d0a0ff', kind: 'fire' },
  // --- Bronie eventowe (z aren bossów, nie rzemiosła) ---
  event_lich:   { name: '☠ Laska Lichbringera', label: 'LICH',  type: 'ranged', dmg: 95,  pierce: 3,  spd: 650,  cd: 0.50, color: '#bb55ff', kind: 'soul',      event: true },
  event_demon:  { name: 'Fire Blade',            label: 'FIRE',  type: 'melee',  dmg: 120, range: 100, arc: 1.15, cd: 0.42, color: '#ff4422', fire: true,        event: true, crit: 0.25, fireWave: true },
  event_titan:  { name: '⚡ Pięść Tytana',       label: 'TITAN', type: 'melee',  dmg: 200, range: 115, arc: 0.60, cd: 0.95, color: '#ddaa44', earth: true,       event: true },
  event_spider: { name: '🕷 Kły Pajączycy',      label: 'JADY',  type: 'ranged', dmg: 55,  pierce: 6,  spd: 980,  cd: 0.15, color: '#44cc22', kind: 'venom',     event: true },
  event_ice:    { name: 'Mroczny Mróz',          label: 'MRÓZ',  type: 'ranged', dmg: 75,  pierce: 4,  spd: 740,  cd: 0.36, color: '#8ad8ff', kind: 'frost',     event: true, healOnHitBonus: 8 },
  event_necro:  { name: 'Kostur Cienia',         label: 'CIEŃ',  type: 'ranged', dmg: 88,  pierce: 3,  spd: 560,  cd: 0.52, color: '#9933aa', kind: 'bone',      event: true, soulDrain: true },
  event_wraith: { name: 'Ostrze Próżni',         label: 'PRÓŻ',  type: 'melee',  dmg: 155, range: 110, arc: 1.05, cd: 0.50, color: '#6040ff', voidBlade: true,   event: true, crit: 0.30 },
  event_drake:  { name: 'Berło Burzy',           label: 'BURZA', type: 'ranged', dmg: 90,  pierce: 5,  spd: 920,  cd: 0.28, color: '#ffe44a', kind: 'lightning', event: true },
};

// Przepisy pieca (wymagają kości)
const FURNACE_RECIPES = [
  { name: 'Zelazny Miecz',  cost: { wood: 1, stone: 5, bone: 0 }, effect: 'equip_sword',  desc: 'Broń: +22 ATK' },
  { name: 'Luk Mysliwski',  cost: { wood: 4, stone: 1, bone: 2 }, effect: 'equip_bow',    desc: 'Broń: +12 ATK +Przebicie' },
  { name: 'Kostur Kosci',   cost: { wood: 1, stone: 2, bone: 5 }, effect: 'equip_staff',  desc: 'Broń: +28 MAG' },
  { name: 'Kolczuga',       cost: { wood: 0, stone: 7, bone: 3 }, effect: 'equip_armor',  desc: 'Zbroja: +90 MAX HP' },
  { name: 'Buty Mocy',      cost: { wood: 2, stone: 1, bone: 4 }, effect: 'equip_boots',  desc: 'Buty: +55 SZYBK.' },
  { name: 'Helm Wojownika', cost: { wood: 0, stone: 4, bone: 4 }, effect: 'equip_helm',   desc: 'Helm: +5/s leczenia' },
];

// Definicje efektów ekwipunku
const EQUIP_DEFS = {
  equip_sword:  { slot: 'weapon', name: 'Żelazny Miecz',   dmgBonus: 22, pierceBonus: 0, speed: 0, hpMax: 0, hpRegen: 0, melee: true },
  equip_bow:    { slot: 'weapon', name: 'Łuk Myśliwski',   dmgBonus: 12, pierceBonus: 2, speed: 0, hpMax: 0, hpRegen: 0 },
  equip_staff:  { slot: 'weapon', name: 'Kostur Kości',    dmgBonus: 28, pierceBonus: 0, speed: 0, hpMax: 0, hpRegen: 0 },
  equip_armor:  { slot: 'armor',  name: 'Kolczuga',        dmgBonus: 0,  pierceBonus: 0, speed: 0, hpMax: 90, hpRegen: 0 },
  equip_boots:  { slot: 'boots',  name: 'Buty Mocy',       dmgBonus: 0,  pierceBonus: 0, speed: 55, hpMax: 0, hpRegen: 0 },
  equip_helm:   { slot: 'helm',   name: 'Helm Wojownika',  dmgBonus: 0,  pierceBonus: 0, speed: 0, hpMax: 0, hpRegen: 5 },
};

// Mapowanie broni hotbar → slot ekwipunku (equip daje bonus do statów i przejmuje atak)
const HOTBAR_TO_EQUIP = {
  sword:  { slot: 'weapon', name: 'Miecz Stalowy',   dmgBonus: 30, pierceBonus: 0, speed:   0, hpMax: 0, hpRegen: 0, melee: true },
  sword2: { slot: 'weapon', name: 'Miecz Runiczny',  dmgBonus: 55, pierceBonus: 0, speed:   0, hpMax: 0, hpRegen: 0, melee: true },
  mace:   { slot: 'weapon', name: 'Maczuga Ognia',   dmgBonus: 40, pierceBonus: 0, speed: -10, hpMax: 0, hpRegen: 0, melee: true },
  bow:    { slot: 'weapon', name: 'Łuk Kompozyt.',   dmgBonus: 12, pierceBonus: 2, speed:   0, hpMax: 0, hpRegen: 0 },
  bow2:   { slot: 'weapon', name: 'Łuk Magiczny',    dmgBonus: 22, pierceBonus: 4, speed:   0, hpMax: 0, hpRegen: 0 },
  staff:  { slot: 'weapon', name: 'Kostur Arcański', dmgBonus: 28, pierceBonus: 0, speed:   0, hpMax: 0, hpRegen: 0 },
};

// Koła fortuny — zdefiniowane w lobby (patrz: refreshShop, spinWheel)

// ---------- World state ----------
const state = {
  running: false,
  time: 0,
  spawnTimer: 0,
  nextBossTimer: 70,
  bossesDefeated: 0,
  bossActive: false,
  boss: null,
  score: 0,
  kills: 0,
  particles: [],
  projectiles: [],
  hazards: [],
  enemies: [],
  pickups: [],
  floaters: [],
  decor: [],
  chests: [],
  clearedArenas: new Set(),
  buildings: [],
  resourceNodes: [],
  loadedChunks: new Set(),
  _lastChunkX: null,
  _lastChunkY: null,
  resources: { wood: 0, stone: 0, bone: 0 },
  money: 0,
  buildMode: false,
  buildSelected: 0,
  buildRotated: false,
  craftingOpen: false,
  craftingSelected: 0,
  craftingLevel: 1,
  furnaceOpen: false,
  furnaceSelected: 0,
  equipOpen: false,
  equipSlotSel: 0,
  equipHotbarCursor: 0,
  inventoryOpen: false,
  dayTime: 0.18,
  shake: 0,
  flash: 0,
};

// ---------- Player ----------
const player = {
  classId: 'mage',
  x: WORLD_W / 2, y: WORLD_H / 2,
  w: 18, h: 22,
  hp: 100, hpMax: 100,
  mp: 100, mpMax: 100,
  speed: 180,
  manaRegen: 13,
  dmgBonus: 0,
  pierceBonus: 0,
  healBonus: 0,
  armorBonus: 0,
  weaponLevel: 1,
  fireRate: 0.22,
  fireCooldown: 0,
  hotbarWeaponCd: 0,
  _eventRMBCd: 0,
  _rmbPressed: false,
  equip: { weapon: null, armor: null, boots: null, helm: null },
  equipHpRegen: 0,
  hotbar: Array(9).fill(null),  // { kind, count }
  hotbarSel: 0,
  invGrid: Array(27).fill(null), // 3×9 główny inwentarz { kind, count }
  skillCds: [0, 0, 0, 0, 0],   // cooldowny dla slotów 0-4
  _speedBoosts: [],              // { t, a } tymczasowe bonusy prędkości
  _eagleEye: 0,                  // hunter eagle eye: liczba bonusowych strzałów
  _meleeSwingTimer: 0,
  _meleeSwingAng: 0,
  dashCooldown: 0,
  dashTime: 0,
  dashVx: 0, dashVy: 0,
  invuln: 0,
  facing: 1,
  walkBob: 0,
  skillActive: false,
  skillAngle: 0,
  skillTickAcc: 0,
};

const FLAME = { range: 190, halfAngle: 0.42, dps: 70, tickRate: 0.08 };

// ---------- Helpers ----------
function aabb(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
         Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function pushOutOfWalls(entity, isEnemy) {
  for (const b of state.buildings) {
    if (b.type === 'wall') { /* always solid */ }
    else if (b.type === 'door' && isEnemy) { /* solid for enemies */ }
    else continue;
    const dx = entity.x - b.x;
    const dy = entity.y - b.y;
    const overlapX = (b.w / 2 + entity.w / 2) - Math.abs(dx);
    const overlapY = (b.h / 2 + entity.h / 2) - Math.abs(dy);
    if (overlapX > 0 && overlapY > 0) {
      if (overlapX <= overlapY) {
        entity.x += dx >= 0 ? overlapX : -overlapX;
      } else {
        entity.y += dy >= 0 ? overlapY : -overlapY;
      }
    }
  }
  if (state.inDungeon && state.dungeonTiles) pushOutOfDungeonWalls(entity);
}

function getTile(col, row) {
  if (!state.dungeonTiles) return 1;
  if (col < 0 || col >= DUNGEON_COLS || row < 0 || row >= DUNGEON_ROWS) return 0;
  return state.dungeonTiles[row][col];
}

function pushOutOfDungeonWalls(entity) {
  if (!state.dungeonTiles) return;
  const hw = entity.w / 2, hh = entity.h / 2;
  const x0t = Math.floor((entity.x - hw) / DUNGEON_TILE);
  const x1t = Math.floor((entity.x + hw - 0.1) / DUNGEON_TILE);
  const y0t = Math.floor((entity.y - hh) / DUNGEON_TILE);
  const y1t = Math.floor((entity.y + hh - 0.1) / DUNGEON_TILE);
  for (let ty = y0t; ty <= y1t; ty++) {
    for (let tx = x0t; tx <= x1t; tx++) {
      if (getTile(tx, ty) === 1) continue; // floor = passable
      const tileL = tx * DUNGEON_TILE;
      const tileR = tileL + DUNGEON_TILE;
      const tileT = ty * DUNGEON_TILE;
      const tileB = tileT + DUNGEON_TILE;
      const overlapX = Math.min(entity.x + hw, tileR) - Math.max(entity.x - hw, tileL);
      const overlapY = Math.min(entity.y + hh, tileB) - Math.max(entity.y - hh, tileT);
      if (overlapX > 0 && overlapY > 0) {
        if (overlapX <= overlapY) {
          entity.x += (entity.x < tileL + DUNGEON_TILE / 2) ? -overlapX : overlapX;
        } else {
          entity.y += (entity.y < tileT + DUNGEON_TILE / 2) ? -overlapY : overlapY;
        }
      }
    }
  }
}

function buildDungeonTiles() {
  const tiles = [];
  for (let r = 0; r < DUNGEON_ROWS; r++) tiles.push(new Array(DUNGEON_COLS).fill(0));
  function fill(c0, c1, r0, r1) {
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (r >= 0 && r < DUNGEON_ROWS && c >= 0 && c < DUNGEON_COLS)
          tiles[r][c] = 1;
  }
  DUNGEON_ROOMS.forEach(rm => fill(rm.c0, rm.c1, rm.r0, rm.r1));
  DUNGEON_CORRIDORS.forEach(co => fill(co.c0, co.c1, co.r0, co.r1));
  return tiles;
}

function enterDungeon(entrance) {
  if (state.inDungeon) return;
  state.overworldX = player.x;
  state.overworldY = player.y;
  state._overworldDecor = state.decor.slice();
  state._overworldChests = state.chests.slice();
  state._overworldResourceNodes = state.resourceNodes.slice();
  state._overworldBuildings = state.buildings.slice();

  WORLD_W = DUNGEON_COLS * DUNGEON_TILE; // 1920
  WORLD_H = DUNGEON_ROWS * DUNGEON_TILE; // 1280

  state.inDungeon = true;
  state.dungeonLevel = entrance.level;
  state.dungeonTiles = buildDungeonTiles();
  state.dungeonBossKilled = false;

  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.hazards.length = 0;
  state.pickups.length = 0;
  state.buildings.length = 0;
  state.bossActive = false;
  state.boss = null;
  state.craftingOpen = false;
  state.furnaceOpen = false;
  state.equipOpen = false;
  state.equipSlotSel = 0;
  state.equipHotbarCursor = 0;
  // bossBarWrap rysowany na canvasie — brak HTML show/hide

  // Player at start room center
  const sr = DUNGEON_ROOMS[0];
  player.x = ((sr.c0 + sr.c1 + 1) / 2) * DUNGEON_TILE;
  player.y = ((sr.r0 + sr.r1 + 1) / 2) * DUNGEON_TILE;

  // Exit portal (bottom-left of start room)
  const exitX = (sr.c0 + 2.5) * DUNGEON_TILE;
  const exitY = (sr.r1 - 1.5) * DUNGEON_TILE;
  state.dungeonExitPos = { x: exitX, y: exitY };
  state.decor = [{ type: 'dungeon_exit', x: exitX, y: exitY }];
  state.chests = [];
  state.resourceNodes = [];

  spawnDungeonEnemies(entrance.level);

  camera.x = clamp(player.x - SW / 2, 0, WORLD_W - SW);
  camera.y = clamp(player.y - SH / 2, 0, WORLD_H - SH);

  addFloater(player.x, player.y - 32, `LOCHY — POZIOM ${entrance.level}`, '#aa44ff');
  screenShake(8);
}

function exitDungeon() {
  if (!state.inDungeon) return;
  state.inDungeon = false;
  state.dungeonTiles = null;

  WORLD_W = 20000;
  WORLD_H = 20000;

  state.decor = state._overworldDecor;
  state.chests = state._overworldChests;
  state.resourceNodes = state._overworldResourceNodes;
  state.buildings = state._overworldBuildings;

  player.x = state.overworldX;
  player.y = state.overworldY;

  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.hazards.length = 0;
  state.pickups.length = 0;
  state.bossActive = false;
  state.boss = null;
  // bossBarWrap rysowany na canvasie — brak HTML show/hide
  state.nextBossTimer = 45;

  camera.x = clamp(player.x - SW / 2, 0, WORLD_W - SW);
  camera.y = clamp(player.y - SH / 2, 0, WORLD_H - SH);

  addFloater(player.x, player.y - 30, 'WYSZEDŁEŚ Z LOCHÓW', '#88ff88');
}

function spawnDungeonEnemies(level) {
  const types = level <= 1 ? ['bat', 'skeleton', 'wolf', 'wolf'] :
                level === 2 ? ['skeleton', 'orc', 'wolf', 'troll'] :
                             ['orc', 'troll', 'golem', 'skeleton'];
  // Skip start room (index 0), skip boss room (last)
  for (let ri = 1; ri < DUNGEON_ROOMS.length - 1; ri++) {
    const rm = DUNGEON_ROOMS[ri];
    const count = 3 + level + randi(0, 3);
    for (let k = 0; k < count; k++) {
      const type = types[randi(0, types.length)];
      const x = rand(rm.c0 + 1.5, rm.c1 - 0.5) * DUNGEON_TILE;
      const y = rand(rm.r0 + 1.5, rm.r1 - 0.5) * DUNGEON_TILE;
      spawnEnemyAt(type, x, y);
    }
  }
  // Loot chests (treasure room and loot room)
  const tr = DUNGEON_ROOMS[4];
  state.chests.push({ x: (tr.c0 + tr.c1 + 1) / 2 * DUNGEON_TILE, y: (tr.r0 + tr.r1 + 1) / 2 * DUNGEON_TILE, open: false, bob: 0, loot: 'weapon_upgrade' });
  state.chests.push({ x: (tr.c0 + tr.c1 + 1) / 2 * DUNGEON_TILE + 32, y: (tr.r0 + tr.r1 + 1) / 2 * DUNGEON_TILE, open: false, bob: 0, loot: 'crystal' });
  const lr = DUNGEON_ROOMS[2];
  state.chests.push({ x: (lr.c0 + lr.c1 + 1) / 2 * DUNGEON_TILE, y: (lr.r0 + lr.r1 + 1) / 2 * DUNGEON_TILE, open: false, bob: 0, loot: 'amulet' });
  // Boss in boss room
  const br = DUNGEON_ROOMS[5];
  const bx = (br.c0 + br.c1 + 1) / 2 * DUNGEON_TILE;
  const by = (br.r0 + br.r1 + 1) / 2 * DUNGEON_TILE;
  spawnBoss(bx, by);
}

function hasWallBetween(x1, y1, x2, y2) {
  for (const b of state.buildings) {
    if (b.type !== 'wall' && b.type !== 'door') continue;
    const hwx = b.w / 2, hwy = b.h / 2;
    for (let s = 1; s <= 7; s++) {
      const t = s / 8;
      const sx = x1 + (x2 - x1) * t;
      const sy = y1 + (y2 - y1) * t;
      if (Math.abs(sx - b.x) < hwx && Math.abs(sy - b.y) < hwy) return true;
    }
  }
  return false;
}

function addParticles(x, y, color, count, speed, life) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const s = rand(speed * 0.3, speed);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life, maxLife: life, color, size: randi(2, 4),
    });
  }
}

function addFloater(x, y, text, color) {
  state.floaters.push({ x, y, text, color, life: 0.8, maxLife: 0.8, vy: -40 });
}

function screenShake(amount) { state.shake = Math.max(state.shake, amount); }

// ---------- Day / Night ----------
function getDayBrightness() {
  const t = state.dayTime;
  if (t < 0.10) return t / 0.10;           // świt
  if (t < 0.48) return 1;                   // dzień
  if (t < 0.58) return 1 - (t - 0.48) / 0.10; // zmierzch
  return 0;                                  // noc
}
function isDay() { return getDayBrightness() >= 0.85; }
function getDayTint() {
  const t = state.dayTime, br = getDayBrightness();
  if (t >= 0.10 && t < 0.48) return null; // dzień — brak tintu
  if (t < 0.10) return [60, 30, 10, 0.3 * (1 - br)]; // świt
  if (t < 0.58) return [110, 45, 8, 0.28 * (1 - br)]; // zmierzch
  if (t < 0.72) return [30, 10, 55, 0.45 * (1 - br)]; // wczesna noc
  return [8, 4, 35, 0.5]; // noc
}
function getDayLabel() {
  const t = state.dayTime;
  if (t < 0.10) return 'ŚWIT';
  if (t < 0.48) return 'DZIEŃ';
  if (t < 0.58) return 'ZMIERZCH';
  return 'NOC';
}
function timeToNight() {
  const t = state.dayTime;
  if (t >= 0.58) return 0;
  return Math.ceil((0.58 - t) * DAY_CYCLE);
}

// ---------- Interakcja / Budowanie ----------
function doCraft(recipe) {
  const res = state.resources;
  if (res.wood < recipe.cost.wood || res.stone < recipe.cost.stone) {
    addFloater(player.x, player.y-22, 'BRAK SUROWCOW!', '#ff4060'); screenShake(2); return;
  }
  const goldCost = recipe.cost.gold || 0;
  if (goldCost > 0 && state.money < goldCost) {
    addFloater(player.x, player.y-22, `BRAK ZLOTA! ($${goldCost})`, '#ff4060'); screenShake(2); return;
  }
  removeFromInvGrid('wood',  recipe.cost.wood);
  removeFromInvGrid('stone', recipe.cost.stone);
  if (goldCost > 0) state.money -= goldCost;

  const e = recipe.effect;
  // Poziom 1
  if      (e === 'armor')  { player.hpMax += 40; player.hp = Math.min(player.hp+40, player.hpMax); addFloater(player.x, player.y-22, '+40 MAX HP', '#ff8aa8'); }
  else if (e === 'torch')  { player.speed = Math.min(player.speed+25, 400); addFloater(player.x, player.y-22, '+25 SZYBKOSC', '#ff8844'); }
  else if (e === 'mpcrys') { player.mpMax += 30; player.mp = Math.min(player.mp+30, player.mpMax); addFloater(player.x, player.y-22, '+30 MAX MP', '#8ad8ff'); }
  else if (e === 'blade')  { player.dmgBonus += 8; addFloater(player.x, player.y-22, '+8 OBRAZEN', '#ffd66b'); }
  else if (e === 'boots2') { player.speed = Math.min(player.speed+30, 400); addFloater(player.x, player.y-22, '+30 SZYBKOSC', '#9bff9b'); }
  else if (e === 'potion') { if (addToHotbar('potion',1)) addFloater(player.x, player.y-22, 'ELIKSIR → hotbar', '#9bff9b'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  // Poziom 2 — broń na hotbar
  else if (e === 'sword')  { if (addToHotbar('sword',1))  addFloater(player.x, player.y-22, 'MIECZ STALOWY → hotbar!', '#c0d8ff'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'bow')    { if (addToHotbar('bow',1))    addFloater(player.x, player.y-22, 'LUK → hotbar!', '#c8e8c0'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'staff')  { if (addToHotbar('staff',1))  addFloater(player.x, player.y-22, 'KOSTUR → hotbar!', '#d0a0ff'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'armor2') { player.hpMax += 80; player.hp = Math.min(player.hp+80, player.hpMax); addFloater(player.x, player.y-22, '+80 MAX HP', '#ff8aa8'); }
  else if (e === 'boots3') { player.speed = Math.min(player.speed+50, 420); addFloater(player.x, player.y-22, '+50 SZYBKOSC', '#9bff9b'); }
  else if (e === 'shield') { player.armorBonus = (player.armorBonus||0) + 15; addFloater(player.x, player.y-22, '+15 PANCERZ', '#8ad8ff'); }
  // Poziom 3
  else if (e === 'sword2') { if (addToHotbar('sword2',1)) addFloater(player.x, player.y-22, 'MIECZ RUNICZNY → hotbar!', '#cc44ff'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'mace')   { if (addToHotbar('mace',1))   addFloater(player.x, player.y-22, 'MACZUGA → hotbar!', '#ff8844'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'bow2')   { if (addToHotbar('bow2',1))   addFloater(player.x, player.y-22, 'LUK MAGICZNY → hotbar!', '#44aaff'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }
  else if (e === 'armor3') { player.hpMax += 150; player.hp = Math.min(player.hp+150, player.hpMax); addFloater(player.x, player.y-22, '+150 MAX HP', '#ff8aa8'); }
  else if (e === 'mpot')   { if (addToHotbar('mpot',1))   addFloater(player.x, player.y-22, 'MOCNY ELIKSIR → hotbar!', '#ff88aa'); else addFloater(player.x, player.y-22, 'HOTBAR PELNY!', '#ff4060'); }

  addParticles(player.x, player.y, '#ffd66b', 20, 120, 0.5);
  screenShake(3);
}

function upgradeCraftingTable() {
  if (state.craftingLevel >= 3) { addFloater(player.x, player.y-22, 'MAX POZIOM!', '#ffd66b'); return; }
  const cost = CRAFTING_UPGRADE_COST[state.craftingLevel];
  if (state.money < cost) {
    addFloater(player.x, player.y-22, `BRAK ZLOTA! ($${cost})`, '#ff4060'); screenShake(2); return;
  }
  state.money -= cost;
  state.craftingLevel++;
  state.craftingSelected = 0;
  addParticles(player.x, player.y, '#ffd66b', 30, 160, 0.6);
  addFloater(player.x, player.y-28, `STOL POZIOM ${state.craftingLevel}! NOWE PRZEPISY!`, '#ffd66b');
  screenShake(6);
}

function applyEquipDef(def) {
  const slot = def.slot;
  const old = player.equip[slot];
  if (old) {
    player.dmgBonus     -= (old.dmgBonus || 0);
    player.pierceBonus  -= (old.pierceBonus || 0);
    player.speed        -= (old.speed || 0);
    if (old.hpMax) { player.hpMax -= old.hpMax; player.hp = Math.min(player.hp, player.hpMax); }
    player.equipHpRegen -= (old.hpRegen || 0);
  }
  player.equip[slot]  = def;
  player.dmgBonus    += (def.dmgBonus || 0);
  player.pierceBonus += (def.pierceBonus || 0);
  player.speed        = Math.min(player.speed + (def.speed || 0), 400);
  if (def.hpMax) { player.hpMax += def.hpMax; player.hp = Math.min(player.hp + def.hpMax, player.hpMax); }
  player.equipHpRegen += (def.hpRegen || 0);
  addParticles(player.x, player.y, '#ff9944', 20, 130, 0.5);
  addFloater(player.x, player.y - 26, def.name + ' ZALOZONE!', '#ff9944');
  screenShake(4);
}

function unequipSlot(slotKey) {
  const old = player.equip[slotKey];
  if (!old) { addFloater(player.x, player.y - 22, 'SLOT PUSTY!', '#ff4060'); return; }
  player.dmgBonus     -= (old.dmgBonus || 0);
  player.pierceBonus  -= (old.pierceBonus || 0);
  player.speed        -= (old.speed || 0);
  if (old.hpMax) { player.hpMax -= old.hpMax; player.hp = Math.min(player.hp, player.hpMax); }
  player.equipHpRegen -= (old.hpRegen || 0);
  player.equip[slotKey] = null;
  addFloater(player.x, player.y - 22, old.name + ' ZDIETY', '#aabbff');
}

// Zwraca listę { hotbarIdx, kind, def } — bronie z hotbara pasujące do danego slotu
function getEquippableFromHotbar(slotKey) {
  const result = [];
  for (let i = 0; i < 9; i++) {
    const s = player.hotbar[i];
    if (!s) continue;
    const def = HOTBAR_TO_EQUIP[s.kind];
    if (def && def.slot === slotKey) result.push({ hotbarIdx: i, kind: s.kind, def });
  }
  return result;
}

function doFurnace(recipe) {
  const r = state.resources;
  if (r.wood < recipe.cost.wood || r.stone < recipe.cost.stone || (r.bone || 0) < recipe.cost.bone) {
    addFloater(player.x, player.y - 22, 'BRAK SUROWCOW!', '#ff4060'); screenShake(2); return;
  }
  removeFromInvGrid('wood',  recipe.cost.wood);
  removeFromInvGrid('stone', recipe.cost.stone);
  removeFromInvGrid('bone',  recipe.cost.bone);
  applyEquipDef(EQUIP_DEFS[recipe.effect]);
}

function handleInteract() {
  // Dungeon exit portal
  if (state.inDungeon && state.dungeonExitPos) {
    const ex = state.dungeonExitPos.x - player.x, ey = state.dungeonExitPos.y - player.y;
    if (ex*ex + ey*ey < 64*64) { exitDungeon(); return; }
  }
  // Dungeon entrance (overworld)
  if (!state.inDungeon) {
    for (const d of state.decor) {
      if (d.type !== 'dungeon_entrance') continue;
      const dx = d.x - player.x, dy = d.y - player.y;
      if (dx*dx + dy*dy < 72*72) { enterDungeon(d); return; }
    }
  }
  for (const b of state.buildings) {
    if (b.type === 'crafting') {
      const dx = b.x - player.x, dy = b.y - player.y;
      if (dx*dx + dy*dy < 65*65) { state.craftingOpen = !state.craftingOpen; state.craftingSelected = 0; return; }
    } else if (b.type === 'furnace') {
      const dx = b.x - player.x, dy = b.y - player.y;
      if (dx*dx + dy*dy < 65*65) { state.furnaceOpen = !state.furnaceOpen; state.furnaceSelected = 0; return; }
    }
  }
  for (const n of state.resourceNodes) {
    if (n.depleted) continue;
    const dx = n.x - player.x, dy = n.y - player.y;
    if (dx*dx + dy*dy < 56*56) {
      n.depleted = true;
      n.respawnTimer = 28;
      const amount = randi(2, 5);
      if (n.type === 'stone') {
        addToInvGrid('stone', amount);
        addFloater(player.x, player.y - 20, `+${amount} KAMIEN`, '#9090a0');
        addParticles(n.x, n.y, '#9090a0', 14, 100, 0.4);
      } else {
        addToInvGrid('wood', amount);
        addFloater(player.x, player.y - 20, `+${amount} DREWNO`, '#c8a060');
        addParticles(n.x, n.y, '#c8a060', 14, 100, 0.4);
      }
      screenShake(2);
      break;
    }
  }
}
function toggleBuildMode() {
  state.buildMode = !state.buildMode;
  if (state.buildMode) addFloater(player.x, player.y - 20, '[B]BUDOWANIE · 1/2/3 wybierz', '#ffd66b');
}
function placeBuildingAtMouse() {
  const bdef = BUILDINGS[state.buildSelected];
  const bx = Math.round(mouseWorld.x / 8) * 8;
  const by = Math.round(mouseWorld.y / 8) * 8;
  const rotated = state.buildRotated && (bdef.id === 'wall' || bdef.id === 'door');
  const bw = rotated ? bdef.h : bdef.w;
  const bh = rotated ? bdef.w : bdef.h;
  // Sprawdź nakładanie na istniejące budynki
  for (const ex of state.buildings) {
    const dx = Math.abs(bx - ex.x), dy = Math.abs(by - ex.y);
    if (dx < (bw + ex.w) / 2 - 3 && dy < (bh + ex.h) / 2 - 3) {
      addFloater(player.x, player.y - 20, 'ZAJETE MIEJSCE!', '#ff4060');
      screenShake(2); return;
    }
  }
  if (state.resources.wood < bdef.cost.wood || state.resources.stone < bdef.cost.stone || (state.resources.bone||0) < (bdef.cost.bone||0)) {
    addFloater(player.x, player.y - 20, 'BRAK SUROWCOW!', '#ff4060');
    screenShake(2); return;
  }
  removeFromInvGrid('wood',  bdef.cost.wood);
  removeFromInvGrid('stone', bdef.cost.stone);
  if (bdef.cost.bone) removeFromInvGrid('bone', bdef.cost.bone);
  const b = { type: bdef.id, x: bx, y: by, w: bw, h: bh, rotated, fireCd: 0 };
  if (b.type === 'wall')      { b.hp = b.maxHp = 140; }
  if (b.type === 'door')      { b.hp = b.maxHp = 70; }
  if (b.type === 'furnace')   { b.hp = b.maxHp = 200; }
  if (b.type === 'barricade') { b.hp = b.maxHp = 100; }
  state.buildings.push(b);
  addParticles(bx, by, '#ffd66b', 18, 100, 0.4);
  addFloater(bx, by - 20, bdef.name + '!', '#9bff9b');
  screenShake(3);
}

// -------- InvGrid (główny inwentarz materiałów) --------
function addToInvGrid(kind, amount) {
  // Próbuj dokładać na istniejące stosy
  for (const slot of player.invGrid) {
    if (slot && slot.kind === kind && slot.count < 64) {
      const add = Math.min(amount, 64 - slot.count);
      slot.count += add; amount -= add;
      if (amount <= 0) { syncResources(); return; }
    }
  }
  // Puste sloty dla reszty
  while (amount > 0) {
    const idx = player.invGrid.findIndex(s => s === null);
    if (idx === -1) { addFloater(player.x, player.y-22, 'EKWIPUNEK PEŁNY!', '#ff4060'); break; }
    const add = Math.min(amount, 64);
    player.invGrid[idx] = { kind, count: add };
    amount -= add;
  }
  syncResources();
}

function getInvCount(kind) {
  return player.invGrid.reduce((sum, s) => s && s.kind === kind ? sum + s.count : sum, 0);
}

function removeFromInvGrid(kind, amount) {
  for (let i = player.invGrid.length - 1; i >= 0 && amount > 0; i--) {
    const s = player.invGrid[i];
    if (!s || s.kind !== kind) continue;
    const take = Math.min(s.count, amount);
    s.count -= take; amount -= take;
    if (s.count <= 0) player.invGrid[i] = null;
  }
  syncResources();
}

function syncResources() {
  state.resources.wood  = getInvCount('wood');
  state.resources.stone = getInvCount('stone');
  state.resources.bone  = getInvCount('bone');
}

// -------- Hotbar --------
function addToHotbar(kind, count = 1) {
  for (const slot of player.hotbar) {
    if (slot && slot.kind === kind && slot.count < 64) { slot.count = Math.min(64, slot.count + count); return true; }
  }
  for (let i = 0; i < 9; i++) {
    if (!player.hotbar[i]) { player.hotbar[i] = { kind, count }; return true; }
  }
  return false;
}

function useHotbarItem() {
  if (!state.running || state.paused) return;
  const slot = player.hotbar[player.hotbarSel];
  if (!slot) return;
  if (slot.kind in HOTBAR_WEAPONS) return; // broni używa LPM, nie F
  if (slot.kind === 'potion') { player.hp = Math.min(player.hpMax, player.hp + 50); addFloater(player.x, player.y-20, '+50 HP (eliksir)', '#9bff9b'); addParticles(player.x, player.y, '#9bff9b', 12, 90, 0.4); }
  else if (slot.kind === 'mpot') { player.hp = Math.min(player.hpMax, player.hp + 80); addFloater(player.x, player.y-20, '+80 HP (mocny)', '#ff88cc'); addParticles(player.x, player.y, '#ff88cc', 14, 100, 0.4); }
  else if (slot.kind === 'meat')  { player.hp = Math.min(player.hpMax, player.hp + 35); addFloater(player.x, player.y-20, '+35 HP (mieso)', '#ff9966'); addParticles(player.x, player.y, '#ff9966', 10, 80, 0.4); }
  else return; // nieznany typ — nie zużywaj
  slot.count--;
  if (slot.count <= 0) player.hotbar[player.hotbarSel] = null;
}

// -------- Skill casting --------
function castSkill(slotIdx) {
  if (!state.running || state.paused || state.craftingOpen || state.furnaceOpen) return;
  const cid = player.baseClass;
  const skills = CLASS_SKILLS[cid];
  if (!skills || slotIdx >= skills.length) return;
  const sk = skills[slotIdx];
  if (!sk.ex) return;
  // Sprawdź odblokowanie
  if (!save.hasSkill(cid, slotIdx)) {
    addFloater(player.x, player.y - 22, `KUP SKILL ${slotIdx+1} W SKLEPIE! ($${SKILL_PRICES[slotIdx]})`, '#ff4466');
    screenShake(2); return;
  }
  if (player.skillCds[slotIdx] > 0) {
    addFloater(player.x, player.y - 18, `CD: ${player.skillCds[slotIdx].toFixed(1)}s`, '#ff6644');
    return;
  }
  const mpCost = sk.mp || 0;
  if (player.mp < mpCost) { addFloater(player.x, player.y - 18, 'BRAK MANY!', '#4488ff'); return; }
  player.mp -= mpCost;
  player.skillCds[slotIdx] = sk.cd;
  sk.ex();
  addParticles(player.x, player.y, sk.col || '#ffffff', 8, 100, 0.3);
}

function updateSkillCooldowns(dt) {
  for (let i = 1; i < 5; i++) {
    if (player.skillCds[i] > 0) player.skillCds[i] = Math.max(0, player.skillCds[i] - dt);
  }
  // Tymczasowe bonusy prędkości
  for (let i = player._speedBoosts.length - 1; i >= 0; i--) {
    const b = player._speedBoosts[i];
    b.t -= dt;
    if (b.t <= 0) { player.speed = Math.max(50, player.speed - b.a); player._speedBoosts.splice(i, 1); }
  }
}

function dropClassItem(x, y) {
  const map = { mage: 'scroll', archer: 'quiver', doctor: 'medkit', knight: 'shard', shaman: 'totem', ninja: 'kunai', gravedigger: 'totem', berserker: 'shard', pyromancer: 'scroll', cleric: 'medkit', hunter: 'quiver', shadow: 'kunai', crusader: 'shard', witch: 'totem', alchemist: 'medkit', bard: 'scroll', necromancer: 'totem', paladin: 'shard', druid: 'totem', vampire: 'medkit', frostmage: 'scroll', stormcaller: 'totem', runeknight: 'shard', illusionist: 'kunai' };
  const kind = map[player.baseClass] || 'scroll';
  state.pickups.push({ x, y, kind, life: 16, bob: Math.random() * Math.PI * 2 });
}

// ---------- Chunk-based infinite world ----------
function generateChunk(cx, cy) {
  const key = `${cx},${cy}`;
  if (state.loadedChunks.has(key)) return;
  state.loadedChunks.add(key);

  const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
  let i = 0;
  const cr = () => chunkRand(cx, cy, i++);

  // Strefa startowa — bez decoracji w promieniu 200px od punktu spawnu
  const spawnX = WORLD_W / 2, spawnY = WORLD_H / 2;

  const notNearSpawn = (wx, wy, r = 220) => {
    const dx = wx - spawnX, dy = wy - spawnY;
    return dx*dx + dy*dy > r*r;
  };

  // Drzewa (gęstość zależna od biomu)
  for (let t = 0; t < 14; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    const biome = getBiome(tx, ty);
    if (biome === 5) continue;
    if (biome === 2 && cr() > 0.12) continue;
    if (!notNearSpawn(tx, ty)) continue;
    state.decor.push({ type: 'tree', x: tx, y: ty, v: Math.floor(cr()*3), chunkKey: key });
  }
  // Dodatkowe drzewa dla lasów
  for (let t = 0; t < 8; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    if (getBiome(tx, ty) === 1 && notNearSpawn(tx, ty))
      state.decor.push({ type: 'tree', x: tx, y: ty, v: Math.floor(cr()*3), chunkKey: key });
  }
  // Skały
  for (let t = 0; t < 9; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    const biome = getBiome(tx, ty);
    if (biome === 5) continue;
    if (!notNearSpawn(tx, ty)) continue;
    state.decor.push({ type: 'rock', x: tx, y: ty, v: Math.floor(cr()*3), chunkKey: key });
  }
  // Dodatkowe skały w górach
  for (let t = 0; t < 6; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    if (getBiome(tx, ty) === 4 && notNearSpawn(tx, ty))
      state.decor.push({ type: 'rock', x: tx, y: ty, v: Math.floor(cr()*3), chunkKey: key });
  }
  // Trawa
  for (let t = 0; t < 36; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    const biome = getBiome(tx, ty);
    if (biome === 5 || (biome === 2 && cr() > 0.10)) continue;
    state.decor.push({ type: 'grass', x: tx, y: ty, chunkKey: key });
  }
  // Filary (rzadko)
  if (cr() < 0.22) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    if (getBiome(tx, ty) !== 5 && notNearSpawn(tx, ty))
      state.decor.push({ type: 'pillar', x: tx, y: ty, chunkKey: key });
  }
  // Lilie na wodzie
  for (let t = 0; t < 5; t++) {
    const tx = x0 + cr()*CHUNK_SIZE, ty = y0 + cr()*CHUNK_SIZE;
    if (getBiome(tx, ty) === 5)
      state.decor.push({ type: 'lily', x: tx, y: ty, chunkKey: key });
  }

  // Węzły zasobów — kamień
  for (let t = 0; t < 6; t++) {
    const nx = x0 + cr()*CHUNK_SIZE, ny = y0 + cr()*CHUNK_SIZE;
    if (getBiome(nx, ny) === 5 || !notNearSpawn(nx, ny, 180)) continue;
    state.resourceNodes.push({ type: 'stone', x: nx, y: ny, v: Math.floor(cr()*3), depleted: false, respawnTimer: 0, chunkKey: key });
  }
  // Węzły zasobów — drewno
  for (let t = 0; t < 9; t++) {
    const nx = x0 + cr()*CHUNK_SIZE, ny = y0 + cr()*CHUNK_SIZE;
    if (getBiome(nx, ny) === 5 || !notNearSpawn(nx, ny, 180)) continue;
    state.resourceNodes.push({ type: 'wood', x: nx, y: ny, v: Math.floor(cr()*4), depleted: false, respawnTimer: 0, chunkKey: key });
  }

  // Struktura (35% szans na 1 strukturę w chunku)
  if (cr() < 0.35) {
    const sx = x0 + 0.1*CHUNK_SIZE + cr()*CHUNK_SIZE*0.8;
    const sy = y0 + 0.1*CHUNK_SIZE + cr()*CHUNK_SIZE*0.8;
    const biome = getBiome(sx, sy);
    if (biome !== 5 && notNearSpawn(sx, sy, 300)) {
      const types = ['stonecircle', 'ruins', 'camp', 'graveyard'];
      const stype = types[Math.floor(cr()*4)];
      state.decor.push({ type: stype, x: sx, y: sy, chunkKey: key });
      const loot = cr() < 0.4 ? 'weapon_upgrade' : (['boots','amulet','crystal','ring','weapon_upgrade'])[Math.floor(cr()*5)];
      const offsets = { stonecircle: [0,0], ruins: [10,0], camp: [40,0], graveyard: [0,20] };
      const [ox, oy] = offsets[stype] || [0,0];
      state.chests.push({ x: sx+ox+(cr()-0.5)*20, y: sy+oy+(cr()-0.5)*20, open: false, bob: cr()*TAU, loot, chunkKey: key });
    }
  }

  // Samotna skrzynka (20% szans)
  if (cr() < 0.20) {
    const sx = x0 + cr()*CHUNK_SIZE, sy = y0 + cr()*CHUNK_SIZE;
    if (getBiome(sx, sy) !== 5 && notNearSpawn(sx, sy))
      state.chests.push({ x: sx, y: sy, open: false, bob: cr()*TAU, loot: cr()<0.3?'weapon_upgrade':'crystal', chunkKey: key });
  }

  // Wejście do lochu (2% chunków, deterministyczne)
  if (chunkRand(cx, cy, 9000) < 0.02) {
    const dx2 = x0 + 0.25*CHUNK_SIZE + chunkRand(cx,cy,9001)*CHUNK_SIZE*0.5;
    const dy2 = y0 + 0.25*CHUNK_SIZE + chunkRand(cx,cy,9002)*CHUNK_SIZE*0.5;
    if (getBiome(dx2, dy2) !== 5 && notNearSpawn(dx2, dy2, 600)) {
      const level = 1 + Math.floor(chunkRand(cx,cy,9003)*3);
      state.decor.push({ type: 'dungeon_entrance', x: dx2, y: dy2, level, visited: false, chunkKey: key });
    }
  }

  // Boss Arena (10% chunków, deterministyczne, minimum 700px od spawnu)
  if (chunkRand(cx, cy, 8000) < 0.10) {
    const ax = x0 + 0.15*CHUNK_SIZE + chunkRand(cx,cy,8001)*CHUNK_SIZE*0.7;
    const ay = y0 + 0.15*CHUNK_SIZE + chunkRand(cx,cy,8002)*CHUNK_SIZE*0.7;
    if (getBiome(ax, ay) !== 5 && notNearSpawn(ax, ay, 700)) {
      const vi = Math.floor(chunkRand(cx,cy,8003)*8);
      const arenaKey = `${cx},${cy}`;
      const cleared = state.clearedArenas.has(arenaKey);
      state.decor.push({ type: 'boss_arena', x: ax, y: ay, variant: vi, bossId: BOSS_ARENA_DEFS[vi].bossId, cleared, arenaKey, chunkKey: key });
    }
  }
}

function unloadChunks(pcx, pcy) {
  const maxDist = CHUNK_RADIUS + 1;
  for (const key of [...state.loadedChunks]) {
    const [ccx, ccy] = key.split(',').map(Number);
    if (Math.abs(ccx - pcx) > maxDist || Math.abs(ccy - pcy) > maxDist) {
      state.loadedChunks.delete(key);
      state.decor          = state.decor.filter(d => d.chunkKey !== key);
      state.resourceNodes  = state.resourceNodes.filter(n => n.chunkKey !== key);
      state.chests         = state.chests.filter(c => !c.chunkKey || c.chunkKey !== key);
    }
  }
}

function updateChunks() {
  if (state.inDungeon) return;
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcy = Math.floor(player.y / CHUNK_SIZE);
  if (state._lastChunkX === pcx && state._lastChunkY === pcy) return;
  state._lastChunkX = pcx;
  state._lastChunkY = pcy;
  for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++)
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++)
      generateChunk(pcx + dx, pcy + dy);
  unloadChunks(pcx, pcy);
}

// Zachowane dla kompatybilności — wywoływane ze startGame
function generateDecor() {
  state.decor.length = 0;
  state.resourceNodes.length = 0;
  state.chests.length = 0;
  state.loadedChunks = new Set();
  state._lastChunkX = null;
  state._lastChunkY = null;
  // Wygeneruj chunki startowe wokół gracza
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcy = Math.floor(player.y / CHUNK_SIZE);
  for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++)
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++)
      generateChunk(pcx + dx, pcy + dy);
}

// ---------- Chests ----------
function updateChests(dt) {
  for (const c of state.chests) {
    if (c.open) continue;
    c.bob += dt * 2;
    const dx = player.x - c.x, dy = player.y - c.y;
    if (dx * dx + dy * dy < 30 * 30) openChest(c);
  }
}

function openChest(c) {
  c.open = true;
  addParticles(c.x, c.y, '#ffd66b', 22, 170, 0.7);
  screenShake(4);
  applyChestLoot(c.loot);
}

function applyChestLoot(loot) {
  if (loot === 'weapon_upgrade') {
    if (player.weaponLevel < 3) {
      player.weaponLevel++;
      const names = { mage: ['','Podwójna Kula','Eksplodująca Kula'], archer: ['','Ciężka Strzała','Potrójna Salwa'], doctor: ['','Strzykawka Przebijna','Masowa Iniekcja'], knight: ['','Ciężki Miecz','Wichura Ostrzy'], shaman: ['','Łańcuch Błyskawic','Burza Piorunów'], ninja: ['','Podwójne Gwiazdy','Deszcz Śmierci'], gravedigger: ['','Podwójna Kość','Kostna Burza'], berserker: ['','Ciężki Topór','Wichura Toporów'], pyromancer: ['','Wielki Inferno','Deszcz Ognia'], cleric: ['','Podwójny Promień','Święta Salwa'], hunter: ['','Podwójny Bumerang','Zasadzka'], shadow: ['','Potrójna Ostrość','Mgła Cieni'], necromancer: ['','Podwójna Trucizna','Plagowa Salwa'], paladin: ['','Boskie Ostrze','Tarcza Światłości'], druid: ['','Podwójny Kolec','Natura Wybucha'], vampire: ['','Strumień Krwi','Wieczna Żądza'], frostmage: ['','Podwójny Mróz','Blizzard'], stormcaller: ['','Łańcuch Burzy','Piorun Bogów'], runeknight: ['','Podwójna Runa','Runowa Apokalipsa'], illusionist: ['','Rozszczepiająca','Fontanna Iluzji'],
        crusader: ['','Święty Buzdygan','Boska Armia'], witch: ['','Podwójna Klątwa','Heksowy Sztorm'], alchemist: ['','Kwasowa Salwa','Wielka Eksplozja'], bard: ['','Podwójny Akord','Symfonia Zniszczenia'] };
      addFloater(player.x, player.y - 22, `${(names[player.classId] || names.mage)[player.weaponLevel]}!`, '#ffd66b');
    } else {
      player.mp = player.mpMax;
      addFloater(player.x, player.y - 22, 'MANA MAX', '#8ad8ff');
    }
  } else if (loot === 'boots') {
    player.speed = Math.min(player.speed + 16, 360);
    addFloater(player.x, player.y - 22, '+16 SZYBKOŚĆ', '#9bff9b');
  } else if (loot === 'amulet') {
    player.hpMax += 20; player.hp = Math.min(player.hp + 20, player.hpMax);
    addFloater(player.x, player.y - 22, '+20 MAX HP', '#ff8aa8');
  } else if (loot === 'crystal') {
    player.mpMax += 20; player.mp = Math.min(player.mp + 20, player.mpMax);
    addFloater(player.x, player.y - 22, '+20 MAX MP', '#8ad8ff');
  } else if (loot === 'ring') {
    player.fireRate = Math.max(player.fireRate * 0.88, 0.07);
    addFloater(player.x, player.y - 22, '+SZYBKOŚĆ STRZAŁU', '#ffaa33');
  } else if (loot === 'event_lich') {
    if (addToHotbar('event_lich', 1)) addFloater(player.x, player.y - 28, '☠ LASKA LICHBRINGERA → hotbar!', '#bb55ff');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_demon') {
    if (addToHotbar('event_demon', 1)) addFloater(player.x, player.y - 28, 'FIRE BLADE → hotbar!', '#ff4422');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_titan') {
    if (addToHotbar('event_titan', 1)) addFloater(player.x, player.y - 28, '⚡ PIĘŚĆ TYTANA → hotbar!', '#ddaa44');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_spider') {
    if (addToHotbar('event_spider', 1)) addFloater(player.x, player.y - 28, '🕷 KŁY PAJĄCZYCY → hotbar!', '#44cc22');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_ice') {
    if (addToHotbar('event_ice', 1)) addFloater(player.x, player.y - 28, 'MROCZNY MRÓZ → hotbar!', '#8ad8ff');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_necro') {
    if (addToHotbar('event_necro', 1)) addFloater(player.x, player.y - 28, 'KOSTUR CIENIA → hotbar!', '#9933aa');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_wraith') {
    if (addToHotbar('event_wraith', 1)) addFloater(player.x, player.y - 28, 'OSTRZE PRÓŻNI → hotbar!', '#6040ff');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  } else if (loot === 'event_drake') {
    if (addToHotbar('event_drake', 1)) addFloater(player.x, player.y - 28, 'BERŁO BURZY → hotbar!', '#ffe44a');
    else addFloater(player.x, player.y - 22, 'HOTBAR PEŁNY!', '#ff4060');
  }
}

// ---------- Spawning ----------
function spawnEnemyAt(type, x, y) {
  if (type === 'bat') {
    state.enemies.push({
      type, x, y, w: 16, h: 12,
      hp: 24, maxHp: 24, speed: 120, dmg: 6,
      hitFlash: 0, bob: Math.random() * TAU,
    });
  } else if (type === 'skeleton') {
    state.enemies.push({
      type, x, y, w: 18, h: 24,
      hp: 46, maxHp: 46, speed: 72, dmg: 9,
      hitFlash: 0, fireCd: rand(1.0, 2.0), walkBob: 0,
    });
  } else if (type === 'orc') {
    state.enemies.push({
      type, x, y, w: 24, h: 30,
      hp: 110, maxHp: 110, speed: 95, dmg: 16,
      hitFlash: 0, walkBob: 0, atkCd: 0, chargeCd: rand(4, 7), chargeVx: 0, chargeVy: 0, chargeTimer: 0,
    });
  } else if (type === 'wolf') {
    state.enemies.push({
      type, x, y, w: 16, h: 18,
      hp: 45, maxHp: 45, speed: 200, dmg: 9,
      hitFlash: 0, walkBob: 0, atkCd: 0,
    });
  } else if (type === 'troll') {
    state.enemies.push({
      type, x, y, w: 28, h: 34,
      hp: 260, maxHp: 260, speed: 52, dmg: 22,
      hitFlash: 0, walkBob: 0, atkCd: 0, stompCd: rand(4, 6), hpRegen: 5,
    });
  } else if (type === 'golem') {
    state.enemies.push({
      type, x, y, w: 32, h: 38,
      hp: 340, maxHp: 340, speed: 36, dmg: 24,
      hitFlash: 0, walkBob: 0, atkCd: 0, fireCd: rand(2, 4),
    });
  } else if (type === 'sheep') {
    state.enemies.push({
      type, x, y, w: 18, h: 13, hp: 22, maxHp: 22, speed: 68, dmg: 0,
      passive: true, hitFlash: 0, walkBob: 0,
      wanderAngle: Math.random() * TAU, wanderTimer: rand(1, 4),
    });
  } else if (type === 'pig') {
    state.enemies.push({
      type, x, y, w: 20, h: 14, hp: 32, maxHp: 32, speed: 50, dmg: 0,
      passive: true, hitFlash: 0, walkBob: 0,
      wanderAngle: Math.random() * TAU, wanderTimer: rand(1, 4),
    });
  }
}

function spawnRandomEnemyNearPlayer() {
  const ang = Math.random() * TAU;
  // Minecraft-like: spawny dalej od gracza, w ciemności
  const dist = rand(580, 920);
  const x = clamp(player.x + Math.cos(ang) * dist, 30, WORLD_W - 30);
  const y = clamp(player.y + Math.sin(ang) * dist, 30, WORLD_H - 30);
  const t = state.time;
  const roll = Math.random();
  let type;
  // Stopniowe odblokowywanie typów jak w Minecraft
  if (t < 40) {
    type = roll < 0.55 ? 'bat' : (roll < 0.85 ? 'skeleton' : 'wolf');
  } else if (t < 90) {
    type = roll < 0.25 ? 'bat' : (roll < 0.55 ? 'skeleton' : (roll < 0.80 ? 'orc' : 'wolf'));
  } else if (t < 160) {
    type = roll < 0.15 ? 'bat' : (roll < 0.38 ? 'skeleton' : (roll < 0.58 ? 'orc' : (roll < 0.78 ? 'wolf' : 'troll')));
  } else {
    type = roll < 0.08 ? 'bat' : (roll < 0.24 ? 'skeleton' : (roll < 0.42 ? 'orc' : (roll < 0.58 ? 'wolf' : (roll < 0.78 ? 'troll' : 'golem'))));
  }
  spawnEnemyAt(type, x, y);
}

function spawnBoss(atX, atY, forcedBossId, arenaKey) {
  if (state.bossActive) return;
  if (state.enemies.some(e => e.type === 'boss')) return;
  const idx = state.bossesDefeated % BOSS_TYPES.length;
  const loop = Math.floor(state.bossesDefeated / BOSS_TYPES.length);
  const cfg = forcedBossId ? (BOSS_TYPES.find(b => b.id === forcedBossId) || BOSS_TYPES[idx]) : BOSS_TYPES[idx];
  const hpScale = forcedBossId ? (1 + loop * 0.3) : (1 + loop * 0.5);
  const dmgScale = forcedBossId ? (1 + loop * 0.15) : (1 + loop * 0.2);

  const displayName = (loop > 0 && !forcedBossId) ? `${cfg.name} (${loop + 1}×)` : cfg.name;
  document.getElementById('bossName').textContent = `BOSS — ${displayName}`;

  const _bossAng = Math.random() * TAU;
  const _bossDist = rand(380, 560);
  const _bossX = clamp(player.x + Math.cos(_bossAng) * _bossDist, 150, WORLD_W - 150);
  const _bossY = clamp(player.y + Math.sin(_bossAng) * _bossDist, 150, WORLD_H - 150);

  state.bossActive = true;
  state.boss = {
    type: 'boss',
    subtype: cfg.id,
    name: displayName,
    x: (atX !== undefined) ? atX : _bossX,
    y: (atY !== undefined) ? atY : _bossY,
    w: cfg.w, h: cfg.h,
    hp: Math.round(cfg.hp * hpScale),
    maxHp: Math.round(cfg.hp * hpScale),
    dmg: Math.round(cfg.dmg * dmgScale),
    speed: cfg.speed,
    hitFlash: 0,
    phaseTimer: 0,
    attackCd: 2,
    attackPattern: 0,
    bob: 0,
    teleportFlash: 0,
    chargeTimer: 0,
    chargeVx: 0, chargeVy: 0,
    arenaKey: arenaKey || null,
  };
  state.enemies.push(state.boss);
  addFloater(player.x, player.y - 30, `${displayName.toUpperCase()} NADCHODZI`, '#ff8aa8');
  screenShake(8);
}

// ============================================================
// WORLD SAVE / LOAD
// ============================================================
function saveWorld() {
  if (!state.running) return;
  try {
    const data = {
      v: 2,
      classId: player.classId,
      x: player.x, y: player.y,
      hp: player.hp, mp: player.mp,
      hpMax: player.hpMax, mpMax: player.mpMax,
      speed: player.speed,
      dmgBonus: player.dmgBonus,
      pierceBonus: player.pierceBonus,
      healBonus: player.healBonus,
      armorBonus: player.armorBonus || 0,
      equipHpRegen: player.equipHpRegen,
      weaponLevel: player.weaponLevel,
      equip: player.equip,
      hotbar: player.hotbar,
      invGrid: player.invGrid,
      resources: state.resources,
      money: state.money,
      kills: state.kills,
      score: state.score,
      time: state.time,
      dayTime: state.dayTime,
      craftingLevel: state.craftingLevel,
      buildings: state.buildings.map(b => ({ type: b.type, x: b.x, y: b.y })),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    refreshSaveButtons();
  } catch(e) { console.warn('Błąd zapisu:', e); }
}

function loadWorldData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
function deleteSave() { localStorage.removeItem(SAVE_KEY); refreshSaveButtons(); }

function refreshSaveButtons() {
  const cb = document.getElementById('continueBtn');
  const db = document.getElementById('deleteSaveBtn');
  const has = hasSave();
  if (cb) cb.style.display = has ? '' : 'none';
  if (db) db.style.display = has ? '' : 'none';
}

function continueGame() {
  const data = loadWorldData();
  if (!data) return;
  startGame(data.classId);
  // Przywróć zapisany stan
  player.x = data.x || player.x;
  player.y = data.y || player.y;
  player.hp       = data.hp       ?? player.hp;
  player.hpMax    = data.hpMax    ?? player.hpMax;
  player.mp       = data.mp       ?? player.mp;
  player.mpMax    = data.mpMax    ?? player.mpMax;
  player.speed    = data.speed    ?? player.speed;
  player.dmgBonus     = data.dmgBonus     || 0;
  player.pierceBonus  = data.pierceBonus  || 0;
  player.healBonus    = data.healBonus    || 0;
  player.armorBonus   = data.armorBonus   || 0;
  player.equipHpRegen = data.equipHpRegen || 0;
  player.weaponLevel  = data.weaponLevel  || 1;
  player.equip    = data.equip    || { weapon:null, armor:null, boots:null, helm:null };
  player.hotbar   = data.hotbar   || Array(9).fill(null);
  player.invGrid  = data.invGrid  || Array(27).fill(null);
  // Migracja starych zapisów: jeśli brak invGrid ale są stare zasoby — przenieś do inwentarza
  if (!data.invGrid && data.resources) {
    const r = data.resources;
    if ((r.wood  || 0) > 0) addToInvGrid('wood',  r.wood);
    if ((r.stone || 0) > 0) addToInvGrid('stone', r.stone);
    if ((r.bone  || 0) > 0) addToInvGrid('bone',  r.bone);
  }
  syncResources();  // state.resources jest teraz obliczane z invGrid
  state.money     = data.money    || 0;
  state.kills     = data.kills    || 0;
  state.score     = data.score    || 0;
  state.time      = data.time     || 0;
  state.dayTime   = data.dayTime  || 0.18;
  state.craftingLevel = data.craftingLevel || 1;
  // Odbuduj budynki
  if (data.buildings && data.buildings.length) {
    for (const b of data.buildings) {
      if (!state.buildings.find(ex => ex.type === b.type && Math.abs(ex.x-b.x)<4 && Math.abs(ex.y-b.y)<4)) {
        const def = BUILDINGS.find(bd => bd.type === b.type);
        if (def) state.buildings.push({ ...def, x: b.x, y: b.y });
      }
    }
  }
  // Wygeneruj chunki wokół przywróconej pozycji (nie wokół domyślnego spawnu 500000,500000)
  generateDecor();
  // Natychmiast snap kamery — bez lerp opóźnienia
  camera.x = player.x - SW / 2;
  camera.y = player.y - SH / 2;
}

// Auto-save co 30s
setInterval(() => { if (state.running && !state.paused) saveWorld(); }, 30000);

// ---------- Game flow ----------
function startGame(classId) {
  const cls = CLASSES[classId] || CLASSES.mage;
  overlay.classList.add('hidden');
  endOverlay.classList.add('hidden');
  // bossBarWrap rysowany na canvasie — brak HTML show/hide

  player.classId = classId;
  player.baseClass = cls.base || classId;
  player.hp = player.hpMax = cls.hp;
  player.mp = player.mpMax = cls.mp;
  player.speed = cls.speed;
  player.fireRate = cls.fireRate;
  WORLD_W = 20000;
  WORLD_H = 20000;
  player.x = WORLD_W / 2;
  player.y = WORLD_H / 2;
  player.fireCooldown = 0;
  player.dashCooldown = 0;
  player.dashTime = 0;
  player.invuln = 0;
  player.skillActive = false;
  player.skillTickAcc = 0;
  player.dmgBonus = cls.startDmg || 0;
  player.pierceBonus = cls.startPierce || 0;
  player.healBonus = cls.startHeal || 0;
  player.weaponLevel = 1;
  player.armorBonus = 0;
  player.hotbarWeaponCd = 0;
  player.equip = { weapon: null, armor: null, boots: null, helm: null };
  player.equipHpRegen = 0;
  player.hotbar  = Array(9).fill(null);
  player.hotbar[0] = { kind: 'event_drake', count: 1 };
  player.hotbarSel = 0;
  player.invGrid = Array(27).fill(null);
  player.skillCds = [0, 0, 0, 0, 0];
  player._speedBoosts = [];
  player._eagleEye = 0;
  player._thunderAcc = 0;
  player._shadowAcc = 0;
  player._gravediggerAcc = 0;
  player._pyroAcc = 0;
  player._hunterTrapCd = 0;
  player._shadowStepCd = 0;
  player._clericHealTimer = 0;
  player._clericShotCount = 0;
  state.chests.length = 0;
  state.buildings.length = 0;
  state.resourceNodes.length = 0;
  state.resources.wood = 0;
  state.resources.stone = 0;
  state.resources.bone = 0;
  state.buildMode = false;
  state.craftingOpen = false;
  state.craftingSelected = 0;
  state.craftingLevel = 1;
  state.furnaceOpen = false;
  state.furnaceSelected = 0;
  state.equipOpen = false;
  state.equipSlotSel = 0;
  state.equipHotbarCursor = 0;
  state.inventoryOpen = false;
  state.dayTime = 0.18;
  state._wasNight = false;
  state.inDungeon = false;
  state.dungeonTiles = null;
  state.dungeonLevel = 0;
  state.overworldX = 0;
  state.overworldY = 0;
  state.dungeonExitPos = null;
  state.dungeonBossKilled = false;
  state._overworldDecor = null;
  state._overworldChests = null;
  state._overworldResourceNodes = null;
  state._overworldBuildings = null;
  // WORLD_W/H już ustawione na 20000 wcześniej — nie resetujemy

  state.running = true;
  state.time = 0;
  state.spawnTimer = 0;
  state.nextBossTimer = 70;
  state.bossesDefeated = 0;
  state.bossActive = false;
  state.boss = null;
  state.clearedArenas = new Set();
  state.score = 0;
  state.kills = 0;
  state.money = 0; // in-game earned this run; saved to localStorage on death
  state.particles.length = 0;
  state.projectiles.length = 0;
  state.hazards.length = 0;
  state.enemies.length = 0;
  state.pickups.length = 0;
  state.floaters.length = 0;

  generateDecor();

  // Spawn passive animals
  for (let i = 0; i < 65; i++) {
    const ax = rand(150, WORLD_W - 150), ay = rand(150, WORLD_H - 150);
    if (getBiome(ax, ay) !== 5) spawnEnemyAt(Math.random() < 0.55 ? 'sheep' : 'pig', ax, ay);
  }

  // Camera snaps to player
  camera.x = player.x - SW / 2;
  camera.y = player.y - SH / 2;

  // Upewnij się że gra nie jest zapauzowana + odbierz focus od przycisków menu
  state.paused = false;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  canvas.focus();
}

function endGame(victory) {
  if (!victory) deleteSave(); // przy śmierci usuń zapis
  state.running = false;
  save.money = save.money + state.money;
  endTitle.textContent = victory ? 'ZWYCIĘSTWO!' : 'PRZEGRANA';
  endText.textContent = `Czas: ${Math.floor(state.time)}s · Wrogów: ${state.kills} · Bossów: ${state.bossesDefeated} · Punkty: ${state.score} · Zarobek: $${state.money}`;
  endOverlay.classList.remove('hidden');
  refreshClassCards();
}

// ============================================================
//   UPDATE
// ============================================================

function update(dt) {
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 4);

  if (!state.running || state.paused) return;

  state.time += dt;
  updateDayNight(dt);
  updateMouseWorld();
  updateChunks();
  updateSkillCooldowns(dt);
  updatePlayer(dt);
  updateProjectiles(dt);
  updateHazards(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateFloaters(dt);
  updateSpawns(dt);
  updateBossArenas(dt);
  updateChests(dt);
  updateBuildings(dt);
  updateResourceNodes(dt);
  updateCamera(dt);
  updateHud();
}

function updateDayNight(dt) {
  state.dayTime = (state.dayTime + dt / DAY_CYCLE) % 1;
}

function updateBuildings(dt) {
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const b = state.buildings[i];
    if (b.type === 'campfire') {
      const dx = player.x - b.x, dy = player.y - b.y;
      if (dx*dx + dy*dy < 90*90) player.hp = Math.min(player.hpMax, player.hp + 1.2 * dt);
    } else if (b.type === 'tower') {
      b.fireCd -= dt;
      if (b.fireCd <= 0) {
        let nearest = null, nearestD2 = 280*280;
        for (const e of state.enemies) {
          const dx = e.x - b.x, dy = e.y - b.y, d2 = dx*dx + dy*dy;
          if (d2 < nearestD2) { nearest = e; nearestD2 = d2; }
        }
        if (nearest) {
          const ang = Math.atan2(nearest.y - b.y, nearest.x - b.x);
          state.projectiles.push({ x: b.x, y: b.y - 20, vx: Math.cos(ang)*580, vy: Math.sin(ang)*580, r: 4, dmg: 24, life: 0.55, kind: 'arrow', pierce: 0, angle: ang });
          addParticles(b.x, b.y - 20, '#e8e0c0', 3, 80, 0.2);
          b.fireCd = 1.4;
        } else { b.fireCd = 0.3; }
      }
    } else if (b.type === 'wall') {
      const whx = b.rotated ? 14 : 22, why = b.rotated ? 22 : 14;
      for (const e of state.enemies) {
        const dx = e.x - b.x, dy = e.y - b.y;
        if (Math.abs(dx) < whx && Math.abs(dy) < why) {
          const push = 1.2;
          e.x += dx > 0 ? push : -push;
          e.y += dy > 0 ? push : -push;
          b.hp -= e.dmg * dt * 0.25;
        }
      }
      if (b.hp <= 0) { addParticles(b.x, b.y, '#9090a0', 16, 100, 0.4); state.buildings.splice(i, 1); }
    } else if (b.type === 'door') {
      const whx = b.rotated ? 6 : 12, why = b.rotated ? 12 : 6;
      for (const e of state.enemies) {
        const dx = e.x - b.x, dy = e.y - b.y;
        if (Math.abs(dx) < whx && Math.abs(dy) < why) {
          b.hp -= e.dmg * dt * 0.5;
        }
      }
      if (b.hp <= 0) { addParticles(b.x, b.y, '#6a3d1a', 14, 90, 0.4); state.buildings.splice(i, 1); }
    } else if (b.type === 'barricade') {
      for (const e of state.enemies) {
        const dx = e.x - b.x, dy = e.y - b.y;
        if (Math.abs(dx) < 20 && Math.abs(dy) < 9) {
          b.hp -= e.dmg * dt * 0.2;
        }
      }
      if (b.hp <= 0) { addParticles(b.x, b.y, '#8a6030', 18, 110, 0.5); state.buildings.splice(i, 1); }
    } else if (b.type === 'spawner') {
      b.spawnCd = (b.spawnCd || 0) - dt;
      if (b.spawnCd <= 0) {
        b.spawnCd = 10 + Math.random() * 8;
        const hostile = state.enemies.filter(e => !e.passive).length;
        if (hostile < 35) {
          const types = ['bat', 'skeleton', 'orc', 'wolf'];
          const type = types[Math.floor(Math.random() * types.length)];
          const ang = Math.random() * TAU;
          spawnEnemyAt(type, b.x + Math.cos(ang) * 22, b.y + Math.sin(ang) * 22);
          addParticles(b.x, b.y, '#ff4060', 10, 100, 0.4);
          addFloater(b.x, b.y - 20, type.toUpperCase() + '!', '#ff8855');
        }
      }
    }
  }
}

function updateResourceNodes(dt) {
  for (const n of state.resourceNodes) {
    if (n.depleted) { n.respawnTimer -= dt; if (n.respawnTimer <= 0) n.depleted = false; }
  }
}

function updateCamera(dt) {
  // Smooth follow
  const targetX = player.x - SW / 2;
  const targetY = player.y - SH / 2;
  camera.x += (targetX - camera.x) * Math.min(1, dt * 8);
  camera.y += (targetY - camera.y) * Math.min(1, dt * 8);
  // W lochu twarda granica; w otwartym świecie pozwalamy na swobodny ruch
  if (state.inDungeon) {
    camera.x = clamp(camera.x, 0, WORLD_W - SW);
    camera.y = clamp(camera.y, 0, WORLD_H - SH);
  }
  // Overworld: brak klampowania — świat jest faktycznie nieskończony
}

function updatePlayer(dt) {
  if (state.craftingOpen || state.furnaceOpen || state.equipOpen) return;
  let mx = 0, my = 0;
  if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) my += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }

  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (player.dashTime > 0) {
    player.dashTime -= dt;
    player.x += player.dashVx * dt;
    player.y += player.dashVy * dt;
    addParticles(player.x, player.y + 8, '#8ad8ff', 1, 30, 0.3);
  } else {
    player.x += mx * player.speed * dt;
    player.y += my * player.speed * dt;
    if (keys['KeyQ'] && player.dashCooldown <= 0 && (mx !== 0 || my !== 0)) {
      player.dashTime = 0.18;
      player.dashCooldown = 0.9;
      player.dashVx = mx * 520;
      player.dashVy = my * 520;
      player.invuln = Math.max(player.invuln, 0.22);
      addParticles(player.x, player.y, '#8ad8ff', 12, 140, 0.4);
    }
  }

  if (state.inDungeon) {
    player.x = clamp(player.x, 12, WORLD_W - 12);
    player.y = clamp(player.y, 12, WORLD_H - 12);
  } else {
    // Overworld: bardzo luźna granica (0..999,940) — praktycznie nieskończona
    player.x = clamp(player.x, 0, 999940);
    player.y = clamp(player.y, 0, 999940);
  }
  pushOutOfWalls(player, false);

  player.facing = (mouseWorld.x >= player.x) ? 1 : -1;
  if (len > 0 || player.dashTime > 0) player.walkBob += dt * 14;

  player.mp = Math.min(player.mpMax, player.mp + player.manaRegen * dt);
  if (player.equipHpRegen > 0) player.hp = Math.min(player.hpMax, player.hp + player.equipHpRegen * dt);
  if (player.invuln > 0) player.invuln -= dt;
  // Kapłan — pasywne leczenie co 5s
  if (player.baseClass === 'cleric') {
    player._clericHealTimer = (player._clericHealTimer || 0) + dt;
    if (player._clericHealTimer >= 5) {
      player._clericHealTimer = 0;
      const ha = 8 + player.healBonus;
      player.hp = Math.min(player.hpMax, player.hp + ha);
      addFloater(player.x, player.y - 22, `+${ha} HP (kapłan)`, '#ffffaa');
      addParticles(player.x, player.y, '#ffffaa', 12, 90, 0.45);
    }
  }

  // Skill (Space) — class-specific
  updateSkill(dt);

  // Basic attack (LPM) — hotbar weapon override OR class attack
  if (player._meleeSwingTimer > 0) player._meleeSwingTimer -= dt;
  player.fireCooldown -= dt;
  player.hotbarWeaponCd = Math.max(0, player.hotbarWeaponCd - dt);
  player._eventRMBCd = Math.max(0, player._eventRMBCd - dt);
  if (mouseDown) {
    const hbSlot = player.hotbar[player.hotbarSel];
    const hbWeap = hbSlot ? HOTBAR_WEAPONS[hbSlot.kind] : null;
    if (hbWeap) {
      if (player.hotbarWeaponCd <= 0) {
        fireHotbarWeapon(hbWeap);
        player.hotbarWeaponCd = hbWeap.cd;
      }
    } else if (player.fireCooldown <= 0) {
      fireBasic();
      player.fireCooldown = player.fireRate;
    }
  }
  // PPM — moc eventowej broni
  if (player._rmbPressed) {
    player._rmbPressed = false;
    const hbSlot = player.hotbar[player.hotbarSel];
    const hbWeap = hbSlot ? HOTBAR_WEAPONS[hbSlot.kind] : null;
    if (hbWeap && hbWeap.event && player._eventRMBCd <= 0) {
      const cd = fireEventRMB(hbSlot.kind);
      if (cd > 0) player._eventRMBCd = cd;
    }
  }
}

function doEquipMelee(wpn) {
  const ang = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
  const px = player.x, py = player.y;
  const range = 78, arc = 0.92;
  // Damage = sword base (40) + extra bonuses (player.dmgBonus already includes wpn.dmgBonus so subtract it)
  const extraBonus = player.dmgBonus - (wpn.dmgBonus || 0);
  const baseDmg = 40;
  let hit = 0;
  for (const e of state.enemies) {
    if (e.passive) continue;
    const dx = e.x - px, dy = e.y - py;
    if (Math.hypot(dx, dy) > range) continue;
    const eAng = Math.atan2(dy, dx);
    let diff = eAng - ang;
    while (diff >  Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    if (Math.abs(diff) > arc) continue;
    const dmg = baseDmg + extraBonus;
    e.hp -= dmg;
    addFloater(e.x, e.y - 14, `-${dmg}`, '#c0d8ff');
    addParticles(e.x, e.y, '#c0d8ff', 6, 100, 0.3);
    hit++;
  }
  addParticles(px + Math.cos(ang) * 52, py + Math.sin(ang) * 52, '#c0d8ff', 10, 130, 0.25);
  if (hit > 0) screenShake(hit > 1 ? 5 : 3);
  player._meleeSwingTimer = 0.28;
  player._meleeSwingAng = ang;
}

const EVENT_RMB_CDS = {
  event_lich:   12,
  event_demon:  10,
  event_titan:  14,
  event_spider: 11,
  event_ice:    13,
  event_necro:  12,
  event_wraith: 9,
  event_drake:  10,
};

function fireEventRMB(kind) {
  const px = player.x, py = player.y;
  const ang = Math.atan2(mouseWorld.y - py, mouseWorld.x - px);
  const dmgB = player.dmgBonus || 0;

  if (kind === 'event_lich') {
    // Soul Nova — 14 dusz w okrąg, każda leczy przy trafieniu
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*320, vy: Math.sin(a)*320,
        r: 10, dmg: 110 + dmgB, life: 1.4, kind: 'soul', pierce: 2, angle: a, healOnHit: 12 });
    }
    addFloater('SOUL NOVA!', px, py - 30, '#bb55ff');

  } else if (kind === 'event_demon') {
    // Inferno Rush — 7 kul ognia w wachlarz ku kursorowi
    for (let w = -3; w <= 3; w++) {
      const a = ang + w * 0.18;
      state.projectiles.push({ x: px + Math.cos(ang)*20, y: py + Math.sin(ang)*20,
        vx: Math.cos(a)*560, vy: Math.sin(a)*560,
        r: 16, dmg: 90 + dmgB, life: 1.1, kind: 'firewave', pierce: 3, angle: a });
    }
    addFloater('INFERNO RUSH!', px, py - 30, '#ff4422');

  } else if (kind === 'event_titan') {
    // Seismic Slam — 16 głazów we wszystkich kierunkach
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*260, vy: Math.sin(a)*260,
        r: 18, dmg: 220 + dmgB, life: 1.6, kind: 'rock', pierce: 2, angle: a });
    }
    addFloater('SEISMIC SLAM!', px, py - 30, '#ddaa44');

  } else if (kind === 'event_spider') {
    // Venom Burst — 12 jadów w okrąg
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*400, vy: Math.sin(a)*400,
        r: 9, dmg: 70 + dmgB, life: 1.2, kind: 'venom', pierce: 3, angle: a });
    }
    addFloater('VENOM BURST!', px, py - 30, '#44cc22');

  } else if (kind === 'event_ice') {
    // Blizzard — 20 odłamków lodu w losowych kierunkach
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * TAU;
      const spd = 300 + Math.random() * 300;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd,
        r: 8, dmg: 65 + dmgB, life: 1.0 + Math.random() * 0.6, kind: 'frost', pierce: 2, angle: a, healOnHit: 8 });
    }
    addFloater('BLIZZARD!', px, py - 30, '#8ad8ff');

  } else if (kind === 'event_necro') {
    // Dark Wave — 16 kości na zewnątrz
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*370, vy: Math.sin(a)*370,
        r: 10, dmg: 100 + dmgB, life: 1.3, kind: 'bone', pierce: 3, angle: a });
    }
    addFloater('DARK WAVE!', px, py - 30, '#9933aa');

  } else if (kind === 'event_wraith') {
    // Void Blink — teleport do kursora + pierścień 12 ostrzy próżni
    const tx = clamp(mouseWorld.x, 80, WORLD_W - 80);
    const ty = clamp(mouseWorld.y, 80, WORLD_H - 80);
    player.x = tx; player.y = ty;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: tx, y: ty, vx: Math.cos(a)*340, vy: Math.sin(a)*340,
        r: 11, dmg: 140 + dmgB, life: 1.1, kind: 'shadowblade', pierce: 2, angle: a });
    }
    addFloater('VOID BLINK!', tx, ty - 30, '#6040ff');

  } else if (kind === 'event_drake') {
    // Tarcza Burzy — 16 piorunów we wszystkich kierunkach + 3 celowane w najbliższego wroga
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.projectiles.push({ x: px, y: py, vx: Math.cos(a)*620, vy: Math.sin(a)*620,
        r: 8, dmg: 95 + dmgB, life: 1.1, kind: 'lightning', pierce: 3, angle: a });
    }
    // 3 pioruny w najbliższego wroga
    const nearest = state.enemies.filter(e => !e.passive).sort((a, b) =>
      (Math.hypot(a.x-px, a.y-py) - Math.hypot(b.x-px, b.y-py)))[0];
    if (nearest) {
      for (let i = -1; i <= 1; i++) {
        const ta = Math.atan2(nearest.y - py, nearest.x - px) + i * 0.15;
        state.projectiles.push({ x: px, y: py, vx: Math.cos(ta)*820, vy: Math.sin(ta)*820,
          r: 9, dmg: 130 + dmgB, life: 0.9, kind: 'lightning', pierce: 5, angle: ta });
      }
    }
    addFloater(px, py - 30, 'TARCZA BURZY!', '#ffe44a');
    addParticles(px, py, '#ffe44a', 30, 280, 0.5);
    screenShake(8);
  }

  return EVENT_RMB_CDS[kind] || 12;
}

function fireHotbarWeapon(wDef) {
  const ang = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
  const px = player.x, py = player.y;
  if (wDef.type === 'melee') {
    // Melee swing — uderza wszystkich wrogów w zasięgu w łuku
    let hit = 0;
    for (const e of state.enemies) {
      const dx = e.x - px, dy = e.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist > wDef.range) continue;
      // Sprawdź kąt ataku
      const eAng = Math.atan2(dy, dx);
      let diff = eAng - ang;
      while (diff >  Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) > wDef.arc) continue;
      // Oblicz obrażenia
      let dmg = wDef.dmg + (player.dmgBonus || 0);
      const isCrit = wDef.crit && Math.random() < wDef.crit;
      if (isCrit) { dmg = Math.floor(dmg * 2.2); addFloater(e.x, e.y - 18, 'KRIT!', '#ffd700'); }
      if (wDef.fire)  addParticles(e.x, e.y, '#ff6633', 8, 120, 0.35);
      if (wDef.earth) addParticles(e.x, e.y, '#cc9944', 12, 140, 0.4);
      if (wDef.voidBlade) addParticles(e.x, e.y, '#6040ff', 12, 150, 0.4);
      e.hp -= dmg;
      addFloater(e.x, e.y - 14, `-${dmg}`, isCrit ? '#ffd700' : wDef.color);
      addParticles(e.x, e.y, wDef.color, 6, 100, 0.3);
      hit++;
    }
    // Efekt zamachu
    addParticles(px + Math.cos(ang)*50, py + Math.sin(ang)*50, wDef.color, 10, 130, 0.25);
    // EFEKTY EVENTOWE — melee
    if (wDef.event && wDef.fire && wDef.fireWave) {
      // Fire Blade: fala ognia leci do przodu od gracza
      for (let w = -1; w <= 1; w++) {
        const wAng = ang + w * 0.08;
        state.projectiles.push({
          x: px + Math.cos(ang) * 22, y: py + Math.sin(ang) * 22,
          vx: Math.cos(wAng) * 480, vy: Math.sin(wAng) * 480,
          r: 18, dmg: 38 + (player.dmgBonus || 0),
          life: 0.95, kind: 'firewave', pierce: 4, angle: wAng,
        });
      }
      addParticles(px + Math.cos(ang) * 46, py + Math.sin(ang) * 46, '#ff4422', 24, 280, 0.55);
      screenShake(7);
    } else if (wDef.event && wDef.earth) {
      // Pięść Tytana: fala uderzeniowa — obrażenia i odpychanie wszystkich wrogów w promieniu 220px
      const waveR = 220;
      for (const e of state.enemies) {
        if (e.passive) continue;
        const edx = e.x - px, edy = e.y - py;
        const ed = Math.hypot(edx, edy) || 1;
        if (ed < waveR) {
          const pushMul = (1 - ed / waveR) * 260;
          e.x += (edx / ed) * pushMul;
          e.y += (edy / ed) * pushMul;
          const waveDmg = Math.round(80 * (1 - ed / waveR));
          if (waveDmg > 0) { e.hp -= waveDmg; e.hitFlash = 0.15; addFloater(e.x, e.y - 14, `-${waveDmg}`, '#ddaa44'); }
        }
      }
      addParticles(px, py, '#ddaa44', 32, 380, 0.6);
      screenShake(18);
    } else if (wDef.voidBlade && hit > 0) {
      // Ostrze Próżni: po trafieniu wybucha void ring
      const n = 10;
      for (let vi = 0; vi < n; vi++) {
        const va = (vi / n) * TAU;
        state.projectiles.push({ x: px, y: py, vx: Math.cos(va)*280, vy: Math.sin(va)*280, r: 8, dmg: 28 + (player.dmgBonus||0), life: 0.8, kind: 'shadowblade', pierce: 1, angle: va });
      }
      addParticles(px, py, '#6040ff', 28, 300, 0.6);
      screenShake(12);
    } else if (wDef.earth && hit > 0) screenShake(12);
    if (!wDef.event && hit > 0) screenShake(hit > 1 ? 5 : 3);
    else if (hit > 0 && !wDef.earth && !wDef.voidBlade) screenShake(hit > 1 ? 5 : 3);
    player._meleeSwingTimer = wDef.cd * 0.9;
    player._meleeSwingAng   = ang;
  } else {
    // Ranged — strzela pocisk
    const ox = Math.cos(ang) * 14, oy = Math.sin(ang) * 14 - 4;
    const projR = wDef.kind === 'fire' ? 7 : wDef.kind === 'soul' ? 10 : wDef.kind === 'venom' ? 7 : wDef.kind === 'frost' ? 8 : wDef.kind === 'lightning' ? 5 : 6;
    state.projectiles.push({
      x: px+ox, y: py+oy,
      vx: Math.cos(ang)*wDef.spd, vy: Math.sin(ang)*wDef.spd,
      r: projR,
      dmg: wDef.dmg + (player.dmgBonus || 0),
      life: 1.6,
      kind: wDef.kind,
      pierce: (wDef.pierce || 0) + (player.pierceBonus || 0),
      angle: ang,
      soulDrain:   wDef.event && wDef.kind === 'soul',
      venomPoison: wDef.event && wDef.kind === 'venom',
      healOnHit:   wDef.healOnHitBonus ? (wDef.healOnHitBonus + (player.healBonus||0)) : undefined,
    });
    addParticles(px+ox, py+oy, wDef.color, 4, 80, 0.2);
  }
}

function fireBasic() {
  // Melee weapon equipped → swing instead of class ranged attack
  const equipWpn = player.equip && player.equip.weapon;
  if (equipWpn && equipWpn.melee) { doEquipMelee(equipWpn); return; }

  const ang = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
  const px = player.x, py = player.y;
  const ox = Math.cos(ang) * 14, oy = Math.sin(ang) * 14 - 4;
  const lv = player.weaponLevel;
  const db = player.dmgBonus;

  const cid = player.baseClass;
  if (cid === 'mage') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*520, vy: Math.sin(ang)*520, r: 6, dmg: 10+db, life: 1.4, kind: 'fire', pierce: 0 });
      addParticles(px+ox, py+oy, '#ffcc55', 4, 80, 0.25);
    } else if (lv === 2) {
      for (const s of [-1, 1]) {
        const a = ang + s * 0.13;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*500, vy: Math.sin(a)*500, r: 6, dmg: 9+db, life: 1.4, kind: 'fire', pierce: 0 });
      }
      addParticles(px+ox, py+oy, '#ffcc55', 6, 90, 0.25);
    } else {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*470, vy: Math.sin(ang)*470, r: 11, dmg: 19+db, life: 1.4, kind: 'fire', pierce: 0 });
      addParticles(px+ox, py+oy, '#ffaa33', 9, 110, 0.3);
    }
  } else if (cid === 'archer') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*720, vy: Math.sin(ang)*720, r: 4, dmg: 11+db, life: 1.0, kind: 'arrow', pierce: 1+player.pierceBonus, angle: ang });
      addParticles(px+ox, py+oy, '#e8e0c0', 2, 50, 0.18);
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*900, vy: Math.sin(ang)*900, r: 5, dmg: 19+db, life: 1.0, kind: 'arrow', pierce: 2+player.pierceBonus, angle: ang });
      addParticles(px+ox, py+oy, '#ffd66b', 4, 80, 0.2);
    } else {
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.2;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*720, vy: Math.sin(a)*720, r: 4, dmg: 13+db, life: 1.0, kind: 'arrow', pierce: 1+player.pierceBonus, angle: a });
      }
      addParticles(px+ox, py+oy, '#ffd66b', 6, 90, 0.22);
    }
  } else if (cid === 'doctor') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*460, vy: Math.sin(ang)*460, r: 5, dmg: 8+db, life: 1.6, kind: 'syringe', pierce: 0, angle: ang, healOnHit: 3+player.healBonus });
      addParticles(px+ox, py+oy, '#8ad8ff', 3, 60, 0.22);
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*460, vy: Math.sin(ang)*460, r: 5, dmg: 11+db, life: 1.8, kind: 'syringe', pierce: 2, angle: ang, healOnHit: 5+player.healBonus });
      addParticles(px+ox, py+oy, '#9bff9b', 4, 70, 0.22);
    } else {
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.18;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*460, vy: Math.sin(a)*460, r: 5, dmg: 9+db, life: 1.6, kind: 'syringe', pierce: 0, angle: a, healOnHit: 4+player.healBonus });
      }
      addParticles(px+ox, py+oy, '#9bff9b', 7, 80, 0.25);
    }
  } else if (cid === 'knight') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*420, vy: Math.sin(ang)*420, r: 10, dmg: 22+db, life: 0.20, kind: 'blade', pierce: 2, angle: ang });
      addParticles(px+ox, py+oy, '#e0e8ff', 5, 120, 0.2);
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*380, vy: Math.sin(ang)*380, r: 14, dmg: 38+db, life: 0.22, kind: 'blade', pierce: 4, angle: ang });
      addParticles(px+ox, py+oy, '#ffd66b', 7, 140, 0.22);
    } else {
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.38;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*400, vy: Math.sin(a)*400, r: 10, dmg: 22+db, life: 0.20, kind: 'blade', pierce: 2, angle: a });
      }
      addParticles(px+ox, py+oy, '#e0e8ff', 10, 160, 0.24);
    }
  } else if (cid === 'shaman') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*680, vy: Math.sin(ang)*680, r: 5, dmg: 13+db, life: 1.2, kind: 'lightning', pierce: 1, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*700, vy: Math.sin(ang)*700, r: 6, dmg: 20+db, life: 1.2, kind: 'lightning', pierce: 2, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) {
        const a = ang + s * 0.18;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*680, vy: Math.sin(a)*680, r: 5, dmg: 16+db, life: 1.2, kind: 'lightning', pierce: 1, angle: a });
      }
    }
    addParticles(px+ox, py+oy, '#8ae8ff', 5, 100, 0.2);
  } else if (cid === 'ninja') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*780, vy: Math.sin(ang)*780, r: 5, dmg: 10+db, life: 0.9, kind: 'shuriken', pierce: 0, spin: 0 });
    } else if (lv === 2) {
      for (const s of [-1, 1]) {
        const a = ang + s * 0.15;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*780, vy: Math.sin(a)*780, r: 5, dmg: 10+db, life: 0.9, kind: 'shuriken', pierce: 0, spin: 0 });
      }
    } else {
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.24;
        state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*780, vy: Math.sin(a)*780, r: 5, dmg: 10+db, life: 0.9, kind: 'shuriken', pierce: 1, spin: 0 });
      }
    }
    addParticles(px+ox, py+oy, '#c8c8d8', 3, 60, 0.15);
  } else if (cid === 'gravedigger') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*340, vy: Math.sin(ang)*340, r: 7, dmg: 14+db, life: 1.8, kind: 'bone', pierce: 2, angle: ang });
    } else if (lv === 2) {
      for (const s of [-1, 1]) { const a = ang + s * 0.15; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*340, vy: Math.sin(a)*340, r: 7, dmg: 13+db, life: 1.8, kind: 'bone', pierce: 2, angle: a }); }
    } else {
      for (let i = -1; i <= 1; i++) { const a = ang + i * 0.2; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*340, vy: Math.sin(a)*340, r: 7, dmg: 14+db, life: 1.8, kind: 'bone', pierce: 3, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#e0dcc8', 5, 80, 0.3);
  } else if (cid === 'berserker') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*380, vy: Math.sin(ang)*380, r: 13, dmg: 24+db, life: 0.18, kind: 'axe', pierce: 3, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*360, vy: Math.sin(ang)*360, r: 18, dmg: 38+db, life: 0.20, kind: 'axe', pierce: 5, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.30; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*380, vy: Math.sin(a)*380, r: 12, dmg: 22+db, life: 0.18, kind: 'axe', pierce: 3, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#ff6633', 6, 160, 0.22);
  } else if (cid === 'pyromancer') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*290, vy: Math.sin(ang)*290, r: 11, dmg: 16+db, life: 2.0, kind: 'inferno', pierce: 0, explode: true, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*270, vy: Math.sin(ang)*270, r: 14, dmg: 24+db, life: 2.2, kind: 'inferno', pierce: 0, explode: true, angle: ang });
    } else {
      for (const s of [-1, 1]) { const a = ang + s * 0.18; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*290, vy: Math.sin(a)*290, r: 11, dmg: 16+db, life: 2.0, kind: 'inferno', pierce: 0, explode: true, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#ff8822', 8, 90, 0.3);
  } else if (cid === 'cleric') {
    player._clericShotCount = ((player._clericShotCount || 0) + 1);
    const holy5 = player._clericShotCount % 5 === 0;
    if (holy5) { addFloater(player.x, player.y - 28, 'UZDROWIENIE!', '#ffffaa'); addParticles(px+ox, py+oy, '#ffffaa', 18, 150, 0.5); }
    const h1 = holy5 ? 18 + player.healBonus : 4 + player.healBonus;
    const h2 = holy5 ? 26 + player.healBonus : 7 + player.healBonus;
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*500, vy: Math.sin(ang)*500, r: holy5 ? 10 : 7, dmg: 10+db, life: 1.5, kind: 'holy', pierce: 1, healOnHit: h1, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*500, vy: Math.sin(ang)*500, r: holy5 ? 13 : 9, dmg: 14+db, life: 1.5, kind: 'holy', pierce: 2, healOnHit: h2, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*500, vy: Math.sin(a)*500, r: holy5 ? 10 : 7, dmg: 11+db, life: 1.5, kind: 'holy', pierce: 1, healOnHit: h1, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#ffffaa', 5, 90, 0.28);
  } else if (cid === 'hunter') {
    const eagleMult = player._eagleEye > 0 ? 3 : 1;
    if (eagleMult > 1) { player._eagleEye = Math.max(0, player._eagleEye - 1); addParticles(px+ox, py+oy, '#66aa22', 10, 160, 0.4); }
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*560, vy: Math.sin(ang)*560, r: 7, dmg: (13+db)*eagleMult, life: 3.0, kind: 'boomerang', pierce: 99, angle: ang, boomerang: true, distTraveled: 0, maxDist: 260, returning: false });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*560, vy: Math.sin(ang)*560, r: 9, dmg: 19+db, life: 3.0, kind: 'boomerang', pierce: 99, angle: ang, boomerang: true, distTraveled: 0, maxDist: 320, returning: false });
    } else {
      for (const s of [-1, 1]) { const a = ang + s * 0.25; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*560, vy: Math.sin(a)*560, r: 7, dmg: 13+db, life: 3.0, kind: 'boomerang', pierce: 99, angle: a, boomerang: true, distTraveled: 0, maxDist: 260, returning: false }); }
    }
    addParticles(px+ox, py+oy, '#88aa44', 4, 70, 0.22);
  } else if (cid === 'shadow') {
    if (lv === 1) {
      for (const s of [-1, 1]) { const a = ang + s * 0.25; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*480, vy: Math.sin(a)*480, r: 9, dmg: 15+db, life: 0.22, kind: 'shadowblade', pierce: 2, angle: a }); }
    } else if (lv === 2) {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*480, vy: Math.sin(a)*480, r: 10, dmg: 20+db, life: 0.22, kind: 'shadowblade', pierce: 3, angle: a }); }
    } else {
      for (let i = -2; i <= 2; i++) { const a = ang + i * 0.18; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*480, vy: Math.sin(a)*480, r: 8, dmg: 15+db, life: 0.22, kind: 'shadowblade', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#5533aa', 6, 140, 0.22);
  // ---- Legendarne ataki ----
  } else if (cid === 'crusader') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*560, vy: Math.sin(ang)*560, r: 14, dmg: 30+db, life: 0.24, kind: 'holyblade', pierce: 2, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*540, vy: Math.sin(ang)*540, r: 18, dmg: 46+db, life: 0.26, kind: 'holyblade', pierce: 4, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.30; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*540, vy: Math.sin(a)*540, r: 12, dmg: 26+db, life: 0.24, kind: 'holyblade', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#ffe8aa', 6, 120, 0.24);
  } else if (cid === 'witch') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*360, vy: Math.sin(ang)*360, r: 9, dmg: 24+db, life: 2.2, kind: 'venom', pierce: 1, angle: ang });
    } else if (lv === 2) {
      for (const s of [-1, 1]) { const a = ang + s * 0.18; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*360, vy: Math.sin(a)*360, r: 9, dmg: 22+db, life: 2.2, kind: 'venom', pierce: 1, angle: a }); }
    } else {
      for (let i = -1; i <= 1; i++) { const a = ang + i * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*360, vy: Math.sin(a)*360, r: 9, dmg: 24+db, life: 2.2, kind: 'venom', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#66cc22', 6, 75, 0.3);
  } else if (cid === 'alchemist') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*300, vy: Math.sin(ang)*300, r: 10, dmg: 20+db, life: 2.0, kind: 'inferno', pierce: 0, explode: true, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*280, vy: Math.sin(ang)*280, r: 13, dmg: 30+db, life: 2.2, kind: 'inferno', pierce: 0, explode: true, angle: ang });
    } else {
      for (const s of [-1, 1]) { const a = ang + s * 0.20; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*300, vy: Math.sin(a)*300, r: 10, dmg: 20+db, life: 2.0, kind: 'inferno', pierce: 0, explode: true, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#88cc22', 6, 85, 0.28);
  } else if (cid === 'bard') {
    if (lv === 1) {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.25; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*700, vy: Math.sin(a)*700, r: 6, dmg: 18+db, life: 1.1, kind: 'lightning', pierce: 2, angle: a }); }
    } else if (lv === 2) {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*720, vy: Math.sin(a)*720, r: 7, dmg: 26+db, life: 1.1, kind: 'lightning', pierce: 3, angle: a }); }
    } else {
      for (let i = -2; i <= 2; i++) { const a = ang + i * 0.20; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*700, vy: Math.sin(a)*700, r: 6, dmg: 18+db, life: 1.1, kind: 'lightning', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#88ddff', 6, 110, 0.22);
  // ---- Epickie ataki ----
  } else if (cid === 'necromancer') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*320, vy: Math.sin(ang)*320, r: 9, dmg: 22+db, life: 2.4, kind: 'venom', pierce: 1, angle: ang });
    } else if (lv === 2) {
      for (const s of [-1, 1]) { const a = ang + s * 0.16; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*320, vy: Math.sin(a)*320, r: 9, dmg: 20+db, life: 2.4, kind: 'venom', pierce: 1, angle: a }); }
    } else {
      for (let i = -1; i <= 1; i++) { const a = ang + i * 0.2; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*320, vy: Math.sin(a)*320, r: 9, dmg: 22+db, life: 2.4, kind: 'venom', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#44cc22', 6, 70, 0.3);
  } else if (cid === 'paladin') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*640, vy: Math.sin(ang)*640, r: 14, dmg: 32+db, life: 0.26, kind: 'holyblade', pierce: 3, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*620, vy: Math.sin(ang)*620, r: 18, dmg: 50+db, life: 0.28, kind: 'holyblade', pierce: 5, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.28; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*640, vy: Math.sin(a)*640, r: 13, dmg: 30+db, life: 0.26, kind: 'holyblade', pierce: 3, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#ffe8aa', 6, 130, 0.24);
  } else if (cid === 'druid') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*580, vy: Math.sin(ang)*580, r: 6, dmg: 20+db, life: 1.4, kind: 'thorn', pierce: 4, angle: ang });
    } else if (lv === 2) {
      for (const s of [-1, 1]) { const a = ang + s * 0.15; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*580, vy: Math.sin(a)*580, r: 6, dmg: 18+db, life: 1.4, kind: 'thorn', pierce: 4, angle: a }); }
    } else {
      for (let i = -1; i <= 1; i++) { const a = ang + i * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*580, vy: Math.sin(a)*580, r: 6, dmg: 20+db, life: 1.4, kind: 'thorn', pierce: 5, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#44aa22', 4, 65, 0.22);
  } else if (cid === 'vampire') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*380, vy: Math.sin(ang)*380, r: 7, dmg: 10+db, life: 1.6, kind: 'blood', pierce: 1, healOnHit: 2 + player.healBonus, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*360, vy: Math.sin(ang)*360, r: 9, dmg: 16+db, life: 1.7, kind: 'blood', pierce: 2, healOnHit: 4 + player.healBonus, angle: ang });
    } else {
      for (const s of [-1, 1]) { const a = ang + s * 0.2; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*380, vy: Math.sin(a)*380, r: 7, dmg: 10+db, life: 1.6, kind: 'blood', pierce: 1, healOnHit: 2 + player.healBonus, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#cc1122', 5, 70, 0.22);
  } else if (cid === 'frostmage') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*580, vy: Math.sin(ang)*580, r: 8, dmg: 20+db, life: 1.5, kind: 'frost', pierce: 2, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*560, vy: Math.sin(ang)*560, r: 11, dmg: 30+db, life: 1.6, kind: 'frost', pierce: 3, angle: ang });
    } else {
      for (const s of [-1, 1]) { const a = ang + s * 0.18; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*580, vy: Math.sin(a)*580, r: 8, dmg: 20+db, life: 1.5, kind: 'frost', pierce: 2, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#88ddff', 5, 80, 0.25);
  } else if (cid === 'stormcaller') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*750, vy: Math.sin(ang)*750, r: 6, dmg: 24+db, life: 1.3, kind: 'lightning', pierce: 4, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*780, vy: Math.sin(ang)*780, r: 8, dmg: 36+db, life: 1.3, kind: 'lightning', pierce: 5, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.16; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*750, vy: Math.sin(a)*750, r: 6, dmg: 24+db, life: 1.3, kind: 'lightning', pierce: 4, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#aaeeff', 7, 130, 0.22);
  } else if (cid === 'runeknight') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*500, vy: Math.sin(ang)*500, r: 16, dmg: 38+db, life: 0.16, kind: 'rune', pierce: 4, angle: ang });
    } else if (lv === 2) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*480, vy: Math.sin(ang)*480, r: 22, dmg: 60+db, life: 0.18, kind: 'rune', pierce: 6, angle: ang });
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.26; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*500, vy: Math.sin(a)*500, r: 14, dmg: 34+db, life: 0.16, kind: 'rune', pierce: 4, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#cc44ff', 8, 150, 0.22);
  } else if (cid === 'illusionist') {
    if (lv === 1) {
      for (const s of [-1, 1]) { const a = ang + s * 0.22; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*520, vy: Math.sin(a)*520, r: 8, dmg: 20+db, life: 0.22, kind: 'shadowblade', pierce: 3, angle: a }); }
    } else if (lv === 2) {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.20; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*540, vy: Math.sin(a)*540, r: 9, dmg: 28+db, life: 0.22, kind: 'shadowblade', pierce: 4, angle: a }); }
    } else {
      for (let i = -2; i <= 2; i++) { const a = ang + i * 0.17; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*520, vy: Math.sin(a)*520, r: 8, dmg: 20+db, life: 0.22, kind: 'shadowblade', pierce: 3, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#aa33ff', 6, 130, 0.22);
  } else if (cid === 'void') {
    if (lv === 1) {
      state.projectiles.push({ x: px+ox, y: py+oy, vx: Math.cos(ang)*580, vy: Math.sin(ang)*580, r: 10, dmg: 32+db, life: 0.30, kind: 'void', pierce: 3, angle: ang });
    } else if (lv === 2) {
      for (const s of [-1, 1]) { const a = ang + s * 0.18; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*600, vy: Math.sin(a)*600, r: 10, dmg: 38+db, life: 0.28, kind: 'void', pierce: 4, angle: a }); }
    } else {
      for (const s of [-1, 0, 1]) { const a = ang + s * 0.20; state.projectiles.push({ x: px+Math.cos(a)*14, y: py+Math.sin(a)*14-4, vx: Math.cos(a)*590, vy: Math.sin(a)*590, r: 10, dmg: 34+db, life: 0.28, kind: 'void', pierce: 4, angle: a }); }
    }
    addParticles(px+ox, py+oy, '#660088', 7, 140, 0.22);
  }
}

function updateSkill(dt) {
  const want = !!keys['Space'] && player.mp > 0 && state.running;
  if (!want) {
    player.skillActive = false;
    player.skillTickAcc = 0;
    return;
  }
  player.skillActive = true;
  const cls = CLASSES[player.classId];
  player.mp = Math.max(0, player.mp - cls.skillDrainPerSec * dt);

  const ang = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
  player.skillAngle = ang;

  const scid = player.baseClass;
  if (scid === 'mage') skillFlamethrower(dt, ang);
  else if (scid === 'archer') skillMultishot(dt, ang);
  else if (scid === 'doctor') skillHealAura(dt);
  else if (scid === 'knight') skillBattleCry(dt);
  else if (scid === 'shaman') skillThunderstorm(dt, ang);
  else if (scid === 'ninja') skillShadowBurst(dt, ang);
  else if (scid === 'gravedigger') skillGravedigger(dt);
  else if (scid === 'berserker') skillBerserkerRage(dt);
  else if (scid === 'pyromancer') skillFireRain(dt);
  else if (scid === 'cleric') skillCleric(dt);
  else if (scid === 'hunter') skillHunterTrap(dt);
  else if (scid === 'shadow') skillShadow(dt);
  else if (scid === 'crusader') skillCrusaderAura(dt);
  else if (scid === 'witch') skillWitchHex(dt, ang);
  else if (scid === 'alchemist') skillAlchemistBrew(dt);
  else if (scid === 'bard') skillBardSonic(dt, ang);
  else if (scid === 'necromancer') skillNecroChannel(dt, ang);
  else if (scid === 'paladin') skillPaladinAura(dt);
  else if (scid === 'druid') skillDruidGrowth(dt, ang);
  else if (scid === 'vampire') skillVampireDrain(dt, ang);
  else if (scid === 'frostmage') skillFrostBlast(dt, ang);
  else if (scid === 'stormcaller') skillThunderstormEpic(dt, ang);
  else if (scid === 'runeknight') skillRuneAura(dt);
  else if (scid === 'illusionist') skillIllusionMirror(dt, ang);
  else if (scid === 'void') skillVoidDrain(dt, ang);
}

function skillFlamethrower(dt, ang) {
  const ox = player.x + Math.cos(ang) * 14;
  const oy = player.y + Math.sin(ang) * 14 - 4;
  const burst = 4;
  for (let i = 0; i < burst; i++) {
    const spread = (Math.random() - 0.5) * 2 * FLAME.halfAngle;
    const a = ang + spread;
    const sp = rand(220, 360);
    const life = rand(0.25, 0.55);
    const palette = ['#fff7c8', '#ffd66b', '#ffaa33', '#ff6633', '#ff3b3b'];
    state.particles.push({
      x: ox, y: oy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life, maxLife: life,
      color: palette[Math.floor(Math.random() * palette.length)],
      size: randi(3, 6),
    });
  }
  player.skillTickAcc += dt;
  if (player.skillTickAcc >= FLAME.tickRate) {
    const dmg = Math.round((FLAME.dps + player.dmgBonus * 4) * player.skillTickAcc);
    player.skillTickAcc = 0;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    for (const e of state.enemies) {
      const dx = e.x - player.x, dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > FLAME.range + e.w / 2) continue;
      const ddx = dx / (d || 1), ddy = dy / (d || 1);
      if (ddx * cosA + ddy * sinA < Math.cos(FLAME.halfAngle)) continue;
      e.hp -= dmg;
      e.hitFlash = 0.08;
      if (Math.random() < 0.25) addFloater(e.x, e.y - e.h / 2, String(dmg), '#ff8855');
    }
  }
}

function skillMultishot(dt, ang) {
  player.skillTickAcc += dt;
  if (player.skillTickAcc >= 0.18) {
    player.skillTickAcc = 0;
    const ox = player.x + Math.cos(ang) * 14;
    const oy = player.y + Math.sin(ang) * 14 - 4;
    for (let i = -1; i <= 1; i++) {
      const a = ang + i * 0.18;
      state.projectiles.push({
        x: ox, y: oy,
        vx: Math.cos(a) * 720, vy: Math.sin(a) * 720,
        r: 4, dmg: 14, life: 1.0, kind: 'arrow', pierce: 1,
        angle: a,
      });
    }
    addParticles(ox, oy, '#e8e0c0', 3, 80, 0.2);
  }
}

function skillHealAura(dt) {
  // Heal self
  player.hp = Math.min(player.hpMax, player.hp + 9 * dt);
  // Healing pulse particles
  if (Math.random() < 0.6) {
    const a = Math.random() * TAU;
    const r = rand(20, 60);
    state.particles.push({
      x: player.x + Math.cos(a) * r,
      y: player.y + Math.sin(a) * r,
      vx: Math.cos(a) * -40, vy: Math.sin(a) * -40 - 10,
      life: 0.6, maxLife: 0.6,
      color: Math.random() < 0.5 ? '#9bff9b' : '#ffffff',
      size: randi(2, 4),
    });
  }
}

function skillBattleCry(dt) {
  player.invuln = Math.max(player.invuln, 0.35);
  const AURA_R = 85;
  const dmgPerSec = 55 + player.dmgBonus * 2;
  for (const e of state.enemies) {
    const dx = e.x - player.x, dy = e.y - player.y;
    if (dx * dx + dy * dy < AURA_R * AURA_R) {
      e.hp -= dmgPerSec * dt;
      e.hitFlash = 0.1;
    }
  }
  if (Math.random() < 0.5) {
    const a = Math.random() * TAU;
    state.particles.push({
      x: player.x + Math.cos(a) * rand(10, AURA_R),
      y: player.y + Math.sin(a) * rand(10, AURA_R),
      vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
      life: 0.35, maxLife: 0.35,
      color: Math.random() < 0.5 ? '#ffd66b' : '#ffffff',
      size: 3,
    });
  }
}

function skillThunderstorm(dt, ang) {
  player._thunderAcc = (player._thunderAcc || 0) + dt;
  if (player._thunderAcc < 0.32) return;
  player._thunderAcc = 0;
  const spread = 1.3;
  for (let i = 0; i < 5; i++) {
    const a = ang - spread / 2 + (i / 4) * spread;
    state.projectiles.push({ x: player.x + Math.cos(a)*14, y: player.y + Math.sin(a)*14 - 4, vx: Math.cos(a)*740, vy: Math.sin(a)*740, r: 5, dmg: 16 + player.dmgBonus, life: 1.3, kind: 'lightning', pierce: 1, angle: a });
  }
  addParticles(player.x, player.y, '#8ae8ff', 12, 150, 0.4);
  screenShake(2);
}

function skillShadowBurst(dt, ang) {
  player._shadowAcc = (player._shadowAcc || 0) + dt;
  if (player._shadowAcc < 0.50) return;
  player._shadowAcc = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*700, vy: Math.sin(a)*700, r: 5, dmg: 12 + player.dmgBonus, life: 0.9, kind: 'shuriken', pierce: 0, spin: 0 });
  }
  addParticles(player.x, player.y, '#c8c8d8', 18, 200, 0.4);
  screenShake(2);
}

function skillGravedigger(dt) {
  player._gravediggerAcc = (player._gravediggerAcc || 0) + dt;
  if (player._gravediggerAcc < 0.65) return;
  player._gravediggerAcc = 0;
  const tx = mouseWorld.x, ty = mouseWorld.y;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const bx = tx + Math.cos(a) * rand(15, 55);
    const by = ty + Math.sin(a) * rand(15, 55);
    state.projectiles.push({ x: bx, y: by, vx: Math.cos(a + Math.PI) * 200, vy: Math.sin(a + Math.PI) * 200, r: 8, dmg: 22 + player.dmgBonus, life: 0.55, kind: 'bone', pierce: 1, angle: a + Math.PI });
  }
  addParticles(tx, ty, '#8a7a60', 22, 200, 0.5);
  screenShake(4);
}

function skillBerserkerRage(dt) {
  const AURA_R = 100;
  const dmgPerSec = 80 + player.dmgBonus * 2;
  for (const e of state.enemies) {
    const dx = e.x - player.x, dy = e.y - player.y;
    if (dx * dx + dy * dy < AURA_R * AURA_R) { e.hp -= dmgPerSec * dt; e.hitFlash = 0.1; }
  }
  if (Math.random() < 0.6) {
    const a = Math.random() * TAU;
    state.particles.push({ x: player.x + Math.cos(a) * rand(10, AURA_R), y: player.y + Math.sin(a) * rand(10, AURA_R), vx: Math.cos(a) * 100, vy: Math.sin(a) * 100, life: 0.3, maxLife: 0.3, color: Math.random() < 0.5 ? '#ff4422' : '#ff8844', size: 4 });
  }
}

function skillFireRain(dt) {
  player._pyroAcc = (player._pyroAcc || 0) + dt;
  if (player._pyroAcc < 0.22) return;
  player._pyroAcc = 0;
  const tx = mouseWorld.x + rand(-120, 120), ty = mouseWorld.y + rand(-120, 120);
  state.projectiles.push({ x: tx, y: ty, vx: rand(-20, 20), vy: rand(-20, 20), r: 12, dmg: 22 + player.dmgBonus, life: 0.5, kind: 'inferno', pierce: 0, explode: true, angle: 0 });
  addParticles(tx, ty, '#ff6622', 6, 100, 0.3);
}

function skillCleric(dt) {
  player.invuln = Math.max(player.invuln, 0.3);
  player.hp = Math.min(player.hpMax, player.hp + 5 * dt);
  if (Math.random() < 0.5) {
    const a = Math.random() * TAU;
    state.particles.push({ x: player.x + Math.cos(a) * rand(10, 90), y: player.y + Math.sin(a) * rand(10, 90), vx: 0, vy: -rand(30, 80), life: 0.5, maxLife: 0.5, color: Math.random() < 0.5 ? '#ffffaa' : '#ffffff', size: 3 });
  }
}

function skillHunterTrap(dt) {
  player._hunterTrapCd = (player._hunterTrapCd || 0) - dt;
  if (player._hunterTrapCd > 0) return;
  player._hunterTrapCd = 1.5;
  const trapDmg = 45 + player.dmgBonus * 2;
  state.projectiles.push({ x: mouseWorld.x, y: mouseWorld.y, vx: 0, vy: 0, r: 14, dmg: 0, life: 10, kind: 'trap', pierce: 99, trapDmg });
  addParticles(mouseWorld.x, mouseWorld.y, '#88aa44', 10, 80, 0.4);
}

function skillNecroChannel(dt, ang) {
  player._necroAcc = (player._necroAcc || 0) + dt;
  if (player._necroAcc < 0.45) return;
  player._necroAcc = 0;
  for (let i = 0; i < 4; i++) {
    const a = ang + (i - 1.5) * 0.28;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*340, vy: Math.sin(a)*340, r: 9, dmg: 18 + player.dmgBonus, life: 2.2, kind: 'venom', pierce: 1, angle: a });
  }
  addParticles(player.x, player.y, '#44cc22', 10, 90, 0.35);
}

function skillPaladinAura(dt) {
  player._paladinAuraCd = (player._paladinAuraCd || 0) - dt;
  if (player._paladinAuraCd > 0) return;
  player._paladinAuraCd = 0.7;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*560, vy: Math.sin(a)*560, r: 14, dmg: 28 + player.dmgBonus, life: 0.22, kind: 'holyblade', pierce: 3, angle: a });
  }
  player.hp = Math.min(player.hpMax, player.hp + 3);
  addParticles(player.x, player.y, '#ffe8aa', 14, 200, 0.4);
}

function skillDruidGrowth(dt, ang) {
  player._druidAcc = (player._druidAcc || 0) + dt;
  if (player._druidAcc < 0.4) return;
  player._druidAcc = 0;
  const spread = 0.9;
  for (let i = 0; i < 4; i++) {
    const a = ang - spread/2 + (i/3)*spread;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*600, vy: Math.sin(a)*600, r: 6, dmg: 16 + player.dmgBonus, life: 1.3, kind: 'thorn', pierce: 4, angle: a });
  }
  addParticles(player.x, player.y, '#66cc33', 8, 100, 0.3);
}

function skillVampireDrain(dt, ang) {
  player._vampireAcc = (player._vampireAcc || 0) + dt;
  if (player._vampireAcc < 0.48) return;
  player._vampireAcc = 0;
  state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(ang)*400, vy: Math.sin(ang)*400, r: 8, dmg: 12 + player.dmgBonus, life: 1.4, kind: 'blood', pierce: 1, healOnHit: 3 + player.healBonus, angle: ang });
  addParticles(player.x, player.y, '#cc1122', 4, 65, 0.22);
}

function skillVoidDrain(dt, ang) {
  player._voidAcc = (player._voidAcc || 0) + dt;
  if (player._voidAcc < 0.42) return;
  player._voidAcc = 0;
  state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(ang)*520, vy: Math.sin(ang)*520, r: 10, dmg: 28 + player.dmgBonus, life: 1.2, kind: 'void', pierce: 3, healOnHit: 4 + player.healBonus, angle: ang });
  addParticles(player.x, player.y, '#550088', 4, 75, 0.22);
}

function skillFrostBlast(dt, ang) {
  player._frostAcc = (player._frostAcc || 0) + dt;
  if (player._frostAcc < 0.38) return;
  player._frostAcc = 0;
  for (const s of [-1, 0, 1]) {
    const a = ang + s * 0.22;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*600, vy: Math.sin(a)*600, r: 9, dmg: 22 + player.dmgBonus, life: 1.4, kind: 'frost', pierce: 2, angle: a });
  }
  addParticles(player.x, player.y, '#88ddff', 10, 120, 0.35);
}

function skillThunderstormEpic(dt, ang) {
  player._stormAcc = (player._stormAcc || 0) + dt;
  if (player._stormAcc < 0.28) return;
  player._stormAcc = 0;
  const spread = 1.6;
  for (let i = 0; i < 6; i++) {
    const a = ang - spread/2 + (i/5)*spread;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*780, vy: Math.sin(a)*780, r: 6, dmg: 22 + player.dmgBonus, life: 1.2, kind: 'lightning', pierce: 3, angle: a });
  }
  addParticles(player.x, player.y, '#aaeeff', 10, 160, 0.3);
  screenShake(2);
}

function skillRuneAura(dt) {
  player._runeAuraCd = (player._runeAuraCd || 0) - dt;
  if (player._runeAuraCd > 0) return;
  player._runeAuraCd = 0.65;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*440, vy: Math.sin(a)*440, r: 16, dmg: 34 + player.dmgBonus, life: 0.15, kind: 'rune', pierce: 4, angle: a });
  }
  addParticles(player.x, player.y, '#cc44ff', 16, 180, 0.4);
  ctx.fillStyle = `rgba(180,60,255,0.12)`; ctx.fillRect(0, 0, SW, SH);
}

function skillIllusionMirror(dt, ang) {
  player._illusionAcc = (player._illusionAcc || 0) + dt;
  if (player._illusionAcc < 0.35) return;
  player._illusionAcc = 0;
  for (let i = -2; i <= 2; i++) {
    const a = ang + i * 0.20;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*540, vy: Math.sin(a)*540, r: 8, dmg: 18 + player.dmgBonus, life: 0.22, kind: 'shadowblade', pierce: 3, angle: a });
  }
  addParticles(player.x, player.y, '#ee88ff', 10, 130, 0.3);
}

function skillCrusaderAura(dt) {
  player._crusaderAuraCd = (player._crusaderAuraCd || 0) - dt;
  if (player._crusaderAuraCd > 0) return;
  player._crusaderAuraCd = 0.9;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*380, vy: Math.sin(a)*380, r: 12, dmg: 22 + player.dmgBonus, life: 0.35, kind: 'holyblade', pierce: 2, angle: a });
  }
  addParticles(player.x, player.y, '#ffe8aa', 14, 160, 0.4);
  player.invuln = Math.max(player.invuln, 0.12);
}

function skillWitchHex(dt, ang) {
  player._witchHexAcc = (player._witchHexAcc || 0) + dt;
  if (player._witchHexAcc < 0.35) return;
  player._witchHexAcc = 0;
  const spread = 0.45;
  for (let i = 0; i < 3; i++) {
    const a = ang - spread + i * spread;
    state.projectiles.push({ x: player.x + Math.cos(a)*14, y: player.y + Math.sin(a)*14 - 4, vx: Math.cos(a)*360, vy: Math.sin(a)*360, r: 8, dmg: 18 + player.dmgBonus, life: 2.0, kind: 'venom', pierce: 1, angle: a });
  }
  addParticles(player.x, player.y, '#66cc22', 8, 80, 0.3);
}

function skillAlchemistBrew(dt) {
  player._alchBrewCd = (player._alchBrewCd || 0) - dt;
  if (player._alchBrewCd > 0) {
    if (Math.random() < 0.5) state.particles.push({ x: player.x + rand(-20,20), y: player.y + rand(-10,10), vx: rand(-20,20), vy: -rand(20,50), life: 0.5, maxLife: 0.5, color: '#88cc22', size: 3 });
    return;
  }
  player._alchBrewCd = 1.2;
  player.hp = Math.min(player.hpMax, player.hp + 6);
  addParticles(player.x, player.y, '#9bff9b', 10, 80, 0.4);
  addFloater(player.x, player.y - 22, '+6 HP', '#9bff9b');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    state.projectiles.push({ x: player.x, y: player.y, vx: Math.cos(a)*240, vy: Math.sin(a)*240, r: 10, dmg: 16 + player.dmgBonus, life: 1.8, kind: 'inferno', pierce: 0, explode: true, angle: a });
  }
  addParticles(player.x, player.y, '#aacc00', 12, 120, 0.4);
}

function skillBardSonic(dt, ang) {
  player._bardSonicAcc = (player._bardSonicAcc || 0) + dt;
  if (player._bardSonicAcc < 0.40) return;
  player._bardSonicAcc = 0;
  const spread = 1.4;
  for (let i = 0; i < 5; i++) {
    const a = ang - spread / 2 + (i / 4) * spread;
    state.projectiles.push({ x: player.x + Math.cos(a)*14, y: player.y + Math.sin(a)*14 - 4, vx: Math.cos(a)*680, vy: Math.sin(a)*680, r: 6, dmg: 16 + player.dmgBonus, life: 1.0, kind: 'lightning', pierce: 2, angle: a });
  }
  addParticles(player.x, player.y, '#88ddff', 10, 130, 0.35);
}

function skillShadow(dt) {
  player._shadowStepCd = (player._shadowStepCd || 0) - dt;
  if (player._shadowStepCd > 0) return;
  player._shadowStepCd = 0.8;
  const tx = clamp(mouseWorld.x, 20, WORLD_W - 20), ty = clamp(mouseWorld.y, 20, WORLD_H - 20);
  addParticles(player.x, player.y, '#7722cc', 15, 180, 0.5);
  player.x = tx; player.y = ty;
  player.invuln = Math.max(player.invuln, 0.5);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; state.projectiles.push({ x: tx, y: ty, vx: Math.cos(a)*640, vy: Math.sin(a)*640, r: 8, dmg: 14 + player.dmgBonus, life: 0.7, kind: 'shadowblade', pierce: 1, angle: a }); }
  addParticles(tx, ty, '#aa44ff', 20, 220, 0.5);
  screenShake(3);
}

function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (p.kind === 'trap') {
      p.life -= dt;
      if (p.life <= 0) { state.projectiles.splice(i, 1); continue; }
      if (Math.random() < 0.12) state.particles.push({ x: p.x + rand(-8,8), y: p.y + rand(-8,8), vx: 0, vy: -rand(15,40), life: 0.4, maxLife: 0.4, color: '#88aa44', size: 2 });
      for (const e of state.enemies) {
        const ddx = e.x - p.x, ddy = e.y - p.y;
        if (ddx*ddx + ddy*ddy < (e.w/2 + p.r)*(e.w/2 + p.r)) {
          const blastR = 90;
          for (const en of state.enemies) { const dx2 = en.x - p.x, dy2 = en.y - p.y; if (dx2*dx2 + dy2*dy2 < blastR*blastR) { en.hp -= p.trapDmg; en.hitFlash = 0.2; addFloater(en.x, en.y - en.h/2, String(p.trapDmg), '#88cc44'); } }
          addParticles(p.x, p.y, '#88cc44', 28, 260, 0.7); screenShake(5);
          state.projectiles.splice(i, 1); break;
        }
      }
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    // Trail particles
    if (p.kind === 'fire' && Math.random() < 0.5) {
      state.particles.push({
        x: p.x, y: p.y,
        vx: rand(-10, 10), vy: rand(-10, 10),
        life: 0.3, maxLife: 0.3,
        color: Math.random() < 0.5 ? '#ffcc55' : '#ff6633',
        size: 3,
      });
    }
    if (p.kind === 'lightning' && Math.random() < 0.65) {
      state.particles.push({
        x: p.x + rand(-3, 3), y: p.y + rand(-3, 3),
        vx: rand(-30, 30), vy: rand(-30, 30),
        life: 0.10, maxLife: 0.10,
        color: Math.random() < 0.5 ? '#8ae8ff' : '#ffffff',
        size: 2,
      });
    }
    if (p.kind === 'bone' && Math.random() < 0.2) state.particles.push({ x: p.x, y: p.y, vx: rand(-10,10), vy: rand(-10,10), life: 0.2, maxLife: 0.2, color: '#d8d4c0', size: 2 });
    if (p.kind === 'inferno' && Math.random() < 0.6) state.particles.push({ x: p.x, y: p.y, vx: rand(-15,15), vy: rand(-15,15), life: 0.3, maxLife: 0.3, color: Math.random() < 0.5 ? '#ff6633' : '#ff9922', size: 4 });
    if (p.kind === 'holy' && Math.random() < 0.3) state.particles.push({ x: p.x, y: p.y, vx: rand(-10,10), vy: -rand(20,60), life: 0.25, maxLife: 0.25, color: '#ffffaa', size: 2 });
    if (p.kind === 'holyblade' && Math.random() < 0.4) state.particles.push({ x: p.x, y: p.y, vx: rand(-15,15), vy: -rand(20,50), life: 0.3, maxLife: 0.3, color: Math.random()<0.5?'#ffe8aa':'#ffffff', size: 3 });
    if (p.kind === 'venom' && Math.random() < 0.35) state.particles.push({ x: p.x, y: p.y, vx: rand(-10,10), vy: rand(-10,10), life: 0.3, maxLife: 0.3, color: Math.random()<0.5?'#44cc22':'#88ff44', size: 3 });
    if (p.kind === 'thorn' && Math.random() < 0.25) state.particles.push({ x: p.x, y: p.y, vx: rand(-8,8), vy: rand(-8,8), life: 0.2, maxLife: 0.2, color: '#44aa22', size: 2 });
    if (p.kind === 'blood' && Math.random() < 0.4) state.particles.push({ x: p.x, y: p.y, vx: rand(-12,12), vy: rand(-12,12), life: 0.25, maxLife: 0.25, color: Math.random()<0.5?'#cc1122':'#ff2244', size: 3 });
    if (p.kind === 'rune' && Math.random() < 0.4) state.particles.push({ x: p.x, y: p.y, vx: rand(-20,20), vy: rand(-20,20), life: 0.2, maxLife: 0.2, color: Math.random()<0.5?'#cc44ff':'#ffffff', size: 2 });
    if (p.kind === 'void' && Math.random() < 0.45) state.particles.push({ x: p.x, y: p.y, vx: rand(-15,15), vy: rand(-15,15), life: 0.22, maxLife: 0.22, color: Math.random()<0.5?'#660099':'#330044', size: Math.random()<0.3?4:2 });
    if (p.kind === 'frost' && Math.random() < 0.35) state.particles.push({ x: p.x, y: p.y, vx: rand(-15,15), vy: rand(-15,15), life: 0.25, maxLife: 0.25, color: Math.random()<0.5?'#88ddff':'#ffffff', size: 2 });
    if (p.kind === 'soul' && Math.random() < 0.55) state.particles.push({ x: p.x, y: p.y, vx: rand(-20,20), vy: rand(-20,20), life: 0.28, maxLife: 0.28, color: Math.random()<0.5?'#9922ee':'#cc88ff', size: Math.random() < 0.3 ? 4 : 2 });
    if (p.kind === 'shuriken') p.spin = (p.spin || 0) + dt * 16;
    if (p.kind === 'boomerang') {
      p.distTraveled = (p.distTraveled || 0) + Math.hypot(p.vx, p.vy) * dt;
      if (!p.returning && p.distTraveled >= (p.maxDist || 260)) p.returning = true;
      if (p.returning) {
        const rdx = player.x - p.x, rdy = player.y - p.y;
        const rd = Math.hypot(rdx, rdy) || 1;
        if (rd < 22) { state.projectiles.splice(i, 1); continue; }
        p.vx = (rdx / rd) * 520; p.vy = (rdy / rd) * 520;
      }
      p.angle = Math.atan2(p.vy, p.vx);
    }

    if (p.life <= 0 || p.x < -20 || p.x > WORLD_W + 20 || p.y < -20 || p.y > WORLD_H + 20) {
      if (p.kind === 'inferno' && p.explode && p.life <= 0) {
        state.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 55, dmg: 6, life: 3.0, kind: 'pool', tickAcc: 0 });
        addParticles(p.x, p.y, '#ff6633', 14, 180, 0.5);
      }
      state.projectiles.splice(i, 1); continue;
    }

    let consumed = false;
    for (let j = 0; j < state.enemies.length; j++) {
      const e = state.enemies[j];
      const dx = p.x - e.x, dy = p.y - e.y;
      const rr = (e.w / 2 + p.r);
      if (dx * dx + dy * dy < rr * rr) {
        if (e._hitBy === p) continue; // already hit by this projectile (pierce safety)
        e._hitBy = p;
        e.hp -= p.dmg;
        e.hitFlash = 0.12;
        if (p.kind === 'inferno' && p.explode) {
          state.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 55, dmg: 6, life: 3.0, kind: 'pool', tickAcc: 0 });
          addParticles(p.x, p.y, '#ff6633', 20, 220, 0.6);
          screenShake(4);
        }
        const hitColor = p.kind === 'arrow' ? '#e8e0c0' : p.kind === 'blade' ? '#e0e8ff' : p.kind === 'lightning' ? '#8ae8ff' : p.kind === 'shuriken' ? '#c8c8d8' : p.kind === 'bone' ? '#e0dcc8' : p.kind === 'axe' ? '#ff6633' : p.kind === 'shadowblade' ? '#9955ff' : p.kind === 'holy' ? '#ffffaa' : p.kind === 'boomerang' ? '#88aa44' : p.kind === 'void' ? '#660099' : '#ffaa33';
        addParticles(p.x, p.y, hitColor, 6, 140, 0.35);
        addFloater(e.x, e.y - e.h / 2, String(p.dmg), '#ffd66b');
        screenShake(2);
        // Doctor heal-on-hit
        if (p.healOnHit && player.hp < player.hpMax) {
          player.hp = Math.min(player.hpMax, player.hp + p.healOnHit);
          addFloater(player.x, player.y - 14, '+' + p.healOnHit, '#9bff9b');
        }
        // Laska Lichbringera — drenuje duszę (+20 HP)
        if (p.soulDrain) {
          player.hp = Math.min(player.hpMax, player.hp + 20);
          addFloater(player.x, player.y - 18, '+20 DUSZA', '#bb55ff');
          addParticles(player.x, player.y, '#9922ee', 8, 100, 0.4);
        }
        // Kły Pajączycy — zatruwa wroga (DoT przez 4s)
        if (p.venomPoison && !e.passive) {
          e.poisoned = { timer: 4.0, dmgPerTick: 12, tick: 0 };
          addFloater(e.x, e.y - 20, 'ZATRUCIE!', '#44cc22');
        }
        if (p.pierce > 0) {
          p.pierce -= 1;
          // continue without consuming
        } else {
          state.projectiles.splice(i, 1);
          consumed = true;
          break;
        }
      }
    }
    if (consumed) continue;
  }
}

function updateHazards(dt) {
  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const h = state.hazards[i];
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.life -= dt;
    if (h.life <= 0 || h.x < -20 || h.x > WORLD_W + 20 || h.y < -20 || h.y > WORLD_H + 20) {
      state.hazards.splice(i, 1); continue;
    }
    if (h.kind !== 'pool') {
      let blocked = false;
      for (const b of state.buildings) {
        if (b.type !== 'wall' && b.type !== 'door') continue;
        if (Math.abs(h.x - b.x) < b.w / 2 + h.r && Math.abs(h.y - b.y) < b.h / 2 + h.r) {
          addParticles(h.x, h.y, '#9090a0', 4, 60, 0.2);
          state.hazards.splice(i, 1); blocked = true; break;
        }
      }
      if (blocked) continue;
    }
    const dx = h.x - player.x, dy = h.y - player.y;
    const rr = (h.r + 8);
    const colliding = dx * dx + dy * dy < rr * rr;

    if (h.kind === 'pool') {
      // Persistent damage zone — DoT every 0.3s while inside
      h.tickAcc = (h.tickAcc || 0) + dt;
      if (colliding && h.tickAcc >= 0.3) {
        h.tickAcc = 0;
        damagePlayer(h.dmg);
      }
      // Visual sizzle
      if (Math.random() < 0.4) {
        const a = Math.random() * TAU;
        const r = Math.random() * h.r;
        state.particles.push({
          x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r,
          vx: 0, vy: -rand(20, 60),
          life: 0.5, maxLife: 0.5,
          color: Math.random() < 0.5 ? '#ff6633' : '#ffaa33',
          size: 3,
        });
      }
    } else if (colliding) {
      damagePlayer(h.dmg);
      addParticles(h.x, h.y, h.color || '#a060ff', 10, 140, 0.4);
      state.hazards.splice(i, 1);
    }
  }
}

function damagePlayer(dmg) {
  if (player.invuln > 0) return;
  const finalDmg = Math.max(1, dmg - (player.armorBonus || 0));
  player.hp -= finalDmg;
  player.invuln = 0.9;
  state.flash = 1;
  screenShake(6);
  addFloater(player.x, player.y - 12, '-' + finalDmg, '#ff5577');
  if (player.hp <= 0) {
    player.hp = 0;
    addParticles(player.x, player.y, '#ff3b6b', 30, 220, 0.8);
    endGame(false);
  }
}

function updateEnemies(dt) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (e.hitFlash > 0) e.hitFlash -= dt;
    e._hitBy = null; // reset pierce marker each frame
    // Poison DoT (Kły Pajączycy)
    if (e.poisoned) {
      e.poisoned.tick += dt;
      if (e.poisoned.tick >= 0.5) {
        e.poisoned.tick = 0;
        e.hp -= e.poisoned.dmgPerTick;
        e.hitFlash = 0.08;
        addParticles(e.x, e.y, '#44cc22', 4, 60, 0.2);
      }
      e.poisoned.timer -= dt;
      if (e.poisoned.timer <= 0) e.poisoned = null;
    }

    if (e.type === 'bat') {
      e.bob += dt * 10;
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt + Math.sin(e.bob) * 0.6;
      if (aabb(e, player)) damagePlayer(e.dmg);
    } else if (e.type === 'skeleton') {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.walkBob += dt * 8;
      const target = 220;
      const dir = (d > target) ? 1 : (d < target - 30 ? -1 : 0);
      e.x += (dx / d) * e.speed * dt * dir;
      e.y += (dy / d) * e.speed * dt * dir;
      e.x += -dy / d * 20 * dt;
      e.y += dx / d * 20 * dt;
      e.fireCd -= dt;
      if (e.fireCd <= 0 && d < 520 && !hasWallBetween(e.x, e.y, player.x, player.y)) {
        e.fireCd = rand(1.4, 2.4);
        const ang = Math.atan2(dy, dx);
        state.hazards.push({
          x: e.x, y: e.y - 6,
          vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
          r: 5, dmg: 6, life: 2.4, color: '#a060ff',
        });
      }
      if (aabb(e, player)) damagePlayer(e.dmg);
    } else if (e.type === 'orc') {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.walkBob += dt * 6;
      if (e.chargeTimer > 0) {
        e.chargeTimer -= dt;
        e.x += e.chargeVx * dt;
        e.y += e.chargeVy * dt;
        if (Math.random() < 0.4) addParticles(e.x, e.y, '#4a7a3a', 1, 40, 0.2);
      } else {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
      }
      e.atkCd -= dt;
      e.chargeCd -= dt;
      if (aabb(e, player) && e.atkCd <= 0) { damagePlayer(e.dmg); e.atkCd = 0.8; }
      if (e.chargeCd <= 0 && d < 350) {
        e.chargeCd = rand(3, 6);
        e.chargeTimer = 0.5;
        e.chargeVx = (dx / d) * 400;
        e.chargeVy = (dy / d) * 400;
        addParticles(e.x, e.y, '#ff6633', 8, 140, 0.3);
      }
    } else if (e.type === 'wolf') {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.walkBob += dt * 16;
      if (d > 24) {
        const sideAng = Math.atan2(dy, dx) + (Math.sin(state.time * 3 + e.walkBob * 0.3) * 0.6);
        e.x += Math.cos(sideAng) * e.speed * dt;
        e.y += Math.sin(sideAng) * e.speed * dt;
      }
      e.atkCd -= dt;
      if (aabb(e, player) && e.atkCd <= 0) { damagePlayer(e.dmg); e.atkCd = 0.55; }
    } else if (e.type === 'troll') {
      e.hp = Math.min(e.maxHp, e.hp + (e.hpRegen || 5) * dt);
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.walkBob += dt * 4;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      e.atkCd -= dt;
      if (aabb(e, player) && e.atkCd <= 0) { damagePlayer(e.dmg); e.atkCd = 1.1; }
      e.stompCd -= dt;
      if (e.stompCd <= 0 && d < 320) {
        e.stompCd = rand(3, 5);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          state.hazards.push({ x: e.x, y: e.y, vx: Math.cos(a)*190, vy: Math.sin(a)*190, r: 8, dmg: 12, life: 2.2, color: '#5a4030' });
        }
        addParticles(e.x, e.y, '#5a4030', 18, 120, 0.4);
        screenShake(5);
      }
    } else if (e.type === 'golem') {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.walkBob += dt * 3;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      e.atkCd -= dt;
      if (aabb(e, player) && e.atkCd <= 0) { damagePlayer(e.dmg); e.atkCd = 1.8; }
      e.fireCd -= dt;
      if (e.fireCd <= 0 && d < 650) {
        e.fireCd = rand(2.5, 4.0);
        const ang = Math.atan2(dy, dx);
        for (const spread of [-0.14, 0, 0.14]) {
          const a = ang + spread;
          state.hazards.push({ x: e.x, y: e.y, vx: Math.cos(a)*210, vy: Math.sin(a)*210, r: 10, dmg: 15, life: 2.8, color: '#7a6050' });
        }
        addParticles(e.x, e.y, '#7a6050', 14, 130, 0.4);
        screenShake(3);
      }
    } else if (e.type === 'sheep' || e.type === 'pig') {
      e.walkBob += dt * 5;
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderTimer = rand(2, 5);
        e.wanderAngle = Math.random() * TAU;
      }
      const dxp = player.x - e.x, dyp = player.y - e.y;
      const dp = Math.hypot(dxp, dyp);
      if (dp < 120) {
        e.wanderAngle = Math.atan2(-dyp, -dxp) + rand(-0.5, 0.5);
        e.wanderTimer = 0.4;
      }
      const ns = dp < 90 ? e.speed * 1.9 : e.speed;
      e.x += Math.cos(e.wanderAngle) * ns * dt;
      e.y += Math.sin(e.wanderAngle) * ns * dt;
    } else if (e.type === 'boss') {
      updateBoss(e, dt);
    }

    e.x = clamp(e.x, 8, WORLD_W - 8);
    e.y = clamp(e.y, 8, WORLD_H - 8);
    if (e.type !== 'boss') pushOutOfWalls(e, true);
    else if (state.inDungeon && state.dungeonTiles) pushOutOfDungeonWalls(e);

    if (e.hp <= 0) {
      const isBoss = e.type === 'boss';
      const isLarge = e.type === 'troll' || e.type === 'golem';
      addParticles(e.x, e.y, isBoss ? '#ff4060' : (isLarge ? '#cc7744' : '#ff8855'), isBoss ? 60 : (isLarge ? 30 : 16), 200, isBoss ? 1.0 : (isLarge ? 0.7 : 0.5));
      screenShake(isBoss ? 14 : (isLarge ? 6 : 3));
      state.kills += 1;
      if (!isBoss) {
        // Brak dropu HP/MP z wrogów — tylko crafting
        const classDropChance = e.type === 'golem' ? 0.55 : (e.type === 'troll' ? 0.40 : (e.type === 'orc' ? 0.22 : 0.18));
        if (Math.random() < classDropChance) dropClassItem(e.x + rand(-12, 12), e.y + rand(-12, 12));
        const resChance = e.type === 'golem' ? 0.60 : (e.type === 'troll' ? 0.50 : 0.28);
        if (Math.random() < resChance && e.type !== 'sheep' && e.type !== 'pig') {
          const rk = Math.random() < 0.5 ? 'wood' : 'stone';
          state.pickups.push({ x: e.x + rand(-10,10), y: e.y + rand(-10,10), kind: rk, life: 18, bob: 0 });
        }
        // Kości ze szkieletów
        if (e.type === 'skeleton' && Math.random() < 0.70) {
          state.pickups.push({ x: e.x + rand(-8,8), y: e.y + rand(-8,8), kind: 'bone', life: 16, bob: 0 });
        }
        // 0.5% miecz kostny ze szkieleta
        if (e.type === 'skeleton' && Math.random() < 0.005) {
          state.pickups.push({ x: e.x + rand(-8,8), y: e.y + rand(-8,8), kind: 'bone_sword', life: 25, bob: 0 });
          addFloater(e.x, e.y - 24, 'MIECZ KOSTNY!', '#d0ccb8');
        }
        // Mięso z mobów
        const meatChance = e.type === 'troll' ? 0.55 : e.type === 'orc' ? 0.35 : e.type === 'wolf' ? 0.35 : e.type === 'bat' ? 0.20 : e.type === 'skeleton' ? 0.10 : 0;
        if (meatChance > 0 && Math.random() < meatChance) {
          state.pickups.push({ x: e.x + rand(-10,10), y: e.y + rand(-10,10), kind: 'meat', life: 18, bob: Math.random()*TAU });
        }
        // Dropy zwierząt
        if (e.type === 'sheep') {
          const bc = randi(2, 5);
          for (let k = 0; k < bc; k++) state.pickups.push({ x: e.x+rand(-12,12), y: e.y+rand(-12,12), kind: 'bone', life: 16, bob: Math.random()*TAU });
        } else if (e.type === 'pig') {
          const bc = randi(1, 3);
          for (let k = 0; k < bc; k++) state.pickups.push({ x: e.x+rand(-12,12), y: e.y+rand(-12,12), kind: 'bone', life: 16, bob: Math.random()*TAU });
          state.pickups.push({ x: e.x+rand(-8,8), y: e.y+rand(-8,8), kind: 'meat', life: 16, bob: Math.random()*TAU });
        }
        const coinVal = e.type === 'golem' ? randi(12, 28) : (e.type === 'troll' ? randi(8, 18) : (e.type === 'orc' ? randi(3, 9) : (e.type === 'wolf' ? randi(2, 6) : randi(1, 5))));
        const coinChance = e.type === 'golem' ? 0.75 : (e.type === 'troll' ? 0.60 : (e.type === 'orc' ? 0.23 : 0.13));
        if (Math.random() < coinChance) state.pickups.push({ x: e.x + rand(-14,14), y: e.y + rand(-14,14), kind: 'coin', value: coinVal, life: 18, bob: Math.random()*TAU });
        // 1% szansa na $1 z każdego moba
        if (!e.passive && Math.random() < 0.01) state.pickups.push({ x: e.x + rand(-8,8), y: e.y + rand(-8,8), kind: 'coin', value: 1, life: 18, bob: Math.random()*TAU });
      }
      const pts = isBoss ? 2000 : (e.type === 'golem' ? 300 : (e.type === 'troll' ? 200 : (e.type === 'orc' ? 120 : (e.type === 'wolf' ? 50 : (e.type === 'skeleton' ? 60 : 30)))));
      state.score += pts;
      state.enemies.splice(i, 1);
      if (isBoss) {
        const wasArenaKey = e.arenaKey || null;
        state.bossActive = false;
        state.boss = null;
        if (!wasArenaKey) state.bossesDefeated += 1;
        state.nextBossTimer = state.inDungeon ? 9999 : 25;
        if (state.inDungeon) {
          state.dungeonBossKilled = true;
          addFloater(player.x, player.y - 30, 'LOCH OCZYSZCZONY! Wyjdź [E]', '#40ff88');
          state.chests.push({ x: e.x, y: e.y, open: false, bob: 0, loot: 'weapon_upgrade' });
          const bm2 = 150 + randi(0, 100) + state.dungeonLevel * 80;
          state.money += bm2;
          addFloater(e.x, e.y - 40, `+$${bm2}`, '#ffd700');
        } else if (wasArenaKey) {
          // Arena boss killed — mark arena cleared, no respawn
          state.clearedArenas.add(wasArenaKey);
          const arenaDecor = state.decor.find(d => d.type === 'boss_arena' && d.arenaKey === wasArenaKey);
          if (arenaDecor) arenaDecor.cleared = true;
          addFloater(player.x, player.y - 30, 'ARENA OCZYSZCZONA!', '#ffd66b');
          // Broń eventowa zależna od typu areny
          const arenaWeaponMap = { lich: 'event_lich', demon: 'event_demon', titan: 'event_titan', spider: 'event_spider', ice: 'event_ice', necro: 'event_necro', wraith: 'event_wraith', drake: 'event_drake' };
          const eventWeapon = arenaDecor ? (arenaWeaponMap[arenaDecor.bossId] || 'weapon_upgrade') : 'weapon_upgrade';
          state.chests.push({ x: e.x + rand(-20,20), y: e.y + rand(-10,10), open: false, bob: 0, loot: eventWeapon });
          const arenaBonus = 120 + randi(0, 100);
          state.money += arenaBonus;
          addFloater(e.x, e.y - 50, `ARENA +$${arenaBonus}`, '#ffd700');
          for (let k = 0; k < 6; k++) dropClassItem(e.x + rand(-60, 60), e.y + rand(-60, 60));
        } else {
          addFloater(player.x, player.y - 30, 'BOSS POKONANY!', '#ffd66b');
        }
        // Reward za bossa: zasoby i kości (bez HP/MP)
        const boneReward = 4 + randi(0, 4);
        for (let k = 0; k < boneReward; k++) {
          state.pickups.push({ x: e.x + rand(-40,40), y: e.y + rand(-40,40), kind: 'bone', life: 22, bob: Math.random()*TAU });
        }
        const woodReward = randi(3, 6);
        for (let k = 0; k < woodReward; k++) {
          const rk = Math.random() < 0.5 ? 'wood' : 'stone';
          state.pickups.push({ x: e.x + rand(-40,40), y: e.y + rand(-40,40), kind: rk, life: 22, bob: Math.random()*TAU });
        }
        for (let k = 0; k < 3; k++) {
          dropClassItem(e.x + rand(-50, 50), e.y + rand(-50, 50));
        }
        const bm = 80 + randi(0, 60);
        state.money += bm;
        addFloater(e.x, e.y - 30, `+$${bm}`, '#ffd700');
      }
    }
  }
}

function updateBoss(b, dt) {
  b.bob += dt * 3;
  b.phaseTimer += dt;
  if (b.teleportFlash > 0) b.teleportFlash -= dt;

  b._enraged = b.hp < b.maxHp * 0.45;
  if (b._enraged && !b._enrageShown) {
    b._enrageShown = true;
    addFloater(b.x, b.y - 48, '⚡ SZAŁ! ⚡', '#ff2200');
    addParticles(b.x, b.y, '#ff2200', 50, 320, 0.8);
    screenShake(20);
  }

  if (b.subtype === 'lich') updateLich(b, dt);
  else if (b.subtype === 'demon') updateDemon(b, dt);
  else if (b.subtype === 'ice') updateIce(b, dt);
  else if (b.subtype === 'titan') updateTitan(b, dt);
  else if (b.subtype === 'necro') updateNecro(b, dt);
  else if (b.subtype === 'spider') updateSpider(b, dt);
  else if (b.subtype === 'wraith') updateWraith(b, dt);
  else if (b.subtype === 'drake') updateDrake(b, dt);

  if (aabb(b, player)) damagePlayer(b.dmg);
}

function bossApproach(b, dt, targetDist) {
  const dx = player.x - b.x, dy = player.y - b.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d > targetDist) {
    b.x += (dx / d) * b.speed * dt;
    b.y += (dy / d) * b.speed * dt;
  }
}

// ---- Lich (caster) ----
function updateLich(b, dt) {
  bossApproach(b, dt, 220);
  b.attackCd -= dt * (b._enraged ? 2.2 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackRing(b);
    else if (b.attackPattern === 1) bossAttackAimed(b);
    else if (b.attackPattern === 2) bossAttackSpiral(b);
    else if (b.attackPattern === 3) bossAttackDoubleRing(b);
    else if (b.attackPattern === 4) bossAttackSoulChain(b);
    else bossAttackDeathRain(b);
    b.attackCd = b._enraged ? 0.9 : 1.8;
  }
}

// ---- Demon (charger) ----
function updateDemon(b, dt) {
  if (b.chargeTimer > 0) {
    b.chargeTimer -= dt;
    b.x += b.chargeVx * dt;
    b.y += b.chargeVy * dt;
    if (Math.random() < 0.6) addParticles(b.x, b.y, '#ff6633', 2, 60, 0.4);
    b.x = clamp(b.x, 20, WORLD_W - 20);
    b.y = clamp(b.y, 20, WORLD_H - 20);
  } else {
    bossApproach(b, dt, 180);
  }
  b.attackCd -= dt * (b._enraged ? 2.2 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackFireFan(b);
    else if (b.attackPattern === 1) bossAttackCharge(b);
    else if (b.attackPattern === 2) bossAttackFirePool(b);
    else if (b.attackPattern === 3) bossAttackDemonFury(b);
    else if (b.attackPattern === 4) bossAttackLavaGeyser(b);
    else bossAttackInfernoSpiral(b);
    b.attackCd = b._enraged ? 0.7 : 1.5;
  }
}

function bossAttackFireFan(b) {
  const baseAng = Math.atan2(player.y - b.y, player.x - b.x);
  for (let i = -3; i <= 3; i++) {
    const a = baseAng + i * 0.15;
    state.hazards.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * 280, vy: Math.sin(a) * 280,
      r: 6, dmg: 9, life: 2.4, color: '#ff6633',
    });
  }
  addParticles(b.x, b.y, '#ff6633', 18, 180, 0.5);
  screenShake(4);
}

function bossAttackCharge(b) {
  const dx = player.x - b.x, dy = player.y - b.y;
  const d = Math.hypot(dx, dy) || 1;
  b.chargeVx = (dx / d) * 520;
  b.chargeVy = (dy / d) * 520;
  b.chargeTimer = 0.7;
  addParticles(b.x, b.y, '#ffaa33', 20, 200, 0.5);
  screenShake(6);
}

function bossAttackFirePool(b) {
  state.hazards.push({
    x: b.x, y: b.y + 20,
    vx: 0, vy: 0,
    r: 32, dmg: 7, life: 5,
    color: '#ff4020',
    kind: 'pool', tickAcc: 0,
  });
  addParticles(b.x, b.y + 20, '#ff4020', 24, 80, 0.6);
}

// ---- Ice Queen (teleporter) ----
function updateIce(b, dt) {
  bossApproach(b, dt, 260);
  b.attackCd -= dt * (b._enraged ? 2.1 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackIcicle(b);
    else if (b.attackPattern === 1) bossAttackTeleport(b);
    else if (b.attackPattern === 2) bossAttackIceNova(b);
    else if (b.attackPattern === 3) bossAttackFrostBlizzard(b);
    else if (b.attackPattern === 4) bossAttackIceLance(b);
    else bossAttackFrostTrap(b);
    b.attackCd = b._enraged ? 0.85 : 1.7;
  }
}

function bossAttackIcicle(b) {
  for (let i = 0; i < 7; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const ang = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.18, 0.18);
      state.hazards.push({
        x: b.x, y: b.y,
        vx: Math.cos(ang) * 360, vy: Math.sin(ang) * 360,
        r: 5, dmg: 10, life: 2.4, color: '#8ad8ff',
      });
    }, i * 80);
  }
}

function bossAttackTeleport(b) {
  // Burst at old position
  addParticles(b.x, b.y, '#8ad8ff', 30, 220, 0.6);
  const ang = Math.random() * TAU;
  const dist = rand(160, 260);
  b.x = clamp(player.x + Math.cos(ang) * dist, 30, WORLD_W - 30);
  b.y = clamp(player.y + Math.sin(ang) * dist, 30, WORLD_H - 30);
  b.teleportFlash = 0.4;
  addParticles(b.x, b.y, '#8ad8ff', 30, 220, 0.6);
  screenShake(3);
}

function bossAttackIceNova(b) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    state.hazards.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * 160, vy: Math.sin(a) * 160,
      r: 6, dmg: 9, life: 3.2, color: '#bce8ff',
    });
  }
  addParticles(b.x, b.y, '#bce8ff', 24, 180, 0.5);
}

// ---- Titan (tank) ----
function updateTitan(b, dt) {
  bossApproach(b, dt, 80);
  b.attackCd -= dt * (b._enraged ? 2.0 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackStomp(b);
    else if (b.attackPattern === 1) bossAttackRockToss(b);
    else if (b.attackPattern === 2) bossAttackBoulderRing(b);
    else if (b.attackPattern === 3) bossAttackMegaStomp(b);
    else if (b.attackPattern === 4) bossAttackEarthquake(b);
    else bossAttackRockBarrage(b);
    b.attackCd = b._enraged ? 1.0 : 2.0;
  }
}

function bossAttackStomp(b) {
  // Expanding ring of slow rocks
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    state.hazards.push({
      x: b.x, y: b.y + 20,
      vx: Math.cos(a) * 140, vy: Math.sin(a) * 140,
      r: 8, dmg: 10, life: 2.6, color: '#8a7060',
    });
  }
  addParticles(b.x, b.y + 20, '#5a4030', 30, 160, 0.6);
  screenShake(10);
}

function bossAttackRockToss(b) {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const ang = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.12, 0.12);
      state.hazards.push({
        x: b.x, y: b.y,
        vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
        r: 9, dmg: 10, life: 2.8, color: '#6a5040',
      });
    }, i * 200);
  }
}

function bossAttackBoulderRing(b) {
  // Big slow boulders
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + b.bob;
    state.hazards.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * 100, vy: Math.sin(a) * 100,
      r: 12, dmg: 13, life: 4, color: '#7a6050',
    });
  }
  screenShake(8);
}

// ---- Necromancer ----
function updateNecro(b, dt) {
  bossApproach(b, dt, 280);
  b.attackCd -= dt * (b._enraged ? 2.1 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackSummon(b);
    else if (b.attackPattern === 1) bossAttackAimed(b);
    else if (b.attackPattern === 2) bossAttackSpiral(b);
    else if (b.attackPattern === 3) bossAttackSummonHorde(b);
    else if (b.attackPattern === 4) bossAttackDeathCurse(b);
    else bossAttackBoneRing(b);
    b.attackCd = b._enraged ? 1.0 : 2.0;
  }
}
function bossAttackSummon(b) {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU;
    spawnEnemyAt('skeleton',
      clamp(b.x + Math.cos(a) * rand(60, 110), 30, WORLD_W - 30),
      clamp(b.y + Math.sin(a) * rand(60, 110), 30, WORLD_H - 30));
  }
  addParticles(b.x, b.y, '#a060ff', 24, 180, 0.7);
  addFloater(b.x, b.y - 42, 'PRZYWOŁAJ!', '#a060ff');
  screenShake(4);
}

// ---- Spider Queen ----
function updateSpider(b, dt) {
  if (b.chargeTimer > 0) {
    b.chargeTimer -= dt;
    b.x += b.chargeVx * dt;
    b.y += b.chargeVy * dt;
    if (Math.random() < 0.4) addParticles(b.x, b.y, '#2a7a1a', 2, 60, 0.3);
    b.x = clamp(b.x, 20, WORLD_W - 20);
    b.y = clamp(b.y, 20, WORLD_H - 20);
  } else {
    bossApproach(b, dt, 150);
  }
  b.attackCd -= dt * (b._enraged ? 2.3 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackWebPool(b);
    else if (b.attackPattern === 1) bossAttackCharge(b);
    else if (b.attackPattern === 2) bossAttackSpiderRing(b);
    else if (b.attackPattern === 3) bossAttackWebStorm(b);
    else if (b.attackPattern === 4) bossAttackSpiderLeap(b);
    else bossAttackEggBurst(b);
    b.attackCd = b._enraged ? 0.65 : 1.4;
  }
}
function bossAttackWebPool(b) {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU;
    state.hazards.push({
      x: player.x + Math.cos(a) * rand(20, 80),
      y: player.y + Math.sin(a) * rand(20, 80),
      vx: 0, vy: 0, r: 28, dmg: 6, life: 7,
      color: '#1a5a0a', kind: 'pool', tickAcc: 0,
    });
  }
  addParticles(b.x, b.y, '#2a7a1a', 16, 150, 0.5);
}
function bossAttackSpiderRing(b) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + b.bob;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*160, vy: Math.sin(a)*160, r: 5, dmg: 9, life: 3.5, color: '#4aaa2a' });
  }
  addParticles(b.x, b.y, '#4aaa2a', 18, 180, 0.5);
}

// ---- Void Wraith ----
function updateWraith(b, dt) {
  if (b.teleportFlash > 0) b.teleportFlash -= dt;
  bossApproach(b, dt, 240);
  b.attackCd -= dt * (b._enraged ? 2.2 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackVoidBolt(b);
    else if (b.attackPattern === 1) bossAttackTeleport(b);
    else if (b.attackPattern === 2) bossAttackVoidNova(b);
    else if (b.attackPattern === 3) bossAttackVoidBeam(b);
    else if (b.attackPattern === 4) bossAttackVoidSurge(b);
    else bossAttackVoidCage(b);
    b.attackCd = b._enraged ? 0.8 : 1.7;
  }
}
function bossAttackVoidBolt(b) {
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.12, 0.12);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*380, vy: Math.sin(a)*380, r: 5, dmg: 10, life: 2.5, color: '#6040ff' });
    }, i * 70);
  }
}
function bossAttackVoidNova(b) {
  bossAttackTeleport(b);
  setTimeout(() => {
    if (!state.boss || !state.running) return;
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*190, vy: Math.sin(a)*190, r: 5, dmg: 11, life: 3.2, color: '#8060ff' });
    }
    addParticles(b.x, b.y, '#8060ff', 24, 200, 0.6);
    screenShake(5);
  }, 350);
}

// ---- Storm Drake ----
function updateDrake(b, dt) {
  if (b.chargeTimer > 0) {
    b.chargeTimer -= dt;
    b.x += b.chargeVx * dt;
    b.y += b.chargeVy * dt;
    if (Math.random() < 0.5) addParticles(b.x, b.y, '#ffe44a', 2, 80, 0.3);
    b.x = clamp(b.x, 20, WORLD_W - 20);
    b.y = clamp(b.y, 20, WORLD_H - 20);
  } else {
    bossApproach(b, dt, 200);
  }
  b.attackCd -= dt * (b._enraged ? 2.2 : 1.0);
  if (b.attackCd <= 0) {
    b.attackPattern = (b.attackPattern + 1) % 6;
    if (b.attackPattern === 0) bossAttackLightning(b);
    else if (b.attackPattern === 1) bossAttackWingGust(b);
    else if (b.attackPattern === 2) bossAttackCharge(b);
    else if (b.attackPattern === 3) bossAttackThunderstrike(b);
    else if (b.attackPattern === 4) bossAttackStormCall(b);
    else bossAttackElectricBurst(b);
    b.attackCd = b._enraged ? 0.75 : 1.6;
  }
}
function bossAttackLightning(b) {
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.08, 0.08);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*520, vy: Math.sin(a)*520, r: 4, dmg: 11, life: 1.6, color: '#ffe44a' });
    }, i * 45);
  }
  addParticles(b.x, b.y, '#ffe44a', 14, 200, 0.4);
  screenShake(5);
}
function bossAttackWingGust(b) {
  const base = Math.atan2(player.y - b.y, player.x - b.x);
  for (let i = -4; i <= 4; i++) {
    const a = base + i * 0.2;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*300, vy: Math.sin(a)*300, r: 5, dmg: 10, life: 2.2, color: '#a0d4ff' });
  }
  addParticles(b.x, b.y, '#a0d4ff', 20, 200, 0.5);
  screenShake(5);
}

function bossAttackRing(b) {
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    state.hazards.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * 220, vy: Math.sin(a) * 220,
      r: 7, dmg: 16, life: 3.2, color: '#ff4060',
    });
  }
  addParticles(b.x, b.y, '#ff4060', 28, 240, 0.5);
  screenShake(5);
}

function bossAttackAimed(b) {
  for (let i = 0; i < 7; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.07, 0.07);
      state.hazards.push({
        x: b.x, y: b.y,
        vx: Math.cos(a) * 400, vy: Math.sin(a) * 400,
        r: 6, dmg: 18, life: 2.4, color: '#ffaa33',
      });
    }, i * 75);
  }
}

// ---- Nowe ataki bossów ----
function bossAttackDoubleRing(b) {
  const n = 18;
  for (const off of [0, Math.PI / n]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + off;
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*240, vy: Math.sin(a)*240, r: 7, dmg: 17, life: 3.2, color: '#ff4060' });
    }
  }
  addParticles(b.x, b.y, '#ff4060', 34, 260, 0.5);
  screenShake(6);
}
function bossAttackDemonFury(b) {
  for (let i = 0; i < 8; i++) {
    const ax = player.x + rand(-160, 160), ay = player.y + rand(-160, 160);
    state.hazards.push({ x: ax, y: ay, vx: 0, vy: 0, r: 40, dmg: 14, life: 5.5, color: '#ff4020', kind: 'pool', tickAcc: 0 });
    addParticles(ax, ay, '#ff4020', 16, 100, 0.5);
  }
  screenShake(8);
}
function bossAttackFrostBlizzard(b) {
  const n = 28;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const px2 = player.x + rand(-180, 180), py2 = player.y + rand(-180, 180);
      state.hazards.push({ x: b.x, y: b.y, vx: (px2-b.x)/1.8, vy: (py2-b.y)/1.8, r: 6, dmg: 16, life: 2.5, color: '#8ad8ff' });
    }, i * 40);
  }
  addParticles(b.x, b.y, '#8ad8ff', 26, 230, 0.5);
  screenShake(5);
}
function bossAttackMegaStomp(b) {
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    state.hazards.push({ x: b.x, y: b.y + 20, vx: Math.cos(a)*260, vy: Math.sin(a)*260, r: 13, dmg: 24, life: 3.2, color: '#7a6050' });
  }
  addParticles(b.x, b.y + 20, '#5a4030', 48, 260, 0.7);
  screenShake(18);
}
function bossAttackSummonHorde(b) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    spawnEnemyAt('skeleton', clamp(b.x + Math.cos(a)*90, 30, WORLD_W-30), clamp(b.y + Math.sin(a)*90, 30, WORLD_H-30));
  }
  for (let i = 0; i < 2; i++) {
    spawnEnemyAt('orc', clamp(b.x + rand(-60,60), 30, WORLD_W-30), clamp(b.y + rand(-60,60), 30, WORLD_H-30));
  }
  bossAttackSpiral(b);
  addFloater(b.x, b.y - 48, 'PRZYWOŁAJ HORDĘ!', '#a060ff');
  screenShake(8);
}
function bossAttackWebStorm(b) {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU;
    state.hazards.push({ x: player.x + Math.cos(a)*rand(20,110), y: player.y + Math.sin(a)*rand(20,110), vx: 0, vy: 0, r: 38, dmg: 13, life: 9, color: '#1a5a0a', kind: 'pool', tickAcc: 0 });
  }
  bossAttackSpiderRing(b);
  addParticles(b.x, b.y, '#2a7a1a', 24, 200, 0.5);
  screenShake(6);
}
function bossAttackVoidBeam(b) {
  const baseAng = Math.atan2(player.y - b.y, player.x - b.x);
  for (let i = 0; i < 18; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = baseAng + rand(-0.05, 0.05);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*580, vy: Math.sin(a)*580, r: 5, dmg: 20, life: 1.8, color: '#6040ff' });
    }, i * 35);
  }
  bossAttackTeleport(b);
  addParticles(b.x, b.y, '#6040ff', 24, 250, 0.5);
  screenShake(7);
}
function bossAttackThunderstrike(b) {
  const base = Math.atan2(player.y - b.y, player.x - b.x);
  for (let i = -7; i <= 7; i++) {
    const a = base + i * 0.12;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*680, vy: Math.sin(a)*680, r: 5, dmg: 22, life: 1.6, color: '#ffe44a' });
  }
  addParticles(b.x, b.y, '#ffe44a', 28, 280, 0.5);
  screenShake(9);
}

// ---- Nowe ataki bossów (rozszerzenie) ----

// Lich: łańcuch dusz — 8 boltów w prędko jeden po drugim
function bossAttackSoulChain(b) {
  for (let i = 0; i < 8; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.05, 0.05);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*420, vy: Math.sin(a)*420, r: 6, dmg: 11, life: 2.2, color: '#bb55ff' });
    }, i * 60);
  }
  addParticles(b.x, b.y, '#aa33ee', 16, 160, 0.5);
  screenShake(4);
}

// Lich: deszcz śmierci — 10 skał z nieba wokół gracza
function bossAttackDeathRain(b) {
  for (let i = 0; i < 10; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const tx = player.x + rand(-200, 200), ty = player.y + rand(-200, 200);
      state.hazards.push({ x: tx - 5, y: ty - 300, vx: rand(-20,20), vy: 500, r: 7, dmg: 13, life: 1.0, color: '#9933cc' });
      addParticles(tx, ty - 280, '#bb55ff', 4, 40, 0.3);
    }, i * 70);
  }
  addFloater(b.x, b.y - 50, 'DESZCZ ŚMIERCI!', '#bb55ff');
  screenShake(5);
}

// Demon: gejzery lawy — 4 kolumny ognia z ziemi
function bossAttackLavaGeyser(b) {
  for (let i = 0; i < 4; i++) {
    const tx = player.x + rand(-140, 140), ty = player.y + rand(-140, 140);
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      addParticles(tx, ty, '#ff8800', 10, 80, 0.3);
      setTimeout(() => {
        if (!state.boss || !state.running) return;
        for (let k = 0; k < 5; k++) {
          const a = Math.random() * TAU;
          state.hazards.push({ x: tx, y: ty, vx: Math.cos(a)*160, vy: Math.sin(a)*160 - 80, r: 8, dmg: 11, life: 1.2, color: '#ff6600' });
        }
        addParticles(tx, ty, '#ff4400', 20, 200, 0.6);
        screenShake(4);
      }, 400);
    }, i * 250);
  }
}

// Demon: spirala inferno
function bossAttackInfernoSpiral(b) {
  let i = 0;
  const startAng = b.bob;
  const id = setInterval(() => {
    if (!state.boss || !state.running) { clearInterval(id); return; }
    if (state.hazards.length < MAX_HAZARDS) {
      const a = startAng + i * 0.52;
      for (let k = 0; k < 3; k++) {
        const aa = a + k * (TAU / 3);
        state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(aa)*220, vy: Math.sin(aa)*220, r: 7, dmg: 10, life: 2.4, color: '#ff5511' });
      }
    }
    i++;
    if (i > 10) clearInterval(id);
  }, 75);
  addParticles(b.x, b.y, '#ff5511', 20, 200, 0.5);
  screenShake(4);
}

// Ice: trzy lance lodowe — szybkie, wąskie
function bossAttackIceLance(b) {
  const baseAng = Math.atan2(player.y - b.y, player.x - b.x);
  for (let k = 0; k < 3; k++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = baseAng + rand(-0.1, 0.1);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*600, vy: Math.sin(a)*600, r: 4, dmg: 14, life: 1.6, color: '#ccf0ff' });
    }, k * 120);
  }
  addParticles(b.x, b.y, '#88ddff', 18, 240, 0.4);
  screenShake(5);
}

// Ice: pułapki lodowe — 5 min stref zamrożenia wokół gracza
function bossAttackFrostTrap(b) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU;
    const tx = player.x + Math.cos(a) * rand(40, 130);
    const ty = player.y + Math.sin(a) * rand(40, 130);
    state.hazards.push({ x: tx, y: ty, vx: 0, vy: 0, r: 22, dmg: 8, life: 6, color: '#77ccee', kind: 'pool', tickAcc: 0 });
    addParticles(tx, ty, '#88ddff', 8, 60, 0.4);
  }
  addParticles(b.x, b.y, '#aaddff', 20, 180, 0.5);
  screenShake(4);
}

// Titan: trzęsienie ziemi — fale z bosca w 4 kierunkach
function bossAttackEarthquake(b) {
  for (let dir = 0; dir < 4; dir++) {
    const a = dir * (TAU / 4) + b.bob * 0.3;
    for (let i = 1; i <= 4; i++) {
      setTimeout(() => {
        if (!state.boss || !state.running) return;
        const spd = 140 + i * 20;
        state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, r: 14 - i, dmg: 12, life: 2.4, color: '#6a5030' });
      }, i * 80 + dir * 20);
    }
  }
  addParticles(b.x, b.y + 20, '#5a4030', 50, 280, 0.7);
  screenShake(18);
  addFloater(b.x, b.y - 50, 'TRZĘSIENIE!', '#aa8833');
}

// Titan: grad skał — 8 szybkich kamieni
function bossAttackRockBarrage(b) {
  for (let i = 0; i < 8; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.25, 0.25);
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*310, vy: Math.sin(a)*310, r: 8, dmg: 12, life: 2.6, color: '#7a6040' });
    }, i * 80);
  }
  addParticles(b.x, b.y, '#8a7040', 24, 200, 0.5);
  screenShake(8);
}

// Necro: klątwa śmierci — 8 wolnych boltów po łuku
function bossAttackDeathCurse(b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const a = (i / n) * TAU + b.bob;
      state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*130, vy: Math.sin(a)*130, r: 7, dmg: 13, life: 4.5, color: '#882266' });
    }, i * 60);
  }
  addParticles(b.x, b.y, '#882266', 20, 160, 0.6);
  addFloater(b.x, b.y - 48, 'KLĄTWA!', '#aa2277');
  screenShake(5);
}

// Necro: pierścień kości + przywołanie
function bossAttackBoneRing(b) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*170, vy: Math.sin(a)*170, r: 5, dmg: 9, life: 3.0, color: '#ddd8b0' });
  }
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * TAU;
    spawnEnemyAt('skeleton', clamp(b.x + Math.cos(a)*90, 30, WORLD_W-30), clamp(b.y + Math.sin(a)*90, 30, WORLD_H-30));
  }
  addParticles(b.x, b.y, '#ccc8a0', 24, 200, 0.5);
  screenShake(5);
}

// Spider: skok — teleport blisko gracza + seria sieci
function bossAttackSpiderLeap(b) {
  addParticles(b.x, b.y, '#2a7a1a', 20, 180, 0.5);
  const a = Math.random() * TAU;
  b.x = clamp(player.x + Math.cos(a) * 90, 30, WORLD_W - 30);
  b.y = clamp(player.y + Math.sin(a) * 90, 30, WORLD_H - 30);
  b.teleportFlash = 0.3;
  addParticles(b.x, b.y, '#2a7a1a', 30, 200, 0.6);
  for (let i = 0; i < 8; i++) {
    const wa = (i / 8) * TAU;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(wa)*140, vy: Math.sin(wa)*140, r: 7, dmg: 8, life: 3.0, color: '#44aa22' });
  }
  screenShake(7);
  addFloater(b.x, b.y - 46, 'SKOK PAJĄKA!', '#44cc22');
}

// Spider: jaja — spawn pająków + kałuże sieci
function bossAttackEggBurst(b) {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const ex = clamp(b.x + Math.cos(a)*80, 30, WORLD_W-30);
    const ey = clamp(b.y + Math.sin(a)*80, 30, WORLD_H-30);
    spawnEnemyAt('bat', ex, ey);
    state.hazards.push({ x: ex, y: ey, vx: 0, vy: 0, r: 30, dmg: 6, life: 8, color: '#1a5a0a', kind: 'pool', tickAcc: 0 });
    addParticles(ex, ey, '#3a8a1a', 10, 80, 0.4);
  }
  addParticles(b.x, b.y, '#44aa22', 20, 180, 0.5);
  addFloater(b.x, b.y - 46, 'JAJA!', '#44cc22');
  screenShake(5);
}

// Wraith: void surge — 3 teleporty z salwą boltów z każdego miejsca
function bossAttackVoidSurge(b) {
  for (let t = 0; t < 3; t++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      addParticles(b.x, b.y, '#6040ff', 16, 160, 0.4);
      const a = Math.random() * TAU;
      b.x = clamp(player.x + Math.cos(a)*130, 30, WORLD_W-30);
      b.y = clamp(player.y + Math.sin(a)*130, 30, WORLD_H-30);
      b.teleportFlash = 0.25;
      addParticles(b.x, b.y, '#6040ff', 16, 160, 0.5);
      for (let k = 0; k < 5; k++) {
        const va = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.2, 0.2);
        state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(va)*380, vy: Math.sin(va)*380, r: 5, dmg: 11, life: 2.2, color: '#8060ff' });
      }
    }, t * 350);
  }
  screenShake(5);
}

// Wraith: void cage — otacza gracza 8 pociskami
function bossAttackVoidCage(b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const ox = player.x + Math.cos(a) * 180;
    const oy = player.y + Math.sin(a) * 180;
    const va = Math.atan2(player.y - oy, player.x - ox);
    state.hazards.push({ x: ox, y: oy, vx: Math.cos(va)*200, vy: Math.sin(va)*200, r: 6, dmg: 12, life: 2.8, color: '#5533ff' });
  }
  addParticles(player.x, player.y, '#6040ff', 24, 200, 0.5);
  screenShake(6);
  addFloater(b.x, b.y - 48, 'VOID CAGE!', '#8060ff');
}

// Drake: wezwanie burzy — 5 piorunów na pozycji gracza z opóźnieniem
function bossAttackStormCall(b) {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (!state.boss || !state.running) return;
      const tx = player.x + rand(-60, 60), ty = player.y + rand(-60, 60);
      addParticles(tx, ty - 200, '#ffe44a', 8, 60, 0.3);
      setTimeout(() => {
        if (!state.boss || !state.running) return;
        state.hazards.push({ x: tx, y: ty - 280, vx: 0, vy: 900, r: 5, dmg: 14, life: 0.5, color: '#ffe44a' });
        addParticles(tx, ty, '#ffe44a', 20, 200, 0.5);
        screenShake(5);
      }, 300);
    }, i * 200);
  }
  addFloater(b.x, b.y - 48, 'WEZWANIE BURZY!', '#ffe44a');
}

// Drake: elektryczny wybuch — nova + charge
function bossAttackElectricBurst(b) {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + b.bob;
    state.hazards.push({ x: b.x, y: b.y, vx: Math.cos(a)*250, vy: Math.sin(a)*250, r: 5, dmg: 11, life: 2.8, color: '#ffe44a' });
  }
  addParticles(b.x, b.y, '#ffe44a', 30, 260, 0.5);
  screenShake(10);
  bossAttackCharge(b);
}

const MAX_HAZARDS = 160;
function bossAttackSpiral(b) {
  let i = 0;
  const startAng = b.bob * 2;
  const id = setInterval(() => {
    if (!state.boss || !state.running) { clearInterval(id); return; }
    if (state.hazards.length < MAX_HAZARDS) {
      const a = startAng + i * 0.48;
      for (let k = 0; k < 2; k++) {
        const aa = a + k * Math.PI;
        state.hazards.push({
          x: b.x, y: b.y,
          vx: Math.cos(aa) * 200, vy: Math.sin(aa) * 200,
          r: 5, dmg: 10, life: 2.6, color: '#a060ff',
        });
      }
    }
    i++;
    if (i > 12) clearInterval(id);
  }, 85);
}

function updatePickups(dt) {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    p.life -= dt;
    p.bob += dt * 5;
    const dx = player.x - p.x, dy = player.y - p.y;
    if (dx * dx + dy * dy < 22 * 22) {
      if (p.kind === 'hp') {
        player.hp = Math.min(player.hpMax, player.hp + 16);
        addFloater(player.x, player.y - 16, '+16 HP', '#9bff9b');
        addParticles(p.x, p.y, '#ff7a9a', 12, 140, 0.4);
      } else if (p.kind === 'mp') {
        player.mp = Math.min(player.mpMax, player.mp + 15);
        addFloater(player.x, player.y - 16, '+15 MP', '#9bd6ff');
        addParticles(p.x, p.y, '#8ad8ff', 12, 140, 0.4);
      } else if (p.kind === 'scroll') {
        player.dmgBonus += 2;
        addFloater(player.x, player.y - 16, 'ZWÓJ +2 OGIEŃ', '#ff8855');
        addParticles(p.x, p.y, '#a060ff', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'quiver') {
        player.dmgBonus += 2;
        if (player.pierceBonus < 2) player.pierceBonus += 1;
        addFloater(player.x, player.y - 16, 'KOŁCZAN +ŁUK', '#ffd66b');
        addParticles(p.x, p.y, '#e8e0c0', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'medkit') {
        player.healBonus += 2;
        player.hp = Math.min(player.hpMax, player.hp + 12);
        addFloater(player.x, player.y - 16, 'APTECZKA +LECZENIE', '#9bff9b');
        addParticles(p.x, p.y, '#9bff9b', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'shard') {
        player.dmgBonus += 2;
        player.speed = Math.min(player.speed + 5, 380);
        addFloater(player.x, player.y - 16, 'ODŁAMEK +2 ATAK', '#e0e8ff');
        addParticles(p.x, p.y, '#c0d0ff', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'totem') {
        player.dmgBonus += 2;
        player.mpMax += 10; player.mp = Math.min(player.mpMax, player.mp + 10);
        addFloater(player.x, player.y - 16, 'TOTEM +MAGIA', '#8ae8ff');
        addParticles(p.x, p.y, '#8ae8ff', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'kunai') {
        player.dmgBonus += 1;
        player.fireRate = Math.max(player.fireRate * 0.92, 0.07);
        addFloater(player.x, player.y - 16, 'KUNAI +SZYBKOŚĆ', '#c8c8d8');
        addParticles(p.x, p.y, '#c8c8d8', 16, 160, 0.5);
        screenShake(3);
      } else if (p.kind === 'wood') {
        addToInvGrid('wood', 1);
        addFloater(player.x, player.y - 16, '+1 DREWNO', '#c8a060');
        addParticles(p.x, p.y, '#c8a060', 6, 70, 0.3);
      } else if (p.kind === 'stone') {
        addToInvGrid('stone', 1);
        addFloater(player.x, player.y - 16, '+1 KAMIEN', '#9090a0');
        addParticles(p.x, p.y, '#9090a0', 6, 70, 0.3);
      } else if (p.kind === 'coin') {
        state.money += p.value;
        addFloater(player.x, player.y - 16, `+$${p.value}`, '#ffd700');
        addParticles(p.x, p.y, '#ffd700', 8, 90, 0.35);
      } else if (p.kind === 'bone') {
        addToInvGrid('bone', 1);
        addFloater(player.x, player.y - 16, '+1 KOSC', '#e0dcc8');
        addParticles(p.x, p.y, '#e0dcc8', 6, 70, 0.3);
      } else if (p.kind === 'meat') {
        if (addToHotbar('meat', 1)) { addFloater(player.x, player.y-16, 'MIESO → hotbar', '#ff9966'); addParticles(p.x, p.y, '#ff9966', 6, 70, 0.3); }
        else { addFloater(player.x, player.y-16, 'HOTBAR PELNY!', '#ff4060'); }
      } else if (p.kind === 'bone_sword') {
        if (addToHotbar('bone_sword', 1)) { addFloater(player.x, player.y-16, 'MIECZ KOSTNY → hotbar!', '#d0ccb8'); addParticles(p.x, p.y, '#d0ccb8', 14, 120, 0.4); }
        else { addFloater(player.x, player.y-16, 'HOTBAR PELNY!', '#ff4060'); }
      }
      state.pickups.splice(i, 1);
      continue;
    }
    if (p.life <= 0) state.pickups.splice(i, 1);
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function updateFloaters(dt) {
  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const f = state.floaters[i];
    f.y += f.vy * dt;
    f.vy *= 0.96;
    f.life -= dt;
    if (f.life <= 0) state.floaters.splice(i, 1);
  }
}

function updateSpawns(dt) {
  if (state.inDungeon) return;

  // W dzień: tylko pasywne zwierzęta (spawny wrogów = stop)
  if (isDay()) {
    state._wasNight = false;
    return;
  }

  // Pierwszy tick nocy: spawny "pocztu" jak w Minecraft (mała horda startowa)
  if (!state._wasNight) {
    state._wasNight = true;
    const packSize = 3 + Math.min(6, Math.floor(state.time / 40));
    for (let k = 0; k < packSize; k++) spawnRandomEnemyNearPlayer();
    state.spawnTimer = 4.0;
    addFloater(player.x, player.y - 48, 'NOC NADCHODZI...', '#8855ff');
  }

  // Minecraft-like: małe grupy co kilka sekund, cap niższy niż w floodzie
  state.spawnTimer -= dt;
  // Wrogowie pasywni (owce/świnie) nie liczą się do limitu
  const hostileCount = state.enemies.filter(e => !e.passive).length;
  const cap = state.bossActive ? 20 : 35;
  if (state.spawnTimer <= 0 && hostileCount < cap) {
    // Grupa 1-2 mobów (rzadko 3), jak w Minecraft
    const groupSize = Math.random() < 0.25 ? 3 : (Math.random() < 0.5 ? 2 : 1);
    for (let k = 0; k < groupSize; k++) spawnRandomEnemyNearPlayer();
    // Przerwa rośnie z czasem (Minecraft: trudniej = częściej, ale powoli)
    const baseInterval = Math.max(2.5, 6.0 - state.time / 50);
    state.spawnTimer = state.bossActive ? baseInterval * 2.0 : baseInterval;
  }
}

function updateBossArenas() {
  if (state.inDungeon || state.bossActive) return;
  for (const d of state.decor) {
    if (d.type !== 'boss_arena' || d.cleared) continue;
    const dx = player.x - d.x, dy = player.y - d.y;
    const def = BOSS_ARENA_DEFS[d.variant];
    if (dx*dx + dy*dy < def.triggerR * def.triggerR) {
      spawnBoss(d.x, d.y - 60, d.bossId, d.arenaKey);
      addFloater(player.x, player.y - 65, `⚔ ${def.name.toUpperCase()} ⚔`, def.col);
      screenShake(14);
      break;
    }
  }
}

function updateHud() {
  hpBar.style.width = (player.hp / player.hpMax * 100).toFixed(1) + '%';
  mpBar.style.width = (player.mp / player.mpMax * 100).toFixed(1) + '%';
  if (state.bossActive) {
    waveLabel.textContent = `BOSS ${state.bossesDefeated + 1}: ${state.boss.name}`;
  } else {
    const t = Math.floor(state.time);
    const dayLabel = getDayLabel();
    if (isDay()) {
      const toNight = timeToNight();
      waveLabel.textContent = `${dayLabel} · Noc za ${toNight}s · [E]Kopaj [B]Buduj`;
    } else {
      waveLabel.textContent = `${dayLabel} · ${t}s · [E]Kopaj [B]Buduj`;
    }
  }
  enemyCount.textContent = `Wrogowie: ${state.enemies.length}`;
  killCountEl.textContent = `Pokonani: ${state.kills}`;
  scoreEl.textContent = `Punkty: ${state.score}`;
  moneyEl.textContent = `$${state.money}`;
}

// ============================================================
//   RENDER
// ============================================================

function pxRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Visibility check (world coords) against screen + margin
function inView(x, y, margin = 60) {
  return x > camera.x - margin && x < camera.x + SW + margin &&
         y > camera.y - margin && y < camera.y + SH + margin;
}

function render() {
  const sx = (Math.random() - 0.5) * state.shake;
  const sy = (Math.random() - 0.5) * state.shake;

  ctx.save();
  ctx.translate(-camera.x + sx, -camera.y + sy);

  drawGround();
  drawResourceNodes();
  drawDecor();
  drawBuildings();
  drawChests();
  drawPickups();
  drawHazards();
  drawProjectiles();
  drawEnemies();
  drawPlayer();
  drawSkillFX();
  drawParticles();
  drawFloaters();
  drawWorldBorder();

  ctx.restore();

  drawNightOverlay();

  // Damage flash
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 90, ${state.flash * 0.35})`;
    ctx.fillRect(0, 0, SW, SH);
  }

  // Winietka — ciemne krawędzie dla kinowego klimatu
  const vGrad = ctx.createRadialGradient(SW/2, SH/2, SH*0.22, SW/2, SH/2, SW*0.82);
  vGrad.addColorStop(0,   'transparent');
  vGrad.addColorStop(0.6, 'rgba(0,0,0,0.08)');
  vGrad.addColorStop(1,   'rgba(0,0,0,0.72)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, SW, SH);

  drawMinimap();
  drawTimeOfDay();
  drawResourceHud();
  drawBuildMode();
  drawBuildingSelector();
  drawHotbar();
  drawSkillBar();
  drawBossBar();
  drawCraftingUI();
  drawFurnaceUI();
  drawEquipPanel();
  drawInventoryPanel();
  drawCrosshair();
}

function drawBossBar() {
  if (!state.bossActive || !state.boss) return;
  const bw = 500, bh = 18;
  const bx = Math.round(SW / 2 - bw / 2);
  const by = 10;
  // Tło paska
  ctx.fillStyle = '#0f0b1e';
  ctx.fillRect(bx - 10, by - 22, bw + 20, bh + 30);
  ctx.strokeStyle = '#3a2d5c';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx - 10, by - 22, bw + 20, bh + 30);
  // Nazwa bossa
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px "Courier New"';
  ctx.fillStyle = '#ff8aa8';
  ctx.fillText(`BOSS — ${state.boss.name}`, SW / 2, by - 6);
  // Tor paska
  ctx.fillStyle = '#0a0814';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#2d2447';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  // Wypełnienie paska (gradient imitowany dwoma prostokątami)
  const pct = Math.max(0, state.boss.hp / state.boss.maxHp);
  const fw = Math.round(pct * bw);
  if (fw > 0) {
    const grad = ctx.createLinearGradient(bx, 0, bx + fw, 0);
    grad.addColorStop(0, '#8a2bff');
    grad.addColorStop(1, '#ff4060');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, fw, bh);
  }
  // Błysk na pasku enrage (<30% HP)
  if (pct < 0.3 && Math.sin(state.time * 12) > 0.5) {
    ctx.fillStyle = 'rgba(255,60,90,0.25)';
    ctx.fillRect(bx, by, fw, bh);
  }
}

function drawCraftingUI() {
  if (!state.craftingOpen) return;
  const recipes = getRecipes();
  const lvl = state.craftingLevel;
  const upgradeFooter = lvl < 3 ? 20 : 0;
  const pw = 370, rh = 30, ph = 58 + recipes.length * rh + upgradeFooter + 14;
  const px = Math.round(SW/2 - pw/2), py = Math.round(SH/2 - ph/2);

  ctx.fillStyle = 'rgba(8,6,18,0.97)';
  ctx.fillRect(px, py, pw, ph);
  const borderCol = lvl === 3 ? '#9a44ff' : lvl === 2 ? '#3a8a3a' : '#8a6a2a';
  ctx.strokeStyle = borderCol; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
  ctx.strokeStyle = borderCol + '66'; ctx.lineWidth = 1; ctx.strokeRect(px+3, py+3, pw-6, ph-6);

  // Nagłówek
  ctx.textAlign = 'center'; ctx.font = 'bold 13px "Courier New"';
  ctx.fillStyle = '#ffd66b'; ctx.fillText('STOL RZEMIOSLA', px+pw/2-30, py+18);
  const lvlColors = ['','#c8b470','#3a8a3a','#9a44ff'];
  ctx.fillStyle = lvlColors[lvl] || '#ccc'; ctx.font = 'bold 11px "Courier New"';
  ctx.fillText(`POZ.${lvl}/3`, px+pw-28, py+18);
  ctx.fillStyle = '#4a3a18'; ctx.fillRect(px+8, py+24, pw-16, 1);

  // Złoto gracza
  ctx.textAlign = 'left'; ctx.font = '10px "Courier New"'; ctx.fillStyle = '#ffd700';
  ctx.fillText(`$${state.money}`, px+12, py+38);
  ctx.fillStyle = '#6a5530';
  ctx.fillText(`D:${state.resources.wood} K:${state.resources.stone}`, px+80, py+38);
  ctx.fillStyle = '#4a3a18'; ctx.fillRect(px+8, py+42, pw-16, 1);

  recipes.forEach((r, i) => {
    const ry = py + 50 + i * rh;
    const sel = i === state.craftingSelected;
    const goldCost = r.cost.gold || 0;
    const okRes = state.resources.wood >= r.cost.wood && state.resources.stone >= r.cost.stone;
    const okGold = goldCost <= 0 || state.money >= goldCost;
    const ok = okRes && okGold;
    // Kolor tła wg poziomu
    if (sel) {
      const bgCol = r.level === 3 ? 'rgba(60,20,90,0.6)' : r.level === 2 ? 'rgba(20,60,20,0.6)' : 'rgba(90,68,22,0.5)';
      ctx.fillStyle = bgCol; ctx.fillRect(px+5, ry, pw-10, rh-2);
      ctx.strokeStyle = borderCol; ctx.lineWidth = 1; ctx.strokeRect(px+5, ry, pw-10, rh-2);
    }
    ctx.textAlign = 'left'; ctx.font = (sel ? 'bold ' : '') + '11px "Courier New"';
    const nameCol = r.level === 3 ? (ok ? '#cc88ff' : '#5a3a80') : r.level === 2 ? (ok ? '#88ee88' : '#2a5a2a') : (ok ? (sel ? '#ffe090' : '#c8b470') : '#5a4828');
    ctx.fillStyle = nameCol;
    ctx.fillText((sel ? '> ' : '  ') + r.name, px+12, ry+18);
    // Koszt surowców
    let cs = '';
    if (r.cost.wood > 0) cs += `D:${r.cost.wood} `;
    if (r.cost.stone > 0) cs += `K:${r.cost.stone}`;
    if (goldCost > 0) cs += (cs ? ' ' : '') + `$${goldCost}`;
    ctx.textAlign = 'center'; ctx.fillStyle = ok ? '#88cc44' : '#4a6028'; ctx.font = '10px "Courier New"';
    ctx.fillText(cs, px+pw/2 + 10, ry+18);
    ctx.textAlign = 'right'; ctx.fillStyle = '#6a9aaa';
    ctx.fillText(r.desc, px+pw-10, ry+18);
  });

  // Przycisk ulepszenia
  if (lvl < 3) {
    const upgCost = CRAFTING_UPGRADE_COST[lvl];
    const canUpg = state.money >= upgCost;
    const fy = py + ph - upgradeFooter - 5;
    ctx.fillStyle = '#4a3a18'; ctx.fillRect(px+8, fy, pw-16, 1);
    ctx.textAlign = 'center'; ctx.font = '10px "Courier New"';
    ctx.fillStyle = canUpg ? '#ffd700' : '#6a5030';
    ctx.fillText(`[U] Ulepsz stół do poz.${lvl+1}: $${upgCost}`, px+pw/2, fy+14);
  }
  ctx.textAlign = 'center'; ctx.font = '9px "Courier New"'; ctx.fillStyle = '#6a5530';
  ctx.fillText('[W/S] wybierz  [E] zrób  [U] ulepsz  [ESC] zamknij', px+pw/2, py+ph-3);
}

// ---- Hotbar ----
function drawHotbar() {
  if (!state.running) return;
  const sw = 42, sh = 42, gap = 3, n = 9;
  const totalW = n * sw + (n-1) * gap;
  const startX = Math.round(SW/2 - totalW/2);
  const startY = SH - sh - 6;
  for (let i = 0; i < n; i++) {
    const x = startX + i * (sw + gap), y = startY;
    const sel = i === player.hotbarSel;
    // Tło slotu
    ctx.fillStyle = sel ? 'rgba(255,215,0,0.22)' : 'rgba(8,6,18,0.82)';
    ctx.fillRect(x, y, sw, sh);
    ctx.strokeStyle = sel ? '#ffd700' : '#3a2d5c';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(x, y, sw, sh);
    // Numer slotu
    ctx.textAlign = 'left'; ctx.font = '8px "Courier New"';
    ctx.fillStyle = sel ? '#ffd700' : '#504060';
    ctx.fillText(String(i+1), x+2, y+9);
    // Item
    const slot = player.hotbar[i];
    if (!slot) continue;
    const cx = x + sw/2, cy = y + sh/2;
    if (slot.kind === 'potion') {
      pxRect(cx-4, cy-7, 8, 12, '#a040c0'); pxRect(cx-3, cy-9, 6, 3, '#d060e0');
      pxRect(cx-2, cy-6, 4, 8, '#e080ff'); pxRect(cx-1, cy-5, 2, 3, '#ffccff');
    } else if (slot.kind === 'mpot') {
      pxRect(cx-4, cy-7, 8, 12, '#c04090'); pxRect(cx-3, cy-9, 6, 3, '#e060aa');
      pxRect(cx-2, cy-6, 4, 8, '#ff88cc'); pxRect(cx-1, cy-5, 2, 3, '#ffccee');
    } else if (slot.kind === 'meat') {
      pxRect(cx-6, cy-4, 12, 8, '#c83828'); pxRect(cx-5, cy-5, 5, 2, '#3a2010');
      pxRect(cx-4, cy-2, 8, 5, '#e05040'); pxRect(cx-2, cy-1, 4, 3, '#ff6050');
    } else if (slot.kind === 'bone_sword') {
      pxRect(cx-2, cy-14, 4, 20, '#d0ccb8'); pxRect(cx-2, cy-14, 4, 5, '#fff8e8');
      pxRect(cx-7, cy-2, 14, 3, '#b0aa98'); pxRect(cx-1, cy+6, 2, 6, '#c8a860');
      pxRect(cx-3, cy-10, 2, 3, '#a89878'); pxRect(cx+1, cy-6, 2, 3, '#a89878');
    } else if (slot.kind === 'sword' || slot.kind === 'sword2') {
      const sc = slot.kind === 'sword2' ? '#cc44ff' : '#c0d8ff';
      pxRect(cx-2, cy-14, 4, 20, '#888'); pxRect(cx-2, cy-14, 4, 4, sc);
      pxRect(cx-7, cy-2, 14, 3, '#666'); pxRect(cx-1, cy+6, 2, 6, '#8a6a2a');
    } else if (slot.kind === 'mace') {
      pxRect(cx-3, cy-14, 6, 8, '#ff8844'); pxRect(cx-2, cy-8, 4, 4, '#ffaa66');
      pxRect(cx-2, cy-4, 4, 14, '#888'); pxRect(cx-1, cy+8, 2, 5, '#8a6a2a');
    } else if (slot.kind === 'bow' || slot.kind === 'bow2') {
      const bc = slot.kind === 'bow2' ? '#44aaff' : '#c8e8c0';
      ctx.strokeStyle = bc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 10, -Math.PI*0.7, Math.PI*0.7); ctx.stroke();
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy-10); ctx.lineTo(cx, cy+10); ctx.stroke();
      pxRect(cx, cy-1, 14, 2, '#aaa');
    } else if (slot.kind === 'staff') {
      pxRect(cx-1, cy-14, 3, 20, '#7040a0');
      pxRect(cx-4, cy-15, 9, 5, '#d0a0ff'); pxRect(cx-2, cy-17, 5, 3, '#e0c0ff');
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha *= 0.8;
      ctx.beginPath(); ctx.arc(cx, cy-15, 3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (slot.kind === 'event_lich') {
      pxRect(cx-1, cy-13, 3, 18, '#7722aa');
      pxRect(cx-4, cy-14, 9, 5, '#bb55ff'); pxRect(cx-2, cy-16, 5, 3, '#dd88ff');
      ctx.fillStyle = '#cc66ff'; ctx.globalAlpha *= 0.85;
      ctx.beginPath(); ctx.arc(cx, cy-14, 4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (slot.kind === 'event_demon') {
      pxRect(cx-2, cy-14, 5, 20, '#881100'); pxRect(cx-1, cy-14, 3, 6, '#ff4422');
      pxRect(cx-7, cy-2, 14, 3, '#550000'); pxRect(cx-1, cy+7, 2, 6, '#5a2a10');
      pxRect(cx-2, cy-13, 4, 4, '#ff8844');
    } else if (slot.kind === 'event_titan') {
      pxRect(cx-7, cy-5, 14, 11, '#aa8818'); pxRect(cx-6, cy-9, 12, 6, '#ccaa28');
      pxRect(cx-5, cy-4, 10, 9, '#bbaa22'); pxRect(cx-4, cy-7, 8, 4, '#ffe055');
    } else if (slot.kind === 'event_spider') {
      pxRect(cx-5, cy-12, 4, 16, '#115511'); pxRect(cx+1, cy-12, 4, 16, '#115511');
      pxRect(cx-4, cy-6, 8, 9, '#22aa22'); pxRect(cx-2, cy-11, 4, 5, '#55ee55');
    } else if (slot.kind === 'event_ice') {
      // Ice wand — błękitna różdżka z kryształem
      pxRect(cx-1, cy-13, 3, 18, '#336688');
      pxRect(cx-5, cy-16, 11, 6, '#88ddff'); pxRect(cx-3, cy-18, 7, 3, '#ccf0ff');
      ctx.fillStyle = '#aaeeff'; ctx.globalAlpha *= 0.85;
      ctx.beginPath(); ctx.arc(cx, cy-15, 4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (slot.kind === 'event_necro') {
      // Necro staff — czarny kostur z czaszką
      pxRect(cx-1, cy-14, 3, 20, '#332244');
      pxRect(cx-4, cy-15, 9, 5, '#9933aa'); pxRect(cx-2, cy-17, 5, 3, '#cc55dd');
      pxRect(cx-3, cy-16, 7, 5, '#441155');
      ctx.fillStyle = '#8822aa'; ctx.globalAlpha *= 0.8;
      ctx.beginPath(); ctx.arc(cx, cy-15, 3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (slot.kind === 'event_wraith') {
      // Void blade — fioletowy miecz z aurą
      pxRect(cx-2, cy-14, 5, 22, '#1a0040'); pxRect(cx-1, cy-14, 3, 7, '#6040ff');
      pxRect(cx-7, cy-2, 14, 3, '#220060'); pxRect(cx-1, cy+8, 2, 5, '#330066');
      pxRect(cx-2, cy-13, 4, 4, '#9966ff');
    } else if (slot.kind === 'event_drake') {
      // Storm scepter — złote berło z błyskawicą
      pxRect(cx-1, cy-14, 3, 20, '#996600');
      pxRect(cx-5, cy-15, 11, 7, '#ffe44a'); pxRect(cx-3, cy-17, 7, 4, '#ffff88');
      pxRect(cx-1, cy-18, 2, 5, '#ffe44a'); pxRect(cx, cy-18, 3, 3, '#ffffff');
    }
    // Cooldown overlay dla event broni (PPM)
    const isEventSlot = slot.kind in HOTBAR_WEAPONS && HOTBAR_WEAPONS[slot.kind].event;
    if (isEventSlot) {
      const rmbCdMax = EVENT_RMB_CDS[slot.kind] || 12;
      const rmbCdLeft = (i === player.hotbarSel) ? player._eventRMBCd : 0;
      if (rmbCdLeft > 0) {
        const frac = rmbCdLeft / rmbCdMax;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y + sh * (1 - frac), sw, sh * frac);
        ctx.textAlign = 'center'; ctx.font = 'bold 9px "Courier New"';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(Math.ceil(rmbCdLeft) + 's', cx, y + sh/2 + 4);
      }
    }
    // Licznik lub nazwa broni
    if (slot.kind in HOTBAR_WEAPONS) {
      ctx.textAlign = 'center'; ctx.font = '7px "Courier New"';
      const wDef2 = HOTBAR_WEAPONS[slot.kind];
      ctx.fillStyle = wDef2.color;
      const displayLabel = wDef2.label || wDef2.name.split(' ')[0];
      ctx.fillText(displayLabel, cx, y+sh-3);
    } else if (slot.count > 1) {
      ctx.textAlign = 'right'; ctx.font = 'bold 9px "Courier New"';
      ctx.fillStyle = '#000'; ctx.fillText(slot.count, x+sw-1, y+sh-1);
      ctx.fillStyle = '#ffffff'; ctx.fillText(slot.count, x+sw-2, y+sh-2);
    }
  }
  // Wskazówka użycia
  const selSlot = player.hotbar[player.hotbarSel];
  if (selSlot) {
    const isWeapon = selSlot.kind in HOTBAR_WEAPONS;
    const isEventW = isWeapon && HOTBAR_WEAPONS[selSlot.kind].event;
    ctx.textAlign = 'center'; ctx.font = '8px "Courier New"'; ctx.fillStyle = '#a090c0';
    if (isEventW) {
      const cdLeft = player._eventRMBCd;
      const hint = cdLeft > 0
        ? '[PPM] ' + Math.ceil(cdLeft) + 's'
        : '[LPM] atak  [PPM] MOC';
      ctx.fillText(hint, SW/2, SH - sh - 10);
    } else {
      ctx.fillText(isWeapon ? '[LPM] atak bronią' : '[F] użyj', SW/2, SH - sh - 10);
    }
  }
}

// ---- Pasek umiejętności ----
function drawSkillBar() {
  if (!state.running) return;
  const cid = player.baseClass;
  const skills = CLASS_SKILLS[cid];
  if (!skills) return;
  const sw = 52, sh = 48, gap = 3, n = 5;
  const startX = 8, startY = SH - sh - 54; // powyżej hotbara
  const keys = ['SP','X','C','V','R'];
  for (let i = 0; i < n; i++) {
    const sk = skills[i];
    if (!sk) continue;
    const x = startX + i * (sw + gap), y = startY;
    const unlocked = save.hasSkill(cid, i);
    const cd = player.skillCds[i];
    const cdMax = sk.cd || 1;
    const cdFrac = i === 0 ? 0 : (cd / cdMax);
    const isSpace = i === 0;
    const spaceActive = isSpace && player.skillActive;

    // Tło
    ctx.fillStyle = unlocked ? (spaceActive ? 'rgba(255,140,50,0.18)' : 'rgba(8,6,18,0.82)') : 'rgba(4,3,10,0.9)';
    ctx.fillRect(x, y, sw, sh);

    if (!unlocked) {
      // Zablokowana — pokaż kłódkę i cenę
      ctx.fillStyle = sk.col || '#444444'; ctx.globalAlpha = 0.3;
      ctx.fillRect(x, y, sw, 3);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.font = 'bold 8px "Courier New"';
      ctx.fillStyle = '#604060'; ctx.fillText(keys[i], x+sw/2, y+11);
      ctx.font = '14px "Courier New"'; ctx.fillStyle = '#604060';
      ctx.fillText('🔒', x+sw/2, y+28);
      ctx.font = '7px "Courier New"'; ctx.fillStyle = '#886688';
      ctx.fillText('$'+SKILL_PRICES[i], x+sw/2, y+sh-3);
      ctx.strokeStyle = '#2a1a3a'; ctx.lineWidth = 1; ctx.strokeRect(x, y, sw, sh);
      continue;
    }

    // Kolorowy pasek górny
    ctx.fillStyle = sk.col || '#888888'; ctx.fillRect(x, y, sw, 3);
    // Klawisz
    ctx.textAlign = 'center'; ctx.font = 'bold 8px "Courier New"';
    ctx.fillStyle = sk.col || '#aaaaaa';
    ctx.fillText(keys[i], x+sw/2, y+11);
    // Nazwa (skrócona)
    ctx.font = '7px "Courier New"'; ctx.fillStyle = '#a090b0';
    const nameShort = sk.n.length > 8 ? sk.n.slice(0,8) : sk.n;
    ctx.fillText(nameShort, x+sw/2, y+22);
    // CD
    if (i > 0 && cd > 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.55 * cdFrac})`; ctx.fillRect(x, y+3, sw, sh-3);
      ctx.textAlign = 'center'; ctx.font = 'bold 10px "Courier New"';
      ctx.fillStyle = '#ff6666'; ctx.fillText(cd.toFixed(1), x+sw/2, y+sh/2+4);
    } else if (i > 0) {
      ctx.font = '7px "Courier New"'; ctx.fillStyle = '#4a6a44';
      ctx.fillText('GOTOWE', x+sw/2, y+34);
    }
    if (sk.mp > 0) { ctx.font = '7px "Courier New"'; ctx.fillStyle = '#3a5888'; ctx.fillText(sk.mp+'mp', x+sw/2, y+sh-3); }
    ctx.strokeStyle = i===0 && spaceActive ? '#ffd700' : '#2a1a4a';
    ctx.lineWidth = 1; ctx.strokeRect(x, y, sw, sh);
  }
}

function drawFurnaceUI() {
  if (!state.furnaceOpen) return;
  const pw = 360, rh = 32, ph = 50 + FURNACE_RECIPES.length * rh + 20;
  const px = Math.round(SW/2 - pw/2), py = Math.round(SH/2 - ph/2);
  ctx.fillStyle = 'rgba(12,6,4,0.97)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#8a4a18'; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
  ctx.strokeStyle = '#5a2a08'; ctx.lineWidth = 1; ctx.strokeRect(px+3, py+3, pw-6, ph-6);
  ctx.textAlign = 'center'; ctx.font = 'bold 13px "Courier New"';
  ctx.fillStyle = '#ff9944'; ctx.fillText('PIEC — KUŹNIA', px+pw/2, py+18);
  // Zasoby
  ctx.font = '9px "Courier New"'; ctx.fillStyle = '#a09090';
  ctx.fillText(`D:${state.resources.wood}  K:${state.resources.stone}  KOŚCI:${state.resources.bone||0}`, px+pw/2, py+32);
  ctx.fillStyle = '#5a2a08'; ctx.fillRect(px+8, py+36, pw-16, 1);
  FURNACE_RECIPES.forEach((r, i) => {
    const ry = py + 42 + i * rh;
    const sel = i === state.furnaceSelected;
    const res = state.resources;
    const ok = res.wood >= r.cost.wood && res.stone >= r.cost.stone && (res.bone||0) >= r.cost.bone;
    if (sel) {
      ctx.fillStyle = 'rgba(100,50,15,0.55)'; ctx.fillRect(px+5, ry, pw-10, rh-2);
      ctx.strokeStyle = '#8a4a18'; ctx.lineWidth = 1; ctx.strokeRect(px+5, ry, pw-10, rh-2);
    }
    ctx.textAlign = 'left'; ctx.font = (sel ? 'bold ' : '') + '11px "Courier New"';
    ctx.fillStyle = ok ? (sel ? '#ffb060' : '#c87840') : '#5a3820';
    ctx.fillText((sel ? '> ' : '  ') + r.name, px+12, ry+20);
    const cs = (r.cost.wood>0?`D:${r.cost.wood} `:'') + (r.cost.stone>0?`K:${r.cost.stone} `:'') + (r.cost.bone>0?`B:${r.cost.bone}`:'');
    ctx.textAlign = 'center'; ctx.fillStyle = ok ? '#88cc44' : '#4a6028';
    ctx.fillText(cs, px+pw/2, ry+20);
    ctx.textAlign = 'right'; ctx.fillStyle = '#6a8aaa'; ctx.font = '10px "Courier New"';
    ctx.fillText(r.desc, px+pw-10, ry+20);
  });
  ctx.textAlign = 'center'; ctx.font = '9px "Courier New"'; ctx.fillStyle = '#6a3520';
  ctx.fillText('[W/S] wybierz  [E] wykuj  [ESC] zamknij', px+pw/2, py+ph-5);
}

function drawEquipPanel() {
  if (!state.equipOpen) return;
  const SLOT_DEFS = [
    { key: 'weapon', label: 'BROŃ',   color: '#ff8844' },
    { key: 'armor',  label: 'ZBROJA', color: '#8888ff' },
    { key: 'boots',  label: 'BUTY',   color: '#44ff88' },
    { key: 'helm',   label: 'HELM',   color: '#ffdd44' },
  ];
  const equippable = getEquippableFromHotbar(SLOT_DEFS[state.equipSlotSel].key);
  const hasHotbar  = equippable.length > 0;
  const pw = 360, ph = hasHotbar ? 230 : 190;
  const px = Math.round(SW/2 - pw/2), py = Math.round(SH/2 - ph/2);

  ctx.fillStyle = 'rgba(8,6,18,0.97)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#604080'; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);

  ctx.textAlign = 'center'; ctx.font = 'bold 13px "Courier New"';
  ctx.fillStyle = '#cc88ff'; ctx.fillText('EKWIPUNEK  [Tab]', px+pw/2, py+18);
  ctx.fillStyle = '#3a2050'; ctx.fillRect(px+8, py+24, pw-16, 1);

  const slotH = 34;
  SLOT_DEFS.forEach((s, i) => {
    const ey = py + 32 + i * slotH;
    const sel = i === state.equipSlotSel;
    const item = player.equip[s.key];

    if (sel) {
      ctx.fillStyle = 'rgba(80,30,120,0.45)';
      ctx.fillRect(px+5, ey, pw-10, slotH-2);
      ctx.strokeStyle = '#8840c0'; ctx.lineWidth = 1;
      ctx.strokeRect(px+5, ey, pw-10, slotH-2);
    }

    ctx.textAlign = 'left'; ctx.font = (sel?'bold ':'') + '10px "Courier New"';
    ctx.fillStyle = sel ? '#ddaaff' : '#605070';
    ctx.fillText((sel?'▶ ':'  ') + s.label + ':', px+10, ey+14);

    ctx.fillStyle = item ? s.color : '#3a2a50';
    ctx.fillText(item ? item.name : '— brak —', px+90, ey+14);

    if (item) {
      const bonuses = [];
      if (item.dmgBonus)    bonuses.push(`+${item.dmgBonus}ATK`);
      if (item.pierceBonus) bonuses.push(`+${item.pierceBonus}PIERCE`);
      if (item.speed)       bonuses.push((item.speed>0?'+':'')+`${item.speed}SPD`);
      if (item.hpMax)       bonuses.push(`+${item.hpMax}HP`);
      if (item.hpRegen)     bonuses.push(`+${item.hpRegen}/s`);
      ctx.font = '8px "Courier New"'; ctx.fillStyle = '#604068';
      ctx.fillText(bonuses.join(' '), px+90, ey+24);
      ctx.textAlign = 'right'; ctx.fillStyle = '#5a2060';
      ctx.fillText('[R] zdejmij', px+pw-8, ey+14);
    }
  });

  const divY = py + 32 + 4 * slotH + 2;
  ctx.fillStyle = '#3a2050'; ctx.fillRect(px+8, divY, pw-16, 1);

  if (hasHotbar) {
    const cursor = state.equipHotbarCursor % equippable.length;
    const hby = divY + 8;
    ctx.textAlign = 'left'; ctx.font = '9px "Courier New"'; ctx.fillStyle = '#8860aa';
    ctx.fillText('BROŃ Z HOTBARA  [A/D] wybierz  [E] załóż:', px+10, hby+10);

    const bw = 78, gap = 6;
    const totalBW = equippable.length * bw + (equippable.length-1)*gap;
    const bx0 = px + pw/2 - totalBW/2;
    equippable.forEach((entry, j) => {
      const bx = Math.round(bx0 + j*(bw+gap));
      const by = hby + 16;
      const isSel = j === cursor;
      ctx.fillStyle = isSel ? 'rgba(100,50,180,0.7)' : 'rgba(30,10,60,0.8)';
      ctx.fillRect(bx, by, bw, 34);
      ctx.strokeStyle = isSel ? '#bb66ff' : '#4a2070';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(bx, by, bw, 34);

      ctx.textAlign = 'center';
      ctx.font = (isSel?'bold ':'') + '9px "Courier New"';
      ctx.fillStyle = isSel ? '#ffddff' : HOTBAR_WEAPONS[entry.kind]?.color || '#aaaaaa';
      ctx.fillText(entry.def.name, bx+bw/2, by+13);

      const bonuses2 = [];
      if (entry.def.dmgBonus)    bonuses2.push(`+${entry.def.dmgBonus}ATK`);
      if (entry.def.pierceBonus) bonuses2.push(`+${entry.def.pierceBonus}P`);
      if (entry.def.speed)       bonuses2.push((entry.def.speed>0?'+':'')+`${entry.def.speed}SPD`);
      ctx.font = '8px "Courier New"'; ctx.fillStyle = isSel ? '#cc99ff' : '#6a4880';
      ctx.fillText(bonuses2.join(' '), bx+bw/2, by+24);

      if (entry.def.melee) {
        ctx.font = '7px "Courier New"'; ctx.fillStyle = isSel ? '#ffaa66' : '#664030';
        ctx.fillText('⚔ melee', bx+bw/2, by+33);
      }
    });
  } else {
    ctx.textAlign = 'center'; ctx.font = '9px "Courier New"'; ctx.fillStyle = '#4a3060';
    ctx.fillText('Brak broni w hotbarze do założenia', px+pw/2, divY+20);
    if (SLOT_DEFS[state.equipSlotSel].key !== 'weapon') {
      ctx.fillStyle = '#3a2050';
      ctx.fillText('(sloty zbroja/buty/helm — tylko przez piec)', px+pw/2, divY+32);
    }
  }

  ctx.textAlign = 'center'; ctx.font = '8px "Courier New"'; ctx.fillStyle = '#3a2050';
  ctx.fillText('[W/S] slot  [E] załóż  [R] zdejmij  [Tab/ESC] zamknij', px+pw/2, py+ph-5);
}

// ============================================================
// PANEL EKWIPUNKU — styl Minecraft
// ============================================================
function drawInventoryPanel() {
  if (!state.inventoryOpen) return;
  const SS = 42, GAP = 4, COLS = 9, INV_ROWS = 3;
  const totalW = COLS * SS + (COLS - 1) * GAP;
  const pw = totalW + 22;
  const titleH = 30;
  const rowH = SS + GAP;
  const ph = titleH + INV_ROWS * rowH + 14 + rowH + 20 + 10;
  const px = Math.round(SW / 2 - pw / 2);
  const py = Math.round(SH / 2 - ph / 2);

  // Tło panelu
  ctx.fillStyle = 'rgba(8,5,20,0.97)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#604080'; ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  ctx.strokeStyle = '#3a1f5a'; ctx.lineWidth = 1;
  ctx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);

  // Tytuł
  ctx.textAlign = 'center'; ctx.font = 'bold 13px "Courier New"';
  ctx.fillStyle = '#cc88ff';
  ctx.fillText('EKWIPUNEK', px + pw / 2, py + 19);
  ctx.fillStyle = '#3a2050'; ctx.fillRect(px + 8, py + titleH - 2, pw - 16, 1);

  const startX = px + 11;

  // Zlicz sumaryczne ilości dla tooltipa pod panelem
  const wCount = getInvCount('wood'), sCount = getInvCount('stone'), bCount = getInvCount('bone');

  // Siatka główna 3×9
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const sx = startX + c * (SS + GAP);
      const sy = py + titleH + r * rowH;
      const slot = player.invGrid[idx];
      // tło slotu — ciemniejsza szachownica jak Minecraft
      ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(18,12,40,0.92)' : 'rgba(14,9,32,0.92)';
      ctx.fillRect(sx, sy, SS, SS);
      // wewnętrzne obramowanie 3D (jaśniejszy górny-lewy, ciemniejszy dolny-prawy)
      ctx.strokeStyle = '#1c1040'; ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, SS, SS);
      ctx.fillStyle = '#2a1a50';
      ctx.fillRect(sx, sy, SS, 1); ctx.fillRect(sx, sy, 1, SS); // górna / lewa krawędź
      ctx.fillStyle = '#0a0520';
      ctx.fillRect(sx, sy + SS - 1, SS, 1); ctx.fillRect(sx + SS - 1, sy, 1, SS); // dolna / prawa
      if (slot) drawInvItem(slot.kind, sx, sy, SS, slot.count > 1 ? slot.count : null);
    }
  }

  // Separator + etykieta hotbar
  const sepY = py + titleH + INV_ROWS * rowH + 4;
  ctx.fillStyle = '#3a1f5a'; ctx.fillRect(px + 8, sepY, pw - 16, 1);
  ctx.textAlign = 'left'; ctx.font = '8px "Courier New"'; ctx.fillStyle = '#5a3880';
  ctx.fillText('HOTBAR:', px + 11, sepY + 10);

  // Wiersz hotbara
  const hotbarY = sepY + 12;
  for (let c = 0; c < COLS; c++) {
    const sx = startX + c * (SS + GAP);
    const slot = player.hotbar[c];
    const sel = c === player.hotbarSel;
    ctx.fillStyle = sel ? 'rgba(255,215,0,0.14)' : 'rgba(18,12,40,0.92)';
    ctx.fillRect(sx, hotbarY, SS, SS);
    ctx.strokeStyle = sel ? '#ffd700' : '#1c1040'; ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(sx, hotbarY, SS, SS);
    if (!sel) {
      ctx.fillStyle = '#2a1a50';
      ctx.fillRect(sx, hotbarY, SS, 1); ctx.fillRect(sx, hotbarY, 1, SS);
      ctx.fillStyle = '#0a0520';
      ctx.fillRect(sx, hotbarY + SS - 1, SS, 1); ctx.fillRect(sx + SS - 1, hotbarY, 1, SS);
    }
    if (slot) drawInvItem(slot.kind, sx, hotbarY, SS, slot.count > 1 ? slot.count : null);
  }

  // Podsumowanie materiałów na dole
  const sumY = py + ph - 17;
  ctx.textAlign = 'center'; ctx.font = '8px "Courier New"';
  ctx.fillStyle = '#c8a060'; ctx.fillText(`D:${wCount}`, px + pw / 2 - 60, sumY);
  ctx.fillStyle = '#9090a0'; ctx.fillText(`K:${sCount}`, px + pw / 2, sumY);
  ctx.fillStyle = '#d0ccb8'; ctx.fillText(`B:${bCount}`, px + pw / 2 + 60, sumY);
  ctx.fillStyle = '#2e1a4a';
  ctx.fillText('[I / ESC] zamknij', px + pw / 2, py + ph - 4);
}

function drawInvItem(kind, sx, sy, SS, count) {
  const cx = sx + SS / 2 | 0, cy = sy + SS / 2 | 0;
  switch (kind) {
    case 'wood':
      pxRect(cx - 8, cy - 6, 16, 12, '#5a3010');
      pxRect(cx - 7, cy - 5, 14, 10, '#8a5020');
      pxRect(cx - 6, cy - 4, 12, 8,  '#c8a060');
      pxRect(cx - 5, cy - 3, 10, 6,  '#d4b070');
      pxRect(cx - 2, cy - 4, 4,  8,  '#a07840');
      pxRect(cx - 1, cy - 5, 2,  10, '#c09050');
      break;
    case 'stone':
      pxRect(cx - 8, cy - 8, 16, 16, '#5a5a68');
      pxRect(cx - 7, cy - 7, 14, 14, '#7a7a8a');
      pxRect(cx - 6, cy - 6, 12, 12, '#9090a0');
      pxRect(cx - 4, cy - 2, 3,  5,  '#606070');
      pxRect(cx + 1, cy - 5, 3,  4,  '#606070');
      pxRect(cx - 2, cy + 2, 4,  2,  '#606070');
      break;
    case 'bone':
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.38);
      pxRect(-8, -2, 16, 4,  '#c8c4b0');
      pxRect(-2, -8, 4,  16, '#c8c4b0');
      pxRect(-3, -3, 6,  6,  '#d8d4c0');
      pxRect(-9, -4, 5,  5,  '#a8a498'); pxRect(4, -4,  5, 5, '#a8a498');
      pxRect(-4, -9, 5,  5,  '#a8a498'); pxRect(-4, 4,  5, 5, '#a8a498');
      ctx.restore();
      break;
    case 'meat':
      pxRect(cx - 6, cy - 4, 12, 8, '#c83828');
      pxRect(cx - 5, cy - 5, 5,  2, '#3a2010');
      pxRect(cx - 4, cy - 2, 8,  5, '#e05040');
      pxRect(cx - 2, cy - 1, 4,  3, '#ff6050');
      break;
    case 'potion':
      pxRect(cx - 4, cy - 7, 8, 12, '#a040c0');
      pxRect(cx - 3, cy - 9, 6, 3,  '#d060e0');
      pxRect(cx - 2, cy - 6, 4, 8,  '#e080ff');
      pxRect(cx - 1, cy - 5, 2, 3,  '#ffccff');
      break;
    case 'mpot':
      pxRect(cx - 4, cy - 7, 8, 12, '#c04090');
      pxRect(cx - 3, cy - 9, 6, 3,  '#e060aa');
      pxRect(cx - 2, cy - 6, 4, 8,  '#ff88cc');
      break;
    case 'sword': case 'sword2': {
      const sc = kind === 'sword2' ? '#cc44ff' : '#c0d8ff';
      pxRect(cx - 2, cy - 13, 4, 18, '#888');
      pxRect(cx - 2, cy - 13, 4, 4,  sc);
      pxRect(cx - 7, cy - 2,  14, 3, '#666');
      pxRect(cx - 1, cy + 5,  2,  7, '#8a6a2a');
      break;
    }
    case 'mace':
      pxRect(cx - 3, cy - 13, 6, 8,  '#ff8844');
      pxRect(cx - 2, cy - 7,  4, 4,  '#ffaa66');
      pxRect(cx - 2, cy - 4,  4, 15, '#888');
      pxRect(cx - 1, cy + 9,  2, 5,  '#8a6a2a');
      break;
    case 'bow': case 'bow2': {
      const bc = kind === 'bow2' ? '#44aaff' : '#c8e8c0';
      ctx.strokeStyle = bc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 11, -Math.PI * 0.72, Math.PI * 0.72); ctx.stroke();
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy + 11); ctx.stroke();
      pxRect(cx, cy - 1, 14, 2, '#aaa');
      break;
    }
    case 'staff':
      pxRect(cx - 1, cy - 14, 3, 20, '#7040a0');
      pxRect(cx - 4, cy - 15, 9, 5,  '#d0a0ff');
      pxRect(cx - 2, cy - 17, 5, 3,  '#e0c0ff');
      break;
    default:
      ctx.fillStyle = '#6040a0'; ctx.fillRect(cx - 9, cy - 9, 18, 18);
      ctx.fillStyle = '#a080e0'; ctx.fillRect(cx - 7, cy - 7, 14, 14);
  }
  if (count) {
    ctx.textAlign = 'right'; ctx.font = 'bold 10px "Courier New"';
    ctx.fillStyle = '#000'; ctx.fillText(count, sx + SS - 1, sy + SS - 1);
    ctx.fillStyle = '#fff'; ctx.fillText(count, sx + SS - 2, sy + SS - 2);
  }
}

function drawGround() {
  if (state.inDungeon && state.dungeonTiles) { drawDungeonGround(); return; }
  const tile = 32;
  const x0 = Math.floor(camera.x / tile) * tile;
  const y0 = Math.floor(camera.y / tile) * tile;
  const x1 = Math.ceil((camera.x + SW) / tile) * tile;
  const y1 = Math.ceil((camera.y + SH) / tile) * tile;
  const t = state.time;

  for (let y = y0; y < y1; y += tile) {
    for (let x = x0; x < x1; x += tile) {
      const biome = getBiome(x + tile/2, y + tile/2);
      const tx = x / tile | 0, ty = y / tile | 0;
      const n1 = noise2(tx * 3 + 7,  ty * 3 + 13);
      const n2 = noise2(tx * 7 + 53, ty * 7 + 97);
      const n3 = noise2(tx * 13 + 121, ty * 11 + 47);

      if (biome === 5) {
        // Woda — głęboka z animowanymi falami
        const wv1 = Math.sin(t * 0.85 + x * 0.024 + y * 0.017) * 0.5 + 0.5;
        const wv2 = Math.sin(t * 1.3  - x * 0.031 + y * 0.039) * 0.5 + 0.5;
        const depth = 0.5 + n1 * 0.5;
        ctx.fillStyle = `rgb(${18+Math.round(depth*8)},${26+Math.round(depth*10+wv1*5)},${100+Math.round(depth*28+wv2*14)})`;
        ctx.fillRect(x, y, tile, tile);
        // Grzbiet fali
        const wvC = (wv1 + wv2) * 0.5;
        if (wvC > 0.55) {
          ctx.fillStyle = `rgba(90,160,230,${(wvC-0.55)*1.8})`;
          ctx.fillRect(x+3, y + tile/2 + Math.round((n2-0.5)*10), tile-6, 2);
        }
        // Odbicie/piana
        if (n2 > 0.8) {
          ctx.fillStyle = 'rgba(180,220,255,0.18)';
          ctx.fillRect(x+Math.round(n1*18)+4, y+Math.round(n3*18)+4, 3, 2);
        }
        // Głębsza ciemna środek
        ctx.fillStyle = 'rgba(0,0,20,0.1)';
        ctx.fillRect(x+6, y+6, tile-12, tile-12);

      } else if (biome === 0) {
        // Łąki — bogata trawa z detalami
        const v = Math.round(n1 * 22);
        ctx.fillStyle = `rgb(${22+Math.round(v*0.28)},${62+v},${30+Math.round(v*0.35)})`;
        ctx.fillRect(x, y, tile, tile);
        // Jaśniejsza łata trawy
        if (n1 > 0.6) {
          ctx.fillStyle = `rgba(55,88,42,${(n1-0.6)*2.2})`;
          ctx.fillRect(x+2, y+2, tile-4, tile-4);
        }
        // Źdźbła trawy
        if (n2 > 0.7) {
          ctx.fillStyle = '#3d6e3a';
          const bx2 = Math.round(n1*22)+3, by2 = Math.round(n2*18)+4;
          ctx.fillRect(x+bx2,   y+by2,   1, 5);
          ctx.fillRect(x+bx2+5, y+by2+2, 1, 4);
          ctx.fillRect(x+bx2+9, y+by2-1, 1, 5);
        }
        // Jasny refleks słońca
        if (n3 > 0.88) {
          ctx.fillStyle = 'rgba(120,180,80,0.22)';
          ctx.fillRect(x, y, tile, 2);
        }
        // Cień/zagłębienie
        if (n2 < 0.15) {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.fillRect(x+4, y+4, tile-8, tile-8);
        }

      } else if (biome === 1) {
        // Las — ciemne dno z liśćmi
        const v2 = Math.round(n1 * 14);
        ctx.fillStyle = `rgb(${11+Math.round(v2*0.22)},${29+v2},${13+Math.round(v2*0.28)})`;
        ctx.fillRect(x, y, tile, tile);
        // Ściółka leśna — liście
        if (n2 > 0.55) {
          ctx.fillStyle = n1 > 0.65 ? '#27381f' : '#1e2e18';
          const lx = Math.round(n1*18)+4, ly2 = Math.round(n2*14)+5;
          ctx.fillRect(x+lx, y+ly2, Math.round(n3*7)+3, 3);
          if (n1 > 0.4) ctx.fillRect(x+lx+2, y+ly2+3, Math.round(n2*4)+2, 2);
        }
        // Mech (jasna plama)
        if (n3 > 0.87) {
          ctx.fillStyle = '#2e5828';
          ctx.fillRect(x+Math.round(n2*20), y+Math.round(n1*20), 5, 4);
        }
        // Cień korzeni
        if (n1 > 0.75) {
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillRect(x, y+tile-5, tile, 5);
        }
        // Ciemna plama ziemi
        if (n2 < 0.18) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x+3, y+3, tile-6, tile-6);
        }

      } else if (biome === 2) {
        // Pustynia — wydmy z falami piasku
        const duneH = 0.5 + smoothN(x*0.006+11, y*0.006+22)*0.5;
        const sr2 = Math.round(88+duneH*20+n1*10);
        const sg = Math.round(76+duneH*15+n1*8);
        const sb = Math.round(27+duneH*7);
        ctx.fillStyle = `rgb(${sr2},${sg},${sb})`;
        ctx.fillRect(x, y, tile, tile);
        // Linia ripple piasku
        const ripY = ((ty * 7 + Math.round(n2*10)) % 9);
        if (ripY < 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.11)';
          ctx.fillRect(x, y+ripY, tile, 1);
        }
        // Podświetlenie grzbietu wydmy
        if (n1 > 0.78) {
          ctx.fillStyle = 'rgba(255,235,170,0.22)';
          ctx.fillRect(x, y, tile, 3);
        }
        // Kamyk/żwir
        if (n3 > 0.84) {
          ctx.fillStyle = '#6e552a';
          ctx.fillRect(x+Math.round(n1*24)+2, y+Math.round(n2*20)+4, 4, 3);
          ctx.fillStyle = '#8c6e36';
          ctx.fillRect(x+Math.round(n1*24)+2, y+Math.round(n2*20)+4, 3, 1);
        }
        // Cień przy krawędzi
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x+tile-4, y, 4, tile);

      } else if (biome === 3) {
        // Bagno — ciemne błoto z kałużami
        const v3 = Math.round(n1 * 16);
        ctx.fillStyle = `rgb(${17+Math.round(v3*0.28)},${36+v3},${17+Math.round(v3*0.28)})`;
        ctx.fillRect(x, y, tile, tile);
        // Błotna łata
        if (n1 < 0.3) {
          ctx.fillStyle = 'rgba(6,15,6,0.55)';
          ctx.fillRect(x+3, y+3, tile-6, tile-6);
        }
        // Kałuża z odbiciem
        if (n2 > 0.68 && n1 > 0.58) {
          ctx.fillStyle = 'rgba(14,32,16,0.88)';
          ctx.fillRect(x+7, y+8, tile-14, tile-16);
          ctx.fillStyle = 'rgba(38,75,42,0.32)';
          ctx.fillRect(x+9, y+10, tile-20, 3);
        }
        // Bąbelki (animowane)
        if (n3 > 0.87 && Math.sin(t*1.4 + n1*18) > 0.6) {
          ctx.fillStyle = 'rgba(55,95,55,0.55)';
          ctx.fillRect(x+Math.round(n1*24)+4, y+Math.round(n2*16)+6, 2, 2);
        }
        // Mech/glony
        if (n2 > 0.82 && n1 < 0.5) {
          ctx.fillStyle = '#1e4a1e';
          ctx.fillRect(x+Math.round(n3*22), y+Math.round(n1*22), 5, 3);
        }

      } else if (biome === 4) {
        // Góry — skały z kierunkowym oświetleniem
        const v4 = Math.round(n1 * 20);
        const rr = Math.round(50+v4), rg = Math.round(48+v4), rb = Math.round(54+v4);
        ctx.fillStyle = `rgb(${rr},${rg},${rb})`;
        ctx.fillRect(x, y, tile, tile);
        // Oświetlenie góra-lewa (słońce z lewego górnego rogu)
        ctx.fillStyle = `rgba(105,102,112,${n3*0.42})`;
        ctx.fillRect(x, y, tile, 3);
        ctx.fillRect(x, y, 3, tile);
        // Cień dół-prawo
        ctx.fillStyle = `rgba(0,0,0,${n1*0.32})`;
        ctx.fillRect(x+tile-4, y, 4, tile);
        ctx.fillRect(x, y+tile-4, tile, 4);
        // Pęknięcie skały
        if (n2 > 0.66) {
          ctx.fillStyle = 'rgba(18,16,22,0.7)';
          const ck = Math.round(n1*20)+2;
          ctx.fillRect(x+ck, y+Math.round(n3*14)+5, Math.round(n2*10)+3, 1);
          if (n3 > 0.5) ctx.fillRect(x+ck+2, y+Math.round(n3*14)+6, 1, Math.round(n1*5)+2);
        }
        // Śnieg na najwyższych partiach
        if (n1 > 0.8) {
          const snowH = Math.round((n1-0.8)*40)+2;
          ctx.fillStyle = `rgba(228,228,248,${(n1-0.8)*4.5})`;
          ctx.fillRect(x, y, tile, snowH);
          // Śnieżna krawędź
          ctx.fillStyle = `rgba(255,255,255,${(n1-0.8)*2.5})`;
          ctx.fillRect(x, y+snowH-1, tile, 1);
        }
      }
    }
  }
}

function drawDungeonGround() {
  const tile = DUNGEON_TILE;
  const x0 = Math.floor(camera.x / tile) * tile;
  const y0 = Math.floor(camera.y / tile) * tile;
  const x1 = Math.ceil((camera.x + SW) / tile) * tile;
  const y1 = Math.ceil((camera.y + SH) / tile) * tile;
  for (let ty = y0; ty < y1; ty += tile) {
    for (let tx = x0; tx < x1; tx += tile) {
      const col = Math.floor(tx / tile);
      const row = Math.floor(ty / tile);
      const t = getTile(col, row);
      const dn1 = noise2(col * 5 + 3, row * 5 + 7);
      const dn2 = noise2(col * 11 + 61, row * 9 + 43);
      if (t === 1) {
        // Podłoga lochu — kamienne płyty z zanieczyszczeniami
        const fv = ((col * 7 + row * 11) % 3);
        const baseColors = ['#231929','#1f1527','#27192f'];
        ctx.fillStyle = baseColors[fv];
        ctx.fillRect(tx, ty, tile, tile);
        // Pęknięcia/plamy
        if (dn1 > 0.72) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(tx + Math.round(dn2*20)+2, ty + Math.round(dn1*14)+4, Math.round(dn2*10)+4, 1);
        }
        // Magiczny refleks (fioletowy połysk)
        ctx.fillStyle = 'rgba(90,55,140,0.1)';
        ctx.fillRect(tx, ty, tile, 2);
        ctx.fillRect(tx, ty, 2, tile);
        // Wilgoć/glony w narożnikach
        if (dn2 > 0.8) {
          ctx.fillStyle = 'rgba(40,20,70,0.4)';
          ctx.fillRect(tx, ty, 4, 4);
        }
      } else {
        // Ściana — ciemny kamień z blokami
        ctx.fillStyle = '#0c0812';
        ctx.fillRect(tx, ty, tile, tile);
        // Blok kamienia (widoczny od spodu gdy jest podłoga poniżej)
        if (getTile(col, row + 1) === 1) {
          ctx.fillStyle = '#2c1e3e';
          ctx.fillRect(tx, ty + tile - 10, tile, 10);
          ctx.fillStyle = '#3a2850';
          ctx.fillRect(tx, ty + tile - 10, tile, 3);
          // Podświetlenie krawędzi
          ctx.fillStyle = 'rgba(120,80,180,0.15)';
          ctx.fillRect(tx, ty + tile - 10, tile, 1);
        }
        // Tekstura muru — poziome fugi
        ctx.fillStyle = '#160f22';
        ctx.fillRect(tx+3, ty+5,  tile-6, 2);
        ctx.fillRect(tx+3, ty+13, tile-6, 2);
        ctx.fillRect(tx+3, ty+21, tile-6, 2);
        // Pionowe fugi (przesunięte naprzemiennie)
        const offset = (row % 2 === 0) ? tile/2 : 0;
        ctx.fillRect(tx + offset % tile, ty+5, 2, 8);
        // Wilgoć/zamglenie
        if (dn1 > 0.75) {
          ctx.fillStyle = 'rgba(60,30,100,0.18)';
          ctx.fillRect(tx, ty, tile/2, tile);
        }
      }
    }
  }
}

function drawWorldBorder() { /* Świat jest nieskończony — brak granicy */ }

function drawDecor() {
  for (const d of state.decor) {
    if (!inView(d.x, d.y, 80)) continue;
    if (d.type === 'tree') drawTree(d.x, d.y, d.v);
    else if (d.type === 'rock') drawRock(d.x, d.y, d.v);
    else if (d.type === 'grass') drawGrass(d.x, d.y);
    else if (d.type === 'pillar') drawPillar(d.x, d.y);
    else if (d.type === 'stonecircle') drawStoneCircle(d.x, d.y);
    else if (d.type === 'ruins') drawRuins(d.x, d.y);
    else if (d.type === 'camp') drawCamp(d.x, d.y);
    else if (d.type === 'graveyard') drawGraveyard(d.x, d.y);
    else if (d.type === 'lily') drawLily(d.x, d.y);
    else if (d.type === 'boss_arena') { if (inView(d.x, d.y, 260)) drawBossArena(d); }
    else if (d.type === 'dungeon_entrance') drawDungeonEntrance(d.x, d.y, d.level, d.visited);
    else if (d.type === 'dungeon_exit') drawDungeonExit(d.x, d.y);
  }
}

function drawDungeonEntrance(x, y, level, visited) {
  const t = state.time;
  const pulse = 0.5 + Math.sin(t * 2.5 + x * 0.01) * 0.45;
  const cols = [null, '#4444ff', '#9922ff', '#ff3300'];
  const col = cols[Math.min(level, 3)];

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(x, y + 14, 22, 6, 0, 0, TAU); ctx.fill();

  // Stone arch
  pxRect(x - 20, y - 18, 40, 32, '#3a2e50');
  pxRect(x - 18, y - 16, 36, 28, '#2e2240');
  pxRect(x - 14, y + 2, 28, 12, '#1e1430');

  // Stairs down
  pxRect(x - 12, y,    24, 3, '#4a3860');
  pxRect(x - 10, y+3,  20, 3, '#3c2e50');
  pxRect(x - 8,  y+6,  16, 3, '#2e2240');
  pxRect(x - 6,  y+9,  12, 3, '#20182e');

  // Portal glow
  const [r, g, b] = level === 1 ? [60, 60, 255] : level === 2 ? [140, 0, 255] : [255, 40, 0];
  ctx.fillStyle = `rgba(${r},${g},${b},${pulse * 0.5})`;
  ctx.beginPath(); ctx.ellipse(x, y - 4, 14, 10, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(${r},${g},${b},${pulse * 0.8})`;
  ctx.beginPath(); ctx.ellipse(x, y - 4, 7, 5, 0, 0, TAU); ctx.fill();

  // Rune symbols on arch
  ctx.fillStyle = col;
  ctx.font = '8px "Courier New"'; ctx.textAlign = 'center';
  ctx.fillText('✦', x - 12, y - 10);
  ctx.fillText('✦', x + 12, y - 10);

  // Level label
  ctx.font = 'bold 9px "Courier New"'; ctx.textAlign = 'center';
  ctx.fillStyle = visited ? '#888' : '#ffd700';
  ctx.fillText(`LOCH LVL ${level}${visited ? ' ✓' : ''}`, x, y - 24);

  // Interaction prompt
  const dx2 = player.x - x, dy2 = player.y - y;
  if (dx2*dx2 + dy2*dy2 < 80*80) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px "Courier New"';
    ctx.fillText('WEJDŹ [E]', x, y - 36);
  }
}

function drawDungeonExit(x, y) {
  const t = state.time;
  const pulse = 0.55 + Math.sin(t * 3.5) * 0.4;

  ctx.fillStyle = `rgba(60,255,100,${pulse * 0.45})`;
  ctx.beginPath(); ctx.ellipse(x, y, 22, 14, 0, 0, TAU); ctx.fill();

  pxRect(x - 8, y - 14, 16, 10, '#1a4028');
  pxRect(x - 6, y - 12, 12, 8,  '#22603a');
  pxRect(x - 4, y - 10, 8,  6,  '#30a050');
  pxRect(x - 3, y - 9,  6,  4,  '#50e078');

  ctx.fillStyle = `rgba(60,255,100,${pulse * 0.7})`;
  ctx.beginPath(); ctx.ellipse(x, y - 8, 6, 4, 0, 0, TAU); ctx.fill();

  ctx.fillStyle = '#40ff88';
  ctx.font = 'bold 9px "Courier New"'; ctx.textAlign = 'center';
  ctx.fillText('WYJŚCIE', x, y - 20);

  const dx2 = player.x - x, dy2 = player.y - y;
  if (dx2*dx2 + dy2*dy2 < 70*70) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px "Courier New"';
    ctx.fillText('[E] WYJDŹ Z LOCHÓW', x, y - 32);
  }
}

function drawLily(x, y) {
  ctx.fillStyle = '#1a5a30';
  ctx.beginPath(); ctx.ellipse(x, y, 6, 4, Math.sin(state.time * 0.5 + x * 0.1) * 0.3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff9acc';
  ctx.beginPath(); ctx.arc(x, y - 1, 2, 0, TAU); ctx.fill();
}

function drawTree(x, y, v) {
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x, y + 8, 12, 4, 0, 0, TAU); ctx.fill();
  // trunk
  pxRect(x - 3, y - 2, 6, 12, '#5a3a1a');
  pxRect(x - 3, y - 2, 2, 12, '#3d2810');
  // leaves
  const leafLight = ['#3aa84a', '#2e8a3e', '#56b85a'][v % 3];
  const leafDark = '#1e5a2a';
  pxRect(x - 10, y - 18, 20, 14, leafDark);
  pxRect(x - 8, y - 22, 16, 4, leafDark);
  pxRect(x - 9, y - 16, 18, 10, leafLight);
  pxRect(x - 7, y - 20, 14, 4, leafLight);
  pxRect(x - 4, y - 22, 8, 2, leafLight);
  // highlights
  pxRect(x - 6, y - 14, 3, 3, '#7ad07a');
  pxRect(x + 2, y - 10, 2, 2, '#7ad07a');
}

function drawRock(x, y, v) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 5, 9, 3, 0, 0, TAU); ctx.fill();
  if (v === 0) {
    pxRect(x - 6, y - 2, 12, 7, '#6a6675');
    pxRect(x - 6, y - 2, 12, 2, '#8a8694');
    pxRect(x - 4, y + 3, 8, 2, '#4a4655');
  } else {
    pxRect(x - 4, y - 1, 8, 5, '#6a6675');
    pxRect(x - 4, y - 1, 8, 2, '#8a8694');
  }
}

function drawGrass(x, y) {
  ctx.fillStyle = '#3aa84a';
  ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
  ctx.fillRect(Math.round(x) + 2, Math.round(y) + 1, 1, 2);
  ctx.fillStyle = '#2e8a3e';
  ctx.fillRect(Math.round(x) + 1, Math.round(y), 1, 3);
}

function drawPillar(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x, y + 18, 14, 4, 0, 0, TAU); ctx.fill();
  // Base
  pxRect(x - 10, y + 12, 20, 6, '#7a7080');
  pxRect(x - 10, y + 12, 20, 2, '#9a8fa4');
  // Shaft
  pxRect(x - 6, y - 18, 12, 32, '#8a8094');
  pxRect(x - 6, y - 18, 3, 32, '#6a5f74');
  pxRect(x + 3, y - 18, 3, 32, '#a89eb4');
  // Capital
  pxRect(x - 9, y - 22, 18, 4, '#9a8fa4');
  pxRect(x - 9, y - 22, 18, 2, '#bab0c6');
  // Cracks
  pxRect(x - 3, y - 10, 1, 8, '#5a4f64');
  pxRect(x + 1, y - 4, 1, 6, '#5a4f64');
}

function drawStoneCircle(x, y) {
  const t = state.time;
  // Outer glow
  ctx.fillStyle = `rgba(100,80,200,${0.08 + Math.sin(t * 1.8) * 0.05})`;
  ctx.beginPath(); ctx.arc(x, y, 62, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(120,90,220,${0.13 + Math.sin(t * 1.8) * 0.06})`;
  ctx.beginPath(); ctx.arc(x, y, 46, 0, TAU); ctx.fill();
  // Ground rune lines connecting stones
  const n = 7, r = 52;
  ctx.strokeStyle = `rgba(160,120,255,${0.22 + Math.sin(t * 2.2) * 0.1})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * TAU;
    const a2 = ((i + 2) % n / n) * TAU;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    ctx.lineTo(x + Math.cos(a2) * r, y + Math.sin(a2) * r);
    ctx.stroke();
  }
  // Inner ritual ring
  ctx.strokeStyle = `rgba(200,160,255,${0.35 + Math.sin(t * 3.1) * 0.15})`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.stroke();
  // Spinning rune dots on inner ring
  ctx.fillStyle = `rgba(220,180,255,${0.55 + Math.sin(t * 2.8) * 0.2})`;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + t * 0.4;
    ctx.fillRect(Math.round(x + Math.cos(a) * 22) - 1, Math.round(y + Math.sin(a) * 22) - 1, 2, 2);
  }
  // Standing stones
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
    const h = 14 + (i % 3) * 5;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 10, 8, 3, 0, 0, TAU); ctx.fill();
    // Stone main body
    pxRect(sx - 4, sy - h, 9, h + 3, '#6a6270');
    pxRect(sx - 4, sy - h, 9, 3, '#8a8090');
    pxRect(sx - 4, sy - h, 2, h + 3, '#4a4250');
    pxRect(sx + 3, sy - h, 2, h + 3, '#7a7585');
    // Carved rune on stone (glowing)
    const runeA = 0.6 + Math.sin(t * 3 + i * 1.1) * 0.35;
    ctx.fillStyle = `rgba(180,130,255,${runeA})`;
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy - h/2) - 3, 3, 7);
    ctx.fillRect(Math.round(sx) - 3, Math.round(sy - h/2) - 1, 7, 3);
    ctx.fillRect(Math.round(sx), Math.round(sy - h/2) - 4, 1, 1);
    ctx.fillRect(Math.round(sx), Math.round(sy - h/2) + 3, 1, 1);
    // Moss
    if (i % 2 === 0) {
      pxRect(sx - 3, sy - h/2 - 2, 5, 3, '#2a5a2a');
      pxRect(sx - 2, sy - h/2 + 1, 3, 2, '#1e4820');
    }
  }
  // Central altar
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x, y + 6, 12, 4, 0, 0, TAU); ctx.fill();
  pxRect(x - 8, y - 1, 16, 9, '#5a5060');
  pxRect(x - 8, y - 1, 16, 2, '#7a7080');
  pxRect(x - 6, y - 6, 12, 7, '#4a4260');
  pxRect(x - 6, y - 6, 12, 2, '#6a6270');
  pxRect(x - 4, y - 9, 8, 5, '#3a3250');
  pxRect(x - 4, y - 9, 8, 2, '#5a5060');
  // Altar glow
  const altarA = 0.28 + Math.sin(t * 4.2) * 0.18;
  ctx.fillStyle = `rgba(140,100,255,${altarA})`;
  ctx.fillRect(x - 7, y - 10, 14, 17);
  // Altar crystal top
  ctx.fillStyle = `rgba(200,160,255,${0.7 + Math.sin(t * 5) * 0.25})`;
  ctx.fillRect(x - 2, y - 11, 4, 3);
  ctx.fillRect(x - 1, y - 12, 2, 1);
}

function drawRuins(x, y) {
  // Stone floor tiles
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const tx = x - 50 + col * 21;
      const ty = y - 4 + row * 14;
      const light = (row + col) % 2 === 0;
      pxRect(tx, ty, 20, 13, light ? '#3a3448' : '#302a40');
      pxRect(tx, ty, 20, 1, light ? '#4a4458' : '#3e3852');
      pxRect(tx, ty, 1, 13, light ? '#4a4458' : '#3e3852');
      if ((row * 5 + col) % 7 === 0) {
        ctx.fillStyle = '#1a1628';
        ctx.fillRect(tx + 5, ty + 3, 1, 6);
        ctx.fillRect(tx + 6, ty + 5, 4, 1);
      }
    }
  }
  // Shadow under walls
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x - 54, y - 6, 100, 12);
  // Wall section back (left side)
  for (let j = 0; j < 3; j++) {
    const wy = y - 22 + j * 16;
    pxRect(x - 52, wy, 14, 14, '#7a7080');
    pxRect(x - 52, wy, 14, 3, '#9a8fa4');
    pxRect(x - 52, wy, 3, 14, '#5a5060');
    pxRect(x - 39, wy, 2, 14, '#9a8fa4');
    if (j === 1) pxRect(x - 50, wy + 4, 6, 3, '#2a5a2a');
  }
  // Front wall row with varying heights & broken section
  const wallDefs = [
    { wx: x - 30, h: 24 }, { wx: x - 8, h: 18 },
    { wx: x + 14, h: 6, broken: true }, { wx: x + 36, h: 22 },
  ];
  for (const wd of wallDefs) {
    const { wx, h, broken } = wd;
    if (broken) {
      pxRect(wx, y - h + 12, 14, h - 8, '#7a7080');
      pxRect(wx, y - h + 12, 14, 3, '#9a8fa4');
      pxRect(wx, y - h + 12, 3, h - 8, '#5a5060');
      pxRect(wx + 2, y + 5, 4, 3, '#5a5060');
      pxRect(wx + 8, y + 4, 5, 2, '#6a6070');
      pxRect(wx + 15, y + 3, 6, 2, '#5a5060');
    } else {
      pxRect(wx, y - h, 14, h, '#7a7080');
      pxRect(wx, y - h, 14, 3, '#9a8fa4');
      pxRect(wx, y - h, 3, h, '#5a5060');
      pxRect(wx + 11, y - h, 3, h, '#9a8fa4');
      if (h > 20) { pxRect(wx + 2, y - h, 4, 3, '#4a4050'); pxRect(wx + 8, y - h, 3, 3, '#4a4050'); }
    }
    const mossDy = broken ? (y - h + 12) : (y - h);
    pxRect(wx + 2, mossDy + h/2 - 2, 5, 3, '#2a5a2a');
    pxRect(wx + 7, mossDy + h/2 + 1, 3, 2, '#1e4820');
  }
  // Broken arch remnant
  ctx.fillStyle = '#7a7080';
  ctx.beginPath(); ctx.arc(x - 8, y - 18, 10, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#9a8fa4';
  ctx.beginPath(); ctx.arc(x - 8, y - 18, 10, Math.PI, 0); ctx.closePath();
  pxRect(x - 18, y - 18, 3, 12, '#7a7080');
  // Well
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x + 58, y + 6, 10, 10, 0, 0, TAU); ctx.fill();
  pxRect(x + 49, y - 4, 18, 20, '#6a6070');
  pxRect(x + 49, y - 4, 18, 3, '#8a8090');
  pxRect(x + 49, y - 4, 3, 20, '#5a5060');
  ctx.fillStyle = '#0c0a14';
  ctx.beginPath(); ctx.ellipse(x + 58, y + 6, 7, 7, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4a4060'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + 58, y + 6, 7, 0, TAU); ctx.stroke();
  // Well crossbeam
  pxRect(x + 48, y - 8, 3, 6, '#7a5030');
  pxRect(x + 67, y - 8, 3, 6, '#7a5030');
  pxRect(x + 48, y - 9, 22, 2, '#5a3a1a');
  // Scattered debris
  pxRect(x + 4, y + 6, 4, 2, '#5a5060');
  pxRect(x + 20, y + 5, 5, 3, '#6a6070');
  pxRect(x - 2, y + 4, 3, 2, '#7a7080');
}

function drawCamp(x, y) {
  const t = state.time;
  // Dirt ground
  ctx.fillStyle = '#2a1e0e';
  ctx.beginPath(); ctx.ellipse(x + 8, y + 6, 55, 24, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#301e0a';
  ctx.fillRect(x - 42, y - 2, 92, 16);
  // Tent (left side)
  ctx.fillStyle = '#5a3a1a';
  ctx.beginPath();
  ctx.moveTo(x - 48, y + 14); ctx.lineTo(x - 22, y - 24); ctx.lineTo(x + 2, y + 14);
  ctx.fill();
  ctx.fillStyle = '#3a2010';
  ctx.beginPath();
  ctx.moveTo(x - 48, y + 14); ctx.lineTo(x - 22, y - 24); ctx.lineTo(x - 22, y + 14);
  ctx.fill();
  // Tent opening
  ctx.fillStyle = '#120a04';
  ctx.beginPath();
  ctx.moveTo(x - 34, y + 14); ctx.lineTo(x - 22, y - 8); ctx.lineTo(x - 10, y + 14);
  ctx.fill();
  // Tent fabric seam
  ctx.strokeStyle = '#7a5028'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 22, y - 24); ctx.lineTo(x - 22, y + 14); ctx.stroke();
  // Tent pole top + rope
  pxRect(x - 23, y - 26, 2, 4, '#9a7040');
  ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 22, y - 26); ctx.lineTo(x - 30, y - 34); ctx.stroke();
  pxRect(x - 31, y - 35, 2, 5, '#5a3a1a');
  // Ground rope pegs
  ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 48, y + 14); ctx.lineTo(x - 54, y + 18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 2, y + 14); ctx.lineTo(x + 6, y + 18); ctx.stroke();
  pxRect(x - 55, y + 17, 2, 4, '#5a3a1a');
  pxRect(x + 5, y + 17, 2, 4, '#5a3a1a');
  // Log near fire
  ctx.fillStyle = '#5a3a1a';
  ctx.save(); ctx.translate(x + 14, y + 9); ctx.rotate(-0.35);
  ctx.fillRect(-15, -3, 30, 5);
  ctx.fillStyle = '#3d2510'; ctx.fillRect(-15, -3, 30, 2);
  ctx.fillStyle = '#7a4a22'; ctx.fillRect(-15, -1, 3, 3); ctx.fillRect(12, -1, 3, 3);
  ctx.restore();
  // Campfire ring stones
  for (let i = 0; i < 7; i++) {
    const fa = (i / 7) * TAU;
    const fx = x + 14 + Math.cos(fa) * 10, fy = y + 3 + Math.sin(fa) * 6;
    pxRect(fx - 2, fy - 1, 4, 3, '#6a6275');
    pxRect(fx - 2, fy - 1, 4, 1, '#8a8090');
  }
  // Crossed fire logs
  ctx.strokeStyle = '#3d2510'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 5, y + 9); ctx.lineTo(x + 23, y + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 9, y + 10); ctx.lineTo(x + 19, y + 2); ctx.stroke();
  // Embers
  ctx.fillStyle = '#ff2200';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(Math.round(x + 10 + i*2), Math.round(y + 5 + (i%2)), 2, 2);
  }
  // Animated flames
  const f1y = Math.round(y - 2 + Math.sin(t * 5) * 2);
  const f2y = Math.round(y - 6 + Math.sin(t * 5.5 + 1) * 2);
  const f3y = Math.round(y - 10 + Math.sin(t * 6 + 2) * 1.5);
  pxRect(x + 10, f1y, 9, 8, '#cc3300');
  pxRect(x + 11, f1y - 2, 7, 5, '#ff4400');
  pxRect(x + 12, f2y, 6, 7, '#ff7700');
  pxRect(x + 13, f2y - 2, 4, 4, '#ffaa22');
  pxRect(x + 13, f3y, 4, 6, '#ffcc44');
  pxRect(x + 14, Math.round(y - 12 + Math.sin(t*7)*1.5), 2, 5, '#ffeeaa');
  // Smoke particles (simulated with alpha dots)
  for (let s = 0; s < 2; s++) {
    const st = (t * 0.6 + s * 0.5) % 1;
    const sy2 = y - 14 - st * 20;
    const sx2 = x + 14 + Math.sin(t * 2 + s) * 4;
    ctx.fillStyle = `rgba(80,70,90,${(1 - st) * 0.35})`;
    ctx.fillRect(Math.round(sx2) - 2, Math.round(sy2) - 2, 4, 4);
  }
  // Barrel (right side)
  pxRect(x + 30, y - 10, 13, 22, '#7a4a1a');
  pxRect(x + 30, y - 10, 13, 2, '#a06a2a');
  pxRect(x + 30, y + 10, 13, 2, '#a06a2a');
  pxRect(x + 29, y - 10, 2, 22, '#5a3010');
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
  ctx.strokeRect(x + 30, y - 1, 13, 4);
  ctx.strokeRect(x + 30, y + 5, 13, 4);
  // Barrel top detail
  ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.ellipse(x + 36, y - 9, 6, 2, 0, 0, TAU); ctx.fill();
  // Supply crate
  pxRect(x + 46, y - 6, 16, 14, '#8a6030');
  pxRect(x + 46, y - 6, 16, 2, '#aa8040');
  pxRect(x + 46, y - 6, 2, 14, '#6a4020');
  pxRect(x + 45, y + 7, 18, 1, '#aa8040');
  pxRect(x + 53, y - 7, 2, 16, '#6a4020');
  pxRect(x + 46, y + 1, 16, 1, '#6a4020');
  // Crate lid
  pxRect(x + 45, y - 7, 18, 2, '#aa8848');
  // Lantern on stick
  pxRect(x + 63, y - 22, 2, 28, '#6a4a20');
  pxRect(x + 61, y - 22, 6, 9, '#8a6030');
  pxRect(x + 62, y - 21, 4, 7, '#ffaa22');
  const lanternA = 0.5 + Math.sin(t * 3) * 0.25;
  ctx.fillStyle = `rgba(255,180,60,${lanternA})`;
  ctx.fillRect(x + 58, y - 24, 12, 14);
}

function drawGraveyard(x, y) {
  // Foggy ground aura
  ctx.fillStyle = 'rgba(30,20,50,0.40)';
  ctx.beginPath(); ctx.ellipse(x, y, 68, 46, 0, 0, TAU); ctx.fill();
  // Iron fence
  for (let i = -3; i <= 3; i++) {
    const fx = x + i * 22;
    pxRect(fx - 1, y - 46, 2, 38, '#3a3448');
    pxRect(fx - 2, y - 47, 4, 2, '#4a4458');
    pxRect(fx - 1, y - 49, 2, 2, '#5a5468');
    pxRect(fx, y - 50, 1, 1, '#7a7490');
  }
  ctx.strokeStyle = '#3a3448'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 68, y - 38); ctx.lineTo(x + 68, y - 38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 68, y - 24); ctx.lineTo(x + 68, y - 24); ctx.stroke();
  // 5 gravestones
  const graves = [
    { ox: -40, oy: -14, shape: 'arch', rot: -0.04 },
    { ox: -16, oy: -20, shape: 'cross', rot: 0.06 },
    { ox:  10, oy: -12, shape: 'arch', rot: -0.03 },
    { ox: -28, oy:  3,  shape: 'cross', rot: 0.05 },
    { ox:  32, oy:  1,  shape: 'arch', rot: 0.02 },
  ];
  for (const g of graves) {
    const gx = x + g.ox, gy = y + g.oy;
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(g.rot);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 19, 9, 3, 0, 0, TAU); ctx.fill();
    if (g.shape === 'arch') {
      pxRect(-5, 0, 10, 19, '#7a7080');
      pxRect(-5, 0, 10, 2, '#9a8fa4');
      pxRect(-5, 0, 2, 19, '#5a5060');
      pxRect(3, 0, 2, 19, '#8e8498');
      ctx.fillStyle = '#7a7080';
      ctx.beginPath(); ctx.arc(0, 0, 5, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#9a8fa4';
      ctx.fillRect(-5, -2, 10, 2);
      pxRect(-3, 6, 6, 1, '#4a4060');
      pxRect(-2, 9, 4, 1, '#4a4060');
      pxRect(-1, 12, 2, 1, '#4a4060');
    } else {
      pxRect(-2, -8, 4, 26, '#7a7080');
      pxRect(-7, -3, 14, 4, '#7a7080');
      pxRect(-7, -3, 14, 1, '#9a8fa4');
      pxRect(-2, -8, 4, 1, '#9a8fa4');
      pxRect(-2, -8, 1, 26, '#5a5060');
    }
    pxRect(-1, 8, 3, 2, '#2a5a2a');
    pxRect(-2, 10, 2, 2, '#1e4820');
    ctx.restore();
  }
  // Dead tree (back right)
  pxRect(x + 52, y - 42, 5, 38, '#3a3020');
  pxRect(x + 52, y - 42, 2, 38, '#252015');
  ctx.strokeStyle = '#3a3020'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x + 54, y - 42); ctx.lineTo(x + 44, y - 55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 54, y - 32); ctx.lineTo(x + 66, y - 46); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 54, y - 22); ctx.lineTo(x + 48, y - 32); ctx.stroke();
  // Animated wisp
  const wt = state.time * 1.4;
  const wx = x + Math.sin(wt) * 22 - 18, wy = y - 30 + Math.cos(wt * 0.7) * 8;
  ctx.fillStyle = `rgba(100,255,180,${0.3 + Math.sin(wt * 2.3) * 0.15})`;
  ctx.beginPath(); ctx.arc(Math.round(wx), Math.round(wy), 4, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(200,255,230,${0.6 + Math.sin(wt * 3) * 0.25})`;
  ctx.beginPath(); ctx.arc(Math.round(wx), Math.round(wy), 2, 0, TAU); ctx.fill();
}

// ============================================================
//   BOSS ARENA DRAW
// ============================================================
function drawBossArena(d) {
  const { x, y, variant, cleared } = d;
  const t = state.time;
  const def = BOSS_ARENA_DEFS[variant];
  const fade = cleared ? 0.3 : 1.0;

  if (variant === 0) drawArenaLich(x, y, t, cleared, fade);
  else if (variant === 1) drawArenaDemon(x, y, t, cleared, fade);
  else if (variant === 2) drawArenaTitan(x, y, t, cleared, fade);
  else if (variant === 3) drawArenaSpider(x, y, t, cleared, fade);
  else if (variant === 4) drawArenaIce(x, y, t, cleared, fade);
  else if (variant === 5) drawArenaNecro(x, y, t, cleared, fade);
  else if (variant === 6) drawArenaWraith(x, y, t, cleared, fade);
  else drawArenaDrake(x, y, t, cleared, fade);

  // Proximity warning — skull + "NIEBEZPIECZEŃSTWO"
  if (!cleared) {
    const dx = player.x - x, dy = player.y - y;
    const dist2 = dx*dx + dy*dy;
    const warnR = def.triggerR * 2.2;
    if (dist2 < warnR * warnR) {
      const closeRatio = 1 - Math.sqrt(dist2) / warnR;
      const warnA = (0.25 + closeRatio * 0.55) * (0.7 + Math.sin(t * 4) * 0.3);
      ctx.strokeStyle = `rgba(255,50,50,${warnA * fade})`;
      ctx.lineWidth = 2 + closeRatio * 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(x, y, def.triggerR, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      // Skull icon above arena center
      const sx = Math.round(x), sy = Math.round(y - def.triggerR * 0.55);
      ctx.font = 'bold 14px "Courier New"';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,60,60,${warnA * fade})`;
      ctx.fillText('☠', sx, sy - 2);
      if (closeRatio > 0.55) {
        ctx.font = 'bold 9px "Courier New"';
        ctx.fillStyle = `rgba(255,80,80,${(warnA - 0.15) * fade})`;
        ctx.fillText(def.name.toUpperCase(), sx, sy + 12);
      }
    }
  }
}

// ---- Arena Ice Queen — Lodowy Pałac ----
function drawArenaIce(x, y, t, cleared, fade) {
  const R = 170;
  const g = ctx.createRadialGradient(x, y, R*0.1, x, y, R);
  g.addColorStop(0, `rgba(10,30,60,${0.75*fade})`);
  g.addColorStop(0.6, `rgba(5,20,40,${0.55*fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  // Snowflake ring
  if (!cleared) {
    for (let i = 0; i < 6; i++) {
      const a = (i/6)*TAU + t*0.3;
      const sx = x+Math.cos(a)*R*0.55, sy = y+Math.sin(a)*R*0.55;
      const sa = (0.5+Math.sin(t*3+i)*0.3)*fade;
      ctx.strokeStyle = `rgba(140,220,255,${sa})`;
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const ka = k*Math.PI/3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx+Math.cos(ka)*9, sy+Math.sin(ka)*9); ctx.stroke();
      }
    }
  }
  // Ice pillars
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i/N)*TAU;
    const px2 = x+Math.cos(a)*R, py2 = y+Math.sin(a)*R;
    const h = 34+(i%4)*8;
    ctx.fillStyle = `rgba(0,0,0,${0.3*fade})`;
    ctx.beginPath(); ctx.ellipse(px2, py2+h*0.3, 8, 3, 0, 0, TAU); ctx.fill();
    pxRect(px2-5, py2-h, 10, h+5, cleared?'#3a6080':'#447799');
    pxRect(px2-5, py2-h, 10, 3, cleared?'#5a80a0':'#66aacc');
    pxRect(px2-5, py2-h, 2, h+5, '#224466');
    if (!cleared) {
      const ia = (0.4+Math.sin(t*2.5+i)*0.3)*fade;
      ctx.fillStyle = `rgba(140,220,255,${ia})`;
      ctx.fillRect(px2-5, py2-h-5, 10, 4);
      pxRect(px2-3, py2-h-9, 6, 5, '#88ddff');
      pxRect(px2-1, py2-h-12, 2, 4, '#ccf0ff');
    }
  }
  // Frozen altar center
  ctx.fillStyle = `rgba(0,0,0,${0.4*fade})`;
  ctx.beginPath(); ctx.ellipse(x, y+6, 16, 6, 0, 0, TAU); ctx.fill();
  pxRect(x-13, y-4, 26, 14, '#224466');
  pxRect(x-13, y-4, 26, 3, '#3366aa');
  pxRect(x-10, y-12, 20, 10, '#1a3355');
  if (!cleared) {
    const cg = ctx.createRadialGradient(x, y-6, 0, x, y-6, 10);
    cg.addColorStop(0, `rgba(200,240,255,${0.9*fade})`);
    cg.addColorStop(1, 'transparent');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(x, y-6, 10, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(100,200,255,${(0.15+Math.sin(t*2)*0.08)*fade})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R*0.58, 0, TAU); ctx.stroke();
  }
}

// ---- Arena Necro — Grobowiec Nekromanty ----
function drawArenaNecro(x, y, t, cleared, fade) {
  const R = 170;
  const g = ctx.createRadialGradient(x, y, R*0.1, x, y, R);
  g.addColorStop(0, `rgba(15,0,25,${0.80*fade})`);
  g.addColorStop(0.6, `rgba(8,0,15,${0.60*fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  // Gravestones
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i/N)*TAU;
    const gx = x+Math.cos(a)*R*0.72, gy = y+Math.sin(a)*R*0.72;
    const h = 26+(i%3)*8;
    ctx.fillStyle = `rgba(0,0,0,${0.3*fade})`;
    ctx.beginPath(); ctx.ellipse(gx, gy+h*0.3, 8, 3, 0, 0, TAU); ctx.fill();
    pxRect(gx-6, gy-h, 13, h+5, '#2a1e35');
    pxRect(gx-6, gy-h, 13, 3, '#3e2e4a');
    pxRect(gx-5, gy-h-6, 11, 7, '#2a1e35'); // rounded top
    pxRect(gx-3, gy-h-8, 7, 3, '#2a1e35');
    if (!cleared) {
      const ga2 = (0.35+Math.sin(t*2.2+i)*0.25)*fade;
      ctx.fillStyle = `rgba(180,50,220,${ga2})`;
      ctx.fillRect(gx-1, gy-h-6, 3, 5);
      ctx.fillRect(gx-3, gy-h-4, 7, 2);
    } else { pxRect(gx-4, gy-h+2, 9, 3, '#4a3a55'); }
    // Bone chain between graves
    if (i < N-1) {
      const a2 = ((i+1)/N)*TAU;
      const nx = x+Math.cos(a2)*R*0.72, ny = y+Math.sin(a2)*R*0.72;
      ctx.strokeStyle = `rgba(70,50,90,${0.35*fade})`;
      ctx.lineWidth = 1; ctx.setLineDash([4,6]);
      ctx.beginPath(); ctx.moveTo(gx, gy-h*0.5); ctx.lineTo(nx, ny-h*0.5); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Bone piles & skulls scattered
  for (let i = 0; i < 6; i++) {
    const ba = (i/6)*TAU+0.5;
    const bx = x+Math.cos(ba)*R*0.38, by2 = y+Math.sin(ba)*R*0.38;
    pxRect(bx-5, by2-2, 10, 4, '#ccc0d0');
    pxRect(bx-3, by2-4, 6, 4, '#c8c0d0');
    if (!cleared) { ctx.fillStyle = `rgba(160,50,200,${(0.3+Math.sin(t*3+i)*0.2)*fade})`; ctx.fillRect(bx-2, by2-3, 4, 4); }
  }
  // Dark altar
  pxRect(x-13, y-4, 26, 14, '#1e0f28');
  pxRect(x-13, y-4, 26, 3, '#3a1e4a');
  pxRect(x-10, y-12, 20, 10, '#160a20');
  if (!cleared) {
    const ra = (0.5+Math.sin(t*4)*0.35)*fade;
    ctx.fillStyle = `rgba(180,50,220,${ra})`;
    ctx.fillRect(x-8, y-10, 16, 2); ctx.fillRect(x-1, y-16, 2, 10);
    ctx.strokeStyle = `rgba(140,40,180,${(0.12+Math.sin(t*1.8)*0.07)*fade})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R*0.55, 0, TAU); ctx.stroke();
  }
}

// ---- Arena Wraith — Wrota Próżni ----
function drawArenaWraith(x, y, t, cleared, fade) {
  const R = 175;
  const g = ctx.createRadialGradient(x, y, R*0.05, x, y, R);
  g.addColorStop(0, `rgba(0,0,30,${0.85*fade})`);
  g.addColorStop(0.5, `rgba(5,0,20,${0.65*fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  // Floating void shards
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i/N)*TAU + t*0.18;
    const r2 = R*(0.55+Math.sin(t*1.4+i*0.7)*0.12);
    const vx2 = x+Math.cos(a)*r2, vy2 = y+Math.sin(a)*r2;
    const h = 18+(i%3)*8;
    const va = (0.5+Math.sin(t*2.5+i)*0.35)*fade;
    pxRect(vx2-3, vy2-h, 7, h, cleared?'#1a1030':'#2a1855');
    pxRect(vx2-3, vy2-h, 7, 2, cleared?'#2a2040':'#4430aa');
    if (!cleared) {
      ctx.fillStyle = `rgba(100,60,255,${va})`;
      ctx.fillRect(vx2-3, vy2-h, 7, 2);
      ctx.fillRect(vx2-3, vy2-3, 7, 2);
    }
  }
  // Void rings
  if (!cleared) {
    for (let ring = 0; ring < 3; ring++) {
      const rr = R*(0.25+ring*0.2);
      const ra = (0.08+Math.sin(t*1.5+ring)*0.05)*fade;
      ctx.strokeStyle = `rgba(80,50,200,${ra})`;
      ctx.lineWidth = ring === 1 ? 2 : 1;
      ctx.beginPath(); ctx.arc(x, y, rr, t*0.3*(ring%2?1:-1), t*0.3*(ring%2?1:-1)+TAU); ctx.stroke();
    }
  }
  // Central void portal
  if (!cleared) {
    const pa = (0.55+Math.sin(t*3)*0.3)*fade;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, 20);
    cg.addColorStop(0, `rgba(0,0,0,${0.95*fade})`);
    cg.addColorStop(0.6, `rgba(40,20,120,${0.7*fade})`);
    cg.addColorStop(1, 'transparent');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(100,60,255,${pa})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.stroke();
    // Void sparks
    for (let i = 0; i < 5; i++) {
      const sa = (i/5)*TAU + t*2;
      const sr = 12+Math.sin(t*4+i)*4;
      ctx.fillStyle = `rgba(120,80,255,${(0.6+Math.sin(t*5+i)*0.3)*fade})`;
      ctx.fillRect(Math.round(x+Math.cos(sa)*sr)-1, Math.round(y+Math.sin(sa)*sr)-1, 3, 3);
    }
  } else {
    pxRect(x-12, y-12, 24, 24, '#0a0020');
    pxRect(x-12, y-12, 24, 2, '#1a1040');
  }
}

// ---- Arena Drake — Burza Smoka ----
function drawArenaDrake(x, y, t, cleared, fade) {
  const R = 180;
  const g = ctx.createRadialGradient(x, y, R*0.1, x, y, R);
  g.addColorStop(0, `rgba(25,20,5,${0.75*fade})`);
  g.addColorStop(0.6, `rgba(15,12,0,${0.55*fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  // Cracked earth lines
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*TAU + 0.2;
    const len = R*(0.3+Math.random()*0.3);
    ctx.strokeStyle = `rgba(80,60,0,${0.4*fade})`;
    ctx.lineWidth = 1+(i%3);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x+Math.cos(a)*len, y+Math.sin(a)*len); ctx.stroke();
  }
  // Lightning rods (tall metal pillars)
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i/N)*TAU;
    const rx2 = x+Math.cos(a)*R, ry2 = y+Math.sin(a)*R;
    const h = 40+(i%3)*10;
    ctx.fillStyle = `rgba(0,0,0,${0.35*fade})`;
    ctx.beginPath(); ctx.ellipse(rx2, ry2+h*0.3, 7, 3, 0, 0, TAU); ctx.fill();
    pxRect(rx2-3, ry2-h, 6, h+5, cleared?'#5a5060':'#706080');
    pxRect(rx2-3, ry2-h, 6, 2, cleared?'#7a7080':'#9080a0');
    pxRect(rx2-3, ry2-h, 1, h+5, '#303038');
    if (!cleared) {
      pxRect(rx2-2, ry2-h-6, 4, 6, '#aaa0b8');
      pxRect(rx2-1, ry2-h-8, 2, 3, '#d0c8e0');
      const la = (0.35+Math.sin(t*6+i*0.9)*0.45)*fade;
      ctx.fillStyle = `rgba(255,230,60,${la})`;
      ctx.fillRect(rx2-2, ry2-h-6, 4, 6);
      // Lightning arc to center occasionally
      if (Math.sin(t*4+i*1.2) > 0.8) {
        ctx.strokeStyle = `rgba(255,240,80,${0.5*fade})`;
        ctx.lineWidth = 1; ctx.setLineDash([3,4]);
        ctx.beginPath(); ctx.moveTo(rx2, ry2-h); ctx.lineTo(x, y-16); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  // Storm cloud center
  if (!cleared) {
    const ca = (0.4+Math.sin(t*2.5)*0.25)*fade;
    ctx.fillStyle = `rgba(40,35,10,${ca})`;
    ctx.beginPath(); ctx.ellipse(x, y-10, 28, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(30,25,5,${ca*0.8})`;
    ctx.beginPath(); ctx.ellipse(x-12, y-14, 18, 10, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+12, y-13, 16, 9, 0, 0, TAU); ctx.fill();
    // Lightning bolts from cloud
    for (let i = 0; i < 3; i++) {
      if (Math.sin(t*8+i*2.1) > 0.6) {
        const bx = x+rand(-18,18);
        ctx.strokeStyle = `rgba(255,235,80,${0.8*fade})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, y-8); ctx.lineTo(bx+rand(-6,6), y+6); ctx.lineTo(bx+rand(-4,4), y+18); ctx.stroke();
      }
    }
    ctx.strokeStyle = `rgba(200,180,40,${(0.12+Math.sin(t*2)*0.06)*fade})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, R*0.55, 0, TAU); ctx.stroke();
  } else {
    pxRect(x-14, y-16, 28, 12, '#302a08');
  }
}

function drawArenaLich(x, y, t, cleared, fade) {
  const R = 155;
  // Outer dark ground
  const g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R);
  g.addColorStop(0, `rgba(20,0,40,${0.72 * fade})`);
  g.addColorStop(0.6, `rgba(10,0,25,${0.55 * fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();

  // Rotating rune ring
  const runeR = R * 0.62;
  ctx.strokeStyle = `rgba(160,80,255,${(0.18 + Math.sin(t * 1.6) * 0.1) * fade})`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, runeR, 0, TAU); ctx.stroke();
  ctx.strokeStyle = `rgba(120,50,200,${(0.12 + Math.sin(t * 2.1) * 0.07) * fade})`;
  ctx.beginPath(); ctx.arc(x, y, R * 0.38, 0, TAU); ctx.stroke();
  // Pentagram lines
  const pts5 = 5;
  for (let i = 0; i < pts5; i++) {
    const a1 = (i / pts5) * TAU + t * 0.05;
    const a2 = ((i + 2) / pts5) * TAU + t * 0.05;
    ctx.strokeStyle = `rgba(180,100,255,${(0.14 + Math.sin(t*2+i)*0.06)*fade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a1) * runeR, y + Math.sin(a1) * runeR);
    ctx.lineTo(x + Math.cos(a2) * runeR, y + Math.sin(a2) * runeR);
    ctx.stroke();
  }
  // Orbit particles
  if (!cleared) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t * 0.7;
      const px2 = x + Math.cos(a) * R * 0.5, py2 = y + Math.sin(a) * R * 0.5;
      const pa = 0.55 + Math.sin(t * 3 + i) * 0.3;
      ctx.fillStyle = `rgba(200,130,255,${pa * fade})`;
      ctx.fillRect(Math.round(px2) - 2, Math.round(py2) - 2, 4, 4);
    }
  }
  // 10 bone columns around perimeter
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const cx2 = x + Math.cos(a) * R, cy2 = y + Math.sin(a) * R;
    const h = 28 + (i % 3) * 8;
    // Shadow
    ctx.fillStyle = `rgba(0,0,0,${0.3 * fade})`;
    ctx.beginPath(); ctx.ellipse(cx2, cy2 + h * 0.4, 7, 3, 0, 0, TAU); ctx.fill();
    // Column bone shaft
    pxRect(cx2 - 4, cy2 - h, 9, h + 4, i%2===0?'#3a2a40':'#2e2038');
    pxRect(cx2 - 4, cy2 - h, 9, 2, '#5a4a60');
    pxRect(cx2 - 4, cy2 - h, 2, h + 4, '#1e1828');
    // Skull top
    if (!cleared) {
      pxRect(cx2 - 4, cy2 - h - 8, 8, 7, '#d0c8d8');
      pxRect(cx2 - 4, cy2 - h - 8, 8, 2, '#f0e8f8');
      ctx.fillStyle = '#100c18';
      ctx.fillRect(cx2 - 3, cy2 - h - 5, 2, 2);
      ctx.fillRect(cx2 + 1, cy2 - h - 5, 2, 2);
      const glowA = (0.4 + Math.sin(t * 2.8 + i * 0.7) * 0.3) * fade;
      ctx.fillStyle = `rgba(180,80,255,${glowA})`;
      ctx.fillRect(cx2 - 3, cy2 - h - 5, 2, 2);
      ctx.fillRect(cx2 + 1, cy2 - h - 5, 2, 2);
    } else {
      // Cleared: crumbled
      pxRect(cx2 - 3, cy2 - h - 4, 7, 5, '#6a5a70');
    }
    // Chain to next
    const a2 = ((i + 1) / N) * TAU;
    const nx2 = x + Math.cos(a2) * R, ny2 = y + Math.sin(a2) * R;
    ctx.strokeStyle = `rgba(80,50,100,${0.35 * fade})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(cx2, cy2 - h * 0.6); ctx.lineTo(nx2, ny2 - h * 0.6); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Central dark altar (bigger than stone circle)
  ctx.fillStyle = `rgba(0,0,0,${0.45 * fade})`;
  ctx.beginPath(); ctx.ellipse(x, y + 8, 16, 6, 0, 0, TAU); ctx.fill();
  pxRect(x - 14, y - 2, 28, 14, '#2e1e40');
  pxRect(x - 14, y - 2, 28, 3, '#4e3e60');
  pxRect(x - 11, y - 10, 22, 10, '#241630');
  pxRect(x - 11, y - 10, 22, 3, '#3e2e50');
  pxRect(x - 8, y - 17, 16, 9, '#1a1025');
  pxRect(x - 8, y - 17, 16, 3, '#2e2040');
  if (!cleared) {
    // Lich skull on altar
    pxRect(x - 6, y - 24, 12, 10, '#d8d0e8');
    pxRect(x - 6, y - 24, 12, 2, '#f8f0ff');
    ctx.fillStyle = '#080610';
    ctx.fillRect(x - 5, y - 21, 3, 3);
    ctx.fillRect(x + 2, y - 21, 3, 3);
    const lichA = (0.6 + Math.sin(t * 3.5) * 0.35) * fade;
    ctx.fillStyle = `rgba(200,100,255,${lichA})`;
    ctx.fillRect(x - 5, y - 21, 3, 3);
    ctx.fillRect(x + 2, y - 21, 3, 3);
    ctx.fillRect(x - 1, y - 18, 2, 2);
    // Aura glow
    const altarA = (0.22 + Math.sin(t * 4) * 0.14) * fade;
    ctx.fillStyle = `rgba(150,60,255,${altarA})`;
    ctx.fillRect(x - 15, y - 26, 30, 38);
  }
}

function drawArenaDemon(x, y, t, cleared, fade) {
  const R = 165;
  // Lava ground
  const g = ctx.createRadialGradient(x, y, R * 0.15, x, y, R);
  g.addColorStop(0, `rgba(60,10,0,${0.78 * fade})`);
  g.addColorStop(0.5, `rgba(40,5,0,${0.6 * fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();

  // Lava pools (4)
  const lavaCols = ['#cc2200', '#ee4400', '#ff6600', '#ff8800'];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const lx = x + Math.cos(a) * R * 0.55, ly = y + Math.sin(a) * R * 0.55;
    const lr = 18 + Math.sin(t * 2.2 + i) * 3;
    ctx.fillStyle = `rgba(80,10,0,${0.5 * fade})`;
    ctx.beginPath(); ctx.ellipse(lx, ly + 4, lr * 1.1, lr * 0.55, 0, 0, TAU); ctx.fill();
    const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, lr);
    lg.addColorStop(0, `rgba(255,140,0,${0.85 * fade})`);
    lg.addColorStop(0.5, `rgba(200,40,0,${0.65 * fade})`);
    lg.addColorStop(1, 'transparent');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.ellipse(lx, ly, lr, lr * 0.5, 0, 0, TAU); ctx.fill();
    // Lava bubble animation
    if (!cleared) {
      const bubT = (t * 1.8 + i * 1.57) % 1;
      const bSize = 2 + bubT * 3;
      ctx.fillStyle = `rgba(255,200,50,${(1 - bubT) * 0.7 * fade})`;
      ctx.beginPath(); ctx.arc(lx + Math.cos(t+i*2)*lr*0.4, ly + Math.sin(t*0.9+i)*lr*0.2, bSize, 0, TAU); ctx.fill();
    }
  }

  // 10 obsidian wall pillars
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const px2 = x + Math.cos(a) * R, py2 = y + Math.sin(a) * R;
    const h = 32 + (i % 4) * 6;
    ctx.fillStyle = `rgba(0,0,0,${0.35 * fade})`;
    ctx.beginPath(); ctx.ellipse(px2, py2 + h * 0.35, 9, 3, 0, 0, TAU); ctx.fill();
    // Obsidian block
    pxRect(px2 - 5, py2 - h, 11, h + 5, '#1a0a0a');
    pxRect(px2 - 5, py2 - h, 11, 3, '#2e1010');
    pxRect(px2 - 5, py2 - h, 2, h + 5, '#0a0404');
    pxRect(px2 + 4, py2 - h, 2, h + 5, '#2e1818');
    // Fire glow at base + top
    if (!cleared) {
      const fireA = (0.35 + Math.sin(t * 3.5 + i * 0.63) * 0.25) * fade;
      ctx.fillStyle = `rgba(255,80,0,${fireA})`;
      ctx.fillRect(px2 - 5, py2 - 6, 11, 5);
      ctx.fillStyle = `rgba(255,160,0,${fireA * 0.6})`;
      ctx.fillRect(px2 - 3, py2 - h - 5, 7, 5);
      // Tiny flame
      const fy = py2 - h - 5 - Math.sin(t * 5 + i) * 3;
      pxRect(px2 - 2, Math.round(fy), 5, 6, '#ff4400');
      pxRect(px2 - 1, Math.round(fy) - 2, 3, 4, '#ff8800');
      pxRect(px2, Math.round(fy) - 3, 1, 3, '#ffcc44');
    }
  }
  // Fire rune ring
  if (!cleared) {
    ctx.strokeStyle = `rgba(255,80,0,${(0.15 + Math.sin(t * 2.3) * 0.08) * fade})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, R * 0.6, 0, TAU); ctx.stroke();
    // Rotating fire runes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 0.4;
      const rx = x + Math.cos(a) * R * 0.6, ry = y + Math.sin(a) * R * 0.6;
      const ra = (0.5 + Math.sin(t * 4 + i) * 0.3) * fade;
      ctx.fillStyle = `rgba(255,120,0,${ra})`;
      ctx.fillRect(Math.round(rx) - 1, Math.round(ry) - 2, 3, 5);
      ctx.fillRect(Math.round(rx) - 2, Math.round(ry), 5, 2);
    }
  }
  // Central demon altar / lava pool
  ctx.fillStyle = `rgba(0,0,0,${0.5 * fade})`;
  ctx.beginPath(); ctx.ellipse(x, y + 6, 18, 7, 0, 0, TAU); ctx.fill();
  pxRect(x - 15, y - 4, 30, 16, '#200808');
  pxRect(x - 15, y - 4, 30, 3, '#3a1010');
  pxRect(x - 12, y - 14, 24, 12, '#180404');
  pxRect(x - 12, y - 14, 24, 3, '#2e0808');
  // Central lava pit
  if (!cleared) {
    const cg = ctx.createRadialGradient(x, y - 4, 0, x, y - 4, 12);
    cg.addColorStop(0, `rgba(255,200,0,${0.9 * fade})`);
    cg.addColorStop(0.5, `rgba(255,60,0,${0.7 * fade})`);
    cg.addColorStop(1, 'transparent');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(x, y - 4, 12, 6, 0, 0, TAU); ctx.fill();
    // Demon rune on altar
    const ra = (0.5 + Math.sin(t * 5) * 0.35) * fade;
    ctx.fillStyle = `rgba(255,100,0,${ra})`;
    ctx.fillRect(x - 10, y - 11, 20, 2);
    ctx.fillRect(x - 1, y - 18, 2, 12);
    ctx.fillRect(x - 6, y - 15, 12, 2);
  }
}

function drawArenaTitan(x, y, t, cleared, fade) {
  const R = 180;
  // Stone ground
  const g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
  g.addColorStop(0, `rgba(30,25,18,${0.7 * fade})`);
  g.addColorStop(0.6, `rgba(22,18,12,${0.5 * fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();

  // Colosseum floor tiles (inner ring)
  const tileR = R * 0.55;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const tx2 = x + Math.cos(a) * tileR * 0.5, ty2 = y + Math.sin(a) * tileR * 0.5;
    pxRect(tx2 - 9, ty2 - 9, 18, 18, (i%2===0)?'#3a3228':'#2e2820');
    pxRect(tx2 - 9, ty2 - 9, 18, 1, '#5a4e3e');
    pxRect(tx2 - 9, ty2 - 9, 1, 18, '#4a3e2e');
  }

  // Outer massive stone walls — partial colosseum (12 huge blocks)
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const px2 = x + Math.cos(a) * R, py2 = y + Math.sin(a) * R;
    const h = 44 + (i % 5) * 10;
    const broken = !cleared && (i === 3 || i === 7 || i === 10);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * fade})`;
    ctx.beginPath(); ctx.ellipse(px2, py2 + h * 0.3, 14, 5, 0, 0, TAU); ctx.fill();
    if (broken) {
      // Crumbled section
      const bh = Math.floor(h * 0.55);
      pxRect(px2 - 8, py2 - bh, 17, bh + 5, '#6a5e4e');
      pxRect(px2 - 8, py2 - bh, 17, 3, '#8a7a66');
      pxRect(px2 - 8, py2 - bh, 3, bh + 5, '#4a3e30');
      // Rubble
      pxRect(px2 - 4, py2 + 2, 6, 4, '#5a4e3e');
      pxRect(px2 + 4, py2 + 4, 5, 3, '#6a5e4e');
      pxRect(px2 - 10, py2 + 5, 7, 3, '#4a3e30');
    } else {
      pxRect(px2 - 8, py2 - h, 17, h + 5, '#7a6e5e');
      pxRect(px2 - 8, py2 - h, 17, 3, '#9a8e7e');
      pxRect(px2 - 8, py2 - h, 3, h + 5, '#5a4e3e');
      pxRect(px2 + 6, py2 - h, 3, h + 5, '#8a7e6e');
      // Battlements on top
      pxRect(px2 - 7, py2 - h - 5, 5, 5, '#8a7e6e');
      pxRect(px2 + 2, py2 - h - 5, 5, 5, '#8a7e6e');
      // Moss on sides
      pxRect(px2 - 6, py2 - h * 0.6, 4, 5, '#2a4a22');
      pxRect(px2 + 3, py2 - h * 0.4, 3, 4, '#1e3a1a');
      // Viewing arch cut-out
      if (i % 3 === 0 && h > 50) {
        pxRect(px2 - 4, py2 - h * 0.6, 8, 10, '#1e1a12');
      }
    }
    // Wall-to-wall connect
    const a2 = ((i + 1) / N) * TAU;
    const nx2 = x + Math.cos(a2) * R, ny2 = y + Math.sin(a2) * R;
    ctx.strokeStyle = `rgba(90,80,60,${0.4 * fade})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px2, py2 - h * 0.3); ctx.lineTo(nx2, ny2 - h * 0.3); ctx.stroke();
  }
  // Scattered debris inside
  for (let i = 0; i < 8; i++) {
    const da = (i / 8) * TAU + 0.3;
    const dr = R * (0.28 + (i % 3) * 0.1);
    const drx = x + Math.cos(da) * dr, dry = y + Math.sin(da) * dr;
    pxRect(drx - 4, dry - 2, 8 + (i%3)*4, 3 + (i%2)*2, '#5a4e3e');
    pxRect(drx - 3, dry + 1, 5 + (i%2)*3, 2, '#4a3e2e');
  }
  // Central titan altar — massive stone block
  ctx.fillStyle = `rgba(0,0,0,${0.4 * fade})`;
  ctx.beginPath(); ctx.ellipse(x, y + 12, 24, 8, 0, 0, TAU); ctx.fill();
  pxRect(x - 22, y - 6, 44, 18, '#6a5e4e');
  pxRect(x - 22, y - 6, 44, 4, '#8a7e6e');
  pxRect(x - 22, y - 6, 4, 18, '#4a3e2e');
  pxRect(x - 18, y - 18, 36, 14, '#5a4e3e');
  pxRect(x - 18, y - 18, 36, 4, '#7a6e5e');
  pxRect(x - 14, y - 26, 28, 10, '#4a3e2e');
  pxRect(x - 14, y - 26, 28, 4, '#6a5e4e');
  if (!cleared) {
    // Titan rune glow
    const ta = (0.3 + Math.sin(t * 1.8) * 0.18) * fade;
    ctx.fillStyle = `rgba(220,170,80,${ta})`;
    ctx.fillRect(x - 12, y - 24, 24, 2);
    ctx.fillRect(x - 1, y - 32, 2, 16);
    ctx.fillRect(x - 8, y - 28, 16, 2);
    // Earth shake cracks
    pxRect(x - 18, y - 4, 36, 1, '#302820');
    pxRect(x + 4, y - 18, 1, 18, '#302820');
    pxRect(x - 10, y - 20, 1, 12, '#302820');
  }
}

function drawArenaSpider(x, y, t, cleared, fade) {
  const R = 160;
  // Dark toxic ground
  const g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
  g.addColorStop(0, `rgba(0,20,5,${0.75 * fade})`);
  g.addColorStop(0.55, `rgba(0,12,3,${0.55 * fade})`);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();

  // Toxic puddles
  for (let i = 0; i < 6; i++) {
    const pa = (i / 6) * TAU + 0.8;
    const pr = R * (0.3 + (i % 3) * 0.13);
    const px2 = x + Math.cos(pa) * pr, py2 = y + Math.sin(pa) * pr;
    const ps = 12 + (i % 3) * 6;
    ctx.fillStyle = `rgba(10,60,10,${0.45 * fade})`;
    ctx.beginPath(); ctx.ellipse(px2, py2 + 3, ps * 1.4, ps * 0.6, 0, 0, TAU); ctx.fill();
    const pg = ctx.createRadialGradient(px2, py2, 0, px2, py2, ps);
    pg.addColorStop(0, `rgba(50,200,30,${0.5 * fade})`);
    pg.addColorStop(0.5, `rgba(20,120,15,${0.3 * fade})`);
    pg.addColorStop(1, 'transparent');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.ellipse(px2, py2, ps, ps * 0.45, 0, 0, TAU); ctx.fill();
  }

  // 8 dead trees around perimeter
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const tx2 = x + Math.cos(a) * R, ty2 = y + Math.sin(a) * R;
    const h = 40 + (i % 3) * 14;
    ctx.fillStyle = `rgba(0,0,0,${0.3 * fade})`;
    ctx.beginPath(); ctx.ellipse(tx2, ty2 + 6, 8, 3, 0, 0, TAU); ctx.fill();
    // Trunk
    pxRect(tx2 - 4, ty2 - h, 8, h + 4, '#1e1808');
    pxRect(tx2 - 4, ty2 - h, 2, h + 4, '#120e04');
    // Branches
    ctx.strokeStyle = `rgba(30,25,8,${0.8 * fade})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx2, ty2 - h); ctx.lineTo(tx2 - 14 - (i%2)*6, ty2 - h * 0.65); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx2, ty2 - h * 0.72); ctx.lineTo(tx2 + 12 + (i%3)*4, ty2 - h * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx2, ty2 - h * 0.45); ctx.lineTo(tx2 - 8 - (i%2)*3, ty2 - h * 0.32); ctx.stroke();
    // Web threads to center
    if (!cleared) {
      ctx.strokeStyle = `rgba(160,200,140,${(0.18 + Math.sin(t * 0.8 + i) * 0.06) * fade})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(tx2, ty2 - h * 0.6); ctx.lineTo(x, y - 10); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Cocoon on branch
    if (!cleared && i % 2 === 0) {
      const coA = (i / N) * TAU + 0.5;
      const coX = tx2 + Math.cos(coA + 0.3) * 14, coY = ty2 - h * 0.55 - 6;
      pxRect(coX - 4, coY - 8, 9, 14, '#a0b8a0');
      pxRect(coX - 4, coY - 8, 9, 2, '#c0d8c0');
      // Web wrapping lines
      ctx.strokeStyle = `rgba(180,220,160,${0.5 * fade})`; ctx.lineWidth = 1;
      for (let w = 0; w < 3; w++) {
        ctx.beginPath(); ctx.moveTo(coX - 5, coY - 6 + w * 4); ctx.lineTo(coX + 5, coY - 4 + w * 4); ctx.stroke();
      }
    }
  }
  // Web spokes (connecting trees around perimeter)
  if (!cleared) {
    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * TAU, a2 = ((i + 1) / N) * TAU;
      const sx = x + Math.cos(a1) * R, sy = y + Math.sin(a1) * R;
      const ex = x + Math.cos(a2) * R, ey = y + Math.sin(a2) * R;
      ctx.strokeStyle = `rgba(150,190,130,${(0.22 + Math.sin(t * 1.1 + i) * 0.08) * fade})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Web rings (concentric circles with gaps)
    for (let r2 = 1; r2 <= 3; r2++) {
      ctx.strokeStyle = `rgba(140,180,120,${(0.12 + r2 * 0.04) * fade})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]);
      ctx.beginPath(); ctx.arc(x, y, R * (0.22 + r2 * 0.22), 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // Central cave pit / web-covered hole
  ctx.fillStyle = `rgba(0,0,0,${0.65 * fade})`;
  ctx.beginPath(); ctx.ellipse(x, y + 4, 28, 18, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(0,15,0,${0.85 * fade})`;
  ctx.beginPath(); ctx.ellipse(x, y, 22, 14, 0, 0, TAU); ctx.fill();
  // Web over cave
  if (!cleared) {
    ctx.strokeStyle = `rgba(180,230,160,${0.55 * fade})`; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const wa = (i / 6) * TAU;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(wa) * 22, y + Math.sin(wa) * 14); ctx.stroke();
    }
    for (let r2 = 1; r2 <= 2; r2++) {
      ctx.strokeStyle = `rgba(160,210,140,${(0.3 + r2 * 0.1) * fade})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, 8 * r2, 5 * r2, 0, 0, TAU); ctx.stroke();
    }
    // Spider egg sac
    ctx.fillStyle = `rgba(180,210,160,${0.7 * fade})`;
    ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(100,160,80,${(0.4 + Math.sin(t * 3) * 0.2) * fade})`;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
  }
}

function drawChests() {
  for (const c of state.chests) {
    if (!inView(c.x, c.y, 40)) continue;
    const x = Math.round(c.x);
    const y = Math.round(c.y + (c.open ? 0 : Math.sin(c.bob) * 1.2));
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 11, 3, 0, 0, TAU); ctx.fill();
    if (c.open) {
      pxRect(x - 9, y, 18, 8, '#7a4a1a');
      pxRect(x - 9, y, 18, 2, '#a06a2a');
      pxRect(x - 9, y - 10, 18, 10, '#5a3a10');
      pxRect(x - 9, y - 10, 18, 2, '#7a5a2a');
      ctx.fillStyle = 'rgba(255,200,60,0.1)';
      ctx.fillRect(x - 9, y - 2, 18, 10);
    } else {
      const isWeapon = c.loot === 'weapon_upgrade';
      const pulse = 0.18 + Math.sin(c.bob * 3) * 0.09;
      ctx.fillStyle = isWeapon ? `rgba(255,200,60,${pulse})` : `rgba(60,160,255,${pulse})`;
      ctx.fillRect(x - 13, y - 7, 26, 20);
      pxRect(x - 9, y, 18, 10, '#7a4a1a');
      pxRect(x - 9, y, 18, 2, '#a06a2a');
      pxRect(x - 9, y + 8, 18, 2, '#3a2410');
      pxRect(x - 9, y + 2, 2, 6, '#5a3410');
      pxRect(x + 7, y + 2, 2, 6, '#5a3410');
      pxRect(x - 9, y - 8, 18, 8, '#7a4a1a');
      pxRect(x - 9, y - 8, 18, 2, '#a06a2a');
      pxRect(x - 9, y - 1, 18, 1, '#5a3410');
      const lk = isWeapon ? '#ffd66b' : '#3bb6ff';
      pxRect(x - 2, y - 4, 4, 6, lk);
      pxRect(x - 1, y - 5, 2, 2, lk);
      // Proximity hint
      const ddx = player.x - c.x, ddy = player.y - c.y;
      if (ddx*ddx + ddy*ddy < 60*60) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 10px "Courier New"';
        ctx.fillStyle = '#ffd66b';
        ctx.fillText('SKRZYNIA', x, y - 14);
      }
    }
  }
}


// ---- Player ----
function drawPlayer() {
  const x = Math.round(player.x);
  const y = Math.round(player.y);
  const bob = Math.round(Math.sin(player.walkBob) * 1.5);
  const facing = player.facing;

  // Invuln blink
  if (player.invuln > 0 && Math.sin(state.time * 50) > 0) {
    ctx.globalAlpha = 0.5;
  }

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(facing, 1);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 9, 3, 0, 0, TAU);
  ctx.fill();

  const isElite = !!CLASSES[player.classId].base;
  if (isElite) {
    ctx.globalAlpha = 0.22 + Math.sin(state.time * 5) * 0.08;
    ctx.fillStyle = '#40ff88';
    ctx.fillRect(-15, -22, 30, 38);
    ctx.globalAlpha = 1;
  }
  const dcid = player.baseClass;
  if (dcid === 'mage') drawMage();
  else if (dcid === 'archer') drawArcher();
  else if (dcid === 'doctor') drawDoctor();
  else if (dcid === 'knight') drawKnight();
  else if (dcid === 'shaman') drawShaman();
  else if (dcid === 'ninja') drawNinja();
  else if (dcid === 'gravedigger') drawGravedigger();
  else if (dcid === 'berserker') drawBerserker();
  else if (dcid === 'pyromancer') drawPyromancer();
  else if (dcid === 'cleric') drawCleric();
  else if (dcid === 'hunter') drawHunter();
  else if (dcid === 'shadow') drawShadow();
  else if (dcid === 'crusader') drawCrusader();
  else if (dcid === 'witch') drawWitch();
  else if (dcid === 'alchemist') drawAlchemist();
  else if (dcid === 'bard') drawBard();
  else if (dcid === 'necromancer') drawNecromancer();
  else if (dcid === 'paladin') drawPaladin();
  else if (dcid === 'druid') drawDruid();
  else if (dcid === 'vampire') drawVampire();
  else if (dcid === 'frostmage') drawFrostmage();
  else if (dcid === 'stormcaller') drawStormcaller();
  else if (dcid === 'runeknight') drawRuneknight();
  else if (dcid === 'illusionist') drawIllusionist();
  else if (dcid === 'void') drawVoid();

  drawHeldWeapon();
  ctx.restore();
  ctx.globalAlpha = 1;
}

const SWORD_SWING_ARC = 0.88;

function drawHeldWeapon() {
  // Show weapon based on selected hotbar slot (if it's a weapon)
  const hbSlot = player.hotbar[player.hotbarSel];
  const kind = hbSlot && (hbSlot.kind in HOTBAR_WEAPONS) ? hbSlot.kind : null;
  if (!kind) return;

  const ang = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
  // Adjust angle for facing direction (scale(-1,1) flips x-axis)
  const localAng = player.facing === -1 ? Math.PI - ang : ang;

  ctx.save();
  ctx.rotate(localAng);

  const isMelee = kind === 'sword' || kind === 'sword2' || kind === 'mace';
  if (isMelee) {
    const swingT = Math.max(0, player._meleeSwingTimer || 0);
    const swingOff = swingT > 0 ? (swingT / 0.28) * 1.0 : 0;
    if (swingOff > 0) ctx.rotate(-swingOff);
    // Arm
    pxRect(2, -2, 6, 3, '#f1c79a');

    if (kind === 'mace') {
      // Handle
      pxRect(7, -2, 4, 3, '#6a3a10');
      // Mace head (orange/fiery)
      pxRect(10, -5, 8, 10, '#cc5522');
      pxRect(11, -6, 6, 2,  '#ff8844');
      pxRect(11,  4, 6, 2,  '#ff8844');
      pxRect(15, -4, 3, 8,  '#ff6633');
    } else {
      // Handle
      pxRect(7, -2, 4, 3, '#6a3a10');
      // Crossguard
      const cg = kind === 'sword2' ? '#9933cc' : '#b08030';
      pxRect(10, -4, 2, 8, cg);
      // Blade
      const bladeCol = kind === 'sword2' ? '#cc44ff' : '#c0d8ff';
      const bladeHi  = kind === 'sword2' ? '#ee99ff' : '#e8f4ff';
      pxRect(11, -1, 17, 2, bladeCol);
      pxRect(11, -1, 16, 1, bladeHi);
      pxRect(27, 0, 3, 1, bladeCol);
      // Runic glow for sword2
      if (kind === 'sword2') {
        const gl = 0.4 + Math.sin(state.time * 7) * 0.25;
        ctx.fillStyle = `rgba(200,80,255,${gl})`;
        ctx.fillRect(12, -3, 14, 5);
      }
    }

    // Swing arc flash
    if (swingT > 0) {
      const col = kind === 'mace' ? '255,130,60' : (kind === 'sword2' ? '200,80,255' : '192,220,255');
      ctx.strokeStyle = `rgba(${col},${swingT * 3.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 54, -SWORD_SWING_ARC, SWORD_SWING_ARC);
      ctx.stroke();
    }
  } else if (kind === 'staff') {
    // Staff — held at angle, glowing orb at end
    pxRect(2, -2, 6, 3, '#f1c79a');
    pxRect(7, -1, 20, 2, '#6a3a10');
    const glow = 0.55 + Math.sin(state.time * 5) * 0.3;
    ctx.fillStyle = `rgba(180, 80, 255, ${glow})`;
    ctx.beginPath();
    ctx.arc(29, 0, 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${glow * 0.5})`;
    ctx.beginPath();
    ctx.arc(28, -1, 2, 0, TAU);
    ctx.fill();
  } else if (kind === 'bow' || kind === 'bow2') {
    // Bow — limbs perpendicular to aim
    const bc = kind === 'bow2' ? '#44aaff' : '#7a4a1a';
    ctx.rotate(-Math.PI / 2);
    pxRect(-1, -15, 2, 12, bc);
    pxRect(-1,  4, 2, 12, bc);
    ctx.strokeStyle = '#dcd4c0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -15); ctx.lineTo(-5, 0); ctx.lineTo(0, 15);
    ctx.stroke();
    // Arrow nocked
    pxRect(-1, -5, 13, 1, '#c8a060');
  }

  ctx.restore();
}

function drawMage() {
  // Robe
  pxRect(-6, -2, 12, 14, '#3a2376');
  pxRect(-7, 2, 14, 8, '#3a2376');
  pxRect(2, -2, 4, 14, '#2a1a5e');
  pxRect(-6, 4, 12, 2, '#ffd66b');
  // Head
  pxRect(-4, -10, 8, 6, '#f1c79a');
  pxRect(2, -8, 2, 4, '#d39e75');
  pxRect(-4, -5, 8, 3, '#dcd4e8');
  pxRect(-2, -3, 4, 2, '#dcd4e8');
  pxRect(-2, -9, 2, 2, '#1a1228');
  pxRect(2, -9, 1, 2, '#1a1228');
  // Hat
  pxRect(-5, -14, 10, 2, '#5a3da0');
  pxRect(-4, -16, 8, 2, '#5a3da0');
  pxRect(-2, -18, 4, 2, '#5a3da0');
  pxRect(-1, -20, 2, 2, '#5a3da0');
  pxRect(-6, -12, 12, 2, '#3b2670');
  pxRect(-1, -16, 2, 1, '#ffd66b');
  pxRect(-2, -15, 4, 1, '#ffd66b');
  // Arms + staff
  pxRect(4, 0, 3, 6, '#3a2376');
  pxRect(6, -10, 2, 16, '#7a4a1a');
  pxRect(6, -12, 2, 2, '#a06a2a');
  const orbColor = player.mp > 50 ? '#ffd66b' : (player.mp > 20 ? '#ff8855' : '#ff4060');
  pxRect(5, -14, 4, 3, orbColor);
  pxRect(6, -15, 2, 1, '#ffffff');
  ctx.fillStyle = `rgba(255, 214, 107, ${0.25 + Math.sin(state.time * 6) * 0.15})`;
  ctx.fillRect(3, -16, 8, 6);
  pxRect(-7, 0, 3, 6, '#3a2376');
  // Legs
  pxRect(-4, 9, 3, 5, '#2a1a5e');
  pxRect(1, 9, 3, 5, '#2a1a5e');
  pxRect(-5, 13, 4, 2, '#1a0e3f');
  pxRect(1, 13, 4, 2, '#1a0e3f');
}

function drawArcher() {
  // Tunic
  pxRect(-6, -2, 12, 14, '#2a6a3a');
  pxRect(-7, 2, 14, 8, '#2a6a3a');
  pxRect(2, -2, 4, 14, '#1d4a28');
  pxRect(-6, 4, 12, 2, '#7a4a1a');
  // Head
  pxRect(-4, -10, 8, 6, '#f1c79a');
  pxRect(2, -8, 2, 4, '#d39e75');
  pxRect(-2, -9, 2, 2, '#1a1228');
  pxRect(2, -9, 1, 2, '#1a1228');
  // Hood
  pxRect(-5, -14, 10, 4, '#1d4a28');
  pxRect(-6, -12, 12, 4, '#1d4a28');
  pxRect(-3, -14, 6, 1, '#2a6a3a');
  // Bow on right (drawn pulled)
  pxRect(6, -10, 2, 18, '#7a4a1a');
  pxRect(5, -10, 3, 2, '#a06a2a');
  pxRect(5, 6, 3, 2, '#a06a2a');
  // Bowstring
  ctx.strokeStyle = '#dcd4c0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(6, -8); ctx.lineTo(2, -1); ctx.lineTo(6, 6);
  ctx.stroke();
  // Drawn arrow
  pxRect(2, -1, 6, 1, '#dcd4c0');
  pxRect(7, -2, 2, 3, '#ffd66b');
  // Arm
  pxRect(4, -1, 2, 5, '#2a6a3a');
  pxRect(-6, 0, 2, 6, '#2a6a3a');
  // Quiver on back
  pxRect(-7, -4, 3, 9, '#5a3a1a');
  pxRect(-6, -6, 1, 3, '#dcd4c0');
  pxRect(-5, -6, 1, 3, '#dcd4c0');
  pxRect(-6, -7, 1, 1, '#ff6633');
  pxRect(-5, -7, 1, 1, '#ff6633');
  // Legs
  pxRect(-4, 9, 3, 5, '#1d4a28');
  pxRect(1, 9, 3, 5, '#1d4a28');
  pxRect(-5, 13, 4, 2, '#0f2814');
  pxRect(1, 13, 4, 2, '#0f2814');
}

function drawDoctor() {
  // Coat (white)
  pxRect(-6, -2, 12, 14, '#e8e4ee');
  pxRect(-7, 2, 14, 8, '#e8e4ee');
  pxRect(2, -2, 4, 14, '#b8b4c0');
  // Red cross on chest
  pxRect(-1, 0, 2, 6, '#ff3b3b');
  pxRect(-3, 2, 6, 2, '#ff3b3b');
  // Belt
  pxRect(-6, 6, 12, 1, '#1a1228');
  // Head
  pxRect(-4, -10, 8, 6, '#f1c79a');
  pxRect(2, -8, 2, 4, '#d39e75');
  // Glasses
  pxRect(-3, -9, 2, 2, '#1a1228');
  pxRect(1, -9, 2, 2, '#1a1228');
  pxRect(-1, -8, 2, 1, '#1a1228');
  pxRect(-3, -9, 2, 1, '#ffffff');
  pxRect(1, -9, 2, 1, '#ffffff');
  // Hair (short)
  pxRect(-4, -12, 8, 2, '#3a2820');
  // Doctor cap (small)
  pxRect(-3, -13, 6, 1, '#ffffff');
  pxRect(-1, -14, 2, 1, '#ff3b3b');
  // Right hand — syringe
  pxRect(4, 0, 3, 6, '#e8e4ee');
  pxRect(6, -2, 2, 8, '#dcd4e8');
  pxRect(6, -4, 2, 2, '#8ad8ff');
  pxRect(7, -6, 1, 2, '#a0a0a8');
  // Left hand — clipboard
  pxRect(-7, 0, 3, 6, '#e8e4ee');
  pxRect(-9, 2, 3, 5, '#a07840');
  pxRect(-9, 2, 3, 1, '#ffd66b');
  pxRect(-8, 4, 1, 1, '#1a1228');
  pxRect(-8, 5, 1, 1, '#1a1228');
  // Stethoscope around neck
  ctx.strokeStyle = '#1a1228';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-3, -3); ctx.quadraticCurveTo(0, 0, 3, -3);
  ctx.stroke();
  pxRect(2, 2, 2, 2, '#1a1228');
  // Legs
  pxRect(-4, 9, 3, 5, '#3a3445');
  pxRect(1, 9, 3, 5, '#3a3445');
  pxRect(-5, 13, 4, 2, '#1a1228');
  pxRect(1, 13, 4, 2, '#1a1228');
}

function drawKnight() {
  // Legs
  pxRect(-4, 9, 3, 5, '#5a6070');
  pxRect(1, 9, 3, 5, '#5a6070');
  pxRect(-5, 13, 4, 2, '#3a4050');
  pxRect(1, 13, 4, 2, '#3a4050');
  // Body — plate armor
  pxRect(-7, -2, 14, 13, '#7a8090');
  pxRect(-7, -2, 14, 3, '#9aa0b0');
  pxRect(-7, -2, 2, 13, '#5a6070');
  pxRect(5, -2, 2, 13, '#9aa0b0');
  // Red tabard stripe
  pxRect(-3, 0, 6, 9, '#8a1520');
  pxRect(-2, 1, 4, 7, '#aa2030');
  // Belt + skirt
  pxRect(-7, 8, 14, 3, '#4a5060');
  pxRect(-6, 10, 4, 3, '#3a4050');
  pxRect(2, 10, 4, 3, '#3a4050');
  // Helmet
  pxRect(-5, -12, 10, 10, '#7a8090');
  pxRect(-5, -12, 10, 2, '#9aa0b0');
  pxRect(-5, -12, 2, 10, '#5a6070');
  pxRect(-5, -4, 10, 2, '#b0b8c8');
  pxRect(-6, -14, 12, 2, '#9aa0b0');
  pxRect(-3, -5, 6, 1, '#1a1a22');
  // Crest on helmet
  pxRect(-2, -15, 4, 3, '#aa2030');
  pxRect(-1, -17, 2, 2, '#cc3040');
  // Shield (left)
  pxRect(-13, -10, 7, 14, '#7a8090');
  pxRect(-13, -10, 7, 2, '#9aa0b0');
  pxRect(-13, -10, 2, 14, '#5a6070');
  pxRect(-12, -4, 5, 5, '#cc2233');
  pxRect(-11, -3, 3, 3, '#aa1020');
  pxRect(-10, -2, 1, 1, '#ffaa33');
  // Sword (right)
  pxRect(7, -16, 2, 22, '#c0c8d8');
  pxRect(6, -16, 4, 2, '#dde0e8');
  pxRect(5, -7, 6, 2, '#9a7840');
  pxRect(7, 4, 2, 4, '#7a5030');
  pxRect(6, -7, 2, 2, '#ffd66b');
}

function drawShaman() {
  // Legs
  pxRect(-4, 9, 3, 5, '#5a3a20');
  pxRect(1, 9, 3, 5, '#5a3a20');
  pxRect(-5, 13, 4, 2, '#3a2210');
  pxRect(1, 13, 4, 2, '#3a2210');
  // Robe
  pxRect(-6, -2, 12, 13, '#6a4a28');
  pxRect(-7, 2, 14, 8, '#6a4a28');
  pxRect(2, -2, 4, 13, '#4a3018');
  // Beads neckline
  for (let i = 0; i < 5; i++) pxRect(-6 + i*3, -2, 2, 2, ['#ffaa33','#ff6633','#3b9bff','#ff3b3b','#9bff9b'][i]);
  // Head
  pxRect(-4, -10, 8, 6, '#c8924a');
  pxRect(2, -8, 2, 4, '#a8723a');
  // Face paint (blue markings)
  pxRect(-3, -9, 2, 2, '#5a9aff');
  pxRect(1, -9, 2, 2, '#5a9aff');
  pxRect(-3, -7, 1, 3, '#5a9aff');
  pxRect(3, -7, 1, 3, '#5a9aff');
  // Feathered headdress
  pxRect(-4, -14, 8, 4, '#8a6a3a');
  pxRect(-5, -14, 10, 1, '#5a3a18');
  for (let i = 0; i < 5; i++) {
    pxRect(-5 + i*2, -20, 2, 7, ['#ff6633','#ff3b3b','#ffaa33','#3bff8a','#3b9bff'][i]);
    pxRect(-5 + i*2, -21, 1, 1, '#ffffff');
  }
  // Staff (right)
  pxRect(5, -20, 2, 26, '#7a5030');
  pxRect(4, -24, 5, 5, '#e8e0c0');
  pxRect(5, -25, 3, 1, '#e8e0c0');
  pxRect(4, -22, 1, 2, '#1a1228');
  pxRect(7, -22, 1, 2, '#1a1228');
  const sc = 0.7 + Math.sin(state.time * 5) * 0.3;
  ctx.fillStyle = `rgba(80,170,255,${sc})`;
  ctx.beginPath(); ctx.arc(6, -26, 4, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(200,240,255,${sc * 0.8})`;
  ctx.beginPath(); ctx.arc(6, -26, 2, 0, TAU); ctx.fill();
  // Left arm
  pxRect(-7, 0, 3, 6, '#6a4a28');
}

function drawNinja() {
  // Legs
  pxRect(-4, 9, 3, 5, '#1a1a28');
  pxRect(1, 9, 3, 5, '#1a1a28');
  pxRect(-5, 13, 4, 2, '#0e0e18');
  pxRect(1, 13, 4, 2, '#0e0e18');
  // Body — dark gi
  pxRect(-6, -2, 12, 13, '#1a1a28');
  pxRect(-7, 2, 14, 8, '#1a1a28');
  pxRect(2, -2, 4, 13, '#0e0e18');
  // Sash belt (red)
  pxRect(-7, 6, 14, 2, '#8a1520');
  pxRect(-7, 8, 14, 1, '#cc2233');
  // Head — dark hood
  pxRect(-4, -10, 8, 6, '#1a1a28');
  pxRect(2, -8, 2, 4, '#0e0e18');
  // Eyes (white)
  pxRect(-3, -9, 2, 1, '#c8d8ff');
  pxRect(1, -9, 2, 1, '#c8d8ff');
  // Bandana
  pxRect(-4, -12, 8, 2, '#8a1520');
  pxRect(-5, -11, 10, 2, '#8a1520');
  pxRect(4, -11, 3, 3, '#cc2233');
  // Hood
  pxRect(-4, -14, 8, 4, '#1a1a28');
  pxRect(-5, -12, 10, 2, '#0e0e18');
  // Kunai belt
  for (let i = 0; i < 3; i++) {
    pxRect(-4 + i*3, 6, 1, 3, '#c0c8d8');
    pxRect(-4 + i*3, 5, 1, 1, '#ffd66b');
  }
  // Arms
  pxRect(4, 0, 3, 6, '#1a1a28');
  pxRect(-7, 0, 3, 6, '#1a1a28');
  // Throwing shuriken
  pxRect(5, -2, 3, 3, '#c0c8d8');
  pxRect(6, -3, 1, 5, '#c0c8d8');
  pxRect(4, -1, 5, 1, '#c0c8d8');
}

function drawGravedigger() {
  pxRect(-4, 9, 3, 5, '#2a1f1a'); pxRect(1, 9, 3, 5, '#2a1f1a');
  pxRect(-6, -2, 12, 13, '#2a1f1a'); pxRect(-7, 2, 14, 8, '#2a1f1a'); pxRect(3, -2, 3, 13, '#1a1410');
  pxRect(-6, 4, 12, 2, '#4a3a2a');
  pxRect(-4, -10, 8, 6, '#ddd0c0'); pxRect(2, -8, 2, 4, '#c0b090');
  pxRect(-2, -10, 2, 2, '#1a1228'); pxRect(1, -10, 2, 2, '#1a1228');
  pxRect(-5, -16, 10, 6, '#1e1616'); pxRect(-4, -18, 8, 2, '#1e1616');
  pxRect(8, -16, 2, 24, '#6a4a2a'); pxRect(5, -17, 8, 3, '#8a6a4a'); pxRect(5, -15, 8, 2, '#6a4a2a');
}

function drawBerserker() {
  pxRect(-4, 9, 4, 6, '#5a3030'); pxRect(1, 9, 4, 6, '#5a3030');
  pxRect(-7, -2, 14, 14, '#5a3030'); pxRect(-8, 0, 16, 10, '#6a3838'); pxRect(-1, 1, 3, 10, '#8a4040');
  pxRect(-10, -2, 4, 6, '#7a3030'); pxRect(7, -2, 4, 6, '#7a3030');
  pxRect(-4, -10, 8, 6, '#c09870'); pxRect(2, -8, 2, 4, '#a07850');
  pxRect(-3, -10, 2, 2, '#ff3333'); pxRect(2, -10, 2, 2, '#ff3333');
  pxRect(-5, -16, 10, 6, '#5a3030'); pxRect(-6, -14, 12, 4, '#6a3838');
  pxRect(-7, -18, 2, 4, '#c0b0a0'); pxRect(6, -18, 2, 4, '#c0b0a0');
}

function drawPyromancer() {
  pxRect(-4, 9, 3, 5, '#3a1508'); pxRect(1, 9, 3, 5, '#3a1508');
  pxRect(-6, -2, 12, 14, '#5a2010'); pxRect(-7, 2, 14, 8, '#6a2818'); pxRect(2, -2, 4, 14, '#4a1808');
  pxRect(-6, 4, 12, 2, '#ff6622');
  pxRect(-4, -10, 8, 6, '#e8c090'); pxRect(2, -8, 2, 4, '#c8a070');
  pxRect(-4, -16, 8, 4, '#6a2818'); pxRect(-2, -20, 4, 4, '#8a3020'); pxRect(0, -22, 2, 2, '#ff6622');
  pxRect(-8, 2, 3, 4, '#ff6622'); pxRect(-8, 2, 2, 2, '#ffaa44');
}

function drawCleric() {
  pxRect(-4, 9, 3, 5, '#b0a888'); pxRect(1, 9, 3, 5, '#b0a888');
  pxRect(-6, -2, 12, 14, '#d8d0c0'); pxRect(-7, 2, 14, 8, '#e0d8c8'); pxRect(2, -2, 4, 14, '#c0b8a8');
  pxRect(-1, 0, 3, 8, '#ffd66b'); pxRect(-4, 3, 9, 2, '#ffd66b');
  pxRect(-4, -10, 8, 6, '#f0d0a0'); pxRect(2, -8, 2, 4, '#d0b080');
  pxRect(-2, -10, 2, 2, '#1a1228'); pxRect(2, -10, 2, 2, '#1a1228');
  pxRect(-5, -16, 10, 4, '#d8d0c0'); pxRect(-6, -17, 12, 2, '#ffd66b');
}

function drawHunter() {
  pxRect(-4, 9, 3, 5, '#3a4a1a'); pxRect(1, 9, 3, 5, '#3a4a1a');
  pxRect(-6, -2, 12, 14, '#4a5a2a'); pxRect(-7, 2, 14, 8, '#3a4a22'); pxRect(2, -2, 4, 14, '#2a3a18');
  pxRect(-6, 4, 12, 2, '#6a7a4a');
  pxRect(-4, -10, 8, 6, '#d0a870'); pxRect(2, -8, 2, 4, '#b08850');
  pxRect(-2, -10, 2, 2, '#1a1228'); pxRect(2, -10, 2, 2, '#1a1228');
  pxRect(-5, -16, 10, 6, '#4a5a2a'); pxRect(-4, -18, 8, 2, '#4a5a2a');
  pxRect(7, -10, 4, 14, '#6a3a1a'); pxRect(8, -12, 2, 2, '#8a5a2a'); pxRect(9, -12, 1, 2, '#a07030');
}

function drawShadow() {
  pxRect(-4, 9, 3, 5, '#14101e'); pxRect(1, 9, 3, 5, '#14101e');
  pxRect(-6, -2, 12, 14, '#1a1228'); pxRect(-7, 2, 14, 8, '#2a1a38'); pxRect(2, -2, 4, 14, '#14101e');
  pxRect(-6, 4, 12, 2, '#4a2288');
  pxRect(-4, -10, 8, 6, '#c0a880'); pxRect(2, -8, 2, 4, '#a08860');
  pxRect(-3, -10, 2, 2, '#aa44ff'); pxRect(2, -10, 2, 2, '#aa44ff');
  pxRect(-5, -16, 10, 8, '#1a1228'); pxRect(-5, -9, 10, 2, '#2a1a38');
  pxRect(-10, 0, 4, 8, '#7a9acc'); pxRect(-10, 0, 1, 6, '#c0d0ff');
}

function drawCrusader() {
  // Nogi
  pxRect(-4, 9, 3, 5, '#4a5870'); pxRect(1, 9, 3, 5, '#4a5870');
  pxRect(-5, 13, 4, 2, '#2e3848'); pxRect(1, 13, 4, 2, '#2e3848');
  // Ciało — ciężka zbroja biało-złota
  pxRect(-7, -2, 14, 13, '#8a9aaa'); pxRect(-7, -2, 14, 3, '#b0c0d0');
  pxRect(-7, -2, 2, 13, '#6a7a88'); pxRect(5, -2, 2, 13, '#b0c0d0');
  // Złoty krzyż na piersi
  pxRect(-1, -1, 2, 9, '#ffd66b'); pxRect(-4, 2, 8, 2, '#ffd66b');
  // Hełm z grzebieniem
  pxRect(-5, -12, 10, 10, '#8a9aaa'); pxRect(-5, -12, 10, 2, '#b0c0d0');
  pxRect(-5, -12, 2, 10, '#6a7a88'); pxRect(-5, -4, 10, 2, '#c0c8d8');
  pxRect(-6, -14, 12, 2, '#b0c0d0');
  pxRect(-2, -16, 4, 4, '#ffd66b'); pxRect(-1, -18, 2, 2, '#ffe8aa');
  // Tarcza ze złotym krzyżem (lewa)
  pxRect(-13, -10, 7, 15, '#8a9aaa'); pxRect(-13, -10, 7, 2, '#b0c0d0');
  pxRect(-13, -5, 7, 2, '#ffd66b'); pxRect(-11, -10, 3, 15, '#ffd66b');
  // Buzdygan (prawa)
  pxRect(7, -14, 2, 20, '#8a6a3a'); pxRect(5, -16, 6, 4, '#ffd66b');
  pxRect(6, -18, 4, 2, '#ffe8aa');
}

function drawWitch() {
  // Nogi
  pxRect(-4, 9, 3, 5, '#1a0e2e'); pxRect(1, 9, 3, 5, '#1a0e2e');
  pxRect(-5, 13, 4, 2, '#100820'); pxRect(1, 13, 4, 2, '#100820');
  // Ciemna szata
  pxRect(-6, -2, 12, 14, '#2a0a4a'); pxRect(-7, 2, 14, 8, '#2a0a4a');
  pxRect(2, -2, 4, 14, '#1a0630');
  pxRect(-6, 4, 12, 2, '#44cc22');
  // Głowa — blada
  pxRect(-4, -10, 8, 6, '#d4c8e0'); pxRect(2, -8, 2, 4, '#b0a0c0');
  // Oczy (żółte)
  pxRect(-3, -9, 2, 2, '#aaff22'); pxRect(1, -9, 2, 2, '#aaff22');
  // Spiczasty kapelusz
  pxRect(-6, -14, 12, 4, '#2a0a4a'); pxRect(-5, -18, 10, 4, '#2a0a4a');
  pxRect(-3, -22, 6, 4, '#2a0a4a'); pxRect(-1, -26, 2, 4, '#2a0a4a');
  pxRect(-7, -14, 14, 2, '#1a0630');
  pxRect(-1, -20, 2, 1, '#aaff22');
  // Miotła (prawa)
  pxRect(5, -18, 2, 24, '#7a5030'); pxRect(3, 4, 6, 4, '#8a6a1a');
  pxRect(3, 4, 1, 6, '#9a7a2a'); pxRect(7, 4, 1, 6, '#9a7a2a');
  // Lewa ręka
  pxRect(-7, 0, 3, 6, '#2a0a4a');
}

function drawAlchemist() {
  // Nogi
  pxRect(-4, 9, 3, 5, '#3a3455'); pxRect(1, 9, 3, 5, '#3a3455');
  pxRect(-5, 13, 4, 2, '#1a1228'); pxRect(1, 13, 4, 2, '#1a1228');
  // Fartuch — żółto-brązowy
  pxRect(-6, -2, 12, 14, '#8a7a1a'); pxRect(-7, 2, 14, 8, '#8a7a1a');
  pxRect(2, -2, 4, 14, '#6a5a10');
  // Kieszenie
  pxRect(-5, 4, 4, 4, '#7a6a10'); pxRect(1, 4, 4, 4, '#7a6a10');
  // Głowa
  pxRect(-4, -10, 8, 6, '#f1c79a'); pxRect(2, -8, 2, 4, '#d39e75');
  // Okrągłe gogle
  pxRect(-3, -9, 3, 3, '#1a1228'); pxRect(1, -9, 3, 3, '#1a1228');
  pxRect(-3, -9, 3, 1, '#4488ff'); pxRect(1, -9, 3, 1, '#4488ff');
  pxRect(0, -8, 1, 1, '#555');
  // Kapelusz laboranta
  pxRect(-4, -14, 8, 4, '#3a2820'); pxRect(-5, -14, 10, 2, '#2a1818');
  // Kolba (prawa ręka)
  pxRect(4, -2, 3, 8, '#8a7a1a'); pxRect(5, -6, 4, 8, '#88cc22');
  pxRect(5, -8, 4, 2, '#4a7a00'); pxRect(6, -9, 2, 1, '#d0ff80');
  const bub = 0.5 + Math.sin(state.time * 8) * 0.5;
  ctx.fillStyle = `rgba(140,220,60,${bub * 0.7})`;
  ctx.fillRect(5, -10, 4, 2);
  // Lewa ręka
  pxRect(-7, 0, 3, 6, '#8a7a1a');
}

function drawBard() {
  // Nogi
  pxRect(-4, 9, 3, 5, '#1a4a2a'); pxRect(1, 9, 3, 5, '#1a4a2a');
  pxRect(-5, 13, 4, 2, '#0e2e18'); pxRect(1, 13, 4, 2, '#0e2e18');
  // Kolorowa tunika
  pxRect(-6, -2, 12, 14, '#2a7a3a'); pxRect(-7, 2, 14, 8, '#2a7a3a');
  pxRect(2, -2, 4, 14, '#1a5228');
  pxRect(-6, 4, 12, 2, '#ffd66b');
  // Nuta na piersi
  pxRect(-1, 0, 3, 5, '#ffd66b'); pxRect(-1, 0, 3, 2, '#ffd66b');
  pxRect(-2, 3, 2, 2, '#ffd66b');
  // Głowa
  pxRect(-4, -10, 8, 6, '#f1c79a'); pxRect(2, -8, 2, 4, '#d39e75');
  pxRect(-2, -9, 2, 2, '#1a1228'); pxRect(2, -9, 1, 2, '#1a1228');
  // Kapelusz bardowski z piórkiem
  pxRect(-5, -14, 10, 4, '#2a7a3a'); pxRect(-6, -12, 12, 2, '#1a5228');
  pxRect(-4, -16, 8, 2, '#2a7a3a'); pxRect(3, -18, 2, 6, '#ff6633');
  pxRect(4, -20, 1, 2, '#ffaa33');
  // Lutnia (prawa)
  pxRect(5, -4, 3, 12, '#7a5030'); pxRect(5, 5, 4, 5, '#a07040');
  pxRect(5, 5, 4, 2, '#8a6030'); pxRect(5, 8, 4, 2, '#c09050');
  ctx.strokeStyle = '#e8d8b0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(8, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(9, 7); ctx.stroke();
  // Lewa ręka
  pxRect(-7, 0, 3, 6, '#2a7a3a');
}

function drawNecromancer() {
  pxRect(-4, 9, 3, 5, '#1a0e2e'); pxRect(1, 9, 3, 5, '#1a0e2e');
  pxRect(-5, 13, 4, 2, '#100820'); pxRect(1, 13, 4, 2, '#100820');
  pxRect(-6, -2, 12, 14, '#1e0a36'); pxRect(-7, 2, 14, 8, '#1e0a36');
  pxRect(2, -2, 4, 14, '#130620'); pxRect(-6, 3, 12, 2, '#44cc22');
  pxRect(-4, -10, 8, 6, '#c8d0c0'); pxRect(2, -8, 2, 4, '#a8b0a0');
  pxRect(-2, -9, 2, 2, '#cc1122'); pxRect(2, -9, 2, 2, '#cc1122');
  pxRect(-5, -16, 10, 6, '#1e0a36'); pxRect(-5, -10, 10, 2, '#130620');
  for (let i = 0; i < 3; i++) pxRect(-4 + i*4, -16, 2, 3, '#e0e0d0');
  pxRect(5, -20, 2, 26, '#5a3a1a'); pxRect(4, -22, 4, 4, '#c8d0c0');
  pxRect(5, -24, 2, 2, '#44cc22'); pxRect(-7, 0, 3, 6, '#1e0a36');
}

function drawPaladin() {
  pxRect(-4, 9, 3, 5, '#5a5020'); pxRect(1, 9, 3, 5, '#5a5020');
  pxRect(-5, 13, 4, 2, '#3a3010'); pxRect(1, 13, 4, 2, '#3a3010');
  pxRect(-7, -2, 14, 13, '#c0a830'); pxRect(-7, -2, 14, 3, '#e0c840');
  pxRect(-7, -2, 2, 13, '#a08820'); pxRect(5, -2, 2, 13, '#e0c840');
  pxRect(-2, -1, 4, 9, '#ffe8aa'); pxRect(-4, 2, 8, 2, '#ffe8aa');
  pxRect(-5, -12, 10, 10, '#c0a830'); pxRect(-5, -12, 10, 2, '#e0c840');
  pxRect(-5, -12, 2, 10, '#a08820'); pxRect(-5, -4, 10, 2, '#ffe090');
  pxRect(-6, -14, 12, 2, '#e0c840'); pxRect(-2, -16, 4, 4, '#ffe8aa');
  ctx.fillStyle = `rgba(255,220,100,${0.25 + Math.sin(state.time*4)*0.12})`;
  ctx.beginPath(); ctx.arc(0, -14, 8, 0, TAU); ctx.fill();
  pxRect(-13, -10, 7, 14, '#c0a830'); pxRect(-11, -6, 5, 5, '#ffe8aa');
  pxRect(7, -18, 2, 24, '#e0d080'); pxRect(6, -7, 6, 2, '#a08820'); pxRect(7, 4, 2, 4, '#7a6020');
}

function drawDruid() {
  pxRect(-4, 9, 3, 5, '#2a4a1a'); pxRect(1, 9, 3, 5, '#2a4a1a');
  pxRect(-5, 13, 4, 2, '#1a2e10'); pxRect(1, 13, 4, 2, '#1a2e10');
  pxRect(-6, -2, 12, 14, '#3a5a1e'); pxRect(-7, 2, 14, 8, '#3a5a1e');
  pxRect(2, -2, 4, 14, '#2a4010'); pxRect(-6, 5, 12, 2, '#88cc44');
  pxRect(-4, -10, 8, 6, '#d4a870'); pxRect(2, -8, 2, 4, '#b48858');
  pxRect(-2, -9, 2, 2, '#1a3a10'); pxRect(2, -9, 2, 2, '#1a3a10');
  pxRect(-5, -15, 10, 5, '#3a5a1e'); pxRect(-5, -10, 10, 2, '#88cc44');
  for (let i = 0; i < 5; i++) pxRect(-6+i*3, -17, 2, 4, ['#66cc22','#88dd44','#44aa00','#66cc22','#aabb44'][i]);
  pxRect(5, -20, 2, 26, '#6a4a2a'); pxRect(4, -22, 4, 6, '#7a9a3a');
  pxRect(3, -24, 2, 2, '#44cc22'); pxRect(7, -24, 2, 2, '#44cc22');
  pxRect(-7, 0, 3, 6, '#3a5a1e');
}

function drawVampire() {
  pxRect(-4, 9, 3, 5, '#1a1020'); pxRect(1, 9, 3, 5, '#1a1020');
  pxRect(-5, 13, 4, 2, '#0e0810'); pxRect(1, 13, 4, 2, '#0e0810');
  pxRect(-6, -2, 12, 14, '#1a0820'); pxRect(-7, 2, 14, 8, '#1a0820');
  pxRect(2, -2, 4, 14, '#0e0510');
  pxRect(-8, -4, 3, 10, '#aa1020'); pxRect(6, -4, 3, 10, '#aa1020');
  pxRect(-8, -5, 16, 2, '#cc1830');
  pxRect(-4, -10, 8, 6, '#e8d8f0'); pxRect(2, -8, 2, 4, '#c8b8d8');
  pxRect(-2, -9, 2, 2, '#cc1122'); pxRect(2, -9, 2, 2, '#cc1122');
  pxRect(-1, -7, 1, 2, '#ffffff'); pxRect(2, -7, 1, 2, '#ffffff');
  pxRect(-4, -14, 8, 4, '#1a0820'); pxRect(-5, -12, 10, 2, '#2a1030');
  pxRect(4, 0, 3, 6, '#1a0820'); pxRect(-7, 0, 3, 6, '#1a0820');
}

function drawFrostmage() {
  pxRect(-4, 9, 3, 5, '#1a3050'); pxRect(1, 9, 3, 5, '#1a3050');
  pxRect(-5, 13, 4, 2, '#102040'); pxRect(1, 13, 4, 2, '#102040');
  pxRect(-6, -2, 12, 14, '#1a3060'); pxRect(-7, 2, 14, 8, '#1a3060');
  pxRect(2, -2, 4, 14, '#102040'); pxRect(-6, 4, 12, 2, '#88ddff');
  pxRect(-4, -10, 8, 6, '#d8f0ff'); pxRect(2, -8, 2, 4, '#b8d8f0');
  pxRect(-2, -9, 2, 2, '#4488ff'); pxRect(2, -9, 2, 2, '#4488ff');
  pxRect(-5, -14, 10, 4, '#1a3060'); pxRect(-6, -12, 12, 2, '#102040');
  for (let i = 0; i < 3; i++) pxRect(-3+i*3, -16, 2, 3, '#88ddff');
  pxRect(-4, -12, 8, 2, '#aaeeff');
  pxRect(4, 0, 3, 6, '#1a3060'); pxRect(6, -12, 2, 18, '#7ab8d8');
  pxRect(5, -14, 4, 3, '#88ddff'); pxRect(6, -15, 2, 1, '#ffffff');
  ctx.fillStyle = `rgba(136,221,255,${0.25+Math.sin(state.time*5)*0.15})`; ctx.fillRect(3,-17,8,6);
  pxRect(-7, 0, 3, 6, '#1a3060');
}

function drawStormcaller() {
  pxRect(-4, 9, 3, 5, '#2a3040'); pxRect(1, 9, 3, 5, '#2a3040');
  pxRect(-5, 13, 4, 2, '#182030'); pxRect(1, 13, 4, 2, '#182030');
  pxRect(-6, -2, 12, 14, '#2a3848'); pxRect(-7, 2, 14, 8, '#2a3848');
  pxRect(2, -2, 4, 14, '#182030'); pxRect(-6, 4, 12, 2, '#aaeeff');
  pxRect(-4, -10, 8, 6, '#c8d8e8'); pxRect(2, -8, 2, 4, '#a8b8c8');
  pxRect(-2, -9, 2, 2, '#aaeeff'); pxRect(2, -9, 2, 2, '#aaeeff');
  pxRect(-6, -16, 12, 6, '#2a3848'); pxRect(-7, -14, 14, 3, '#1a2838');
  pxRect(-5, -18, 10, 2, '#aaeeff');
  for (let i = 0; i < 3; i++) { const lc = `rgba(170,238,255,${0.3+Math.sin(state.time*8+i)*0.3})`; ctx.fillStyle = lc; ctx.fillRect(-4+i*4, -17, 2, 3); }
  pxRect(4, 0, 3, 6, '#2a3848'); pxRect(6, -14, 2, 20, '#6a7a8a');
  pxRect(5, -16, 4, 3, '#aaeeff'); pxRect(6, -17, 2, 1, '#ffffff');
  pxRect(-7, 0, 3, 6, '#2a3848');
}

function drawRuneknight() {
  pxRect(-4, 9, 3, 5, '#2a1840'); pxRect(1, 9, 3, 5, '#2a1840');
  pxRect(-5, 13, 4, 2, '#1a1030'); pxRect(1, 13, 4, 2, '#1a1030');
  pxRect(-7, -2, 14, 13, '#3a2860'); pxRect(-7, -2, 14, 3, '#5a3888');
  pxRect(-7, -2, 2, 13, '#2a1a48'); pxRect(5, -2, 2, 13, '#5a3888');
  pxRect(-2, 0, 4, 9, '#cc44ff'); pxRect(-4, 3, 8, 2, '#cc44ff');
  pxRect(-4, 7, 4, 3, '#aa22dd'); pxRect(1, 7, 3, 3, '#aa22dd');
  ctx.fillStyle = `rgba(180,60,255,${0.18+Math.sin(state.time*6)*0.08})`; ctx.fillRect(-7,-2,14,13);
  pxRect(-5, -12, 10, 10, '#3a2860'); pxRect(-5, -12, 10, 2, '#5a3888');
  pxRect(-5, -12, 2, 10, '#2a1a48'); pxRect(-5, -4, 10, 2, '#7a48a0');
  pxRect(-6, -14, 12, 2, '#5a3888'); pxRect(-2, -15, 4, 4, '#cc44ff');
  pxRect(-13, -10, 7, 14, '#3a2860'); pxRect(-11, -5, 5, 4, '#cc44ff');
  pxRect(7, -20, 2, 26, '#8848cc'); pxRect(6, -8, 6, 2, '#5a3888'); pxRect(7, 4, 2, 4, '#2a1a48');
  for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(200,80,255,${0.6+Math.sin(state.time*5+i*1.2)*0.4})`; ctx.fillRect(7, -16+i*6, 2, 3); }
}

function drawIllusionist() {
  pxRect(-4, 9, 3, 5, '#1e1030'); pxRect(1, 9, 3, 5, '#1e1030');
  pxRect(-5, 13, 4, 2, '#140820'); pxRect(1, 13, 4, 2, '#140820');
  pxRect(-6, -2, 12, 14, '#2e1248'); pxRect(-7, 2, 14, 8, '#2e1248');
  pxRect(2, -2, 4, 14, '#1e0c30'); pxRect(-6, 5, 12, 2, '#ee88ff');
  pxRect(-3, -1, 2, 8, '#aa33ff'); pxRect(2, -1, 2, 8, '#aa33ff');
  pxRect(-4, -10, 8, 6, '#f0d8f8'); pxRect(2, -8, 2, 4, '#d0b8d8');
  pxRect(-2, -9, 2, 2, '#cc44ff'); pxRect(2, -9, 2, 2, '#cc44ff');
  pxRect(-4, -14, 8, 4, '#2e1248'); pxRect(-6, -12, 12, 2, '#1e0c30');
  pxRect(-3, -18, 6, 4, '#2e1248'); pxRect(-4, -18, 8, 2, '#aa33ff');
  pxRect(-1, -20, 2, 2, '#ee88ff');
  pxRect(4, 0, 3, 6, '#2e1248'); pxRect(6, -8, 2, 14, '#9933cc');
  pxRect(5, -10, 4, 3, '#ee88ff'); pxRect(6, -11, 2, 1, '#ffffff');
  ctx.fillStyle = `rgba(220,130,255,${0.2+Math.sin(state.time*7)*0.15})`; ctx.fillRect(3,-13,8,6);
  pxRect(-7, 0, 3, 6, '#2e1248');
}

function drawVoid() {
  const t = state.time;
  // ciało — całkowicie czarne
  pxRect(-4, 9, 3, 5, '#000000'); pxRect(1, 9, 3, 5, '#000000');
  pxRect(-5, 13, 4, 2, '#000000'); pxRect(1, 13, 4, 2, '#000000');
  pxRect(-6, -2, 12, 14, '#000000'); pxRect(-7, 2, 14, 8, '#000000');
  pxRect(2, -2, 4, 14, '#000000'); pxRect(-6, 5, 12, 2, '#110011');
  pxRect(-3, -1, 2, 8, '#000000'); pxRect(2, -1, 2, 8, '#000000');
  pxRect(-4, -10, 8, 6, '#0a0010'); pxRect(-4, -14, 8, 4, '#000000');
  pxRect(-6, -12, 12, 2, '#000000'); pxRect(-3, -18, 6, 4, '#000000');
  pxRect(-4, -18, 8, 2, '#110011'); pxRect(-1, -20, 2, 2, '#220022');
  pxRect(4, 0, 3, 6, '#000000'); pxRect(6, -8, 2, 14, '#000000');
  pxRect(-7, 0, 3, 6, '#000000');
  // fioletowe "oczy" — pulsujące
  const glow = 0.5 + Math.sin(t * 6) * 0.4;
  ctx.fillStyle = `rgba(150,0,255,${glow})`; ctx.fillRect(-2, -9, 2, 2); ctx.fillRect(2, -9, 2, 2);
  // aura nicości
  ctx.fillStyle = `rgba(80,0,120,${0.12+Math.sin(t*4)*0.08})`; ctx.fillRect(-10,-22,20,38);
}

function drawSheep(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1);
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 8, 10, 2.5, 0, 0, TAU); ctx.fill();
  const wool = e.hitFlash > 0 ? '#ffffff' : '#dddae8';
  const woolD = '#b8b4c8';
  const skin = '#f0c080';
  // Wełna (tułów)
  pxRect(-8, -4, 16, 10, wool);
  pxRect(-9, -2, 18, 6, wool);
  pxRect(-9, -2, 3, 6, woolD);
  pxRect(6, -2, 3, 6, woolD);
  // Łapy
  pxRect(-5, 6, 3, 5, skin); pxRect(2, 6, 3, 5, skin);
  pxRect(-6, 10, 3, 2, woolD); pxRect(2, 10, 3, 2, woolD);
  // Głowa
  pxRect(-5, -9, 9, 7, skin);
  pxRect(-5, -9, 2, 7, '#d0a060');
  // Uszy
  pxRect(-7, -8, 2, 3, '#f0b870'); pxRect(4, -8, 2, 3, '#f0b870');
  // Oczy
  pxRect(-3, -7, 2, 2, '#1a1228'); pxRect(1, -7, 2, 2, '#1a1228');
  pxRect(-3, -7, 1, 1, '#ffffff');
  // Rogi (trochę)
  pxRect(-6, -11, 2, 3, '#c8a860'); pxRect(4, -11, 2, 3, '#c8a860');
  ctx.restore();
}

function drawPig(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1);
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 8, 11, 2.5, 0, 0, TAU); ctx.fill();
  const pig = e.hitFlash > 0 ? '#ffffff' : '#f0a080';
  const pigD = '#d08060';
  // Tułów
  pxRect(-9, -3, 18, 10, pig);
  pxRect(-9, -3, 3, 10, pigD);
  pxRect(6, -3, 3, 10, pigD);
  // Łapy
  pxRect(-6, 7, 3, 5, pigD); pxRect(3, 7, 3, 5, pigD);
  pxRect(-7, 11, 4, 2, '#b06040'); pxRect(3, 11, 4, 2, '#b06040');
  // Głowa (okrągła)
  pxRect(-7, -12, 13, 10, pig);
  pxRect(-7, -12, 2, 10, pigD);
  // Ryj
  pxRect(-4, -5, 7, 4, '#e09070');
  pxRect(-3, -4, 2, 2, '#1a0a08'); pxRect(1, -4, 2, 2, '#1a0a08');
  // Uszy
  pxRect(-8, -15, 3, 4, pigD); pxRect(4, -15, 3, 4, pigD);
  // Oczy
  pxRect(-5, -10, 2, 2, '#1a1228'); pxRect(1, -10, 2, 2, '#1a1228');
  pxRect(-5, -10, 1, 1, '#ffffff');
  // Ogon (zwinięty)
  ctx.strokeStyle = pigD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(10, -1, 3, 0.5, 2.5); ctx.stroke();
  ctx.restore();
}

// ---- Enemies ----
function drawEnemies() {
  for (const e of state.enemies) {
    if (!inView(e.x, e.y, 80)) continue;
    if (e.type === 'bat') drawBat(e);
    else if (e.type === 'skeleton') drawSkeleton(e);
    else if (e.type === 'orc') drawOrc(e);
    else if (e.type === 'wolf') drawWolf(e);
    else if (e.type === 'troll') drawTroll(e);
    else if (e.type === 'golem') drawGolem(e);
    else if (e.type === 'sheep') drawSheep(e);
    else if (e.type === 'pig') drawPig(e);
    else if (e.type === 'boss') drawBoss(e);
    if (!e.passive) drawEnemyHpBar(e);
    else if (e.hitFlash > 0) drawEnemyHpBar(e);
  }
}

function drawWolf(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1.5);
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 10, 9, 2.5, 0, 0, TAU); ctx.fill();
  const fur = e.hitFlash > 0 ? '#ffffff' : '#5a5060';
  const furD = '#3a3040';
  // body
  pxRect(-7, 0, 14, 10, fur); pxRect(4, 0, 3, 10, furD);
  // head
  pxRect(-7, -8, 11, 8, fur); pxRect(-8, -6, 4, 4, fur); // snout
  pxRect(-9, -4, 4, 2, furD); // jaw
  // ears
  pxRect(-7, -12, 3, 4, fur); pxRect(-4, -14, 2, 2, furD);
  pxRect(1, -10, 3, 4, fur); pxRect(2, -12, 2, 2, furD);
  // eyes
  pxRect(-5, -7, 2, 2, '#ffcc22'); pxRect(0, -7, 2, 2, '#ffcc22');
  // tail
  pxRect(6, -2, 4, 3, fur); pxRect(9, -5, 3, 4, furD);
  // legs
  pxRect(-5, 9, 3, 5, furD); pxRect(1, 9, 3, 5, furD);
  ctx.restore();
}

function drawTroll(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 2);
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 18, 16, 4, 0, 0, TAU); ctx.fill();
  const skin = e.hitFlash > 0 ? '#ffffff' : '#3a6a2a';
  const skinD = '#244a18';
  // legs
  pxRect(-9, 12, 7, 8, skinD); pxRect(2, 12, 7, 8, skinD);
  pxRect(-11, 18, 8, 3, skin); pxRect(3, 18, 8, 3, skin);
  // body
  pxRect(-12, -4, 24, 18, skin); pxRect(8, -4, 4, 18, skinD);
  pxRect(-12, -4, 24, 3, '#5a9a4a');
  // arms (huge)
  pxRect(-16, -4, 6, 14, skin); pxRect(10, -4, 6, 14, skin);
  pxRect(-18, 8, 8, 5, skin); pxRect(10, 8, 8, 5, skin); // fists
  // head (small)
  pxRect(-6, -14, 12, 10, skin); pxRect(3, -14, 3, 10, skinD);
  // eyes
  pxRect(-4, -11, 3, 3, '#ff3b3b'); pxRect(1, -11, 3, 3, '#ff3b3b');
  // tusks
  pxRect(-3, -6, 2, 3, '#ffffff'); pxRect(1, -6, 2, 3, '#ffffff');
  // spikes
  pxRect(-10, -6, 2, 4, skinD); pxRect(8, -6, 2, 4, skinD);
  pxRect(-2, -18, 4, 6, skinD);
  ctx.restore();
}

function drawGolem(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1);
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.ellipse(0, 20, 18, 5, 0, 0, TAU); ctx.fill();
  const st = e.hitFlash > 0 ? '#ffffff' : '#6a7878';
  const stD = '#3a4848';
  const stL = '#9aacac';
  // legs (stone pillars)
  pxRect(-10, 12, 8, 10, stD); pxRect(2, 12, 8, 10, stD);
  pxRect(-12, 18, 10, 4, st); pxRect(2, 18, 10, 4, st);
  // body (slab)
  pxRect(-14, -8, 28, 22, st); pxRect(10, -8, 4, 22, stD);
  pxRect(-14, -8, 28, 4, stL);
  // crack
  pxRect(-2, -4, 1, 14, stD); pxRect(4, 0, 1, 10, stD);
  // shoulders
  pxRect(-18, -8, 8, 10, st); pxRect(10, -8, 8, 10, st);
  // arms
  pxRect(-18, 2, 6, 12, stD); pxRect(12, 2, 6, 12, stD);
  pxRect(-20, 12, 8, 6, st); pxRect(12, 12, 8, 6, st); // fists
  // head
  pxRect(-10, -20, 20, 14, st); pxRect(6, -20, 4, 14, stD);
  pxRect(-10, -20, 20, 3, stL);
  // glowing eyes
  ctx.fillStyle = '#ff8855';
  ctx.fillRect(-7, -16, 5, 5); ctx.fillRect(2, -16, 5, 5);
  ctx.fillStyle = `rgba(255,136,85,${0.5+Math.sin(state.time*6)*0.3})`;
  ctx.fillRect(-8, -17, 7, 7); ctx.fillRect(1, -17, 7, 7);
  ctx.restore();
}

function drawBat(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const flap = Math.sin(state.time * 18 + e.bob) > 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 10, 7, 2, 0, 0, TAU); ctx.fill();
  const tint = e.hitFlash > 0 ? '#ffffff' : '#1a0c2e';
  if (flap) {
    pxRect(-10, -3, 6, 4, tint);
    pxRect(4, -3, 6, 4, tint);
    pxRect(-12, -1, 4, 2, tint);
    pxRect(8, -1, 4, 2, tint);
  } else {
    pxRect(-9, -5, 4, 5, tint);
    pxRect(5, -5, 4, 5, tint);
    pxRect(-11, -3, 3, 3, tint);
    pxRect(8, -3, 3, 3, tint);
  }
  pxRect(-3, -2, 6, 6, e.hitFlash > 0 ? '#fff' : '#2a1a4e');
  pxRect(-2, -1, 1, 1, '#ff3b6b');
  pxRect(1, -1, 1, 1, '#ff3b6b');
  pxRect(-1, 3, 1, 1, '#fff');
  pxRect(1, 3, 1, 1, '#fff');
  ctx.restore();
}

function drawSkeleton(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 12, 8, 2.5, 0, 0, TAU); ctx.fill();
  const bone = e.hitFlash > 0 ? '#ffffff' : '#dcd4c0';
  const boneShade = '#9a9080';
  pxRect(-4, -2, 8, 9, bone);
  pxRect(-4, -2, 8, 1, boneShade);
  pxRect(-3, 0, 6, 1, boneShade);
  pxRect(-3, 3, 6, 1, boneShade);
  pxRect(-4, -10, 8, 8, bone);
  pxRect(-3, -7, 2, 2, '#1a0e2a');
  pxRect(1, -7, 2, 2, '#1a0e2a');
  pxRect(-3, -3, 6, 1, boneShade);
  pxRect(-6, -1, 2, 6, bone);
  pxRect(4, -1, 2, 6, bone);
  pxRect(6, -3, 1, 10, '#7a4a1a');
  pxRect(5, -3, 2, 1, '#7a4a1a');
  pxRect(5, 6, 2, 1, '#7a4a1a');
  pxRect(-3, 7, 2, 5, bone);
  pxRect(1, 7, 2, 5, bone);
  ctx.restore();
}

function drawOrc(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const bob = Math.round(Math.sin(e.walkBob) * 1.5);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 15, 12, 3, 0, 0, TAU); ctx.fill();
  const skin = e.hitFlash > 0 ? '#ffffff' : '#4a7a3a';
  const skinShade = '#2a4a20';
  const tunic = '#5a3a1a';
  // Body
  pxRect(-7, -2, 14, 14, tunic);
  pxRect(-7, -2, 14, 2, '#3a2410');
  // Head (big)
  pxRect(-6, -13, 12, 11, skin);
  pxRect(-6, -4, 12, 2, skinShade);
  // Eyes
  pxRect(-4, -10, 2, 2, '#ff3b3b');
  pxRect(2, -10, 2, 2, '#ff3b3b');
  // Tusks
  pxRect(-3, -5, 1, 2, '#ffffff');
  pxRect(2, -5, 1, 2, '#ffffff');
  // Brow
  pxRect(-5, -12, 10, 1, skinShade);
  // Arms
  pxRect(-9, -2, 3, 10, skin);
  pxRect(6, -2, 3, 10, skin);
  // Club in right hand
  pxRect(8, -6, 4, 8, '#7a4a1a');
  pxRect(8, -7, 4, 2, '#a06a2a');
  pxRect(9, -3, 2, 1, '#5a3a1a');
  // Legs
  pxRect(-5, 11, 4, 5, tunic);
  pxRect(1, 11, 4, 5, tunic);
  pxRect(-6, 15, 5, 2, '#3a2410');
  pxRect(1, 15, 5, 2, '#3a2410');
  ctx.restore();
}

function drawBoss(b) {
  if (b.subtype === 'demon')  return drawBossDemon(b);
  if (b.subtype === 'ice')    return drawBossIce(b);
  if (b.subtype === 'titan')  return drawBossTitan(b);
  if (b.subtype === 'necro')  return drawBossNecro(b);
  if (b.subtype === 'spider') return drawBossSpider(b);
  if (b.subtype === 'wraith') return drawBossWraith(b);
  if (b.subtype === 'drake')  return drawBossDrake(b);
  // default = lich
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 34, 26, 6, 0, 0, TAU); ctx.fill();
  const dark = b.hitFlash > 0 ? '#ffffff' : '#1a0a26';
  const robe = b.hitFlash > 0 ? '#ffffff' : '#3a0a26';
  const robeShade = '#260618';
  const accent = '#ff4060';
  const skull = '#dcd4c0';
  pxRect(-26, 10, 52, 24, robe);
  pxRect(-28, 18, 56, 14, robe);
  pxRect(-28, 30, 56, 4, robeShade);
  pxRect(10, 10, 16, 24, robeShade);
  pxRect(-22, 8, 44, 3, accent);
  pxRect(-16, -10, 32, 22, robe);
  pxRect(8, -10, 8, 22, robeShade);
  pxRect(-22, -10, 8, 8, dark);
  pxRect(14, -10, 8, 8, dark);
  pxRect(-22, -12, 8, 2, accent);
  pxRect(14, -12, 8, 2, accent);
  pxRect(-20, -2, 6, 14, robe);
  pxRect(14, -2, 6, 14, robe);
  pxRect(-10, -28, 20, 18, skull);
  pxRect(-10, -28, 20, 2, '#9a9080');
  ctx.fillStyle = '#ff2040';
  ctx.fillRect(-7, -22, 5, 5);
  ctx.fillRect(2, -22, 5, 5);
  const g = 0.5 + Math.sin(state.time * 9) * 0.2;
  ctx.fillStyle = `rgba(255, 60, 90, ${g})`;
  ctx.fillRect(-8, -23, 7, 7);
  ctx.fillRect(1, -23, 7, 7);
  pxRect(-1, -15, 2, 3, '#1a0a26');
  pxRect(-7, -10, 14, 2, '#9a9080');
  pxRect(-5, -10, 2, 3, '#1a0a26');
  pxRect(-1, -10, 2, 3, '#1a0a26');
  pxRect(3, -10, 2, 3, '#1a0a26');
  pxRect(-12, -32, 24, 4, '#5a3da0');
  pxRect(-10, -36, 4, 4, '#5a3da0');
  pxRect(-2, -36, 4, 4, '#5a3da0');
  pxRect(6, -36, 4, 4, '#5a3da0');
  pxRect(-9, -34, 2, 2, accent);
  pxRect(-1, -34, 2, 2, accent);
  pxRect(7, -34, 2, 2, accent);
  pxRect(22, -22, 3, 38, '#7a4a1a');
  const orbY = -28 + Math.sin(b.bob * 2) * 2;
  ctx.fillStyle = '#ff4060';
  ctx.fillRect(20, orbY, 8, 8);
  ctx.fillStyle = '#ff8aa8';
  ctx.fillRect(21, orbY + 1, 4, 2);
  ctx.fillStyle = `rgba(255, 64, 96, ${0.3 + Math.sin(state.time * 5) * 0.2})`;
  ctx.fillRect(16, orbY - 4, 16, 16);
  ctx.restore();
}

function drawBossDemon(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 3);
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 36, 28, 7, 0, 0, TAU); ctx.fill();

  const flash = b.hitFlash > 0;
  const body = flash ? '#ffffff' : '#8a1a10';
  const bodyDark = '#4a0c08';
  const hot = '#ff6633';
  const horn = '#1a0a06';
  const ember = '#ffd66b';

  // Heat glow under body
  ctx.fillStyle = `rgba(255, 80, 30, ${0.25 + Math.sin(state.time * 5) * 0.1})`;
  ctx.beginPath(); ctx.arc(0, 18, 30, 0, TAU); ctx.fill();

  // Torso
  pxRect(-18, -8, 36, 28, body);
  pxRect(-18, -8, 36, 4, bodyDark);
  // Belly cracks (lava)
  pxRect(-10, 4, 20, 3, hot);
  pxRect(-6, 10, 12, 2, hot);
  pxRect(-12, -2, 24, 2, '#a02814');

  // Shoulders/arms
  pxRect(-24, -6, 8, 10, body);
  pxRect(16, -6, 8, 10, body);
  pxRect(-26, 4, 6, 14, body);
  pxRect(20, 4, 6, 14, body);
  // Claws
  pxRect(-28, 16, 3, 4, horn);
  pxRect(-23, 16, 3, 4, horn);
  pxRect(22, 16, 3, 4, horn);
  pxRect(27, 16, 3, 4, horn);

  // Head
  pxRect(-12, -22, 24, 16, body);
  pxRect(-12, -22, 24, 3, bodyDark);
  // Eyes (glowing)
  ctx.fillStyle = ember;
  ctx.fillRect(-8, -16, 5, 4);
  ctx.fillRect(3, -16, 5, 4);
  ctx.fillStyle = `rgba(255, 220, 100, ${0.6 + Math.sin(state.time * 8) * 0.3})`;
  ctx.fillRect(-9, -17, 7, 6);
  ctx.fillRect(2, -17, 7, 6);
  // Mouth fangs
  pxRect(-8, -10, 16, 2, '#1a0a06');
  pxRect(-6, -8, 2, 3, '#ffffff');
  pxRect(-2, -8, 2, 3, '#ffffff');
  pxRect(4, -8, 2, 3, '#ffffff');

  // Horns (huge)
  pxRect(-14, -28, 4, 6, horn);
  pxRect(-16, -32, 4, 4, horn);
  pxRect(-18, -36, 4, 4, horn);
  pxRect(10, -28, 4, 6, horn);
  pxRect(12, -32, 4, 4, horn);
  pxRect(14, -36, 4, 4, horn);

  // Legs / cloven hooves
  pxRect(-12, 20, 8, 12, body);
  pxRect(4, 20, 8, 12, body);
  pxRect(-13, 30, 10, 4, horn);
  pxRect(3, 30, 10, 4, horn);

  // Flame wisps on shoulders
  const t = state.time * 6;
  pxRect(-24, -12 + Math.sin(t) * 2, 3, 3, ember);
  pxRect(21, -12 + Math.cos(t) * 2, 3, 3, ember);
  ctx.fillStyle = `rgba(255, 102, 51, ${0.4 + Math.sin(t) * 0.2})`;
  ctx.fillRect(-26, -16, 7, 6);
  ctx.fillRect(19, -16, 7, 6);

  ctx.restore();
}

function drawBossIce(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 2);
  ctx.save();
  ctx.translate(x, y);
  if (b.teleportFlash > 0) ctx.globalAlpha = 0.4 + Math.random() * 0.6;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 36, 22, 5, 0, 0, TAU); ctx.fill();

  const flash = b.hitFlash > 0;
  const robe = flash ? '#ffffff' : '#2848a0';
  const robeShade = '#1a3070';
  const ice = '#bce8ff';
  const iceShade = '#7ab8e0';
  const skin = '#d8e8ff';
  const accent = '#ffffff';

  // Ice aura
  ctx.fillStyle = `rgba(180, 232, 255, ${0.18 + Math.sin(state.time * 4) * 0.08})`;
  ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.fill();

  // Lower robe (flared)
  pxRect(-22, 14, 44, 22, robe);
  pxRect(-24, 22, 48, 14, robe);
  pxRect(-24, 32, 48, 4, robeShade);
  pxRect(12, 14, 10, 22, robeShade);
  // Ice trim
  pxRect(-22, 12, 44, 2, ice);

  // Torso
  pxRect(-12, -4, 24, 20, robe);
  pxRect(6, -4, 6, 20, robeShade);
  // Brooch
  pxRect(-3, 2, 6, 4, ice);
  pxRect(-2, 3, 4, 2, accent);

  // Arms
  pxRect(-16, 0, 5, 16, robe);
  pxRect(11, 0, 5, 16, robe);
  pxRect(-17, 14, 6, 4, skin);
  pxRect(11, 14, 6, 4, skin);

  // Neck
  pxRect(-4, -8, 8, 4, skin);

  // Head
  pxRect(-8, -20, 16, 14, skin);
  pxRect(-8, -20, 16, 2, '#a8c8e8');
  // Eyes (glowing pale blue)
  ctx.fillStyle = '#8ad8ff';
  ctx.fillRect(-5, -14, 3, 3);
  ctx.fillRect(2, -14, 3, 3);
  ctx.fillStyle = `rgba(200, 240, 255, ${0.6 + Math.sin(state.time * 6) * 0.3})`;
  ctx.fillRect(-6, -15, 5, 5);
  ctx.fillRect(1, -15, 5, 5);
  // Lips
  pxRect(-3, -8, 6, 1, '#7ab0d0');

  // Hair (long, white-blue)
  pxRect(-10, -18, 2, 18, ice);
  pxRect(8, -18, 2, 18, ice);
  pxRect(-9, -2, 18, 2, ice);

  // Ice crown (tall)
  pxRect(-10, -24, 20, 4, iceShade);
  pxRect(-8, -28, 4, 4, ice);
  pxRect(-2, -32, 4, 6, ice);
  pxRect(4, -28, 4, 4, ice);
  pxRect(-1, -34, 2, 2, accent);

  // Staff with shard
  pxRect(18, -24, 2, 44, '#5a6080');
  pxRect(15, -28, 8, 6, ice);
  pxRect(17, -32, 4, 4, ice);
  pxRect(16, -30, 6, 2, accent);
  ctx.fillStyle = `rgba(188, 232, 255, ${0.4 + Math.sin(state.time * 5) * 0.2})`;
  ctx.fillRect(12, -34, 14, 14);

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBossTitan(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 1);
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.ellipse(0, 42, 36, 7, 0, 0, TAU); ctx.fill();

  const flash = b.hitFlash > 0;
  const stone = flash ? '#ffffff' : '#7a6855';
  const stoneShade = '#4a3a2a';
  const stoneLight = '#a09080';
  const moss = '#3a6a3a';
  const eye = '#ff8855';

  // Lower body / kilt
  pxRect(-30, 12, 60, 28, stone);
  pxRect(-32, 24, 64, 16, stone);
  pxRect(-32, 36, 64, 4, stoneShade);
  pxRect(20, 12, 12, 28, stoneShade);

  // Torso (huge slab)
  pxRect(-26, -16, 52, 30, stone);
  pxRect(20, -16, 6, 30, stoneShade);
  pxRect(-26, -16, 52, 4, stoneLight);

  // Belt of runes
  pxRect(-26, 8, 52, 4, stoneShade);
  pxRect(-20, 9, 4, 2, eye);
  pxRect(-8, 9, 4, 2, eye);
  pxRect(4, 9, 4, 2, eye);
  pxRect(16, 9, 4, 2, eye);

  // Cracks on chest
  pxRect(-12, -10, 1, 14, stoneShade);
  pxRect(8, -6, 1, 10, stoneShade);
  pxRect(-4, -14, 6, 1, stoneShade);

  // Shoulders (boulders)
  pxRect(-34, -18, 12, 14, stone);
  pxRect(22, -18, 12, 14, stone);
  pxRect(-34, -18, 12, 3, stoneLight);
  pxRect(22, -18, 12, 3, stoneLight);

  // Arms (big)
  pxRect(-34, -4, 10, 22, stone);
  pxRect(24, -4, 10, 22, stone);
  // Fists
  pxRect(-36, 18, 14, 10, stone);
  pxRect(-36, 18, 14, 3, stoneLight);
  pxRect(22, 18, 14, 10, stone);
  pxRect(22, 18, 14, 3, stoneLight);

  // Head (small for body)
  pxRect(-10, -32, 20, 16, stone);
  pxRect(-10, -32, 20, 3, stoneLight);
  // Glowing eye(s)
  ctx.fillStyle = eye;
  ctx.fillRect(-6, -26, 4, 4);
  ctx.fillRect(2, -26, 4, 4);
  ctx.fillStyle = `rgba(255, 136, 85, ${0.6 + Math.sin(state.time * 7) * 0.3})`;
  ctx.fillRect(-7, -27, 6, 6);
  ctx.fillRect(1, -27, 6, 6);
  // Mouth slot
  pxRect(-5, -20, 10, 2, stoneShade);

  // Moss patches
  pxRect(-22, -14, 4, 3, moss);
  pxRect(14, -8, 5, 2, moss);
  pxRect(-26, 0, 3, 4, moss);

  ctx.restore();
}

function drawBossNecro(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 2);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 34, 24, 5, 0, 0, TAU); ctx.fill();
  const fl = b.hitFlash > 0;
  const robe = fl ? '#fff' : '#1a0a36', robeS = '#0e0620', bone = '#dcd4c0', acc = '#a060ff';
  pxRect(-22, 8, 44, 26, robe); pxRect(-24, 16, 48, 16, robe);
  pxRect(-24, 30, 48, 4, robeS); pxRect(10, 8, 12, 26, robeS);
  pxRect(-22, 6, 44, 3, acc);
  pxRect(-14, -10, 28, 20, robe); pxRect(8, -10, 6, 20, robeS);
  pxRect(-10, -26, 20, 16, bone); pxRect(-10, -26, 20, 2, '#9a9080');
  ctx.fillStyle = '#500030';
  ctx.fillRect(-7, -20, 5, 5); ctx.fillRect(2, -20, 5, 5);
  ctx.fillStyle = `rgba(160,0,80,${0.5+Math.sin(state.time*9)*0.2})`;
  ctx.fillRect(-8, -21, 7, 7); ctx.fillRect(1, -21, 7, 7);
  pxRect(-6, -12, 12, 2, '#9a9080');
  pxRect(-12, -30, 24, 4, '#2a0a50'); pxRect(-10, -34, 20, 4, '#2a0a50'); pxRect(-6, -36, 12, 2, '#2a0a50');
  pxRect(-18, -8, 5, 16, robe); pxRect(13, -8, 5, 16, robe);
  pxRect(16, -28, 2, 44, '#5a3a1a');
  const oy2 = -34 + Math.sin(b.bob * 2) * 3;
  ctx.fillStyle = acc; ctx.fillRect(14, oy2, 6, 6);
  ctx.fillStyle = `rgba(160,96,255,${0.3+Math.sin(state.time*5)*0.2})`; ctx.fillRect(10, oy2-4, 14, 14);
  pxRect(-22, -4, 6, 10, bone); pxRect(-20, 4, 3, 3, '#9a9080');
  ctx.restore();
}

function drawBossSpider(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 2);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 26, 30, 6, 0, 0, TAU); ctx.fill();
  const fl = b.hitFlash > 0;
  const body = fl ? '#fff' : '#1a1208', bodyS = '#0a0a04';
  pxRect(-20, 4, 40, 20, body); pxRect(-20, 4, 40, 3, '#3a3020'); pxRect(12, 4, 8, 20, bodyS);
  pxRect(-8, 8, 16, 2, '#3a2800'); pxRect(-6, 12, 12, 2, '#3a2800');
  pxRect(-14, -14, 28, 18, body); pxRect(-14, -14, 28, 3, '#3a3020');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#ff2020'; ctx.fillRect(-9+i*5, -10, 3, 3);
    ctx.fillStyle = `rgba(255,40,40,${0.5+Math.sin(state.time*6+i)*0.3})`; ctx.fillRect(-10+i*5, -11, 5, 5);
  }
  pxRect(-12, -2, 4, 3, fl?'#fff':'#2a2010'); pxRect(8, -2, 4, 3, fl?'#fff':'#2a2010');
  const legColor = fl ? '#ffffff' : '#3a3020';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const lx = side * (14 + 20), ly = -6 + i * 5;
      const bobOff = Math.sin(b.bob + i * 0.5) * 2;
      ctx.strokeStyle = legColor; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(side*14, ly+bobOff); ctx.lineTo(side*28, ly+8+bobOff); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(side*28, ly+8+bobOff); ctx.lineTo(side*36, ly+18+bobOff); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBossWraith(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 3);
  ctx.save(); ctx.translate(x, y);
  if (b.teleportFlash > 0) ctx.globalAlpha = 0.3 + Math.random() * 0.7;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 32, 20, 4, 0, 0, TAU); ctx.fill();
  const fl = b.hitFlash > 0;
  const core = fl ? '#fff' : '#2a1a60', glow = fl ? '#fff' : '#6040ff';
  ctx.fillStyle = `rgba(64,40,255,${0.14+Math.sin(state.time*4)*0.07})`;
  ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const wx = -16 + i * 8, wy = 18 + Math.sin(state.time*3+i*1.2)*6;
    pxRect(wx, wy, 4, 14, core); pxRect(wx+1, wy+10, 2, 6, '#0a0614');
  }
  pxRect(-18, -16, 36, 34, core); pxRect(12, -16, 6, 34, '#1a0e40');
  pxRect(-18, -16, 36, 3, glow); pxRect(-18, 15, 36, 3, '#1a0e40');
  pxRect(-24, -10, 8, 18, core); pxRect(16, -10, 8, 18, core);
  pxRect(-28, -4, 6, 8, '#1a0e40'); pxRect(22, -4, 6, 8, '#1a0e40');
  pxRect(-12, -30, 24, 16, core); pxRect(6, -30, 6, 16, '#1a0e40');
  ctx.fillStyle = glow; ctx.fillRect(-8, -24, 5, 5); ctx.fillRect(3, -24, 5, 5);
  ctx.fillStyle = `rgba(100,70,255,${0.7+Math.sin(state.time*7)*0.25})`;
  ctx.fillRect(-9,-25,7,7); ctx.fillRect(2,-25,7,7);
  const oy3 = -38 + Math.sin(b.bob*2.5)*3;
  ctx.fillStyle = glow; ctx.fillRect(-4, oy3, 8, 8);
  ctx.fillStyle='#fff'; ctx.fillRect(-2, oy3+1, 3, 2);
  ctx.fillStyle=`rgba(96,60,255,${0.4+Math.sin(state.time*5)*0.2})`; ctx.fillRect(-8,oy3-4,16,16);
  ctx.restore(); ctx.globalAlpha = 1;
}

function drawBossDrake(b) {
  const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.bob) * 2);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.ellipse(0, 40, 32, 6, 0, 0, TAU); ctx.fill();
  const fl = b.hitFlash > 0;
  const sc = fl ? '#fff' : '#1e3a5a', scL = fl ? '#fff' : '#2e5a80', scD = '#0e1e30', elec = '#ffe44a';
  // Wings
  pxRect(-44, -20, 20, 30, '#1a2840'); pxRect(-64, -10, 22, 14, '#1a2840');
  pxRect(-44, -20, 4, 30, scD); pxRect(-44, -20, 20, 3, '#2a3850');
  pxRect(24, -20, 20, 30, '#1a2840'); pxRect(42, -10, 22, 14, '#1a2840');
  pxRect(40, -20, 4, 30, scD); pxRect(24, -20, 20, 3, '#2a3850');
  if (Math.sin(state.time * 8) > 0) {
    ctx.strokeStyle = elec; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-44,-10); ctx.lineTo(-56,-8); ctx.lineTo(-50,-2); ctx.lineTo(-62,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(44,-10); ctx.lineTo(56,-8); ctx.lineTo(50,-2); ctx.lineTo(62,0); ctx.stroke();
  }
  pxRect(-22, -8, 44, 30, sc); pxRect(16, -8, 6, 30, scD);
  pxRect(-22, -8, 44, 4, scL);
  for (let i = 0; i < 4; i++) pxRect(-18+i*10, -2+(i%2)*4, 8, 4, scL);
  pxRect(-8, -22, 16, 16, sc); pxRect(4, -22, 4, 16, scD);
  pxRect(-12, -36, 24, 16, sc); pxRect(-12, -36, 24, 3, scL); pxRect(8, -36, 4, 16, scD);
  ctx.fillStyle = elec; ctx.fillRect(-8,-30,4,4); ctx.fillRect(4,-30,4,4);
  ctx.fillStyle = `rgba(255,228,74,${0.6+Math.sin(state.time*8)*0.3})`;
  ctx.fillRect(-9,-31,6,6); ctx.fillRect(3,-31,6,6);
  pxRect(-6, -22, 12, 4, sc); pxRect(2, -22, 4, 4, scD);
  pxRect(-4, -20, 2, 3, '#fff'); pxRect(2, -20, 2, 3, '#fff');
  pxRect(-14,-40,3,4,elec); pxRect(-15,-44,3,4,elec);
  pxRect(11,-40,3,4,elec); pxRect(12,-44,3,4,elec);
  pxRect(-16,22,8,14,sc); pxRect(8,22,8,14,sc);
  pxRect(-18,34,10,4,scD); pxRect(8,34,10,4,scD);
  pxRect(-20,36,3,5,scD); pxRect(-16,36,3,5,scD);
  pxRect(9,36,3,5,scD); pxRect(13,36,3,5,scD);
  ctx.restore();
}

function drawEnemyHpBar(e) {
  if (e.type === 'boss') return;
  if (e.hp >= e.maxHp) return;
  const w = e.w + 4;
  const x = e.x - w / 2;
  const y = e.y - e.h / 2 - 8;
  ctx.fillStyle = '#1a0a26';
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = '#ff5577';
  ctx.fillRect(x, y, (w * e.hp / e.maxHp), 3);
}

// ---- Projectiles ----
function drawProjectiles() {
  // Glow pass
  ctx.globalAlpha = 0.35;
  for (const p of state.projectiles) {
    if (!inView(p.x, p.y, 40)) continue;
    if (p.kind === 'fire') ctx.fillStyle = '#ff6633';
    else if (p.kind === 'lightning') ctx.fillStyle = '#5599ff';
    else if (p.kind === 'blade') ctx.fillStyle = '#aaccff';
    else if (p.kind === 'syringe') ctx.fillStyle = '#3bb6ff';
    else if (p.kind === 'inferno') ctx.fillStyle = '#ff6633';
    else if (p.kind === 'holy') ctx.fillStyle = '#ffffaa';
    else if (p.kind === 'shadowblade') ctx.fillStyle = '#6633cc';
    else if (p.kind === 'boomerang') ctx.fillStyle = '#88aa44';
    else if (p.kind === 'holyblade') ctx.fillStyle = '#ffe8aa';
    else if (p.kind === 'venom') ctx.fillStyle = '#44cc22';
    else if (p.kind === 'thorn') ctx.fillStyle = '#44aa22';
    else if (p.kind === 'blood') ctx.fillStyle = '#cc1122';
    else if (p.kind === 'rune') ctx.fillStyle = '#cc44ff';
    else if (p.kind === 'frost') ctx.fillStyle = '#88ddff';
    else if (p.kind === 'soul') ctx.fillStyle = '#9922ee';
    else if (p.kind === 'firewave') ctx.fillStyle = '#ff4422';
    else continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Cores
  for (const p of state.projectiles) {
    if (!inView(p.x, p.y, 40)) continue;
    if (p.kind === 'fire') {
      ctx.fillStyle = '#ffcc55';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff7c8';
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
    } else if (p.kind === 'arrow') {
      drawArrow(p);
    } else if (p.kind === 'syringe') {
      drawSyringe(p);
    } else if (p.kind === 'blade') {
      drawBlade(p);
    } else if (p.kind === 'lightning') {
      drawLightningProj(p);
    } else if (p.kind === 'shuriken') {
      drawShurikenProj(p);
    } else if (p.kind === 'bone') {
      drawBoneProj(p);
    } else if (p.kind === 'axe') {
      drawAxeProj(p);
    } else if (p.kind === 'inferno') {
      drawInfernoProj(p);
    } else if (p.kind === 'holy') {
      drawHolyProj(p);
    } else if (p.kind === 'boomerang') {
      drawBoomerangProj(p);
    } else if (p.kind === 'trap') {
      drawTrapProj(p);
    } else if (p.kind === 'shadowblade') {
      drawShadowbladeProj(p);
    } else if (p.kind === 'holyblade') {
      drawHolybladeProj(p);
    } else if (p.kind === 'venom') {
      drawVenomProj(p);
    } else if (p.kind === 'thorn') {
      drawThornProj(p);
    } else if (p.kind === 'blood') {
      drawBloodProj(p);
    } else if (p.kind === 'rune') {
      drawRuneProj(p);
    } else if (p.kind === 'frost') {
      drawFrostProj(p);
    } else if (p.kind === 'soul') {
      drawSoulProj(p);
    } else if (p.kind === 'firewave') {
      drawFirewaveProj(p);
    } else if (p.kind === 'void') {
      drawVoidProj(p);
    }
  }
}

function drawHolybladeProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  ctx.fillStyle = '#ffe8aa'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.4, 0, TAU); ctx.fill();
  pxRect(-p.r, -2, p.r*2, 4, '#ffd66b');
  pxRect(-2, -p.r, 4, p.r*2, '#ffd66b');
  ctx.restore();
}

function drawVenomProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#44cc22'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#88ff44'; ctx.beginPath(); ctx.arc(-p.r*0.25, -p.r*0.25, p.r*0.45, 0, TAU); ctx.fill();
  ctx.fillStyle = '#aaffaa'; ctx.beginPath(); ctx.arc(-p.r*0.3, -p.r*0.3, p.r*0.2, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawThornProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  pxRect(-p.r, -2, p.r*2, 4, '#44aa22');
  pxRect(-p.r+2, -4, 4, 8, '#66cc33');
  pxRect(p.r-6, -4, 4, 8, '#66cc33');
  pxRect(-2, -p.r*0.6, 4, p.r*1.2, '#44aa22');
  ctx.restore();
}

function drawBloodProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#cc1122'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff2244'; ctx.beginPath(); ctx.arc(-p.r*0.25, -p.r*0.25, p.r*0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff8899'; ctx.beginPath(); ctx.arc(-p.r*0.3, -p.r*0.3, p.r*0.2, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawRuneProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate((p.angle || 0) + state.time * 3);
  ctx.fillStyle = '#cc44ff'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8822aa'; ctx.fillRect(-p.r, -2, p.r*2, 4); ctx.fillRect(-2, -p.r, 4, p.r*2);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, p.r*0.3, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawFrostProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  ctx.fillStyle = '#88ddff'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, p.r*0.4, 0, TAU); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.fillStyle = '#aaeeff';
    ctx.fillRect(Math.cos(a)*p.r*0.5 - 1, Math.sin(a)*p.r*0.5 - 1, 3, 3);
  }
  ctx.restore();
}

function drawSoulProj(p) {
  const t = state.time;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  // Outer dark orb
  ctx.fillStyle = '#1a0030';
  ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  // Mid ring — rotating purple
  ctx.strokeStyle = `rgba(160,60,255,${0.7 + Math.sin(t * 8) * 0.25})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, TAU); ctx.stroke();
  // Bright core
  ctx.fillStyle = '#cc88ff';
  ctx.beginPath(); ctx.arc(0, 0, p.r * 0.38, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, p.r * 0.15, 0, TAU); ctx.fill();
  // Orbiting sparks
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + t * 6;
    ctx.fillStyle = '#ee88ff';
    ctx.fillRect(Math.round(Math.cos(a) * p.r * 0.55) - 1, Math.round(Math.sin(a) * p.r * 0.55) - 1, 3, 3);
  }
  ctx.restore();
}

function drawBoneProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  pxRect(-9, -3, 18, 6, '#e0dcc8'); pxRect(-9, -3, 5, 6, '#c8c4b0'); pxRect(4, -3, 5, 6, '#c8c4b0');
  pxRect(-11, -2, 4, 4, '#e0dcc8'); pxRect(8, -2, 4, 4, '#e0dcc8');
  ctx.restore();
}

function drawAxeProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  pxRect(-18, -7, 36, 14, '#9a6060'); pxRect(-18, -7, 36, 3, '#cc8888'); pxRect(-16, -5, 32, 2, '#ffcccc');
  pxRect(14, -6, 4, 12, '#7a4a1a');
  ctx.restore();
}

function drawInfernoProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#ff6633'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffaa33'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffff88'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.25, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawFirewaveProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  // Elongated fire wave shape
  ctx.fillStyle = '#ff2200';
  ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.4, p.r * 0.7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff6633';
  ctx.beginPath(); ctx.ellipse(4, 0, p.r * 0.9, p.r * 0.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffaa33';
  ctx.beginPath(); ctx.ellipse(8, 0, p.r * 0.55, p.r * 0.32, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffff88';
  ctx.beginPath(); ctx.ellipse(12, 0, p.r * 0.22, p.r * 0.18, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawVoidProj(p) {
  const t = state.time;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.strokeStyle = `rgba(150,0,255,${0.6+Math.sin(t*9)*0.35})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, TAU); ctx.stroke();
  ctx.fillStyle = `rgba(80,0,120,${0.4+Math.sin(t*7)*0.25})`; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.4, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawHolyProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  ctx.fillStyle = '#ffffaa'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, TAU); ctx.fill();
  pxRect(-1, -5, 3, 10, '#ffd66b'); pxRect(-4, -2, 9, 3, '#ffd66b');
  ctx.restore();
}

function drawBoomerangProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  pxRect(-11, -3, 22, 6, '#88aa44'); pxRect(-11, -3, 9, 6, '#6a8832');
  pxRect(-13, -2, 3, 4, '#aabb66'); pxRect(11, -2, 3, 4, '#aabb66');
  ctx.restore();
}

function drawTrapProj(p) {
  const flash = Math.sin(state.time * 10) > 0;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  pxRect(-8, -8, 16, 16, flash ? '#446622' : '#334411');
  pxRect(-4, -6, 8, 12, flash ? '#558833' : '#3a5520');
  pxRect(-6, -4, 12, 8, flash ? '#558833' : '#3a5520');
  pxRect(-2, -2, 4, 4, flash ? '#88ff44' : '#66cc22');
  ctx.restore();
}

function drawShadowbladeProj(p) {
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(p.angle || 0);
  pxRect(-15, -5, 30, 10, '#4422aa'); pxRect(-15, -5, 30, 3, '#6633cc'); pxRect(-13, -3, 26, 2, '#9955ff');
  pxRect(11, -4, 4, 8, '#2a1a44');
  ctx.restore();
}

function drawArrow(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);
  pxRect(-8, 0, 12, 1, '#dcd4c0');
  pxRect(4, -1, 3, 3, '#ffd66b');
  pxRect(-9, -2, 2, 5, '#7a4a1a');
  pxRect(-8, -2, 1, 5, '#5a3a1a');
  ctx.restore();
}

function drawSyringe(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);
  pxRect(-5, -2, 8, 4, '#e8e4ee');
  pxRect(-5, -2, 8, 1, '#b8b4c0');
  pxRect(-3, -1, 4, 2, '#8ad8ff');
  pxRect(3, -1, 2, 2, '#a0a0a8');
  pxRect(5, 0, 3, 1, '#a0a0a8');
  pxRect(-6, -3, 1, 6, '#b8b4c0');
  ctx.restore();
}

function drawBlade(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);
  pxRect(-14, -4, 28, 8, '#8aaae8');
  pxRect(-14, -4, 28, 2, '#c0d0ff');
  pxRect(-12, -2, 24, 2, '#dde8ff');
  pxRect(10, -3, 4, 6, '#ffd66b');
  pxRect(11, -4, 2, 1, '#ffffff');
  ctx.restore();
}

function drawLightningProj(p) {
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.rotate(p.angle || 0);
  ctx.strokeStyle = '#8ae8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, 0); ctx.lineTo(-4, -3); ctx.lineTo(0, 2); ctx.lineTo(5, -2); ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawShurikenProj(p) {
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.rotate(p.spin || 0);
  pxRect(-5, -1, 10, 2, '#b8b8cc');
  pxRect(-1, -5, 2, 10, '#b8b8cc');
  pxRect(-3, -3, 6, 6, '#d0d0e0');
  pxRect(-1, -1, 2, 2, '#ffffff');
  ctx.restore();
}

function drawHazards() {
  // Pools first (under projectiles)
  for (const h of state.hazards) {
    if (h.kind !== 'pool') continue;
    if (!inView(h.x, h.y, h.r + 20)) continue;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = h.color || '#ff4020';
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.55, 0, TAU); ctx.fill();
    ctx.restore();
    // Edge dots
    ctx.fillStyle = '#ff6633';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + state.time * 1.5;
      const px = h.x + Math.cos(a) * h.r;
      const py = h.y + Math.sin(a) * h.r;
      ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
    }
  }

  // Regular bullet hazards
  const buckets = drawHazards._b || (drawHazards._b = new Map());
  buckets.clear();
  for (const h of state.hazards) {
    if (h.kind === 'pool') continue;
    if (!inView(h.x, h.y, 40)) continue;
    const c = h.color || '#a060ff';
    let arr = buckets.get(c);
    if (!arr) { arr = []; buckets.set(c, arr); }
    arr.push(h);
  }
  ctx.globalAlpha = 0.35;
  for (const [color, arr] of buckets) {
    ctx.fillStyle = color;
    for (const h of arr) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 4, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const [color, arr] of buckets) {
    ctx.fillStyle = color;
    for (const h of arr) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.7, 0, TAU); ctx.fill(); }
  }
  ctx.fillStyle = '#ffffff';
  for (const [, arr] of buckets) {
    for (const h of arr) ctx.fillRect(Math.round(h.x) - 1, Math.round(h.y) - 1, 2, 2);
  }
}

// ---- Skill FX (overlay layer) ----
function drawSkillFX() {
  if (!player.skillActive) return;
  if (player.baseClass === 'mage') drawFlameCone();
  else if (player.classId === 'doctor' || player.classId === 'cleric') drawHealAura();
  else if (player.classId === 'berserker') drawBerserkerAura();
  // other skills produce projectiles — no overlay needed
}

function drawBerserkerAura() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22 + Math.sin(state.time * 8) * 0.08;
  ctx.strokeStyle = '#ff4422';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(player.x, player.y, 100, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#ff4422';
  ctx.beginPath(); ctx.arc(player.x, player.y, 100, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawFlameCone() {
  const ang = player.skillAngle;
  const ox = player.x + Math.cos(ang) * 14;
  const oy = player.y + Math.sin(ang) * 14 - 4;
  const r = FLAME.range;
  const ha = FLAME.halfAngle;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ff5522';
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, r, ang - ha, ang + ha); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#ffcc55';
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, r * 0.6, ang - ha * 0.6, ang + ha * 0.6); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#fff7c8';
  ctx.beginPath(); ctx.arc(ox, oy, 5 + Math.random() * 2, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawHealAura() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 60 + Math.sin(state.time * 8) * 8;
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#9bff9b';
  ctx.beginPath(); ctx.arc(player.x, player.y, pulse, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(player.x, player.y, pulse, 0, TAU); ctx.stroke();
  ctx.restore();
}

// ---- Pickups ----
function drawPickups() {
  for (const p of state.pickups) {
    if (!inView(p.x, p.y, 30)) continue;
    const bob = Math.sin(p.bob) * 2;
    const x = Math.round(p.x), y = Math.round(p.y + bob);
    const blink = p.life < 3 && Math.sin(p.life * 18) > 0;
    if (blink) continue;
    if (p.kind === 'hp') {
      pxRect(x - 4, y - 2, 3, 3, '#ff3b6b');
      pxRect(x + 1, y - 2, 3, 3, '#ff3b6b');
      pxRect(x - 4, y + 1, 8, 2, '#ff3b6b');
      pxRect(x - 2, y + 3, 4, 1, '#ff3b6b');
      pxRect(x - 1, y + 4, 2, 1, '#ff3b6b');
      pxRect(x - 3, y - 1, 1, 1, '#ff8aa8');
    } else if (p.kind === 'mp') {
      pxRect(x - 1, y - 5, 2, 2, '#a060ff');
      pxRect(x - 3, y - 3, 6, 2, '#1a0a26');
      pxRect(x - 4, y - 1, 8, 6, '#1a0a26');
      pxRect(x - 3, y, 6, 4, '#3bb6ff');
      pxRect(x - 2, y + 1, 2, 1, '#8ad8ff');
    } else if (p.kind === 'scroll') {
      // Purple glow
      ctx.fillStyle = `rgba(160,96,255,${0.3 + Math.sin(p.bob * 2) * 0.15})`;
      ctx.fillRect(x - 9, y - 9, 18, 18);
      // Scroll body
      pxRect(x - 5, y - 2, 10, 7, '#2a1a5e');
      pxRect(x - 7, y - 1, 3, 5, '#7a4a1a');
      pxRect(x + 4, y - 1, 3, 5, '#7a4a1a');
      pxRect(x - 5, y - 2, 10, 1, '#3a2880');
      // Rune
      pxRect(x - 1, y, 2, 3, '#a060ff');
      pxRect(x - 2, y + 1, 4, 1, '#a060ff');
      pxRect(x - 1, y - 1, 2, 1, '#ffd66b');
    } else if (p.kind === 'quiver') {
      // Glow
      ctx.fillStyle = `rgba(232,224,192,${0.2 + Math.sin(p.bob * 2) * 0.1})`;
      ctx.fillRect(x - 9, y - 12, 18, 18);
      // Quiver body
      pxRect(x - 3, y - 4, 6, 10, '#5a3a1a');
      pxRect(x - 3, y - 4, 6, 2, '#7a5028');
      pxRect(x - 2, y + 5, 4, 1, '#3a2410');
      // Arrow shafts
      pxRect(x - 2, y - 10, 1, 7, '#dcd4c0');
      pxRect(x,     y - 9,  1, 6, '#dcd4c0');
      pxRect(x + 2, y - 10, 1, 7, '#dcd4c0');
      // Arrow tips
      pxRect(x - 2, y - 11, 1, 1, '#ffd66b');
      pxRect(x,     y - 10, 1, 1, '#ffd66b');
      pxRect(x + 2, y - 11, 1, 1, '#ffd66b');
    } else if (p.kind === 'medkit') {
      ctx.fillStyle = `rgba(155,255,155,${0.25 + Math.sin(p.bob * 2) * 0.12})`;
      ctx.fillRect(x - 9, y - 9, 18, 18);
      pxRect(x - 6, y - 5, 12, 9, '#e8e4ee');
      pxRect(x - 6, y - 5, 12, 2, '#b8b4c0');
      pxRect(x - 6, y + 2, 12, 2, '#c8c4d0');
      pxRect(x - 1, y - 4, 2, 7, '#ff3b3b');
      pxRect(x - 4, y - 1, 8, 2, '#ff3b3b');
      pxRect(x - 1, y - 4, 1, 1, '#ff8888');
    } else if (p.kind === 'shard') {
      ctx.fillStyle = `rgba(192,208,255,${0.3 + Math.sin(p.bob * 2.5) * 0.15})`;
      ctx.fillRect(x - 10, y - 10, 20, 20);
      // Crystal shard shape
      ctx.fillStyle = '#c0d0ff';
      ctx.beginPath();
      ctx.moveTo(x, y - 8); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath();
      ctx.fill();
      pxRect(x - 1, y - 7, 2, 12, '#dde8ff');
      pxRect(x - 2, y - 2, 4, 1, '#ffffff');
    } else if (p.kind === 'totem') {
      ctx.fillStyle = `rgba(138,232,255,${0.25 + Math.sin(p.bob * 2) * 0.12})`;
      ctx.fillRect(x - 9, y - 12, 18, 22);
      pxRect(x - 3, y - 8, 6, 14, '#7a5030');
      pxRect(x - 3, y - 8, 6, 2, '#aa7040');
      pxRect(x - 4, y - 5, 8, 5, '#8a6040');
      pxRect(x - 4, y - 5, 8, 2, '#aa8050');
      pxRect(x - 2, y - 7, 4, 3, '#c8924a');
      pxRect(x - 1, y - 6, 2, 2, '#1a1228');
      ctx.fillStyle = `rgba(80,180,255,${0.6 + Math.sin(p.bob * 3) * 0.3})`;
      ctx.fillRect(x - 1, y - 9, 2, 2);
    } else if (p.kind === 'kunai') {
      ctx.fillStyle = `rgba(200,200,216,${0.2 + Math.sin(p.bob * 3) * 0.1})`;
      ctx.fillRect(x - 9, y - 12, 18, 18);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.bob * 0.3);
      pxRect(-1, -9, 2, 14, '#b0b8c8');
      pxRect(-1, -9, 2, 3, '#e0e8f0');
      pxRect(-3, 4, 6, 3, '#7a5030');
      pxRect(-2, 4, 4, 1, '#9a7040');
      ctx.restore();
    } else if (p.kind === 'wood') {
      ctx.fillStyle = `rgba(200,160,96,${0.3 + Math.sin(p.bob*3)*0.12})`;
      ctx.fillRect(x-7, y-7, 14, 14);
      pxRect(x-4, y-1, 8, 4, '#7a4a1a'); pxRect(x-4, y-1, 8, 2, '#a06a2a');
      pxRect(x-3, y-2, 6, 1, '#c8a060'); pxRect(x-2, y+2, 4, 1, '#5a3010');
    } else if (p.kind === 'stone') {
      ctx.fillStyle = `rgba(145,145,160,${0.25 + Math.sin(p.bob*3)*0.1})`;
      ctx.fillRect(x-7, y-7, 14, 14);
      pxRect(x-4, y-2, 8, 6, '#7a7080'); pxRect(x-4, y-2, 8, 2, '#9a8fa4');
      pxRect(x-4, y-2, 2, 6, '#5a5060'); pxRect(x-1, y-1, 2, 2, '#aaa0b4');
    } else if (p.kind === 'bone') {
      ctx.fillStyle = `rgba(224,220,200,${0.35+Math.sin(p.bob*3)*0.12})`;
      ctx.fillRect(x-8, y-8, 16, 16);
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.4);
      pxRect(-7, -1, 14, 3, '#e0dcc8'); pxRect(-7, -1, 14, 1, '#f0ece8');
      pxRect(-8, -2, 3, 5, '#d0ccb8'); pxRect(5, -2, 3, 5, '#d0ccb8');
      pxRect(-7, -1, 1, 3, '#ffffff'); ctx.restore();
    } else if (p.kind === 'meat') {
      ctx.fillStyle = `rgba(255,120,80,${0.3+Math.sin(p.bob*3)*0.12})`;
      ctx.fillRect(x-8, y-8, 16, 16);
      pxRect(x-5, y-4, 10, 8, '#c83828'); pxRect(x-5, y-4, 10, 2, '#e04838');
      pxRect(x-5, y-4, 2, 8, '#a02818');
      pxRect(x-3, y-2, 6, 4, '#e05040'); pxRect(x-2, y-1, 4, 2, '#ff6050');
    } else if (p.kind === 'coin') {
      const bob = Math.sin(p.bob) * 2;
      const col = p.value >= 4 ? '#ffd700' : (p.value >= 2 ? '#e8c040' : '#c8a820');
      const rim = p.value >= 4 ? '#fff4a0' : (p.value >= 2 ? '#ffd860' : '#e8c050');
      ctx.fillStyle = `rgba(255,215,0,${0.22 + Math.sin(p.bob*2)*0.1})`;
      ctx.beginPath(); ctx.ellipse(x, y+bob, 9, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(x, y+bob, 7, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.ellipse(x, y+bob-1, 5, 3, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#1a1228';
      ctx.font = 'bold 7px "Courier New"';
      ctx.textAlign = 'center';
      ctx.fillText('$', x, y + bob + 3);
    }
  }
}

// ---- Budynki ----
function drawBuildings() {
  for (const b of state.buildings) {
    if (!inView(b.x, b.y, 60)) continue;
    const x = Math.round(b.x), y = Math.round(b.y);
    if (b.type === 'campfire') {
      const t = state.time;
      for (let i = 0; i < 6; i++) {
        const fa = (i/6)*TAU;
        pxRect(x + Math.cos(fa)*9 - 2, y + Math.sin(fa)*5 - 1, 4, 3, '#6a6275');
      }
      ctx.strokeStyle = '#3d2510'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x-6, y+4); ctx.lineTo(x+6, y+3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x-3, y+5); ctx.lineTo(x+4, y-1); ctx.stroke();
      pxRect(x-3, Math.round(y-2+Math.sin(t*5)*1.5), 6, 7, '#cc3300');
      pxRect(x-2, Math.round(y-5+Math.sin(t*5.5)*2), 4, 6, '#ff7700');
      pxRect(x-1, Math.round(y-8+Math.sin(t*6)*1.5), 2, 5, '#ffcc44');
      ctx.fillStyle = `rgba(255,140,40,${0.18+Math.sin(t*4)*0.08})`;
      ctx.fillRect(x-12, y-12, 24, 22);
    } else if (b.type === 'wall') {
      const hp = b.hp/b.maxHp;
      const c = hp > 0.5 ? '#7a8090' : hp > 0.25 ? '#906060' : '#804040';
      const cH = hp > 0.5 ? '#9aa0b0' : '#a07070';
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      if (b.rotated) ctx.ellipse(x, y+8, 5, 18, 0, 0, TAU);
      else ctx.ellipse(x, y+8, 18, 5, 0, 0, TAU);
      ctx.fill();
      if (b.rotated) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2);
        ctx.fillStyle = c; ctx.fillRect(-16, -4, 32, 14);
        ctx.fillStyle = cH; ctx.fillRect(-16, -4, 32, 3);
        ctx.fillStyle = c; ctx.fillRect(-16, -4, 3, 14);
        ctx.fillStyle = c; ctx.fillRect(-14, -8, 8, 4); ctx.fillRect(1, -8, 8, 4);
        ctx.fillStyle = cH; ctx.fillRect(-12, -6, 4, 2); ctx.fillRect(3, -6, 4, 2);
        if (hp < 0.6) { ctx.fillStyle='#1a1228'; ctx.fillRect(-5,-2,1,8); ctx.fillRect(4,0,1,6); }
        ctx.restore();
        ctx.fillStyle = '#400000'; ctx.fillRect(x+10, y-16, 3, 32);
        ctx.fillStyle = hp > 0.5 ? '#44cc44' : hp > 0.25 ? '#cccc44' : '#cc4444';
        ctx.fillRect(x+10, y-16, 3, Math.round(32*hp));
      } else {
        pxRect(x-16, y-4, 32, 14, c);
        pxRect(x-16, y-4, 32, 3, cH);
        pxRect(x-16, y-4, 3, 14, c);
        pxRect(x-14, y-8, 8, 4, c); pxRect(x+1, y-8, 8, 4, c);
        pxRect(x-12, y-6, 4, 2, cH); pxRect(x+3, y-6, 4, 2, cH);
        if (hp < 0.6) { ctx.fillStyle='#1a1228'; ctx.fillRect(x-5,y-2,1,8); ctx.fillRect(x+4,y,1,6); }
        ctx.fillStyle = '#400000'; ctx.fillRect(x-16, y-12, 32, 3);
        ctx.fillStyle = hp > 0.5 ? '#44cc44' : hp > 0.25 ? '#cccc44' : '#cc4444';
        ctx.fillRect(x-16, y-12, Math.round(32*hp), 3);
      }
    } else if (b.type === 'tower') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x, y+20, 14, 5, 0, 0, TAU); ctx.fill();
      pxRect(x-12, y+4, 24, 18, '#7a7080');
      pxRect(x-12, y+4, 24, 3, '#9a8fa4');
      pxRect(x-10, y-22, 20, 30, '#7a8090');
      pxRect(x-10, y-22, 20, 3, '#9aa0b0');
      pxRect(x-10, y-22, 3, 30, '#5a6070');
      pxRect(x+7, y-22, 3, 30, '#9aa0b0');
      pxRect(x-10, y-26, 6, 4, '#7a8090'); pxRect(x-1, y-26, 6, 4, '#7a8090'); pxRect(x+5, y-26, 5, 4, '#7a8090');
      pxRect(x-1, y-14, 2, 10, '#1a1228');
      if ((b.fireCd || 0) > 1.2) { pxRect(x-1, y-12, 2, 5, '#ffd66b'); }
    } else if (b.type === 'door') {
      const hp = b.hp / b.maxHp;
      const cFrame = hp > 0.5 ? '#7a6050' : '#5a4030';
      const cHL    = hp > 0.5 ? '#aa8060' : '#7a5040';
      const cPanel = hp > 0.5 ? '#5a3010' : '#3a1808';
      const drawDoorShape = () => {
        // Frame posts
        ctx.fillStyle = cFrame; ctx.fillRect(-12, -6, 4, 12); ctx.fillRect(8, -6, 4, 12);
        // Top beam
        ctx.fillStyle = cFrame; ctx.fillRect(-12, -9, 24, 3);
        ctx.fillStyle = cHL;    ctx.fillRect(-12, -9, 24, 1);
        // Door panel
        ctx.fillStyle = cPanel; ctx.fillRect(-8, -5, 16, 11);
        ctx.fillStyle = hp > 0.5 ? '#7a5020' : '#5a3010'; ctx.fillRect(-8, -5, 16, 1);
        // Vertical plank line
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, -5, 1, 11);
        // Handle
        ctx.fillStyle = '#ffd66b'; ctx.fillRect(4, 0, 2, 3);
      };
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      if (b.rotated) ctx.ellipse(x, y+8, 4, 14, 0, 0, TAU);
      else ctx.ellipse(x, y+8, 14, 4, 0, 0, TAU);
      ctx.fill();
      if (b.rotated) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2);
        drawDoorShape();
        ctx.restore();
        ctx.fillStyle = '#400000'; ctx.fillRect(x+9, y-12, 2, 24);
        ctx.fillStyle = hp > 0.5 ? '#44cc44' : hp > 0.25 ? '#cccc44' : '#cc4444';
        ctx.fillRect(x+9, y-12, 2, Math.round(24*hp));
      } else {
        ctx.save(); ctx.translate(x, y);
        drawDoorShape();
        ctx.restore();
        ctx.fillStyle = '#400000'; ctx.fillRect(x-12, y-14, 24, 2);
        ctx.fillStyle = hp > 0.5 ? '#44cc44' : hp > 0.25 ? '#cccc44' : '#cc4444';
        ctx.fillRect(x-12, y-14, Math.round(24*hp), 2);
      }
    } else if (b.type === 'furnace') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y+14, 18, 5, 0, 0, TAU); ctx.fill();
      // Podstawa cegły
      pxRect(x-15, y-2, 30, 18, '#7a5030');
      pxRect(x-15, y-2, 30, 3, '#9a6840');
      pxRect(x-15, y-2, 3, 18, '#5a3820');
      // Cegły
      for (let ci = 0; ci < 3; ci++) { pxRect(x-14+ci*10, y-2, 9, 3, '#6a4828'); pxRect(x-9+ci*10, y+5, 9, 3, '#6a4828'); }
      // Komin
      pxRect(x-5, y-16, 10, 14, '#6a5030');
      pxRect(x-5, y-16, 10, 2, '#8a6840');
      pxRect(x-7, y-17, 14, 2, '#9a7848');
      // Dymek
      const t = state.time;
      for (let s = 0; s < 3; s++) {
        const st2 = (t * 0.7 + s * 0.4) % 1;
        const sy2 = (y - 18) - st2 * 18;
        const sx2 = x + Math.sin(t * 1.5 + s * 1.2) * 3;
        ctx.fillStyle = `rgba(80,70,60,${(1-st2)*0.5})`;
        ctx.fillRect(Math.round(sx2)-2, Math.round(sy2)-2, 4, 4);
      }
      // Palenisko (pomarańczowa łuna)
      const glow = 0.55 + Math.sin(t * 4) * 0.25;
      ctx.fillStyle = `rgba(255,120,30,${glow})`;
      ctx.fillRect(x-8, y-2, 16, 10);
      pxRect(x-6, y, 12, 8, '#cc4400');
      pxRect(x-4, y+2, 8, 5, '#ff6622');
      pxRect(x-2, y+3, 4, 3, '#ffaa44');
      ctx.fillStyle = `rgba(255,180,80,${glow*0.5})`;
      ctx.fillRect(x-14, y-14, 28, 28);
      // Hint interakcji
      const nearFurnace = (b.x-player.x)*(b.x-player.x)+(b.y-player.y)*(b.y-player.y) < 65*65;
      if (nearFurnace) {
        ctx.globalAlpha = 0.25 + Math.sin(state.time*4)*0.08;
        ctx.fillStyle = '#ff9944';
        ctx.fillRect(x-18, y-22, 36, 40);
        ctx.globalAlpha = 1;
        ctx.font = 'bold 9px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff9944';
        ctx.fillText('[E] Piec', x, y-22);
      }
    } else if (b.type === 'crafting') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x, y+12, 16, 4, 0, 0, TAU); ctx.fill();
      // Table body
      pxRect(x-14, y-2, 28, 18, '#5a3a1a');
      pxRect(x-14, y-2, 28, 4,  '#7a4a28');
      pxRect(x-14, y-2, 2,  18, '#3d2810');
      // Green craft cloth
      pxRect(x-12, y-8, 24, 8, '#3a6a22');
      pxRect(x-12, y-8, 24, 2, '#5a9a36');
      // Tools on table
      pxRect(x-8, y-10, 2, 4, '#9090a0');
      pxRect(x-9, y-10, 4, 2, '#7a7888');
      pxRect(x+2, y-10, 4, 2, '#c8a060');
      pxRect(x+3, y-12, 2, 4, '#9a7848');
      pxRect(x-3, y-9, 6, 1, '#ffd66b');
      // Legs
      pxRect(x-12, y+14, 4, 5, '#4a2a10');
      pxRect(x+8,  y+14, 4, 5, '#4a2a10');
      // Glow if player is near
      const nearCraft = (b.x-player.x)*(b.x-player.x)+(b.y-player.y)*(b.y-player.y) < 65*65;
      if (nearCraft) {
        ctx.globalAlpha = 0.25 + Math.sin(state.time*4)*0.08;
        ctx.fillStyle = '#ffd66b';
        ctx.fillRect(x-16, y-14, 32, 32);
        ctx.globalAlpha = 1;
        ctx.font = 'bold 9px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd66b';
        ctx.fillText('[E] Rzemioslo', x, y-18);
      }
    } else if (b.type === 'spawner') {
      const t = state.time;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x, y+14, 14, 4, 0, 0, TAU); ctx.fill();
      // Krata — ściany klatki
      pxRect(x-13, y-13, 3, 28, '#6a5830'); pxRect(x+10, y-13, 3, 28, '#6a5830');
      pxRect(x-13, y-13, 26, 3, '#6a5830'); pxRect(x-13, y+12, 26, 3, '#6a5830');
      // Pręty pionowe
      for (let pi = -1; pi <= 1; pi++) {
        pxRect(x + pi*6 - 1, y-10, 2, 20, '#4a3818');
      }
      // Pręty poziome
      pxRect(x-10, y-4, 20, 2, '#4a3818'); pxRect(x-10, y+4, 20, 2, '#4a3818');
      // Animowany mob w środku (mruga)
      const pulse = Math.sin(t * 4) > 0;
      if (pulse) {
        pxRect(x-4, y-6, 8, 10, '#ff4060'); pxRect(x-2, y-8, 4, 3, '#cc2040');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x-3, y-5, 2, 2); ctx.fillRect(x+1, y-5, 2, 2);
      } else {
        pxRect(x-3, y-5, 7, 9, '#cc3050'); pxRect(x-1, y-7, 3, 3, '#aa1838');
      }
      // Czas do spawna
      if ((b.spawnCd || 0) > 0) {
        ctx.font = '8px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff8855';
        ctx.fillText(Math.ceil(b.spawnCd) + 's', x, y - 18);
      }
    } else if (b.type === 'lantern') {
      const t = state.time;
      // Słupek
      pxRect(x-2, y-10, 4, 22, '#6a5020');
      pxRect(x-1, y-10, 2, 22, '#8a6828');
      // Podstawa
      pxRect(x-5, y+10, 10, 4, '#4a3818'); pxRect(x-7, y+12, 14, 3, '#3a2810');
      // Lampion
      pxRect(x-6, y-22, 12, 14, '#3a2810');
      pxRect(x-5, y-22, 10, 2, '#6a5020'); pxRect(x-5, y-10, 10, 2, '#6a5020');
      pxRect(x-6, y-21, 2, 12, '#6a5020'); pxRect(x+4, y-21, 2, 12, '#6a5020');
      // Płomień w lampie
      const fl = 0.7 + Math.sin(t * 9 + x) * 0.2;
      ctx.fillStyle = `rgba(255,200,60,${fl})`;
      ctx.fillRect(x-3, y-20, 6, 8);
      pxRect(x-2, y-19, 4, 6, '#ffcc44');
      pxRect(x-1, y-21, 2, 4, '#ffee88');
    } else if (b.type === 'barricade') {
      const hp = (b.hp||b.maxHp) / (b.maxHp||100);
      const cW = hp > 0.5 ? '#8a6030' : '#6a4020';
      const cH = hp > 0.5 ? '#aa7840' : '#7a5028';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(x, y+8, 20, 4, 0, 0, TAU); ctx.fill();
      // Deski poziome
      pxRect(x-18, y-6, 36, 5, cW); pxRect(x-18, y-6, 36, 2, cH);
      pxRect(x-18, y+1, 36, 5, cW); pxRect(x-18, y+1, 36, 2, cH);
      // Wsporniki X
      pxRect(x-16, y-8, 3, 16, '#5a3818'); pxRect(x-6, y-8, 3, 16, '#5a3818');
      pxRect(x+4,  y-8, 3, 16, '#5a3818'); pxRect(x+14, y-8, 3, 16, '#5a3818');
      // Wbite gwoździe
      pxRect(x-15, y-4, 2, 2, '#c0c0c8'); pxRect(x-3, y+3, 2, 2, '#c0c0c8');
      pxRect(x+7,  y-4, 2, 2, '#c0c0c8'); pxRect(x+15, y+3, 2, 2, '#c0c0c8');
      if (hp < 0.5) { ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x-8,y-2,3,8); ctx.fillRect(x+5,y-4,2,6); }
      ctx.fillStyle = '#400000'; ctx.fillRect(x-18, y-12, 36, 3);
      ctx.fillStyle = hp > 0.5 ? '#44cc44' : hp > 0.25 ? '#cccc44' : '#cc4444';
      ctx.fillRect(x-18, y-12, Math.round(36*hp), 3);
    }
  }
}

// ---- Węzły zasobów ----
function drawResourceNodes() {
  for (const n of state.resourceNodes) {
    if (!inView(n.x, n.y, 30)) continue;
    const x = Math.round(n.x), y = Math.round(n.y);
    if (n.depleted) {
      ctx.fillStyle = '#1a1a1e';
      if (n.type === 'stone') { ctx.fillRect(x-3, y-1, 6, 3); }
      else { ctx.fillRect(x-1, y-4, 3, 6); }
      continue;
    }
    if (n.type === 'stone') {
      // Glittering stone node
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y+7, 10, 3, 0, 0, TAU); ctx.fill();
      pxRect(x-7, y-3, 14, 10, '#6a6675');
      pxRect(x-7, y-3, 14, 3, '#9a9aa8');
      pxRect(x-7, y-3, 3, 10, '#4a4655');
      pxRect(x+4, y-3, 3, 10, '#8a8898');
      pxRect(x-3, y-4, 6, 2, '#8a8898');
      const gs = 0.5 + Math.sin(state.time*3 + n.x*0.01)*0.3;
      ctx.fillStyle = `rgba(180,180,255,${gs})`;
      ctx.fillRect(x-1, y-2, 2, 2); ctx.fillRect(x+2, y, 1, 1);
    } else {
      // Choppable tree (darker, with axe mark hint)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y+9, 13, 4, 0, 0, TAU); ctx.fill();
      pxRect(x-3, y-2, 6, 12, '#5a3a1a'); pxRect(x-3, y-2, 2, 12, '#3d2810');
      const lc = ['#3aa84a','#2e8a3e','#56b85a'][n.v % 3];
      pxRect(x-11, y-18, 22, 14, '#1e5a2a'); pxRect(x-9, y-22, 18, 4, '#1e5a2a');
      pxRect(x-10, y-16, 20, 10, lc); pxRect(x-8, y-20, 16, 4, lc); pxRect(x-5, y-22, 10, 2, lc);
      pxRect(x-6, y-14, 3, 3, '#7ad07a'); pxRect(x+2, y-10, 2, 2, '#7ad07a');
      // Wood icon hint
      ctx.fillStyle = `rgba(200,160,96,${0.5+Math.sin(state.time*2+n.x*0.01)*0.2})`;
      ctx.fillRect(x-4, y-6, 8, 3);
    }
    // Interaction hint
    const dx = player.x-n.x, dy = player.y-n.y;
    if (dx*dx+dy*dy < 56*56) {
      ctx.textAlign='center'; ctx.font='bold 9px "Courier New"';
      ctx.fillStyle='#ffd66b'; ctx.fillText('[E]', x, y-28);
      ctx.fillStyle= n.type==='stone' ? '#9090a0' : '#c8a060';
      ctx.fillText(n.type==='stone' ? 'KAMIEN' : 'DREWNO', x, y-20);
    }
  }
}

function drawParticles() {
  for (const p of state.particles) {
    if (!inView(p.x, p.y, 20)) continue;
    const a = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px "Courier New", monospace';
  for (const f of state.floaters) {
    if (!inView(f.x, f.y, 30)) continue;
    const a = clamp(f.life / f.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// ---- Minimap (screen-space) ----
function drawMinimap() {
  const mw = 160, mh = 100;
  const mx = SW - mw - 10, my = 10;
  ctx.fillStyle = 'rgba(10, 8, 20, 0.7)';
  ctx.fillRect(mx, my, mw, mh);
  ctx.lineWidth = 2;

  if (state.inDungeon && state.dungeonTiles) {
    ctx.strokeStyle = '#7040a0';
    ctx.strokeRect(mx, my, mw, mh);
    ctx.fillStyle = '#d0a0ff';
    ctx.font = 'bold 7px "Courier New"'; ctx.textAlign = 'center';
    ctx.fillText(`LOCH LVL ${state.dungeonLevel}`, mx + mw/2, my + 8);
    const tw = (mw - 2) / DUNGEON_COLS;
    const th = (mh - 10) / DUNGEON_ROWS;
    for (let r = 0; r < DUNGEON_ROWS; r++) {
      for (let c = 0; c < DUNGEON_COLS; c++) {
        if (state.dungeonTiles[r][c] !== 1) continue;
        ctx.fillStyle = '#4a3070';
        ctx.fillRect(mx + 1 + c * tw, my + 10 + r * th, Math.max(1, tw), Math.max(1, th));
      }
    }
    // Enemies
    const DW = DUNGEON_COLS * DUNGEON_TILE, DH = DUNGEON_ROWS * DUNGEON_TILE;
    const esx = (mw - 2) / DW, esy = (mh - 10) / DH;
    for (const e of state.enemies) {
      ctx.fillStyle = e.type === 'boss' ? '#ff4060' : '#ff8855';
      ctx.fillRect(mx + 1 + e.x * esx - 1, my + 10 + e.y * esy - 1, e.type === 'boss' ? 3 : 2, e.type === 'boss' ? 3 : 2);
    }
    ctx.fillStyle = '#9bff9b';
    ctx.fillRect(mx + 1 + player.x * esx - 2, my + 10 + player.y * esy - 2, 4, 4);
    return;
  }

  ctx.strokeStyle = '#3a2d5c';
  ctx.strokeRect(mx, my, mw, mh);
  // Lokalny radar — świat jest nieskończony, pokazujemy obszar wokół gracza
  const viewW = 12000, viewH = 7500;
  const rsx = mw / viewW, rsy = mh / viewH;
  const offX = player.x - viewW / 2, offY = player.y - viewH / 2;
  // Wrogowie
  for (const e of state.enemies) {
    const ex = mx + (e.x - offX) * rsx, ey = my + (e.y - offY) * rsy;
    if (ex < mx || ex > mx+mw || ey < my || ey > my+mh) continue;
    ctx.fillStyle = e.type === 'boss' ? '#ff4060' : (e.passive ? '#aaffaa' : '#ff8855');
    ctx.fillRect(ex - 1, ey - 1, e.type === 'boss' ? 4 : 2, e.type === 'boss' ? 4 : 2);
  }
  // Gracz zawsze na środku
  ctx.fillStyle = '#9bff9b';
  ctx.fillRect(mx + mw/2 - 2, my + mh/2 - 2, 4, 4);
  // Struktura w zasięgu widoku ekranu
  ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 1;
  ctx.strokeRect(mx + (camera.x - offX) * rsx, my + (camera.y - offY) * rsy, SW * rsx, SH * rsy);
  // Etykieta kierunku N
  ctx.font = '7px "Courier New"'; ctx.textAlign = 'center'; ctx.fillStyle = '#604080';
  ctx.fillText('N', mx + mw/2, my + 8);
}

function drawCrosshair() {
  const x = Math.round(mouseScreen.x), y = Math.round(mouseScreen.y);
  if (state.buildMode) {
    ctx.strokeStyle = '#9bff9b'; ctx.lineWidth = 1;
    ctx.strokeRect(x - 16, y - 16, 32, 32);
    ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x-10,y); ctx.lineTo(x+10,y); ctx.moveTo(x,y-10); ctx.lineTo(x,y+10); ctx.stroke();
    return;
  }
  ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x-10,y); ctx.lineTo(x-4,y); ctx.moveTo(x+4,y); ctx.lineTo(x+10,y);
  ctx.moveTo(x,y-10); ctx.lineTo(x,y-4); ctx.moveTo(x,y+4); ctx.lineTo(x,y+10);
  ctx.stroke();
  ctx.fillStyle = '#ffd66b'; ctx.fillRect(x-1,y-1,2,2);
}

function drawNightOverlay() {
  const br = state.inDungeon ? 0 : getDayBrightness();
  if (br >= 1) return;
  const darkness = state.inDungeon ? 0.93 : (1 - br) * 0.88;

  nightCtx.clearRect(0, 0, SW, SH);
  nightCtx.fillStyle = '#000';
  nightCtx.fillRect(0, 0, SW, SH);
  nightCtx.globalCompositeOperation = 'destination-out';

  function addLight(sx, sy, r, strength) {
    const g = nightCtx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0,    `rgba(0,0,0,${strength})`);
    g.addColorStop(0.45, `rgba(0,0,0,${strength*0.6})`);
    g.addColorStop(1,    'transparent');
    nightCtx.fillStyle = g;
    nightCtx.fillRect(sx-r, sy-r, r*2, r*2);
  }

  // Gracz
  const px = Math.round(player.x - camera.x), py = Math.round(player.y - camera.y);
  const pR = player.baseClass === 'mage' || player.baseClass === 'shaman' || player.classId === 'pyromancer' ? 190 : 150;
  addLight(px, py, pR, 1);

  // Budynki graczy
  for (const b of state.buildings) {
    const bx = Math.round(b.x - camera.x), by = Math.round(b.y - camera.y);
    if (bx < -150 || bx > SW+150 || by < -150 || by > SH+150) continue;
    if (b.type === 'campfire') addLight(bx, by, 120, 0.92);
    else if (b.type === 'furnace') addLight(bx, by, 90, 0.80);
    else if (b.type === 'tower') addLight(bx, by-10, 70, 0.6);
  }
  // Obozy z decoracji
  for (const d of state.decor) {
    if (d.type !== 'camp') continue;
    const bx = Math.round(d.x + 14 - camera.x), by = Math.round(d.y + 3 - camera.y);
    if (bx < -100 || bx > SW+100 || by < -100 || by > SH+100) continue;
    addLight(bx, by, 100, 0.85);
  }

  nightCtx.globalCompositeOperation = 'source-over';

  ctx.globalAlpha = darkness;
  ctx.drawImage(nightCanvas, 0, 0);
  ctx.globalAlpha = 1;

  // Kolorowe światła nocne — ciepłe ognisko, zimne magiczne
  if (darkness > 0.05) {
    const nt = state.time;

    // Ciepłe pomarańczowe ogniska (budynki)
    for (const b of state.buildings) {
      if (b.type !== 'campfire') continue;
      const bx = Math.round(b.x - camera.x), by = Math.round(b.y - camera.y);
      if (bx < -120 || bx > SW+120 || by < -120 || by > SH+120) continue;
      const fl = 0.55 + Math.sin(nt * 9.1 + b.x * 0.11) * 0.22 + Math.sin(nt * 16.3) * 0.08;
      const warmG = ctx.createRadialGradient(bx, by, 0, bx, by, 100);
      warmG.addColorStop(0,   `rgba(255,150,30,${darkness * 0.32 * fl})`);
      warmG.addColorStop(0.55, `rgba(220,80,10,${darkness * 0.12 * fl})`);
      warmG.addColorStop(1,   'transparent');
      ctx.fillStyle = warmG;
      ctx.fillRect(bx-100, by-100, 200, 200);
    }

    // Ciepłe ogniska obozowisk z dekoracji
    for (const d of state.decor) {
      if (d.type !== 'camp') continue;
      const bx = Math.round(d.x + 14 - camera.x), by = Math.round(d.y + 3 - camera.y);
      if (bx < -110 || bx > SW+110 || by < -110 || by > SH+110) continue;
      const fl2 = 0.5 + Math.sin(nt * 8.7 + d.x * 0.09) * 0.25;
      const campG = ctx.createRadialGradient(bx, by, 0, bx, by, 85);
      campG.addColorStop(0,    `rgba(255,140,25,${darkness * 0.28 * fl2})`);
      campG.addColorStop(0.6,  `rgba(200,70,8,${darkness * 0.1 * fl2})`);
      campG.addColorStop(1,   'transparent');
      ctx.fillStyle = campG;
      ctx.fillRect(bx-85, by-85, 170, 170);
    }

    // Zimne niebieskofioletowe światło gracza (magia)
    const isMagic = player.baseClass === 'mage' || player.baseClass === 'shaman' ||
                    player.classId === 'pyromancer' || player.baseClass === 'necromancer' ||
                    player.baseClass === 'frostmage' || player.baseClass === 'stormcaller';
    if (isMagic) {
      const px2 = Math.round(player.x - camera.x), py2 = Math.round(player.y - camera.y);
      const magicPulse = 0.4 + Math.sin(nt * 3.5) * 0.15;
      const magCol = player.baseClass === 'frostmage' ? '60,160,255' :
                     player.baseClass === 'stormcaller' ? '80,200,255' : '130,60,255';
      const magG = ctx.createRadialGradient(px2, py2, 0, px2, py2, 120);
      magG.addColorStop(0,    `rgba(${magCol},${darkness * 0.18 * magicPulse})`);
      magG.addColorStop(0.5,  `rgba(${magCol},${darkness * 0.07 * magicPulse})`);
      magG.addColorStop(1,   'transparent');
      ctx.fillStyle = magG;
      ctx.fillRect(px2-120, py2-120, 240, 240);
    }
  }

  // Sky tint
  const tint = getDayTint();
  if (tint) {
    ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`;
    ctx.fillRect(0, 0, SW, SH);
  }
}

function drawBuildingSelector() {
  if (!state.buildMode) return;
  const slotW = 52, slotH = 52, gap = 4;
  const n = BUILDINGS.length;
  const totalW = n * slotW + (n - 1) * gap;
  const startX = Math.round(SW / 2 - totalW / 2);
  const panelY = SH - slotH - 58;

  // Panel tło
  ctx.fillStyle = 'rgba(8,6,18,0.88)';
  ctx.fillRect(startX - 6, panelY - 6, totalW + 12, slotH + 12);
  ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 1;
  ctx.strokeRect(startX - 6, panelY - 6, totalW + 12, slotH + 12);

  for (let i = 0; i < n; i++) {
    const bdef = BUILDINGS[i];
    const sx = startX + i * (slotW + gap);
    const sy = panelY;
    const sel = i === state.buildSelected;
    const canAfford = (state.resources.wood || 0) >= (bdef.cost.wood || 0) &&
                      (state.resources.stone || 0) >= (bdef.cost.stone || 0) &&
                      (state.resources.bone || 0) >= (bdef.cost.bone || 0);

    // Slot bg
    ctx.fillStyle = sel ? 'rgba(255,215,0,0.18)' : 'rgba(20,16,36,0.7)';
    ctx.fillRect(sx, sy, slotW, slotH);
    ctx.strokeStyle = sel ? '#ffd700' : (canAfford ? '#3a5a3a' : '#5a2a2a');
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(sx, sy, slotW, slotH);

    // Mini pixel art ikona budynku
    ctx.save();
    const icx = sx + slotW / 2, icy = sy + slotH / 2 - 4;
    if (bdef.id === 'campfire') {
      pxRect(icx-5, icy+2, 10, 5, '#6a6275');
      pxRect(icx-3, icy-2, 5, 5, '#cc3300'); pxRect(icx-1, icy-5, 3, 4, '#ff7700'); pxRect(icx, icy-7, 1, 3, '#ffcc44');
    } else if (bdef.id === 'wall') {
      pxRect(icx-12, icy-2, 24, 10, '#7a8090'); pxRect(icx-12, icy-2, 24, 3, '#9aa0b0');
      pxRect(icx-12, icy-6, 8, 4, '#7a8090'); pxRect(icx+2, icy-6, 8, 4, '#7a8090');
    } else if (bdef.id === 'tower') {
      pxRect(icx-6, icy-14, 12, 22, '#7a8090'); pxRect(icx-6, icy-14, 12, 2, '#9aa0b0');
      pxRect(icx-8, icy-18, 4, 4, '#7a8090'); pxRect(icx+4, icy-18, 4, 4, '#7a8090');
    } else if (bdef.id === 'door') {
      pxRect(icx-7, icy-8, 14, 16, '#5a3010'); pxRect(icx-7, icy-8, 14, 2, '#7a4a28');
      pxRect(icx+2, icy-2, 2, 4, '#ffd66b');
    } else if (bdef.id === 'crafting') {
      pxRect(icx-10, icy-2, 20, 10, '#5a3a1a'); pxRect(icx-10, icy-6, 20, 5, '#3a6a22');
      pxRect(icx-10, icy-6, 20, 2, '#5a9a36');
    } else if (bdef.id === 'furnace') {
      pxRect(icx-10, icy-2, 20, 12, '#7a5030'); pxRect(icx-4, icy-10, 7, 9, '#6a5030');
      pxRect(icx-2, icy-5, 4, 4, '#ff6622');
    } else if (bdef.id === 'spawner') {
      pxRect(icx-10, icy-10, 3, 20, '#6a5830'); pxRect(icx+7, icy-10, 3, 20, '#6a5830');
      pxRect(icx-10, icy-10, 20, 3, '#6a5830'); pxRect(icx-10, icy+7, 20, 3, '#6a5830');
      pxRect(icx-3, icy-6, 6, 8, '#ff4060');
    } else if (bdef.id === 'lantern') {
      pxRect(icx-1, icy-8, 3, 16, '#6a5020');
      pxRect(icx-4, icy-16, 9, 10, '#3a2810'); pxRect(icx-2, icy-15, 5, 7, '#ffcc44');
    } else if (bdef.id === 'barricade') {
      pxRect(icx-12, icy-3, 24, 4, '#8a6030'); pxRect(icx-12, icy+3, 24, 4, '#8a6030');
      pxRect(icx-10, icy-6, 3, 12, '#5a3818'); pxRect(icx-2, icy-6, 3, 12, '#5a3818');
      pxRect(icx+5, icy-6, 3, 12, '#5a3818');
    }
    ctx.restore();

    // Koszt
    const cost = (bdef.cost.wood > 0 ? `D${bdef.cost.wood}` : '') +
                 (bdef.cost.stone > 0 ? ` K${bdef.cost.stone}` : '') +
                 (bdef.cost.bone > 0 ? ` B${bdef.cost.bone}` : '');
    ctx.textAlign = 'center'; ctx.font = '7px "Courier New"';
    ctx.fillStyle = canAfford ? '#9bff9b' : '#ff6060';
    ctx.fillText(cost.trim(), sx + slotW / 2, sy + slotH - 3);

    // Numer slotu
    ctx.fillStyle = sel ? '#ffd700' : '#504060';
    ctx.font = '7px "Courier New"'; ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), sx + 2, sy + 9);
  }

  // Nazwa i [SCROLL]
  const bsel = BUILDINGS[state.buildSelected];
  ctx.textAlign = 'center'; ctx.font = 'bold 9px "Courier New"';
  ctx.fillStyle = '#ffd66b';
  ctx.fillText(bsel.name.toUpperCase() + '  [SCROLL]', SW / 2, panelY - 10);
}

function drawBuildMode() {
  if (!state.buildMode) return;
  const bdef = BUILDINGS[state.buildSelected];
  const rotated = state.buildRotated && (bdef.id === 'wall' || bdef.id === 'door');
  const pw = rotated ? bdef.h : bdef.w;
  const ph = rotated ? bdef.w : bdef.h;
  const wx = Math.round(mouseWorld.x/8)*8 - camera.x;
  const wy = Math.round(mouseWorld.y/8)*8 - camera.y;
  const canAfford = state.resources.wood >= (bdef.cost.wood||0) && state.resources.stone >= (bdef.cost.stone||0) && (state.resources.bone||0) >= (bdef.cost.bone||0);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = canAfford ? 'rgba(80,200,80,0.3)' : 'rgba(200,60,60,0.3)';
  ctx.fillRect(wx - pw/2, wy - ph/2, pw, ph);
  ctx.strokeStyle = canAfford ? '#9bff9b' : '#ff4060';
  ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
  ctx.strokeRect(wx - pw/2, wy - ph/2, pw, ph);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.font = 'bold 10px "Courier New"';
  ctx.fillStyle = '#ffd66b';
  const cs = (bdef.cost.wood > 0 ? `D:${bdef.cost.wood} ` : '') + (bdef.cost.stone > 0 ? `K:${bdef.cost.stone} ` : '') + (bdef.cost.bone > 0 ? `B:${bdef.cost.bone}` : '');
  ctx.fillText(cs, wx, wy - ph/2 - 6);
  ctx.fillStyle = canAfford ? '#9bff9b' : '#ff4060';
  const canRotate = bdef.id === 'wall' || bdef.id === 'door';
  const label = bdef.name + (canRotate ? (rotated ? ' [↕]' : ' [↔]') : '');
  ctx.fillText(label, wx, wy + ph/2 + 12);
}

function drawResourceHud() {
  const hx = SW - 230, hy = SH - 70;
  ctx.fillStyle = 'rgba(10,8,20,0.85)';
  ctx.fillRect(hx, hy, 220, 60);
  ctx.strokeStyle = state.inDungeon ? '#7040a0' : '#3a2d5c'; ctx.lineWidth = 2;
  ctx.strokeRect(hx, hy, 220, 60);
  ctx.textAlign = 'left'; ctx.font = 'bold 10px "Courier New"';
  if (state.inDungeon) {
    ctx.fillStyle = '#d0a0ff';
    ctx.fillText(`LOCH — POZIOM ${state.dungeonLevel}`, hx+8, hy+20);
    ctx.fillStyle = state.dungeonBossKilled ? '#40ff88' : '#ff8888';
    ctx.fillText(state.dungeonBossKilled ? 'BOSS POKONANY ✓' : 'Boss żyje...', hx+8, hy+35);
  } else {
    const w = state.resources.wood, s = state.resources.stone, b = state.resources.bone || 0;
    pxRect(hx+8, hy+11, 5, 7, '#7a4a1a');
    ctx.fillStyle = '#c8a060'; ctx.fillText(`D:${w}`, hx+16, hy+18);
    pxRect(hx+58, hy+12, 7, 5, '#7a7080');
    ctx.fillStyle = '#9090a0'; ctx.fillText(`K:${s}`, hx+68, hy+18);
    // Kości
    ctx.save(); ctx.translate(hx+112, hy+14); ctx.rotate(0.4);
    pxRect(-5, -1, 10, 2, '#d0ccb8');
    ctx.restore();
    ctx.fillStyle = '#d0ccb8'; ctx.fillText(`B:${b}`, hx+122, hy+18);
    // Ekwipunek
    const wpn = player.equip.weapon, arm = player.equip.armor;
    ctx.fillStyle = '#604080'; ctx.font = '9px "Courier New"';
    ctx.fillText((wpn ? '⚔ '+wpn.name : '⚔ —'), hx+8, hy+31);
    ctx.fillText((arm ? '🛡 '+arm.name : '🛡 —'), hx+8, hy+42);
    if (state.buildMode) {
      ctx.font = 'bold 9px "Courier New"'; ctx.fillStyle = '#ffd66b';
      const bsel = BUILDINGS[state.buildSelected];
      const rotHint = (bsel.id === 'wall' || bsel.id === 'door') ? ' [R]obróć' : '';
      ctx.fillText(`[B]: ${bsel.name} [SCROLL/1-9]${rotHint}`, hx+8, hy+54);
    } else {
      ctx.font = '9px "Courier New"'; ctx.fillStyle = 'rgba(160,140,200,0.7)';
      ctx.fillText('[E]Kopaj/Rzemioslo  [I]Ekwipunek  [Tab]Armor', hx+8, hy+54);
    }
  }
}

function drawTimeOfDay() {
  const br = getDayBrightness(), label = getDayLabel();
  const col = isDay() ? '#ffd66b' : '#8ad8ff';
  const cx2 = SW/2, cy2 = 30;
  // Arc progress
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx2, cy2, 12, 0, TAU); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx2, cy2, 12, -Math.PI/2, state.dayTime * TAU - Math.PI/2); ctx.stroke();
  // Sun/moon dot
  const dotA = state.dayTime * TAU - Math.PI/2;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(Math.round(cx2 + Math.cos(dotA)*12), Math.round(cy2 + Math.sin(dotA)*12), 3, 0, TAU); ctx.fill();
  // Label
  ctx.textAlign = 'center'; ctx.font = 'bold 10px "Courier New"';
  ctx.fillStyle = '#000'; ctx.fillText(label, cx2+1, cy2+4);
  ctx.fillStyle = col; ctx.fillText(label, cx2, cy2+3);
}

// ============================================================
//   MAIN LOOP
// ============================================================
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ============================================================
//   FULLSCREEN SCALING
// ============================================================
const gameWrapper = document.getElementById('gameWrapper');

function resizeGame() {
  gameWrapper.style.transform = '';
  const nw = gameWrapper.offsetWidth;
  const nh = gameWrapper.offsetHeight;
  const scale = Math.min(window.innerWidth / nw, window.innerHeight / nh);
  const left = (window.innerWidth  - nw * scale) / 2;
  const top  = (window.innerHeight - nh * scale) / 2;
  gameWrapper.style.transform = `scale(${scale})`;
  gameWrapper.style.left = left + 'px';
  gameWrapper.style.top  = top  + 'px';
}

window.addEventListener('resize', resizeGame);
resizeGame();

// ============================================================
//   MOBILNE STEROWANIE (touch)
// ============================================================

const TOUCH_DEVICE = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (TOUCH_DEVICE) document.getElementById('mobileControls').style.display = 'block';

// -- stany dotyku --
const _joy = { active: false, id: -1, bx: 0, by: 0 };
const _aim = { active: false, id: -1 };
const JOY_R = 52; // maks przesunięcie knoba

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const r  = canvas.getBoundingClientRect();
    const tx = (t.clientX - r.left) * (SW / r.width);

    if (tx < SW * 0.48 && !_joy.active) {
      // lewa połowa → joystick
      _joy.active = true;
      _joy.id = t.identifier;
      _joy.bx = t.clientX;
      _joy.by = t.clientY;
      _mobileShowJoy(t.clientX, t.clientY);
      _mobileUpdateJoy(t.clientX, t.clientY);
    } else if (tx >= SW * 0.48 && !_aim.active) {
      // prawa połowa → celowanie + strzał
      _aim.active = true;
      _aim.id = t.identifier;
      _mobileSetAim(t.clientX, t.clientY);
      mouseDown = true;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === _joy.id)  _mobileUpdateJoy(t.clientX, t.clientY);
    if (t.identifier === _aim.id)  _mobileSetAim(t.clientX, t.clientY);
  }
}, { passive: false });

canvas.addEventListener('touchend',    _mobileCanvasTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', _mobileCanvasTouchEnd, { passive: false });

function _mobileCanvasTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === _joy.id) {
      _joy.active = false;
      keys['KeyW'] = keys['KeyA'] = keys['KeyS'] = keys['KeyD'] = false;
      const jb = document.getElementById('joyBase');
      if (jb) jb.style.display = 'none';
    }
    if (t.identifier === _aim.id) {
      _aim.active = false;
      mouseDown = false;
    }
  }
}

function _mobileSetAim(cx, cy) {
  const r = canvas.getBoundingClientRect();
  mouseScreen.x = (cx - r.left) * (SW / r.width);
  mouseScreen.y = (cy - r.top)  * (SH / r.height);
}

function _mobileShowJoy(cx, cy) {
  const jb = document.getElementById('joyBase');
  if (!jb) return;
  jb.style.display = 'block';
  jb.style.left = (cx - 60) + 'px';
  jb.style.top  = (cy - 60) + 'px';
}

function _mobileUpdateJoy(cx, cy) {
  const dx = cx - _joy.bx;
  const dy = cy - _joy.by;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const nx = dist > 0 ? dx / dist : 0;
  const ny = dist > 0 ? dy / dist : 0;
  const cl = Math.min(dist, JOY_R);

  // przesuń knob wizualnie
  const knob = document.getElementById('joyKnob');
  if (knob) {
    knob.style.left = (50 + (nx * cl / JOY_R) * 42) + '%';
    knob.style.top  = (50 + (ny * cl / JOY_R) * 42) + '%';
  }

  // symuluj klawisze WASD
  const dead = 0.28;
  keys['KeyW'] = ny < -dead;
  keys['KeyA'] = nx < -dead;
  keys['KeyS'] = ny > dead;
  keys['KeyD'] = nx > dead;
}

// -- Przyciski skillów --
function _bindMobileBtn(id, onPress, onRelease) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('touchstart',  (e) => { e.stopPropagation(); e.preventDefault(); onPress(); },              { passive: false });
  el.addEventListener('touchend',    (e) => { e.stopPropagation(); e.preventDefault(); if (onRelease) onRelease(); }, { passive: false });
  el.addEventListener('touchcancel', (e) => { e.stopPropagation();                     if (onRelease) onRelease(); }, { passive: false });
}

_bindMobileBtn('mBtnSkill1', () => { keys['Space'] = true; },  () => { keys['Space'] = false; });
_bindMobileBtn('mBtnX',      () => { castSkill(1); },          null);
_bindMobileBtn('mBtnDash',   () => { keys['KeyQ'] = true; },   () => { keys['KeyQ'] = false; });
_bindMobileBtn('mBtnE',      () => { handleInteract(); },      null);
_bindMobileBtn('mBtnPause',  () => {
  if (!state.running) return;
  state.paused = !state.paused;
  if (state.paused) { pauseOverlay.classList.remove('hidden'); saveWorld(); }
  else              { pauseOverlay.classList.add('hidden'); canvas.focus(); }
}, null);

// ---- Class icon pixel art ----
(function renderClassIcons() {
  const defs = {
    iconMage:   { colors: ['#3a2376','#5a3da0','#f1c79a','#ffd66b'], draw(p, c) {
      p(-1,-22,2,2,'#5a3da0'); p(-3,-20,6,2,'#5a3da0'); p(-5,-18,10,2,'#3b2670');
      p(-4,-16,8,6,'#f1c79a'); p(-6,-10,12,14,'#3a2376'); p(-6,-4,12,2,'#ffd66b');
      p(6,-18,2,18,'#7a4a1a'); p(5,-20,4,3,'#ffd66b'); p(6,-21,2,1,'#ffffff');
      p(-4,4,3,5,'#2a1a5e'); p(1,4,3,5,'#2a1a5e');
    }},
    iconArcher: { draw(p, c) {
      p(-5,-18,10,4,'#1d4a28'); p(-4,-14,8,6,'#f1c79a'); p(-6,-8,12,14,'#2a6a3a');
      p(-6,-2,12,2,'#7a4a1a'); p(5,-14,2,20,'#7a4a1a'); p(4,-14,3,2,'#a06a2a');
      p(4,4,3,2,'#a06a2a'); p(-4,6,3,5,'#1d4a28'); p(1,6,3,5,'#1d4a28');
      c.strokeStyle='#dcd4c0'; c.lineWidth=1; c.beginPath();
      c.moveTo(28+6,-8+16); c.lineTo(28+2,-1+16); c.lineTo(28+6,6+16); c.stroke();
    }},
    iconDoctor: { draw(p, c) {
      p(-4,-16,8,6,'#f1c79a'); p(-3,-17,6,1,'#ffffff'); p(-1,-18,2,1,'#ff3b3b');
      p(-6,-10,12,14,'#e8e4ee'); p(-1,-4,2,6,'#ff3b3b'); p(-3,-2,6,2,'#ff3b3b');
      p(-6,-4,12,1,'#1a1228'); p(-4,4,3,5,'#3a3445'); p(1,4,3,5,'#3a3445');
      p(-3,-15,2,2,'#1a1228'); p(1,-15,2,2,'#1a1228'); p(-3,-15,2,1,'#ffffff'); p(1,-15,2,1,'#ffffff');
    }},
    iconKnight: { draw(p, c) {
      p(-6,-18,12,10,'#7a8090'); p(-6,-18,12,2,'#9aa0b0'); p(-8,-20,16,2,'#9aa0b0');
      p(-2,-18,4,4,'#aa2030'); p(-4,-8,8,14,'#7a8090'); p(-4,-8,8,3,'#9aa0b0');
      p(-3,-4,6,9,'#8a1520'); p(-6,-8,2,14,'#5a6070'); p(-4,6,4,3,'#3a4050');
      p(2,6,4,3,'#3a4050'); p(-13,-14,7,16,'#7a8090'); p(-12,-8,5,5,'#cc2233');
      p(7,-20,2,26,'#c0c8d8'); p(6,-7,6,2,'#9a7840');
    }},
    iconShaman: { draw(p, c) {
      p(-5,-26,10,5,'#6a4a28'); for(let i=0;i<5;i++) p(-5+i*2,-26,2,8,['#ff6633','#ff3b3b','#ffaa33','#3bff8a','#3b9bff'][i]);
      p(-4,-16,8,6,'#c8924a'); p(-3,-15,2,2,'#5a9aff'); p(1,-15,2,2,'#5a9aff');
      p(-5,-10,10,4,'#8a6a3a'); p(-6,-10,12,14,'#6a4a28');
      p(5,-24,2,28,'#7a5030'); p(4,-28,5,5,'#e8e0c0');
    }},
    iconNinja:  { draw(p, c) {
      p(-4,-18,8,3,'#8a1520'); p(-5,-16,10,3,'#8a1520');
      p(-4,-14,8,8,'#1a1a28'); p(-3,-15,2,1,'#c8d8ff'); p(1,-15,2,1,'#c8d8ff');
      p(-6,-6,12,14,'#1a1a28'); p(-7,0,14,2,'#8a1520');
      p(-4,8,3,5,'#0e0e18'); p(1,8,3,5,'#0e0e18');
      p(5,-6,3,3,'#c0c8d8'); p(6,-7,1,5,'#c0c8d8'); p(4,-5,5,1,'#c0c8d8');
    }},
    iconGravedigger: { draw(p, c) {
      p(-4,-18,8,2,'#1e1616'); p(-5,-16,10,6,'#1e1616');
      p(-4,-12,8,6,'#ddd0c0'); p(-1,-13,2,2,'#1a1228'); p(2,-13,2,2,'#1a1228');
      p(-6,-6,12,14,'#2a1f1a'); p(-6,-2,12,2,'#4a3a2a');
      p(-4,8,3,5,'#2a1f1a'); p(1,8,3,5,'#2a1f1a');
      p(6,-18,2,26,'#6a4a2a'); p(4,-20,6,4,'#8a6a4a'); p(4,-18,6,2,'#6a4a2a');
    }},
    iconBerserker: { draw(p, c) {
      p(-7,-20,2,4,'#c0b0a0'); p(6,-20,2,4,'#c0b0a0');
      p(-6,-18,12,6,'#6a3838'); p(-7,-16,14,4,'#5a3030');
      p(-4,-12,8,6,'#c09870'); p(-2,-13,2,2,'#ff3333'); p(2,-13,2,2,'#ff3333');
      p(-8,-6,16,14,'#6a3838'); p(-9,-2,18,10,'#5a3030'); p(-1,-2,3,10,'#8a4040');
      p(-10,-6,4,8,'#7a3030'); p(7,-6,4,8,'#7a3030');
      p(-4,8,4,6,'#5a3030'); p(1,8,4,6,'#5a3030');
    }},
    iconPyromancer: { draw(p, c) {
      p(0,-24,2,2,'#ff6622'); p(-2,-22,4,4,'#8a3020'); p(-4,-18,8,4,'#6a2818');
      p(-4,-14,8,6,'#e8c090'); p(-6,-8,12,14,'#5a2010'); p(-7,-4,14,8,'#6a2818');
      p(-6,-4,12,2,'#ff6622'); p(-8,-2,3,4,'#ff6622'); p(-8,-2,2,2,'#ffaa44');
      p(-4,6,3,5,'#3a1508'); p(1,6,3,5,'#3a1508');
    }},
    iconCleric: { draw(p, c) {
      p(-6,-20,12,2,'#ffd66b'); p(-5,-18,10,4,'#d8d0c0');
      p(-4,-14,8,6,'#f0d0a0'); p(-2,-15,2,2,'#1a1228'); p(2,-15,2,2,'#1a1228');
      p(-6,-8,12,14,'#d8d0c0'); p(-7,-4,14,8,'#e0d8c8');
      p(-1,-4,3,10,'#ffd66b'); p(-4,-1,9,3,'#ffd66b');
      p(-4,6,3,5,'#b0a888'); p(1,6,3,5,'#b0a888');
    }},
    iconHunter: { draw(p, c) {
      p(-5,-18,10,6,'#4a5a2a'); p(-4,-14,8,6,'#d0a870');
      p(-2,-15,2,2,'#1a1228'); p(2,-15,2,2,'#1a1228');
      p(-6,-8,12,14,'#4a5a2a'); p(-6,-4,12,2,'#6a7a4a');
      p(-4,6,3,5,'#3a4a1a'); p(1,6,3,5,'#3a4a1a');
      p(7,-12,4,16,'#6a3a1a'); p(8,-14,2,2,'#8a5a2a'); p(9,-14,1,2,'#a07030');
      p(-11,-10,11,2,'#7a5030'); c.strokeStyle='#7a5030'; c.lineWidth=1; c.beginPath(); c.moveTo(14-11,-6+12); c.lineTo(14+5,-6+12); c.stroke();
    }},
    iconShadow: { draw(p, c) {
      p(-5,-20,10,10,'#1a1228'); p(-5,-12,10,2,'#2a1a38');
      p(-4,-14,8,6,'#c0a880'); p(-2,-13,2,2,'#aa44ff'); p(2,-13,2,2,'#aa44ff');
      p(-6,-6,12,14,'#1a1228'); p(-7,-2,14,8,'#2a1a38'); p(-6,-2,12,2,'#4a2288');
      p(-4,8,3,5,'#14101e'); p(1,8,3,5,'#14101e');
      p(-10,-2,4,8,'#7a9acc'); p(-10,-2,1,6,'#c0d0ff');
    }},
    iconCrusader: { draw(p) {
      p(-6,-18,12,10,'#c0a830'); p(-6,-18,12,2,'#e0c840'); p(-8,-20,16,2,'#e0c840');
      p(-2,-18,4,4,'#ffe8aa'); p(-4,-8,8,14,'#c0a830'); p(-4,-8,8,3,'#e0c840');
      p(-3,-4,6,9,'#ffe8aa'); p(-3,-2,2,6,'#ffe8aa'); p(-3,-2,6,2,'#ffe8aa');
      p(-6,-8,2,14,'#a08820'); p(-4,6,4,3,'#3a3010'); p(2,6,4,3,'#3a3010');
      p(-13,-14,7,16,'#c0a830'); p(-12,-8,5,5,'#ffe8aa'); p(7,-20,2,26,'#e0d080'); p(6,-7,6,2,'#a08820');
    }},
    iconWitch: { draw(p) {
      p(-1,-30,2,4,'#2a0a4a'); p(-3,-26,6,4,'#2a0a4a'); p(-5,-22,10,4,'#2a0a4a'); p(-7,-18,14,2,'#1a0630');
      p(-4,-16,8,6,'#d4c8e0'); p(-3,-15,2,2,'#aaff22'); p(1,-15,2,2,'#aaff22');
      p(-6,-10,12,14,'#2a0a4a'); p(-7,-6,14,8,'#2a0a4a'); p(-6,-6,12,2,'#44cc22');
      p(-4,4,3,5,'#1a0e2e'); p(1,4,3,5,'#1a0e2e');
      p(5,-2,2,18,'#7a5030'); p(3,8,6,4,'#8a6a1a'); p(3,8,1,6,'#9a7a2a'); p(7,8,1,6,'#9a7a2a');
    }},
    iconAlchemist: { draw(p) {
      p(-4,-18,8,2,'#3a2820'); p(-5,-16,10,4,'#3a2820'); p(-4,-14,8,6,'#f1c79a');
      p(-3,-15,3,3,'#1a1228'); p(1,-15,3,3,'#4488ff'); p(0,-14,1,1,'#555');
      p(-6,-8,12,14,'#8a7a1a'); p(-6,-4,12,1,'#1a1228'); p(-5,-2,4,4,'#7a6a10'); p(1,-2,4,4,'#7a6a10');
      p(-4,6,3,5,'#3a3455'); p(1,6,3,5,'#3a3455');
      p(5,-10,3,8,'#8a7a1a'); p(5,-10,4,8,'#88cc22'); p(5,-12,4,2,'#4a7a00');
    }},
    iconBard: { draw(p, c) {
      p(-5,-18,10,4,'#2a7a3a'); p(-4,-16,8,4,'#1a5228'); p(-4,-14,8,6,'#f1c79a');
      p(-2,-15,2,2,'#1a1228'); p(2,-15,1,2,'#1a1228');
      p(-6,-8,12,14,'#2a7a3a'); p(-7,-4,14,8,'#2a7a3a'); p(-6,-4,12,2,'#ffd66b');
      p(-1,-4,3,5,'#ffd66b'); p(-1,-4,3,2,'#ffd66b'); p(-2,-1,2,2,'#ffd66b');
      p(-4,6,3,5,'#1a4a2a'); p(1,6,3,5,'#1a4a2a');
      p(5,-4,3,12,'#7a5030'); p(5,5,4,5,'#a07040'); p(5,5,4,2,'#c09050');
      c.strokeStyle='#e8d8b0'; c.lineWidth=1; c.beginPath(); c.moveTo(14+6,-4+16); c.lineTo(14+8,7+16); c.stroke();
    }},
    iconNecromancer: { draw(p) {
      p(-5,-20,10,6,'#1e0a36'); p(-5,-14,10,2,'#130620');
      p(-4,-14,8,6,'#c8d0c0'); p(-2,-13,2,2,'#cc1122'); p(2,-13,2,2,'#cc1122');
      p(-6,-8,12,14,'#1e0a36'); p(-7,-4,14,8,'#1e0a36'); p(-6,-4,12,2,'#44cc22');
      p(-4,6,3,5,'#1a0e2e'); p(1,6,3,5,'#1a0e2e');
      p(-4,-20,2,3,'#e0e0d0'); p(0,-20,2,3,'#e0e0d0'); p(3,-20,2,3,'#e0e0d0');
      p(5,-22,2,28,'#5a3a1a'); p(4,-24,4,4,'#c8d0c0'); p(5,-26,2,2,'#44cc22');
    }},
    iconPaladin: { draw(p) {
      p(-6,-18,12,10,'#c0a830'); p(-6,-18,12,2,'#e0c840'); p(-8,-20,16,2,'#e0c840');
      p(-2,-18,4,4,'#ffe8aa'); p(-2,-16,2,6,'#ffe8aa'); p(-2,-16,5,2,'#ffe8aa');
      p(-4,-8,8,14,'#c0a830'); p(-4,-8,8,3,'#e0c840');
      p(-6,-8,2,14,'#a08820'); p(-4,6,4,3,'#3a3010'); p(2,6,4,3,'#3a3010');
      p(-13,-14,7,16,'#c0a830'); p(-12,-8,5,5,'#ffe8aa');
      p(7,-20,2,26,'#e0d080'); p(6,-7,6,2,'#a08820');
    }},
    iconDruid: { draw(p) {
      p(-5,-20,10,5,'#3a5a1e'); p(-5,-15,10,2,'#88cc44');
      for(let i=0;i<5;i++) p(-6+i*3,-22,2,5,['#66cc22','#88dd44','#44aa00','#66cc22','#aabb44'][i]);
      p(-4,-14,8,6,'#d4a870'); p(-2,-13,2,2,'#1a3a10'); p(2,-13,2,2,'#1a3a10');
      p(-6,-8,12,14,'#3a5a1e'); p(-7,-4,14,8,'#3a5a1e'); p(-6,-4,12,2,'#88cc44');
      p(-4,6,3,5,'#2a4a1a'); p(1,6,3,5,'#2a4a1a');
      p(5,-22,2,28,'#6a4a2a'); p(4,-24,4,6,'#7a9a3a');
    }},
    iconVampire: { draw(p) {
      p(-5,-18,10,4,'#1a0820'); p(-5,-14,10,2,'#2a1030');
      p(-4,-14,8,6,'#e8d8f0'); p(-2,-13,2,2,'#cc1122'); p(2,-13,2,2,'#cc1122'); p(-1,-11,1,2,'#fff'); p(2,-11,1,2,'#fff');
      p(-6,-8,12,14,'#1a0820'); p(-8,-4,3,10,'#aa1020'); p(6,-4,3,10,'#aa1020'); p(-8,-5,16,2,'#cc1830');
      p(-4,6,3,5,'#1a1020'); p(1,6,3,5,'#1a1020');
    }},
    iconFrostmage: { draw(p) {
      p(-1,-22,2,2,'#88ddff'); p(-3,-20,6,2,'#88ddff'); p(-5,-18,10,2,'#4488cc');
      p(-4,-16,8,6,'#d8f0ff'); p(-6,-10,12,14,'#1a3060'); p(-6,-4,12,2,'#88ddff');
      p(-4,4,3,5,'#1a3050'); p(1,4,3,5,'#1a3050');
      p(6,-18,2,18,'#7ab8d8'); p(5,-20,4,3,'#88ddff'); p(6,-21,2,1,'#ffffff');
    }},
    iconStormcaller: { draw(p) {
      p(-6,-18,12,4,'#2a3848'); p(-7,-16,14,3,'#1a2838'); p(-5,-20,10,2,'#aaeeff');
      p(-4,-14,8,6,'#c8d8e8'); p(-2,-13,2,2,'#aaeeff'); p(2,-13,2,2,'#aaeeff');
      p(-6,-8,12,14,'#2a3848'); p(-7,-4,14,8,'#2a3848'); p(-6,-4,12,2,'#aaeeff');
      p(-4,6,3,5,'#2a3040'); p(1,6,3,5,'#2a3040');
      p(6,-18,2,18,'#6a7a8a'); p(5,-20,4,3,'#aaeeff'); p(6,-21,2,1,'#ffffff');
    }},
    iconRuneknight: { draw(p) {
      p(-6,-18,12,10,'#3a2860'); p(-6,-18,12,2,'#5a3888'); p(-8,-20,16,2,'#5a3888');
      p(-2,-18,4,4,'#cc44ff'); p(-2,-16,2,6,'#cc44ff'); p(-2,-16,6,2,'#cc44ff');
      p(-4,-8,8,14,'#3a2860'); p(-4,-8,8,3,'#5a3888');
      p(-6,-8,2,14,'#2a1a48'); p(-4,6,4,3,'#1a1030'); p(2,6,4,3,'#1a1030');
      p(-13,-14,7,16,'#3a2860'); p(-11,-8,5,5,'#cc44ff');
      p(7,-20,2,26,'#8848cc'); p(6,-7,6,2,'#5a3888');
    }},
    iconIllusionist: { draw(p) {
      p(-3,-22,6,4,'#2e1248'); p(-4,-22,8,2,'#aa33ff'); p(-1,-24,2,2,'#ee88ff');
      p(-4,-16,8,6,'#f0d8f8'); p(-2,-15,2,2,'#cc44ff'); p(2,-15,2,2,'#cc44ff');
      p(-6,-10,12,14,'#2e1248'); p(-7,-6,14,8,'#2e1248'); p(-6,-6,12,2,'#ee88ff');
      p(-3,-5,2,8,'#aa33ff'); p(2,-5,2,8,'#aa33ff');
      p(-4,4,3,5,'#1e1030'); p(1,4,3,5,'#1e1030');
      p(6,-10,2,14,'#9933cc'); p(5,-12,4,3,'#ee88ff');
    }},
  };
  for (const [id, def] of Object.entries(defs)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const ic = document.createElement('canvas');
    ic.width = 28; ic.height = 32;
    ic.style.cssText = 'width:56px;height:64px;image-rendering:pixelated';
    const c2 = ic.getContext('2d');
    c2.imageSmoothingEnabled = false;
    const cx = 14, cy = 20;
    function p(x, y, w, h, col) { c2.fillStyle = col; c2.fillRect(Math.round(cx+x/2), Math.round(cy+y/2), Math.max(1,Math.round(w/2)), Math.max(1,Math.round(h/2))); }
    def.draw(p, c2);
    el.appendChild(ic);
  }
})();
