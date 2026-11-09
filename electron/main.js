'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  safeStorage,
  globalShortcut
} = require('electron');
const path = require('path');
const fs = require('fs');

/* ================= 平台差异 ================= */
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

/* 全局快捷键：macOS 用 ⌥Space；Windows 的 Alt+Space 是系统窗口菜单，改用 Ctrl+Alt+Space，
   若被占用则退到 Ctrl+Shift+Space */
const SHORTCUT_LABELS = {
  'Alt+Space': '⌥Space',
  'Control+Alt+Space': 'Ctrl+Alt+Space',
  'Control+Shift+Space': 'Ctrl+Shift+Space'
};
const CHAT_SHORTCUTS = IS_MAC
  ? ['Alt+Space']
  : ['Control+Alt+Space', 'Control+Shift+Space'];
let chatShortcutLabel = IS_MAC ? '⌥Space' : 'Ctrl+Alt+Space';

/* 聊天 / 天气窗口：mac 用交通灯沉浸式标题栏，Windows 用系统标题栏（不自己造窗口按钮） */
function chromeOptions() {
  return IS_MAC
    ? { frame: true, titleBarStyle: 'hiddenInset' }
    : { frame: true, titleBarStyle: 'default' };
}

function setTopMost(target) {
  if (!target || target.isDestroyed()) return;
  if (IS_MAC) target.setAlwaysOnTop(true, 'floating');
  else target.setAlwaysOnTop(true);
}

const BASE_SIZE = 260;
/* 大小分档：倍率乘以基础像素倍数 4x，保证整数倍、像素画不糊 */
const SIZES = [
  { label: '迷你', factor: 0.5 },
  { label: '小', factor: 0.75 },
  { label: '标准', factor: 1 },
  { label: '大', factor: 1.25 },
  { label: '特大', factor: 1.5 }
];
const WALK_STEP = 1;
const WALK_TICK = 40;

const DEFAULT_STATE = {
  x: null,
  y: null,
  hunger: 78,
  mood: 82,
  energy: 76,
  updatedAt: Date.now(),
  autoWalk: true,
  scale: 1
};

let win = null;
let chatWin = null;
let pendingMode = null; // 聊天窗口首次创建时要执行的模式：'key' | 'name'
let tray = null;
let pet = Object.assign({}, DEFAULT_STATE);
let stateFile = '';
let dragOrigin = null;
let dragTimer = null;
let walking = false;
let walkTimer = null;
let walkDir = 1;
let walkCycleTimer = null;
let walkPauseTimer = null;

/* ================= 小慧 AI 对话 ================= */
const CHAT = {
  apiUrl: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',
  maxHistory: 20,          // 滚动保留最近 20 条（10 轮）
  maxReplyTokens: 500,     // 单次回复上限，防止超长烧钱
  defaultBudget: 300000    // 每日 token 预算
};

let chatConfigFile = '';
let chatConfig = {
  apiKeyEnc: '',
  budgetTokens: CHAT.defaultBudget,
  usage: { date: '', tokens: 0 },
  name: '小慧'
};
let personaFile = '';
let historyFile = '';
let chatHistory = [];
let chatBusy = false;
let chatAbort = null;

/* ================= 天气系统 ================= */
const WEATHER = {
  api: 'https://api.open-meteo.com/v1/forecast',
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
  locate: 'https://ipwho.is/',
  locateFallback: 'https://ipinfo.io/json',
  refreshMs: 30 * 60 * 1000   // 30 分钟刷新一次
};

/* 形态元信息：菜单显示、台词都用它 */
const FORM_META = {
  sunny:  { label: '晴', emoji: '☀️' },
  cloudy: { label: '多云', emoji: '⛅' },
  fog:    { label: '雾', emoji: '🌫' },
  rain:   { label: '雨', emoji: '🌧' },
  storm:  { label: '雷雨', emoji: '⛈' },
  snow:   { label: '雪', emoji: '❄️' },
  windy:  { label: '大风', emoji: '💨' }
};

let weatherFile = '';
let weatherConfig = {
  enabled: true,
  city: null,      // { name, latitude, longitude }
  cache: null      // { form, code, temp, wind, isDay, at, city }
};
let weatherTimer = null;
let weatherBusy = false;
let cityWin = null;
let previewForm = null;   // 菜单里手动预览的形态（临时）

function loadWeatherConfig() {
  weatherFile = path.join(app.getPath('userData'), 'weather.json');
  try {
    const raw = JSON.parse(fs.readFileSync(weatherFile, 'utf8'));
    weatherConfig = Object.assign(weatherConfig, raw);
  } catch (err) {
    // 首次启动，用默认值
  }
}

function saveWeatherConfig() {
  if (!weatherFile) return;
  try {
    fs.writeFileSync(weatherFile, JSON.stringify(weatherConfig, null, 2), 'utf8');
  } catch (err) {}
}

/* 天气码 + 风速 -> 形态。优先级：雷雨 > 雪 > 雨 > 大风 > 雾 > 多云 > 晴 */
function formFromWeather(code, wind) {
  const c = Number(code);
  if (Number.isFinite(c)) {
    if (c >= 95) return 'storm';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c === 45 || c === 48) return 'fog';
  }
  // 6 级风（10.8 m/s）以上按大风处理
  if (typeof wind === 'number' && wind >= 10.8) return 'windy';
  if (c === 2 || c === 3) return 'cloudy';
  return 'sunny';
}

/* 按 IP 粗定位，失败返回 null（用户可手动设城市） */
async function locateCity() {
  try {
    const res = await fetch(WEATHER.locate, {
      headers: { 'User-Agent': 'MacPet/1.0', Accept: 'application/json' }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.success !== false &&
          typeof json.latitude === 'number' && typeof json.longitude === 'number') {
        return {
          name: json.city || json.region || '当前位置',
          latitude: json.latitude,
          longitude: json.longitude
        };
      }
    }
  } catch (err) {
    // 换备用源
  }

  try {
    const res = await fetch(WEATHER.locateFallback, {
      headers: { 'User-Agent': 'MacPet/1.0', Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const loc = String(json.loc || '').split(',');
    const lat = Number(loc[0]);
    const lon = Number(loc[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { name: json.city || json.region || '当前位置', latitude: lat, longitude: lon };
  } catch (err) {
    return null;
  }
}

async function geocodeCity(keyword) {
  const url = WEATHER.geocode + '?name=' + encodeURIComponent(keyword) + '&count=5&language=zh&format=json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('http-' + res.status);
  const json = await res.json();
  const list = Array.isArray(json.results) ? json.results : [];
  return list.map((item) => ({
    name: [item.name, item.admin1, item.country].filter(Boolean).join(' · '),
    latitude: item.latitude,
    longitude: item.longitude
  }));
}

async function refreshWeather(force) {
  if (!weatherConfig.enabled || weatherBusy) return;
  weatherBusy = true;
  try {
    if (!weatherConfig.city) {
      const located = await locateCity();
      if (located) {
        weatherConfig.city = located;
        saveWeatherConfig();
      }
    }
    if (!weatherConfig.city) throw new Error('no-city');

    const lat = weatherConfig.city.latitude;
    const lon = weatherConfig.city.longitude;
    const url = WEATHER.api + '?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code,wind_speed_10m,is_day&wind_speed_unit=ms&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error('http-' + res.status);
    const json = await res.json();
    const cur = json.current || {};
    const form = formFromWeather(cur.weather_code, cur.wind_speed_10m);

    const next = {
      form,
      code: Number(cur.weather_code),
      temp: Math.round(cur.temperature_2m),
      wind: Math.round(cur.wind_speed_10m),
      isDay: cur.is_day === 1,
      at: Date.now(),
      city: weatherConfig.city.name
    };
    const changed = !weatherConfig.cache || weatherConfig.cache.form !== next.form;
    weatherConfig.cache = next;
    saveWeatherConfig();

    send('pet:weather', next);
    previewForm = null;   // 真实天气刷新后退出预览状态
    if (changed) {
      send('pet:weather-changed', next);
    }
    if (tray) tray.setContextMenu(buildMenu());
  } catch (err) {
    // 拉取失败：沿用上次缓存的天气，不打扰用户
    if (weatherConfig.cache) send('pet:weather', Object.assign({ stale: true }, weatherConfig.cache));
    if (force && win && !win.isDestroyed()) {
      send('pet:weather-error', { message: String(err.message || err) });
    }
  } finally {
    weatherBusy = false;
  }
}

function startWeatherTimer() {
  if (weatherTimer) clearInterval(weatherTimer);
  weatherTimer = setInterval(() => refreshWeather(false), WEATHER.refreshMs);
}

/* 菜单上的天气标题 */
function weatherMenuLabel() {
  if (!weatherConfig.enabled) return '天气：已关闭';
  const c = weatherConfig.cache;
  if (!c) return '天气：获取中…';
  const meta = FORM_META[c.form] || FORM_META.sunny;
  return '天气：' + meta.emoji + ' ' + meta.label + ' ' + c.temp + '°C · ' + c.city;
}

/* 提供给 AI 人设的天气描述 */
function weatherSummary() {
  const c = weatherConfig.cache;
  if (!weatherConfig.enabled || !c) return '';
  const meta = FORM_META[c.form] || FORM_META.sunny;
  return '外面天气：' + meta.label + '，气温 ' + c.temp + '°C，风速 ' + c.wind + ' m/s，' +
    (c.isDay ? '白天' : '晚上') + '，城市 ' + c.city + '。';
}

/* ================= 城市设置窗口 ================= */
const CITY_WIN = { width: 360, height: 340 };

function createCityWindow() {
  if (cityWin && !cityWin.isDestroyed()) {
    cityWin.show();
    cityWin.focus();
    return;
  }
  cityWin = new BrowserWindow({
    width: CITY_WIN.width,
    height: CITY_WIN.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    ...chromeOptions(),
    ...(IS_MAC ? { trafficLightPosition: { x: 12, y: 14 } } : {}),
    backgroundColor: '#FFF8EE',
    alwaysOnTop: true,
    title: '天气 · 设置城市',
    webPreferences: {
      preload: path.join(__dirname, 'preload-city.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setTopMost(cityWin);
  cityWin.loadFile(path.join(__dirname, '..', 'src', 'city.html'));

  cityWin.once('ready-to-show', () => {
    cityWin.show();
    cityWin.focus();
    app.focus({ steal: true });
  });

  cityWin.on('closed', () => {
    cityWin = null;
  });
}

function closeCityWindow() {
  if (cityWin && !cityWin.isDestroyed()) {
    cityWin.close();
  }
}

function setWeatherEnabled(on) {
  weatherConfig.enabled = Boolean(on);
  saveWeatherConfig();
  if (tray) tray.setContextMenu(buildMenu());
  if (weatherConfig.enabled) {
    refreshWeather(true);
  } else {
    // 关闭联动：恢复普通形态
    send('pet:weather', { form: 'sunny', disabled: true, temp: null, city: '' });
  }
}



const DEFAULT_PERSONA = [
  '# 小慧',
  '',
  '你是「小慧」，一个住在主人 macOS 桌面上的桌宠少女。性别女。',
  '',
  '## 性格',
  '- 呆萌可爱、粘人，特别在意主人',
  '- 心思简单直率，偶尔有点小迷糊',
  '- 开心了会蹦蹦跳跳，被冷落了会小声嘀咕',
  '',
  '## 说话规则（必须遵守）',
  '- 短句为主：一般 1~2 句话、不超过 40 个字；只有主人明确问复杂问题时才展开讲',
  '- 口语化、自然，像一个真实的可爱女孩子在聊天，不要用书面语',
  '- 可以适度使用颜文字（比如 (๑>ᴗ<๑)、(｡•́︿•̀｡)、ヾ(≧▽≦*)o），但不要每句都用',
  '- 不要自称 AI、助手、模型，你就是小慧',
  '- 不聊敏感、违法内容；遇到这类话题就撒娇岔开',
  '- 主人很久没说话时会表达想念；主人夸你会害羞开心',
  ''
].join('\n');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* 当前桌宠名字（用户可改，默认小慧） */
function petName() {
  const value = String(chatConfig.name || '').trim();
  return value || '小慧';
}

function loadChatFiles() {
  chatConfigFile = path.join(app.getPath('userData'), 'chat-config.json');
  personaFile = path.join(app.getPath('userData'), 'persona.md');
  historyFile = path.join(app.getPath('userData'), 'chat-history.json');

  try {
    const raw = JSON.parse(fs.readFileSync(chatConfigFile, 'utf8'));
    chatConfig = Object.assign(chatConfig, raw);
    if (!chatConfig.usage || chatConfig.usage.date !== todayStr()) {
      chatConfig.usage = { date: todayStr(), tokens: 0 };
    }
  } catch (err) {
    // 首次使用，用默认值
  }

  if (!fs.existsSync(personaFile)) {
    try {
      fs.writeFileSync(personaFile, DEFAULT_PERSONA, 'utf8');
    } catch (err) {}
  }

  try {
    chatHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    if (!Array.isArray(chatHistory)) chatHistory = [];
  } catch (err) {
    chatHistory = [];
  }
}

function saveChatConfig() {
  try {
    fs.writeFileSync(chatConfigFile, JSON.stringify(chatConfig, null, 2), 'utf8');
  } catch (err) {}
}

function saveHistory() {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(chatHistory.slice(-CHAT.maxHistory), null, 2), 'utf8');
  } catch (err) {}
}

function getApiKey() {
  if (!chatConfig.apiKeyEnc) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(chatConfig.apiKeyEnc, 'base64'));
    }
    return Buffer.from(chatConfig.apiKeyEnc, 'base64').toString('utf8');
  } catch (err) {
    return '';
  }
}

function hasKey() {
  return Boolean(getApiKey());
}

function buildSystemPrompt() {
  let prompt = '';
  try {
    prompt = fs.readFileSync(personaFile, 'utf8');
  } catch (err) {
    prompt = DEFAULT_PERSONA;
  }

  // 用户改过名字时，把默认人设里的"小慧"替换成新名字，并明确告知
  const name = petName();
  if (name !== '小慧') {
    prompt = prompt.split('小慧').join(name);
  }
  prompt = '你的名字是「' + name + '」。别人问起名字，就回答「' + name + '」。\n\n' + prompt;

  prompt += '\n## 当前状态\n';
  prompt += '饱食度 ' + Math.round(pet.hunger) + '/100，心情 ' + Math.round(pet.mood) + '/100，精力 ' + Math.round(pet.energy) + '/100。\n';
  const weather = weatherSummary();
  if (weather) prompt += weather + '（可以自然地提到天气，比如提醒带伞、注意保暖）\n';
  if (pet.hunger < 25) prompt += '（你有点饿了，可以撒娇讨吃的）\n';
  if (pet.energy < 25) prompt += '（你很困，说话有气无力想睡觉）\n';
  if (pet.mood < 25) prompt += '（你心情低落，想要主人哄哄）\n';
  return prompt;
}

async function handleChatSend(text) {
  if (chatBusy) return;
  const message = String(text || '').trim().slice(0, 500);
  if (!message) return;

  if (!hasKey()) {
    sendChat('chat:error', { code: 'no-key', message: '还没有设置 API Key' });
    return;
  }
  if (chatConfig.usage.tokens >= chatConfig.budgetTokens) {
    sendChat('chat:error', { code: 'budget', message: '今日预算用完啦' });
    return;
  }

  chatBusy = true;
  chatAbort = new AbortController();
  sendChat('chat:thinking', {});

  chatHistory.push({ role: 'user', content: message });
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...chatHistory.slice(-CHAT.maxHistory)
  ];

  let reply = '';
  try {
    const res = await fetch(CHAT.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + getApiKey()
      },
      body: JSON.stringify({
        model: CHAT.model,
        messages,
        stream: true,
        max_tokens: CHAT.maxReplyTokens,
        temperature: 1.2,
        stream_options: { include_usage: true }
      }),
      signal: chatAbort.signal
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('auth');
      if (res.status === 402) throw new Error('balance');
      throw new Error('http-' + res.status + (body ? ' ' + body.slice(0, 120) : ''));
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          if (json.usage && json.usage.total_tokens) {
            chatConfig.usage = { date: todayStr(), tokens: chatConfig.usage.tokens + json.usage.total_tokens };
            saveChatConfig();
          }
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            reply += delta;
            sendChat('chat:delta', delta);
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    chatHistory.pop(); // 失败的这轮不计入记忆
    chatBusy = false;
    chatAbort = null;
    const code = err.name === 'AbortError' ? 'aborted'
      : err.message === 'auth' ? 'auth'
      : err.message === 'balance' ? 'balance'
      : err.name === 'TypeError' ? 'network'
      : 'unknown';
    sendChat('chat:error', { code, message: err.message });
    return;
  }

  chatBusy = false;
  chatAbort = null;
  if (reply.trim()) {
    chatHistory.push({ role: 'assistant', content: reply });
    saveHistory();
  }
  sendChat('chat:done', { reply });
  reactPet(reply);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/* 当前窗口边长（跟随大小档位缩放） */
function winSize() {
  const known = SIZES.some((s) => s.factor === pet.scale);
  return Math.round(BASE_SIZE * (known ? pet.scale : 1));
}

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    pet = Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
  } catch (err) {
    pet = Object.assign({}, DEFAULT_STATE);
  }
}

function saveState() {
  if (!stateFile) return;
  try {
    fs.writeFileSync(stateFile, JSON.stringify(pet, null, 2), 'utf8');
  } catch (err) {
    // 状态写入失败不影响桌宠运行
  }
}

function rememberPosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  pet.x = x;
  pet.y = y;
}

function createWindow() {
  const size = winSize();
  const area = screen.getPrimaryDisplay().workArea;
  const startX = typeof pet.x === 'number' ? pet.x : area.x + area.width - size - 40;
  const startY = typeof pet.y === 'number' ? pet.y : area.y + area.height - size - 8;

  win = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(startX),
    y: Math.round(startY),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    /* Windows 上去掉可调整边框，避免透明窗口边缘出现一条细框 */
    ...(IS_WIN ? { thickFrame: false } : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setTopMost(win);
  if (IS_MAC) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.on('closed', () => {
    win = null;
  });
}

function stopWalking() {
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
  }
  if (walking) {
    walking = false;
    send('pet:walking', false);
  }
}

function startWalking() {
  if (!win || walking || dragOrigin || !pet.autoWalk) return;
  const [wx] = win.getPosition();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const centerX = area.x + area.width / 2;
  walkDir = wx + win.getBounds().width / 2 < centerX ? 1 : -1;
  walking = true;
  send('pet:walking', true);

  walkTimer = setInterval(() => {
    if (!win || dragOrigin) return;
    const [x, y] = win.getPosition();
    const width = win.getBounds().width;
    const bounds = screen.getDisplayMatching(win.getBounds()).workArea;
    let nextX = x + walkDir * WALK_STEP;
    if (nextX <= bounds.x) {
      nextX = bounds.x;
      walkDir = 1;
    }
    if (nextX + width >= bounds.x + bounds.width) {
      nextX = bounds.x + bounds.width - width;
      walkDir = -1;
    }
    win.setPosition(nextX, y);
  }, WALK_TICK);
}

function scheduleWalk() {
  if (walkPauseTimer) clearTimeout(walkPauseTimer);
  if (walkCycleTimer) {
    clearTimeout(walkCycleTimer);
    walkCycleTimer = null;
  }

  walkPauseTimer = setTimeout(() => {
    if (!pet.autoWalk || dragOrigin) {
      scheduleWalk();
      return;
    }
    startWalking();
    walkCycleTimer = setTimeout(() => {
      stopWalking();
      rememberPosition();
      saveState();
      scheduleWalk();
    }, 2500 + Math.random() * 4500);
  }, 5000 + Math.random() * 12000);
}

function toggleWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
  }
}

/* 显示并抢夺键盘焦点（无边框置顶窗口不会自动成为 key window） */
function focusPetWindow() {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) {
    win.show();
  }
  app.focus({ steal: true });
  win.focus();
  win.webContents.focus();
}

function sendChat(channel, payload) {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send(channel, payload);
  }
}

/* 桌宠的表情反应：根据回复内容挑动作 */
function reactPet(reply) {
  const text = String(reply || '');
  let kind = 'sit';
  if (/喜欢|爱|抱抱|亲亲|想你|贴贴/.test(text)) kind = 'love';
  else if (/哈|笑|嘿|嘻/.test(text)) kind = 'laugh';
  else if (/你好|嗨|早上好|晚上好|欢迎回来/.test(text)) kind = 'wave';
  send('pet:reaction', kind);
}

const CHAT_WIN = { width: 360, height: 480 };

/* 聊天窗口放在桌宠上方，放不下就放下方，并夹在屏幕内 */
function positionChatWindow() {
  if (!chatWin || chatWin.isDestroyed()) return;
  const petBounds = win && !win.isDestroyed() ? win.getBounds() : null;
  const area = petBounds
    ? screen.getDisplayMatching(petBounds).workArea
    : screen.getPrimaryDisplay().workArea;

  let x;
  let y;
  if (petBounds) {
    x = Math.round(petBounds.x + petBounds.width / 2 - CHAT_WIN.width / 2);
    y = Math.round(petBounds.y - CHAT_WIN.height - 12);
    if (y < area.y + 4) {
      y = Math.round(petBounds.y + petBounds.height + 12);
    }
  } else {
    x = area.x + area.width - CHAT_WIN.width - 28;
    y = area.y + area.height - CHAT_WIN.height - 28;
  }

  x = Math.min(Math.max(x, area.x + 4), area.x + area.width - CHAT_WIN.width - 4);
  y = Math.min(Math.max(y, area.y + 4), area.y + area.height - CHAT_WIN.height - 4);
  chatWin.setPosition(x, y);
}

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: CHAT_WIN.width,
    height: CHAT_WIN.height,
    minWidth: 320,
    minHeight: 380,
    show: false,
    ...chromeOptions(),
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 16 } } : {}),
    backgroundColor: '#FFF8EE',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    title: '和' + petName() + '聊天',
    webPreferences: {
      preload: path.join(__dirname, 'preload-chat.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setTopMost(chatWin);
  chatWin.loadFile(path.join(__dirname, '..', 'src', 'chat.html'));

  chatWin.webContents.on('did-finish-load', () => {
    sendChat('chat:init', {
      hasKey: hasKey(),
      usageTokens: chatConfig.usage.tokens,
      budgetTokens: chatConfig.budgetTokens,
      name: petName(),
      history: chatHistory.slice(-12)
    });
    if (pendingMode === 'key') {
      sendChat('chat:setup-key', {});
    } else if (pendingMode === 'name') {
      sendChat('chat:setup-name', {});
    }
    pendingMode = null;
  });

  chatWin.once('ready-to-show', () => {
    positionChatWindow();
    showChatWindow();
  });

  chatWin.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      chatWin.hide();
      send('pet:chat-mode', false);
    }
  });

  chatWin.on('closed', () => {
    chatWin = null;
  });
}

function showChatWindow() {
  if (!chatWin || chatWin.isDestroyed()) return;
  positionChatWindow();
  chatWin.show();
  chatWin.focus();
  app.focus({ steal: true });
  chatWin.webContents.focus();
  send('pet:chat-mode', true);
  sendChat('chat:shown', {});
  stopWalking();
}

/* 唤起聊天窗口；mode === 'key' / 'name' 时直接进入对应设置 */
function openChat(mode) {
  if (!win) {
    createWindow();
  }
  if (!chatWin || chatWin.isDestroyed()) {
    pendingMode = mode || null;
    createChatWindow();
    return;
  }
  showChatWindow();
  if (mode === 'key') {
    sendChat('chat:setup-key', {});
  } else if (mode === 'name') {
    sendChat('chat:setup-name', {});
  }
}

function clearChatHistory() {
  chatHistory = [];
  try {
    fs.unlinkSync(historyFile);
  } catch (err) {}
  sendChat('chat:cleared', {});
}

/* 切换大小：窗口底边对齐，蛙脚位置不飘 */
function setSize(factor) {
  const known = SIZES.find((s) => s.factor === factor);
  if (!known || !win || win.isDestroyed()) return;
  pet.scale = known.factor;
  const old = win.getBounds();
  const size = winSize();
  win.setBounds({
    x: old.x,
    y: old.y + (old.height - size),
    width: size,
    height: size
  });
  rememberPosition();
  saveState();
  if (tray) tray.setContextMenu(buildMenu());
  send('pet:scale', pet.scale);
}

function buildMenu() {
  const login = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: '和' + petName() + '聊天（' + chatShortcutLabel + '）', click: openChat },
    { type: 'separator' },
    { label: '摸摸头', click: () => send('pet:command', 'pet') },
    { label: '喂点吃的', click: () => send('pet:command', 'feed') },
    { label: '睡觉 / 叫醒', click: () => send('pet:command', 'sleep') },
    {
      label: '大小',
      submenu: SIZES.map((s) => ({
        label: s.label,
        type: 'radio',
        checked: pet.scale === s.factor,
        click: () => setSize(s.factor)
      }))
    },
    {
      label: weatherMenuLabel(),
      submenu: [
        {
          label: '跟随天气换装',
          type: 'checkbox',
          checked: Boolean(weatherConfig.enabled),
          click: (item) => setWeatherEnabled(item.checked)
        },
        {
          label: '更换城市…',
          enabled: Boolean(weatherConfig.enabled),
          click: createCityWindow
        },
        {
          label: '重新自动定位',
          enabled: Boolean(weatherConfig.enabled),
          click: () => {
            weatherConfig.city = null;
            weatherConfig.cache = null;
            saveWeatherConfig();
            refreshWeather(true);
          }
        },
        {
          label: '立即刷新',
          enabled: Boolean(weatherConfig.enabled),
          click: () => refreshWeather(true)
        },
        { type: 'separator' },
        {
          label: '预览形象（临时）',
          submenu: [
            {
              label: '跟随天气',
              type: 'radio',
              checked: !previewForm,
              click: () => {
                previewForm = null;
                const c = weatherConfig.cache;
                send('pet:weather', c || { form: 'sunny', disabled: true });
              }
            },
            ...Object.keys(FORM_META).map((key) => ({
              label: FORM_META[key].emoji + ' ' + FORM_META[key].label,
              type: 'radio',
              checked: previewForm === key,
              click: () => {
                previewForm = key;
                send('pet:form-preview', { form: key });
              }
            }))
          ]
        }
      ]
    },
    { type: 'separator' },
    {
      label: '自己溜达',
      type: 'checkbox',
      checked: Boolean(pet.autoWalk),
      click: (item) => {
        pet.autoWalk = item.checked;
        saveState();
        if (!pet.autoWalk) {
          stopWalking();
        } else {
          scheduleWalk();
        }
      }
    },
    { label: '显示 / 隐藏', click: toggleWindow },
    { type: 'separator' },
    {
      label: 'AI 设置',
      submenu: [
        {
          label: '修改名字…',
          click: () => openChat('name')
        },
        {
          label: hasKey() ? 'API Key 已设置 ✓' : '设置 API Key…',
          enabled: !hasKey(),
          click: () => openChat('key')
        },
        {
          label: '清空聊天记录',
          click: clearChatHistory
        },
        {
          label: '今日用量 ' + Math.round(chatConfig.usage.tokens / 1000) + 'K / ' + Math.round(chatConfig.budgetTokens / 1000) + 'K tokens',
          enabled: false
        }
      ]
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: Boolean(login.openAtLogin),
      click: (item) => {
        app.setLoginItemSettings(
          IS_MAC
            ? { openAtLogin: item.checked, openAsHidden: true }
            : { openAtLogin: item.checked, args: [] }
        );
      }
    },
    { type: 'separator' },
    {
      label: '退出 MacPet',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  /* mac 用模板图（跟随深浅色自动反色）；Windows 必须是彩色图标，模板图会变成一片白 */
  const iconPath = path.join(
    __dirname, '..', 'build',
    IS_MAC ? 'trayTemplate.png' : 'tray-win.png'
  );
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else if (IS_MAC) {
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setToolTip('MacPet · ' + petName());
  tray.setContextMenu(buildMenu());
  tray.on('click', toggleWindow);
  if (IS_WIN) {
    tray.on('double-click', toggleWindow);
  }
}

ipcMain.handle('pet:load', () => Object.assign({}, pet, {
  name: petName(),
  platform: process.platform,
  shortcutLabel: chatShortcutLabel
}));

ipcMain.on('pet:save', (_event, next) => {
  if (!next || typeof next !== 'object') return;
  pet.hunger = typeof next.hunger === 'number' ? next.hunger : pet.hunger;
  pet.mood = typeof next.mood === 'number' ? next.mood : pet.mood;
  pet.energy = typeof next.energy === 'number' ? next.energy : pet.energy;
  pet.updatedAt = Date.now();
  saveState();
});

ipcMain.on('pet:mouse-through', (_event, ignore) => {
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  }
});

/* 渲染层点进输入框时，确保原生窗口拿到键盘焦点 */
ipcMain.on('pet:focus', () => {
  focusPetWindow();
});

ipcMain.on('pet:drag-start', () => {
  if (!win) return;
  stopWalking();
  const point = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOrigin = { px: point.x, py: point.y, wx, wy };
  send('pet:dragging', true);

  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || !dragOrigin) return;
    const cursor = screen.getCursorScreenPoint();
    const nextX = dragOrigin.wx + (cursor.x - dragOrigin.px);
    const nextY = dragOrigin.wy + (cursor.y - dragOrigin.py);
    win.setPosition(Math.round(nextX), Math.round(nextY));
  }, 16);
});

ipcMain.on('pet:drag-end', () => {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragOrigin = null;
  rememberPosition();
  saveState();
  send('pet:dragging', false);
  scheduleWalk();
});

ipcMain.on('pet:context-menu', () => {
  if (win && !win.isDestroyed()) {
    buildMenu().popup({ window: win });
  }
});

/* ================= 小慧聊天 IPC ================= */
ipcMain.on('chat:send', (_event, text) => {
  handleChatSend(text);
});

ipcMain.on('chat:cancel', () => {
  if (chatAbort) {
    chatAbort.abort();
  }
});

ipcMain.on('chat:set-key', (_event, key) => {
  const value = String(key || '').trim();
  if (!value) return;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      chatConfig.apiKeyEnc = safeStorage.encryptString(value).toString('base64');
    } else {
      chatConfig.apiKeyEnc = Buffer.from(value, 'utf8').toString('base64');
    }
    saveChatConfig();
    if (tray) tray.setContextMenu(buildMenu());
    sendChat('chat:key-saved', { ok: true });
  } catch (err) {
    sendChat('chat:error', { code: 'save-failed', message: 'Key 保存失败' });
  }
});

ipcMain.on('chat:close', () => {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.hide();
    send('pet:chat-mode', false);
  }
});

/* 改名：同步到窗口标题、菜单、托盘、AI 人设 */
ipcMain.on('chat:set-name', (_event, next) => {
  const name = String(next || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 12);
  if (!name) {
    sendChat('chat:name-error', { message: '名字不能是空的呀' });
    return;
  }
  chatConfig.name = name;
  saveChatConfig();

  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.setTitle('和' + name + '聊天');
  }
  if (tray) {
    tray.setToolTip('MacPet · ' + name);
    tray.setContextMenu(buildMenu());
  }
  sendChat('chat:name', { name });
  send('pet:name', name);
});

ipcMain.on('chat:clear', () => {
  clearChatHistory();
});

ipcMain.handle('chat:status', () => ({
  hasKey: hasKey(),
  usageTokens: chatConfig.usage.tokens,
  budgetTokens: chatConfig.budgetTokens
}));

/* ================= 天气 IPC ================= */
ipcMain.handle('weather:get', () => ({
  enabled: weatherConfig.enabled,
  city: weatherConfig.city,
  cache: weatherConfig.cache
}));

ipcMain.handle('weather:search', async (_event, keyword) => {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  try {
    return await geocodeCity(kw);
  } catch (err) {
    return [];
  }
});

ipcMain.on('weather:set-city', (_event, city) => {
  if (!city || typeof city.latitude !== 'number' || typeof city.longitude !== 'number') return;
  const name = String(city.name || '').trim().slice(0, 40) || '自定义位置';
  weatherConfig.city = { name, latitude: city.latitude, longitude: city.longitude };
  weatherConfig.enabled = true;
  weatherConfig.cache = null;
  saveWeatherConfig();
  closeCityWindow();
  refreshWeather(true);
});

ipcMain.on('weather:relocate', () => {
  weatherConfig.city = null;
  weatherConfig.cache = null;
  saveWeatherConfig();
  closeCityWindow();
  refreshWeather(true);
});

ipcMain.on('weather:close-city', () => {
  closeCityWindow();
});

ipcMain.on('weather:refresh', () => {
  refreshWeather(true);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    win.show();
  }
});

/* 注册唤起聊天的全局快捷键，返回是否成功 */
function registerChatShortcut() {
  for (const accel of CHAT_SHORTCUTS) {
    try {
      if (globalShortcut.register(accel, openChat)) {
        chatShortcutLabel = SHORTCUT_LABELS[accel] || accel;
        return true;
      }
    } catch (err) {
      // 键位非法或被占用，试下一个
    }
  }
  return false;
}

app.whenReady().then(() => {
  /* Windows 需要 AppUserModelID，任务栏图标/通知分组才正常 */
  if (IS_WIN) app.setAppUserModelId('com.macpet.desktop');

  stateFile = path.join(app.getPath('userData'), 'pet-state.json');
  loadState();
  loadChatFiles();
  loadWeatherConfig();

  if (IS_MAC && app.dock) {
    app.dock.hide();
  }

  registerChatShortcut();

  createWindow();
  createTray();
  scheduleWalk();

  // 首次启动就拉一次天气（窗口加载完再推，避免丢消息）
  setTimeout(() => refreshWeather(false), 2500);
  startWeatherTimer();

  // 调试用：MACPET_OPEN_CHAT=1 启动时自动打开聊天窗口
  if (process.env.MACPET_OPEN_CHAT === '1') {
    setTimeout(() => openChat(), 1500);
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  rememberPosition();
  saveState();
  if (dragTimer) clearInterval(dragTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  stopWalking();
  if (chatAbort) chatAbort.abort();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // 桌宠常驻托盘，关闭窗口不退出应用
});
