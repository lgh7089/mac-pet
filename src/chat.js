'use strict';

(function () {
  const api = window.chatAPI;

  if (!api) {
    document.body.innerHTML =
      '<div style="padding:60px 28px;text-align:center;font-size:13px;line-height:2;color:#a08b76">' +
      '聊天窗口没能连上主进程<br>重启一下 MacPet 再试试</div>';
    return;
  }

  const list = document.getElementById('messages');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  // 顶部栏已精简为纯 logo，不再有名字/状态元素，用空占位兜底避免报错
  const statusEl = document.getElementById('status') || { textContent: '' };
  let nameEl = document.getElementById('name');

  /* Windows 用系统标题栏，样式上少留一块交通灯的位置 */
  if (/Windows/i.test(navigator.userAgent)) {
    document.body.classList.add('win');
  }

  const FALLBACK = {
    'no-key': '我还没有小脑子呢… 先把 API Key 给我吧（右键桌宠 → AI 设置）',
    auth: '钥匙好像不对…检查一下 API Key 呗 (｡•́︿•̀｡)',
    balance: '账户余额不足啦…主人去充点值嘛',
    budget: '今天聊得够多啦，明天再聊嘛，晚安~',
    network: '网好像断了…等会再试试？',
    'save-failed': 'Key 没能存进去…再试一次？',
    unknown: '咦…人家突然不知道说什么了'
  };

  const WELCOME = '我在呢~ 想聊什么呀 (๑>ᴗ<๑)';

  let busy = false;
  let streamingEl = null;
  let keyPanelEl = null;
  let hasKey = false;
  let petName = '小慧';
  let renaming = false;

  /* ================= 名字 ================= */
  function applyName(name) {
    petName = String(name || '').trim() || '小慧';
    if (nameEl) nameEl.textContent = petName;
    document.title = '和' + petName + '聊天';
  }

  function makeNameSpan() {
    const span = document.createElement('div');
    span.className = 'name';
    span.id = 'name';
    span.title = '点一下改名字';
    span.textContent = petName;
    span.addEventListener('click', startRename);
    return span;
  }

  function startRename() {
    if (renaming || !nameEl) return;
    renaming = true;

    const field = document.createElement('input');
    field.id = 'nameinput';
    field.type = 'text';
    field.maxLength = 12;
    field.value = petName;
    field.spellcheck = false;
    nameEl.replaceWith(field);
    field.focus();
    field.select();

    function finish(save) {
      if (!renaming) return;
      renaming = false;
      const value = field.value.trim();
      const span = makeNameSpan();
      field.replaceWith(span);
      nameEl = span;
      if (save && value && value !== petName) {
        api.setName(value);
      } else {
        span.textContent = petName;
        input.focus();
      }
    }

    field.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });

    field.addEventListener('blur', () => finish(true));
  }

  if (nameEl) {
    nameEl.title = '点一下改名字';
    nameEl.addEventListener('click', startRename);
  }

  /* ================= DOM 小工具 ================= */
  function scrollDown() {
    list.scrollTop = list.scrollHeight;
  }

  function addRow(role) {
    const row = document.createElement('div');
    row.className = 'row ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'msg';
    row.appendChild(bubble);
    list.appendChild(row);
    scrollDown();
    return bubble;
  }

  function addMessage(role, text) {
    const bubble = addRow(role);
    bubble.textContent = text;
    scrollDown();
    return bubble;
  }

  function addTyping() {
    const bubble = addRow('assistant');
    const dots = document.createElement('span');
    dots.className = 'typing';
    dots.innerHTML = '<i></i><i></i><i></i>';
    bubble.appendChild(dots);
    scrollDown();
    return bubble;
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value || !input.value.trim();
  }

  /* ================= Key 设置卡片 ================= */
  function showKeyPanel() {
    if (keyPanelEl) {
      const existing = keyPanelEl.querySelector('input');
      if (existing) existing.focus();
      return;
    }

    const card = document.createElement('div');
    card.className = 'keypanel';
    card.innerHTML = [
      '<div class="kp-title">先给我装个「小脑子」吧</div>',
      '<div class="kp-desc">去 platform.deepseek.com 注册并创建 API Key，粘贴到这里。' +
        '它只用系统加密存在你本机，不会上传给任何人。</div>',
      '<input id="keyinput" type="password" spellcheck="false" placeholder="sk-..." />',
      '<button id="keysave">保存并开始聊天</button>'
    ].join('');
    list.appendChild(card);
    keyPanelEl = card;
    scrollDown();

    const keyInput = card.querySelector('#keyinput');
    const keySave = card.querySelector('#keysave');

    function submitKey() {
      const value = keyInput.value.trim();
      if (value.length < 20) {
        keyInput.value = '';
        keyInput.placeholder = '这个 Key 看起来不太对，再检查一下？';
        return;
      }
      api.setKey(value);
      keySave.disabled = true;
      keySave.textContent = '保存中…';
    }

    keySave.addEventListener('click', submitKey);
    keyInput.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        submitKey();
      }
    });

    setTimeout(() => keyInput.focus(), 120);
  }

  function hideKeyPanel() {
    if (keyPanelEl) {
      keyPanelEl.remove();
      keyPanelEl = null;
    }
  }

  /* ================= 发消息 ================= */
  function send() {
    const text = input.value.trim();
    if (!text || busy || !hasKey) return;

    addMessage('user', text);
    input.value = '';
    autoGrow();
    setBusy(true);

    streamingEl = null;
    statusEl.textContent = '正在输入…';
    api.send(text);
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(96, input.scrollHeight) + 'px';
    sendBtn.disabled = busy || !input.value.trim();
  }

  input.addEventListener('input', autoGrow);

  input.addEventListener('keydown', (event) => {
    // 中文输入法组词中不要触发发送
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      api.close();
    }
  });

  sendBtn.addEventListener('click', send);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.activeElement !== input) {
      api.close();
    }
  });

  /* ================= 主进程事件 ================= */
  api.onThinking(() => {
    if (!streamingEl) {
      streamingEl = addTyping();
    }
  });

  api.onDelta((text) => {
    if (!streamingEl) {
      streamingEl = addTyping();
    }
    if (streamingEl.querySelector('.typing')) {
      streamingEl.innerHTML = '';
    }
    streamingEl.textContent += text;
    scrollDown();
  });

  api.onDone(() => {
    if (streamingEl && !streamingEl.textContent.trim()) {
      streamingEl.textContent = '……（她好像走神了）';
    }
    streamingEl = null;
    setBusy(false);
    statusEl.textContent = hasKey ? '在线' : '还没设置 API Key';
    input.focus();
    refreshStatus();
  });

  api.onError((data) => {
    const code = (data && data.code) || 'unknown';
    const bubble = streamingEl || addRow('assistant');
    bubble.textContent = FALLBACK[code] || FALLBACK.unknown;
    streamingEl = null;
    setBusy(false);
    statusEl.textContent = '连接出了点问题';

    if (code === 'no-key') {
      hasKey = false;
      showKeyPanel();
    } else if (code === 'auth' || code === 'budget') {
      // 让用户能看到具体卡在哪
      addMessage('system', code === 'auth' ? 'API Key 可能失效了，菜单里可以重新设置' : '今日用量已达上限，明天自动恢复');
    }
    input.focus();
  });

  api.onKeySaved(() => {
    hasKey = true;
    hideKeyPanel();
    statusEl.textContent = '在线';
    addMessage('system', '小脑子装好啦 ✧');
    addMessage('assistant', '嘿嘿，现在能好好说话啦~ 什么都可以跟我讲哦');
    input.focus();
    refreshStatus();
  });

  api.onCleared(() => {
    list.innerHTML = '';
    streamingEl = null;
    addMessage('system', '聊天记录已清空');
    addMessage('assistant', '我们重新认识一下吧！我叫' + petName + ' (๑>ᴗ<๑)');
  });

  api.onSetupKey(() => {
    hasKey = false;
    showKeyPanel();
  });

  api.onSetupName(() => {
    startRename();
  });

  api.onName((data) => {
    const before = petName;
    applyName(data && data.name);
    if (petName !== before) {
      addMessage('system', '名字改好啦');
      addMessage('assistant', '记住啦！我是' + petName + '，以后就这么叫我吧~');
    }
    input.focus();
  });

  api.onNameError((data) => {
    addMessage('system', (data && data.message) || '名字没能改成…');
    input.focus();
  });

  api.onShown(() => {
    setTimeout(() => input.focus(), 80);
    scrollDown();
  });

  function refreshStatus() {
    api.status().then((info) => {
      if (!info) return;
      hasKey = Boolean(info.hasKey);
      if (!hasKey) {
        statusEl.textContent = '还没有 API Key';
        return;
      }
      const used = Math.round(info.usageTokens / 1000);
      const total = Math.round(info.budgetTokens / 1000);
      statusEl.textContent = '在线 · 今日已用 ' + used + 'K / ' + total + 'K';
    });
  }

  /* ================= 初始化 ================= */
  api.onInit((data) => {
    hasKey = Boolean(data && data.hasKey);
    if (data && data.name) applyName(data.name);

    if (data && Array.isArray(data.history) && data.history.length) {
      data.history.forEach((m) => {
        addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
      });
    } else if (hasKey) {
      addMessage('assistant', WELCOME);
    } else {
      addMessage('assistant', '你好呀，我是' + petName + ' (๑>ᴗ<๑)');
    }

    statusEl.textContent = hasKey ? '在线' : '还没有 API Key';
    if (!hasKey) showKeyPanel();
    refreshStatus();
    setTimeout(() => input.focus(), 150);
    autoGrow();
  });
})();
