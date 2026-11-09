'use strict';

(function () {
  const BASE = 260;
  const BASE_GROUND = 222;
  let F = 1;        // 大小倍率（迷你 0.5 ~ 特大 1.5）
  let SIZE = BASE;  // 画布边长
  let GROUND = BASE_GROUND; // 地面 y

  /* ================= 形象配置：换形象只改这一段 ================= */
  const PET = {
    id: 'girl',
    dir: '../assets/girl',   // 素材目录（相对 src/index.html）
    frameSize: 288,          // 单帧素材边长（3x 高清版，从原始分镜图直接导出）
    baseScale: 2 / 3,        // 显示尺寸 = 192px x F（与旧版一致），特大档 1:1 像素完美
    footRow: 276,            // 素材里脚底所在的行，用来对齐地面
    footY: BASE_GROUND       // 画面里脚底的 y
  };

  /* 每个动作的帧序列 / 帧率 / 是否循环；不循环的播完回到 idle */
  const ANIMS = {
    idle:  { frames: ['idle_0', 'idle_1', 'idle_0', 'idle_3'], fps: 3.2, loop: true },
    walk:  { frames: ['walk_0', 'walk_1', 'walk_2', 'walk_3'], fps: 8, loop: true },
    run:   { frames: ['run_0', 'run_1', 'run_2', 'run_3'], fps: 12, loop: true },
    jump:  { frames: ['jump_0', 'jump_1', 'jump_2', 'jump_3', 'jump_4'], fps: 10, loop: false },
    laugh: { frames: ['laugh_0', 'laugh_1', 'laugh_2', 'laugh_3', 'laugh_4', 'laugh_5'], fps: 9, loop: false },
    sleep: { frames: ['sleep_0', 'sleep_1', 'sleep_2', 'sleep_1'], fps: 1.6, loop: true },
    eat:   { frames: ['eat_0', 'eat_1', 'eat_2', 'eat_3'], fps: 5, loop: false },
    drag:  { frames: ['drag_0', 'drag_1'], fps: 7, loop: true },
    wave:  { frames: ['wave_0', 'wave_1', 'wave_2', 'wave_3'], fps: 6, loop: false },
    dance: { frames: ['dance_0', 'dance_1', 'dance_2', 'dance_3'], fps: 6, loop: false },
    dizzy: { frames: ['dizzy_0', 'dizzy_1', 'dizzy_2'], fps: 6, loop: false },
    fall:  { frames: ['fall_0', 'fall_1', 'fall_2'], fps: 7, loop: false },
    sit:   { frames: ['sit_0', 'sit_1'], fps: 1.4, loop: true },
    love:  { frames: ['love_0', 'love_1', 'love_2'], fps: 5, loop: false }
  };

  /* 空闲时随机做的小动作，重复次数就是权重 */
  const IDLE_ACTIONS = [
    'wave', 'wave', 'dance', 'dance', 'love', 'love',
    'laugh', 'laugh', 'jump', 'sit', 'dizzy', 'fall'
  ];

  const LINES = {
    pet: ['嘿嘿，好痒~', '再摸一下嘛', '最喜欢你了', '咕嘿嘿'],
    feed: ['好好吃！', '还有吗还有吗？', '呜呜太幸福了'],
    drag: ['哇啊——放我下来', '晕了晕了…', '别晃啦 (⊙_⊙)'],
    hungry: ['肚子咕咕叫了…', '主人，想吃东西…', '喂我喂我~'],
    sleepy: ['好困…先睡一会', '眼皮打架了…', '晚安…呼…'],
    wake: ['睡饱啦！', '唔…伸个懒腰', '想你啦~']
  };

  /* ================= 基础环境 ================= */
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('pet');
  const bubble = document.getElementById('bubble');
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;

  /* 应用大小倍率：重设画布、像素倍数、地面和对齐参数 */
  function applyScale(factor) {
    F = typeof factor === 'number' && factor > 0 ? factor : 1;
    SIZE = Math.round(BASE * F);
    GROUND = Math.round(BASE_GROUND * F);
    PET.scale = PET.baseScale * F;  // 各档位都对应整数倍，不糊
    PET.footY = GROUND;
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    stage.style.width = SIZE + 'px';
    stage.style.height = SIZE + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    bubble.style.fontSize = Math.round(13 * Math.max(0.85, F)) + 'px';
    bubble.style.maxWidth = Math.round(200 * F) + 'px';
  }

  applyScale(1);

  const api = window.petAPI || {
    load: () => Promise.resolve(null),
    save: () => {},
    setMouseThrough: () => {},
    focusWindow: () => {},
    dragStart: () => {},
    dragEnd: () => {},
    openContextMenu: () => {},
    onCommand: () => {},
    onWalking: () => {},
    onDragging: () => {},
    onScale: () => {},
    onReaction: () => {},
    onChatMode: () => {},
    onName: () => {},
    getWeather: () => Promise.resolve(null),
    onPreviewForm: () => {}
  };

  const pet = { hunger: 78, mood: 82, energy: 76 };

  const anim = {
    name: 'idle',
    time: 0,
    index: 0,
    walking: false,
    running: false,
    dragging: false,
    nextActAt: 0
  };

  let lastSave = 0;
  let lastChatter = 0;
  let ignoreMouse = false;
  let pressed = false;
  let pressAt = 0;
  let lastTap = 0;
  let bubbleTimer = null;

  /* ================= 素材加载 ================= */
  const images = {};
  const names = new Set();
  Object.values(ANIMS).forEach((def) => def.frames.forEach((n) => names.add(n)));

  function loadImages() {
    return Promise.all(
      [...names].map(
        (name) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              images[name] = img;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = PET.dir + '/' + name + '.png';
          })
      )
    );
  }

  /* ================= 小工具 ================= */
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function say(text, duration) {
    bubble.textContent = text;
    bubble.classList.add('show');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('show');
    }, duration || 2400);
  }

  function play(name) {
    if (!ANIMS[name]) return;
    if (anim.name === name && ANIMS[name].loop) return;
    anim.name = name;
    anim.time = 0;
    anim.index = 0;
  }

  function backToRest() {
    if (anim.dragging) {
      play('drag');
      return;
    }
    if (anim.walking) {
      play(anim.running ? 'run' : 'walk');
      return;
    }
    play('idle');
  }

  function isResting() {
    return anim.name === 'idle' || anim.name === 'walk' || anim.name === 'run' || anim.name === 'sit';
  }

  /* ================= 交互 ================= */
  function petHead() {
    if (anim.name === 'sleep') {
      pet.energy = clamp(pet.energy + 4, 0, 100);
      pet.mood = clamp(pet.mood + 4, 0, 100);
      play('wave');
      say(pick(LINES.wake));
      return;
    }
    pet.mood = clamp(pet.mood + 6, 0, 100);
    play('laugh');
    say(pick(LINES.pet));
  }

  function feed() {
    if (anim.name === 'sleep') {
      anim.name = 'idle';
    }
    pet.hunger = clamp(pet.hunger + 22, 0, 100);
    pet.mood = clamp(pet.mood + 10, 0, 100);
    pet.energy = clamp(pet.energy + 4, 0, 100);
    play('eat');
    say(pick(LINES.feed));
  }

  function toggleSleep() {
    if (anim.name === 'sleep') {
      play('wave');
      say(pick(LINES.wake));
    } else {
      anim.walking = false;
      play('sleep');
      say(pick(LINES.sleepy));
    }
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      feed();
      return;
    }
    lastTap = now;
    setTimeout(() => {
      if (lastTap === now) {
        lastTap = 0;
        petHead();
      }
    }, 320);
  }

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    pressed = true;
    pressAt = Date.now();
    api.dragStart();
  });

  window.addEventListener('mouseup', (event) => {
    if (!pressed) return;
    pressed = false;
    api.dragEnd();
    if (Date.now() - pressAt < 240 && event.button === 0) {
      handleTap();
    }
  });

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.openContextMenu();
  });

  function hitTest(x, y) {
    return x > 40 * F && x < SIZE - 40 * F && y > 56 * F && y < SIZE - 20 * F;
  }

  document.addEventListener('mousemove', (event) => {
    if (pressed || anim.dragging || chatMode) return;
    const inside = hitTest(event.clientX, event.clientY);
    if (inside === !ignoreMouse) return;
    ignoreMouse = !inside;
    api.setMouseThrough(ignoreMouse);
  });

  api.onWalking((value) => {
    anim.walking = Boolean(value);
    if (anim.walking) {
      anim.running = Math.random() < 0.3;
      if (!anim.dragging && anim.name !== 'sleep') backToRest();
    } else if (isResting()) {
      play('idle');
    }
  });

  api.onDragging((value) => {
    anim.dragging = Boolean(value);
    if (value) {
      anim.walking = false;
      play('drag');
      if (Math.random() < 0.5) say(pick(LINES.drag), 1600);
    } else {
      play('idle');
    }
  });

  api.onCommand((cmd) => {
    if (cmd === 'pet') petHead();
    else if (cmd === 'feed') feed();
    else if (cmd === 'sleep') toggleSleep();
  });

  api.onScale((factor) => applyScale(factor));

  /* ================= 聊天联动（聊天窗口独立，桌宠只负责表情） ================= */
  let chatMode = false;

  api.onChatMode((on) => {
    chatMode = Boolean(on);
    if (chatMode) {
      if (ignoreMouse) {
        ignoreMouse = false;
        api.setMouseThrough(false);
      }
      anim.walking = false;
      play('sit');
    } else {
      play('idle');
    }
  });

  /* 主进程根据回复内容推过来的动作 */
  api.onReaction((kind) => {
    if (anim.dragging) return;
    const words = {
      love: ['最喜欢你了', '嘿嘿…被你发现了'],
      laugh: ['哈哈，好开心', '嘻嘻~'],
      wave: ['你好呀', '我在呢'],
      sit: ['嗯嗯', '我在听呢']
    };
    const titles = words[kind] || words.sit;
    play(kind || 'sit');
    say(pick(titles), 2400);
  });

  /* 改名后桌宠自己也念一句 */
  api.onName((name) => {
    if (!name) return;
    say('以后叫我' + name + '啦~', 2600);
    play('wave');
  });

  /* ================= 天气形态 ================= */
  const WEATHER_DIR = '../assets/weather';   // 形态素材放在 assets/weather/<form>/

  const WEATHER_LINES = {
    sunny: ['今天太阳好大，一起出去走走吧？', '晒晒太阳，心情也变好啦', '阳光正好，适合发呆'],
    cloudy: ['云有点多…适合赖床', '天灰灰的，想靠着你', '云飘来飘去的'],
    fog: ['雾蒙蒙的，看不清路啦', '雾好大，出门小心点哦', '前面白茫茫一片…'],
    rain: ['下雨啦，出门记得带伞', '哗啦啦…听雨声好舒服', '雨天最适合窝在家里'],
    storm: ['打雷了！有点怕怕…', '外面好吓人，躲我怀里吧', '雷声好大 (｡•́︿•̀｡)'],
    snow: ['下雪啦！要不要堆雪人？', '好冷…把手给我暖暖', '雪好白呀，踩上去会响'],
    windy: ['风好大，帽子要飞走了！', '呼呼的…头发都吹乱啦', '这风能把我吹跑']
  };

  let form = null;           // 当前天气形态（null = 还没收到天气，用基础形象）
  let weatherInfo = null;    // { form, temp, city, wind, isDay, stale }
  const formCache = {};      // form -> { frameName: Image }

  const FORM_ASSETS = { fog: 'cloudy' };   // 雾天复用多云素材，配合程序雾气

  function loadFormImages(formName) {
    const assetForm = FORM_ASSETS[formName] || formName;
    if (formCache[assetForm]) return Promise.resolve(formCache[assetForm]);
    const dir = WEATHER_DIR + '/' + assetForm;
    const map = {};
    return Promise.all(
      [...names].map(
        (name) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              map[name] = img;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = dir + '/' + name + '.png';
          })
      )
    ).then(() => {
      formCache[assetForm] = map;
    });
  }

  function applyWeather(data) {
    if (!data) return;
    weatherInfo = data;
    const next = data.disabled ? 'sunny' : data.form || 'sunny';
    form = next;
    // 即使形态没变也要确保素材已加载（比如晴天：初始就是 sunny，之前会一直用基础形象）
    const key = FORM_ASSETS[next] || next;
    if (!formCache[key]) loadFormImages(next);
  }

  api.onWeather((data) => applyWeather(data));

  /* 菜单里"预览形象"的临时切换 */
  api.onPreviewForm((data) => applyWeather(data && { form: data.form, disabled: false }));

  api.onWeatherChanged((data) => {
    applyWeather(data);
    const lines = WEATHER_LINES[data.form] || [];
    if (!lines.length) return;
    setTimeout(() => {
      say(pick(lines), 3600);
      if (data.form === 'storm') play('dizzy');
      else if (data.form === 'snow' || data.form === 'windy') play('wave');
      else play('laugh');
    }, 900);
  });

  api.onWeatherError(() => {
    if (!weatherInfo) say('天气没查到…先这样陪你吧', 2400);
  });

  /* ================= 状态推进 ================= */
  function update(dt) {
    if (anim.dragging) {
      play('drag');
    }

    const def = ANIMS[anim.name];
    anim.time += dt;

    const frameMs = 1000 / def.fps;
    let index = Math.floor(anim.time / frameMs);

    if (def.loop) {
      anim.index = index % def.frames.length;
    } else if (index >= def.frames.length) {
      backToRest();
      return;
    } else {
      anim.index = index;
    }
  }

  function decay(dt) {
    const perMinute = dt / 60000;
    if (anim.name === 'sleep') {
      pet.energy = clamp(pet.energy + perMinute * 9, 0, 100);
      pet.hunger = clamp(pet.hunger - perMinute * 0.35, 0, 100);
      return;
    }
    pet.hunger = clamp(pet.hunger - perMinute * 0.9, 0, 100);
    pet.mood = clamp(pet.mood - perMinute * 0.6, 0, 100);
    pet.energy = clamp(pet.energy - perMinute * 0.7, 0, 100);
  }

  function chatter(now) {
    if (chatMode) return;
    if (now - lastChatter < 26000 || anim.name === 'sleep' || anim.dragging) return;
    lastChatter = now;
    if (pet.energy < 18) {
      play('sleep');
      say(pick(LINES.sleepy));
      return;
    }
    if (pet.hunger < 22) {
      say(pick(LINES.hungry));
      return;
    }
    if (pet.mood < 25) {
      say('有点无聊…');
    }
  }

  /* 空闲时随机来点小动作，让动画不单调 */
  function idleAct(now) {
    if (chatMode) return;
    if (now < anim.nextActAt) return;
    anim.nextActAt = now + 9000 + Math.random() * 14000;
    if (anim.dragging || anim.name === 'sleep' || !isResting()) return;
    play(pick(IDLE_ACTIONS));
  }

  /* ================= 绘制 ================= */
  function drawShadow() {
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#2B1B0E';
    ctx.beginPath();
    ctx.ellipse(SIZE / 2, GROUND + 3 * F, 50 * F, 8 * F, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawZzz(now) {
    const float = (now / 1000) % 1;
    ctx.save();
    ctx.fillStyle = 'rgba(74, 44, 20, ' + (0.7 - float * 0.5) + ')';
    ctx.font = 'bold ' + Math.round(15 * F) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('Z', SIZE / 2 + 78 * F, GROUND - 158 * F - float * 14 * F);
    ctx.font = 'bold ' + Math.round(12 * F) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('z', SIZE / 2 + 94 * F, GROUND - 172 * F - float * 12 * F);
    ctx.restore();
  }

  function drawHearts(now) {
    const beat = (Math.sin(now / 260) + 1) / 2;
    const size = (6 + beat * 3) * F;
    [-1, 1].forEach((side) => {
      const x = SIZE / 2 + side * (66 + beat * 4) * F;
      const y = GROUND - (152 + beat * 6) * F;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, size * 0.7);
      ctx.bezierCurveTo(-size, -size * 0.2, -size * 0.5, -size, 0, -size * 0.35);
      ctx.bezierCurveTo(size * 0.5, -size, size, -size * 0.2, 0, size * 0.7);
      ctx.fillStyle = 'rgba(255, 108, 132, 0.85)';
      ctx.fill();
      ctx.restore();
    });
  }

  function drawSnack() {
    const progress = Math.min(1, anim.time / 1100);
    const radius = 7 * (1 - progress) * F;
    if (radius < 1) return;
    const y = GROUND - (84 - progress * 24) * F;
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#8FCB62';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(SIZE / 2 - radius * 0.3, y - radius * 0.35, radius * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.restore();
  }

  function drawPet(now) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawShadow();
    drawWeatherBehind(now);

    const def = ANIMS[anim.name];
    const name = def.frames[anim.index];
    const img = (formCache[FORM_ASSETS[form] || form] && formCache[FORM_ASSETS[form] || form][name]) || images[name];

    const size = PET.frameSize * PET.scale;
    const x = (SIZE - size) / 2;
    const y = PET.footY - PET.footRow * PET.scale;

    if (img) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x, y, size, size);
    }

    drawWeatherFront(now);

    if (anim.name === 'eat') drawSnack();
    if (anim.name === 'sleep') drawZzz(now);
    if (anim.name === 'love') drawHearts(now);
  }

  /* ================= 天气特效 ================= */
  function rnd(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawSunGlow(now) {
    const cx = SIZE * 0.16;
    const cy = SIZE * 0.14;
    const pulse = 0.9 + Math.sin(now / 1500) * 0.1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62 * F * pulse);
    g.addColorStop(0, 'rgba(255, 216, 120, 0.34)');
    g.addColorStop(1, 'rgba(255, 216, 120, 0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 62 * F * pulse, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const t = (now / 2200 + i * 0.25) % 1;
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = '#FFF3C4';
      ctx.beginPath();
      ctx.arc(SIZE * 0.24 + rnd(i) * SIZE * 0.6, SIZE * 0.2 + t * SIZE * 0.5, 2 * F, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPuff(x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#FFFFFF';
    [[0, 0, 1], [-0.75, 0.16, 0.68], [0.75, 0.16, 0.68], [0.34, -0.34, 0.6]].forEach(([dx, dy, k]) => {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, r * k, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawClouds(now, alpha) {
    for (let i = 0; i < 3; i++) {
      const speed = 5 + i * 3;
      const span = SIZE + 90 * F;
      const x = ((now / 1000) * speed + i * 110) % span - 45 * F;
      const y = (22 + i * 24) * F;
      drawPuff(x, y, (22 - i * 4) * F, alpha);
    }
  }

  function drawRain(now, heavy) {
    const count = heavy ? 26 : 16;
    ctx.save();
    ctx.strokeStyle = heavy ? 'rgba(150, 190, 240, 0.8)' : 'rgba(165, 205, 245, 0.7)';
    ctx.lineWidth = 1.4 * F;
    ctx.lineCap = 'round';
    const span = SIZE + 60;
    for (let i = 0; i < count; i++) {
      const speed = 420 + rnd(i) * 260;
      const len = (9 + rnd(i + 7) * 8) * F;
      const x0 = rnd(i + 3) * span;
      const y0 = (((now / 1000) * speed + rnd(i + 11) * SIZE * 2) % (SIZE + 30)) - 16;
      const x = x0 - y0 * 0.2;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x - len * 0.2, y0 + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSnow(now) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (let i = 0; i < 18; i++) {
      const speed = 34 + rnd(i) * 46;
      const y = (((now / 1000) * speed + rnd(i + 5) * SIZE * 2) % (SIZE + 16)) - 8;
      const x = rnd(i + 2) * SIZE + Math.sin(now / 900 + i) * 11 * F;
      const r = (1.3 + rnd(i + 9) * 1.7) * F;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWind(now) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2 * F;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const t = (now / 2600 + i * 0.33) % 1;
      const x = SIZE * 0.05 + t * SIZE * 1.05;
      const y = (56 + i * 46) * F + Math.sin(t * 7) * 7 * F;
      ctx.beginPath();
      ctx.arc(x, y, 11 * F, 0.15 * Math.PI, 1.15 * Math.PI);
      ctx.stroke();
    }
    // 被吹着跑的叶子
    for (let i = 0; i < 4; i++) {
      const t = (now / 2000 + i * 0.25) % 1;
      const x = SIZE * 1.05 - t * SIZE * 1.1;
      const y = (70 + i * 40) * F + Math.sin(t * 9 + i) * 10 * F;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 8 + i);
      ctx.fillStyle = 'rgba(126, 179, 96, 0.75)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.4 * F, 1.8 * F, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFog(now) {
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const y = (SIZE * 0.52 + i * 34 * F) + Math.sin(now / 3200 + i) * 6 * F;
      const g = ctx.createLinearGradient(0, y - 26 * F, 0, y + 26 * F);
      g.addColorStop(0, 'rgba(232, 238, 242, 0)');
      g.addColorStop(0.5, 'rgba(232, 238, 242, ' + (0.22 - i * 0.04) + ')');
      g.addColorStop(1, 'rgba(232, 238, 242, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 26 * F, SIZE, 52 * F);
    }
    ctx.restore();
  }

  function drawStormFlash(now) {
    const cycle = now % 5600;
    if (cycle < 170) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 236, ' + (0.2 * (1 - cycle / 170)) + ')';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();
    }
    if (cycle > 60 && cycle < 300) {
      const a = 1 - Math.abs(cycle - 180) / 120;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.strokeStyle = '#FFE066';
      ctx.lineWidth = 3 * F;
      ctx.lineJoin = 'round';
      const x = SIZE * 0.74;
      const y = 6 * F;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 9 * F, y + 23 * F);
      ctx.lineTo(x + 2 * F, y + 21 * F);
      ctx.lineTo(x - 8 * F, y + 48 * F);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawWeatherBehind(now) {
    const fx = weatherInfo && !weatherInfo.disabled ? form : '';
    if (fx === 'sunny') drawSunGlow(now);
    else if (fx === 'cloudy' || fx === 'fog') drawClouds(now, fx === 'fog' ? 0.35 : 0.55);
  }

  function drawWeatherFront(now) {
    const fx = weatherInfo && !weatherInfo.disabled ? form : '';
    if (fx === 'rain') drawRain(now, false);
    else if (fx === 'storm') {
      drawRain(now, true);
      drawStormFlash(now);
    } else if (fx === 'snow') drawSnow(now);
    else if (fx === 'windy') drawWind(now);
    else if (fx === 'fog') drawFog(now);
  }

  /* ================= 主循环 ================= */
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(64, now - last);
    last = now;

    update(dt);
    decay(dt);
    chatter(now);
    idleAct(now);
    drawPet(now);

    if (now - lastSave > 20000) {
      lastSave = now;
      api.save({
        hunger: Math.round(pet.hunger),
        mood: Math.round(pet.mood),
        energy: Math.round(pet.energy),
        seenHint: true
      });
    }

    requestAnimationFrame(loop);
  }

  loadImages().then(() => {
    // 启动时主动拉一次当前天气（不依赖主进程推送的时机）
    api.getWeather().then((w) => {
      if (w && w.enabled && w.cache) applyWeather(w.cache);
    }).catch(() => {});
    api.load().then((saved) => {
      if (saved) {
        applyScale(saved.scale);
        pet.hunger = typeof saved.hunger === 'number' ? saved.hunger : pet.hunger;
        pet.mood = typeof saved.mood === 'number' ? saved.mood : pet.mood;
        pet.energy = typeof saved.energy === 'number' ? saved.energy : pet.energy;
        if (saved.updatedAt) {
          const idleMinutes = Math.min(240, (Date.now() - saved.updatedAt) / 60000);
          pet.hunger = clamp(pet.hunger - idleMinutes * 0.6, 0, 100);
          pet.energy = clamp(pet.energy - idleMinutes * 0.3, 0, 100);
        }
      }
      anim.nextActAt = performance.now() + 12000;
      const firstRun = !saved || !saved.seenHint;
      const myName = (saved && saved.name) || '小慧';
      const shortcut = (saved && saved.shortcutLabel) ||
        (/Windows/i.test(navigator.userAgent) ? 'Ctrl+Alt+Space' : '⌥Space');
      if (firstRun) {
        api.save({ hunger: 78, mood: 82, energy: 76, seenHint: true });
        setTimeout(() => say('你好呀，我叫' + myName + ' (๑>ᴗ<๑)', 2600), 700);
        setTimeout(() => say('按 ' + shortcut + ' 就能和我聊天哦', 3600), 3600);
      } else {
        setTimeout(() => say('你回来啦~ 想你了', 2600), 700);
      }
      requestAnimationFrame(loop);
    });
  });
})();
