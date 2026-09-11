// ==UserScript==
// @name         ID Linker (Transaction / Merchant)
// @namespace    id-linker
// @version      1.1
// @description  Находит ID в тексте, делает кликабельными. Клик по ID в попапе копирует его, не вызывая перезагрузку.
// @match        *://*.helpdeskeddy.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  console.log('[ID Linker] Скрипт запущен');

  // ==== НАСТРОЙКИ ====
  const TRANSACTION_URL_TEMPLATE = 'https://admin.trinderson.run/dashboard/transactions/{ID}';
  const MERCHANT_URL_TEMPLATE    = 'https://admin.trinderson.run/merchant/{ID}/admin';

  const ID_PATTERN = /\b[0-9a-fA-F]{4,}(?:-[0-9a-fA-F]{2,}){3,6}\b/g;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);

  // ==== СТИЛИ ====
  GM_addStyle(`
    .idl-token {
      color: #2563eb !important;
      text-decoration: underline dotted !important;
      cursor: pointer !important;
      background: transparent !important;
    }
    .idl-token:hover {
      color: #1d4ed8 !important;
      background: rgba(37, 99, 235, 0.15) !important;
    }
    #idl-popup {
      position: fixed;
      z-index: 2147483647;
      background: #1f2937;
      color: #f9fafb;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: 13px/1.3 -apple-system, Segoe UI, Roboto, sans-serif;
      min-width: 200px;
      user-select: none; /* Чтобы текст внутри попапа не выделялся случайно при кликах */
    }
    #idl-popup button {
      all: unset;
      cursor: pointer;
      padding: 8px 10px;
      border-radius: 6px;
      white-space: nowrap;
      color: #f9fafb;
    }
    #idl-popup button:hover {
      background: #374151;
    }
    #idl-popup .idl-id {
      opacity: 0.7;
      font-size: 11px;
      padding: 6px 10px;
      word-break: break-all;
      cursor: pointer;
      transition: all 0.2s ease;
      border-radius: 4px;
      text-align: center;
      background: rgba(255, 255, 255, 0.05);
      user-select: text; /* Разрешаем выделение только для самого ID, если нужно */
    }
    #idl-popup .idl-id:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.15);
    }
    #idl-popup .idl-id.copied {
      color: #4ade80 !important;
      opacity: 1;
      background: rgba(74, 222, 128, 0.15);
    }
  `);

  // ==== ПОПАП ВЫБОРА ====
  let popupEl = null;

  function closePopup() {
    if (popupEl) {
      popupEl.remove();
      popupEl = null;
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onDocKeydown, true);
    }
  }

  function onDocClick(e) {
    if (popupEl && !popupEl.contains(e.target)) {
      closePopup();
    }
  }

  function onDocKeydown(e) {
    if (e.key === 'Escape') closePopup();
  }

  function openPopup(anchorEl, id) {
    closePopup();

    popupEl = document.createElement('div');
    popupEl.id = 'idl-popup';

    const idLabel = document.createElement('div');
    idLabel.className = 'idl-id';
    idLabel.textContent = id;
    idLabel.title = "Нажмите, чтобы скопировать ID в буфер обмена";

    idLabel.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Гарантированно останавливаем всплытие, чтобы не триггерить другие обработчики

      try {
        await navigator.clipboard.writeText(id);

        const originalText = idLabel.textContent;
        idLabel.textContent = '✓ Скопировано!';
        idLabel.classList.add('copied');

        setTimeout(() => {
          if (document.contains(idLabel)) {
            idLabel.textContent = originalText;
            idLabel.classList.remove('copied');
          }
        }, 1500);
      } catch (err) {
        console.error('[ID Linker] Ошибка копирования:', err);
        idLabel.textContent = 'Ошибка копирования';
      }
    });
    popupEl.appendChild(idLabel);

    const btnTx = document.createElement('button');
    btnTx.textContent = '📄 Открыть как ID транзакции';
    btnTx.addEventListener('click', () => {
      window.open(TRANSACTION_URL_TEMPLATE.replace('{ID}', id), '_blank');
      closePopup();
    });
    popupEl.appendChild(btnTx);

    const btnMerchant = document.createElement('button');
    btnMerchant.textContent = '🏪 Открыть как Мерчант ID';
    btnMerchant.addEventListener('click', () => {
      window.open(MERCHANT_URL_TEMPLATE.replace('{ID}', id), '_blank');
      closePopup();
    });
    popupEl.appendChild(btnMerchant);

    document.body.appendChild(popupEl);

    const rect = anchorEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      const popupRect = popupEl.getBoundingClientRect();
      let top = rect.bottom + 4;
      let left = rect.left;

      if (left + popupRect.width > window.innerWidth) {
        left = window.innerWidth - popupRect.width - 8;
      }
      if (top + popupRect.height > window.innerHeight) {
        top = rect.top - popupRect.height - 4;
      }

      popupEl.style.top = `${Math.max(4, top)}px`;
      popupEl.style.left = `${Math.max(4, left)}px`;
    });

    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onDocKeydown, true);
    }, 0);
  }

  // ==== ПОИСК И ОБЁРТКА ID В ТЕКСТЕ ====
  function wrapMatchesInTextNode(textNode) {
    const text = textNode.nodeValue;
    ID_PATTERN.lastIndex = 0;

    const matches = [...text.matchAll(ID_PATTERN)];
    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of matches) {
      const id = match[0];
      const start = match.index;
      const end = start + id.length;

      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      const span = document.createElement('span');
      span.className = 'idl-token';
      span.dataset.idlId = id;
      span.textContent = id;
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopup(span, id);
      });
      frag.appendChild(span);

      lastIndex = end;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  }

  function shouldSkip(node) {
    if (!node) return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (SKIP_TAGS.has(node.tagName)) return true;
      if (node.classList && node.classList.contains('idl-token')) return true;

      // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Игнорируем сам попап и все элементы внутри него,
      // чтобы MutationObserver не парсил текст внутри нашего же интерфейса.
      if (node.id === 'idl-popup' || (node.closest && node.closest('#idl-popup'))) {
        return true;
      }
    }
    return false;
  }

  function scan(root) {
    if (shouldSkip(root)) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkip(node.parentNode)) return NodeFilter.FILTER_REJECT;
          if (node.parentNode.tagName === 'A') return NodeFilter.FILTER_REJECT;

          ID_PATTERN.lastIndex = 0;
          if (!ID_PATTERN.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodesToProcess = [];
    let n;
    while ((n = walker.nextNode())) nodesToProcess.push(n);

    for (const node of nodesToProcess) {
      wrapMatchesInTextNode(node);
    }
  }

  // ==== НАБЛЮДЕНИЕ ЗА ИЗМЕНЕНИЯМИ DOM ====
  let scheduled = false;
  const pendingRoots = new Set();

  function scheduleScan(root) {
    const target = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
    if (!target) return;

    pendingRoots.add(target);
    if (scheduled) return;

    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const r of roots) {
        if (document.contains(r)) scan(r);
      }
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            scheduleScan(node.parentNode || document.body);
          }
        }
      } else if (m.type === 'characterData') {
        scheduleScan(m.target.parentNode || document.body);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  scan(document.body);
})();