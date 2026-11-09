'use strict';

(function () {
  const api = window.cityAPI;
  const keyword = document.getElementById('keyword');
  const results = document.getElementById('results');
  const hint = document.getElementById('hint');
  const current = document.getElementById('current');
  const autoBtn = document.getElementById('auto');
  const closeBtn = document.getElementById('close');

  if (!api) {
    hint.textContent = '窗口初始化失败，请重启应用再试';
    return;
  }

  if (/Windows/i.test(navigator.userAgent)) {
    document.body.classList.add('win');
  }

  let searchTimer = null;

  function formatCache(cache) {
    if (!cache) return '还没有天气数据';
    const map = {
      sunny: '☀️ 晴', cloudy: '⛅ 多云', fog: '🌫 雾',
      rain: '🌧 雨', storm: '⛈ 雷雨', snow: '❄️ 雪', windy: '💨 大风'
    };
    return (map[cache.form] || '') + ' ' + cache.temp + '°C · ' + cache.city;
  }

  api.get().then((info) => {
    if (!info) return;
    const cityName = info.city ? info.city.name : '未设置（自动定位）';
    current.textContent = '当前位置：' + cityName + '　|　' + formatCache(info.cache);
  });

  function renderResults(list) {
    results.innerHTML = '';
    if (!list.length) {
      hint.textContent = '没找到这个城市，换个名字试试';
      return;
    }
    hint.textContent = '点选一个城市保存';
    list.forEach((city) => {
      const row = document.createElement('div');
      row.className = 'result';
      row.textContent = city.name;
      row.addEventListener('click', () => {
        api.setCity(city);
      });
      results.appendChild(row);
    });
  }

  function doSearch() {
    const kw = keyword.value.trim();
    if (!kw) return;
    hint.textContent = '搜索中…';
    api.search(kw).then((list) => renderResults(Array.isArray(list) ? list : []));
  }

  keyword.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const kw = keyword.value.trim();
    if (kw.length < 1) return;
    searchTimer = setTimeout(doSearch, 420);
  });

  keyword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doSearch();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
    }
  });

  autoBtn.addEventListener('click', () => {
    autoBtn.textContent = '正在重新定位…';
    api.relocate();
    api.close();
  });

  closeBtn.addEventListener('click', () => api.close());

  setTimeout(() => keyword.focus(), 120);
})();
