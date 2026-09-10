// ==UserScript==
// @name         HelpDeskeddy SBP Checker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Отправка изображений и PDF в API через FormData для получения SBP ID.
// @author       Artyom Kalashnikov
// @match        *://*.helpdeskeddy.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // НАСТРОЙКИ
    // ============================================================

    const API_URL = 'https://api.my-sandbox.space/v1/get_sbp_id';
    const STORAGE_KEY = 'helpdeskeddy_sbp_api_key';
    const myButtonsMap = new WeakMap();

    const MIME_TO_EXT = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'application/pdf': '.pdf',
    };

    const AI_ICON_SVG = `
        <svg width="12" height="12" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
            <text xml:space="preserve" text-anchor="start" font-family="Helvetica, Arial, sans-serif"
                  font-size="13" y="10.468" x="0.29576" fill="currentColor">AI</text>
        </svg>
    `;

    // ============================================================
    // УПРАВЛЕНИЕ API КЛЮЧОМ (Неблокирующее)
    // ============================================================

    function getApiKey() {
        let key = GM_getValue(STORAGE_KEY, '');

        if (!key) {
            key = prompt('Для работы SBP Checker необходим API ключ.\nПожалуйста, введите ваш API ключ:');

            if (key && key.trim() !== '') {
                key = key.trim();
                GM_setValue(STORAGE_KEY, key);
                return key;
            } else {
                return null; // Пользователь нажал Отмена или ввел пустоту
            }
        }
        return key;
    }

    // ============================================================
    // СТИЛИ
    // ============================================================

    const customStyles = document.createElement('style');
    customStyles.textContent = `
        .ticket-conversation__actions_button.image-sender-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 5px 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
            border-radius: 4px;
            transition: all 0.2s ease;
            color: var(--darkreader-text-607280, #9f5989);
        }
        .ticket-conversation__actions_button.image-sender-btn:hover {
            background-color: #23869b;
            color: #fff !important;
            border-radius: 90%;
        }
        .ticket-conversation__actions_button.image-sender-btn svg {
            width: 14px;
            height: 14px;
            display: block;
        }
        .ticket-conversation__actions_button.image-sender-btn svg text {
            fill: currentColor;
            stroke: none;
        }
        .sbp-result-container {
            margin-top: 8px;
            padding: 8px 12px;
            background: #f0fdf4;
            border: 1px solid #86efac;
            border-radius: 6px;
            font-size: 13px;
            color: #166534;
            display: flex;
            align-items: center;
            gap: 8px;
            animation: fadeIn 0.3s ease;
        }
        .sbp-result-container.error {
            background: #fef2f2;
            border-color: #fca5a5;
            color: #991b1b;
        }
        .sbp-label {
            font-weight: 600;
            white-space: nowrap;
        }
        .sbp-value {
            font-family: monospace;
            font-size: 14px;
            font-weight: bold;
            user-select: all;
            cursor: pointer;
        }
        .sbp-copy-hint {
            font-size: 11px;
            opacity: 0.7;
            margin-left: auto;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to   { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(customStyles);

    // ============================================================
    // ЗАГРУЗКА ФАЙЛА КАК BLOB (через GM_xmlhttpRequest)
    // ============================================================

    function gmGetBlob(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`Ошибка загрузки файла: HTTP ${response.status}`));
                        return;
                    }
                    const blob = response.response;
                    if (!blob || blob.size === 0) {
                        reject(new Error(`Получен пустой файл (0 bytes). URL: ${url}`));
                        return;
                    }
                    resolve(blob);
                },
                onerror: () => reject(new Error('Не удалось загрузить файл')),
                ontimeout: () => reject(new Error('Таймаут при загрузке файла')),
            });
        });
    }

    // ============================================================
    // ИМЯ ФАЙЛА
    // ============================================================

    function normalizeFileName(fileName, blob, fallbackName) {
        let name = (fileName || fallbackName || 'file').trim() || fallbackName || 'file';

        if (!/\.[a-z0-9]+$/i.test(name)) {
            const extension = MIME_TO_EXT[(blob.type || '').toLowerCase()];
            if (extension) name += extension;
        }

        return name;
    }

    // ============================================================
    // ПОИСК ФАЙЛОВ В СООБЩЕНИИ
    // ============================================================

    function findFilesInMessage(messageBlock) {
        const files = [];
        const seenUrls = new Set();

        // --- Картинки ---
        messageBlock.querySelectorAll('img').forEach((img) => {
            const thumbnailUrl = img.src || '';
            if (!thumbnailUrl || !thumbnailUrl.startsWith('http')) return;

            const match = thumbnailUrl.match(
                /^(https?:\/\/[^/]+)\/([^/]+)\/file\/image_thumb\/([^/]+)(?:\/size\/\d+)?/
            );
            if (!match) return;

            const [, host, language, imageId] = match;
            const originalUrl = `${host}/${language}/file/download/${imageId}`;

            if (!seenUrls.has(originalUrl)) {
                files.push({ type: 'image', url: originalUrl, name: img.alt || `image_${imageId}` });
                seenUrls.add(originalUrl);
            }
        });

        // --- PDF ---
        messageBlock.querySelectorAll('.ticket-conversation__message-file').forEach((block) => {
            const link =
                block.querySelector('.ticket-conversation__message-file-btn-download') ||
                block.querySelector('.ticket-conversation__message-file-href-preview');
            if (!link || !link.href) return;

            const href = link.href;
            if (seenUrls.has(href)) return;

            const nameEl = block.querySelector('.ticket-conversation__message-file-name');
            const name = nameEl ? nameEl.textContent.trim() : 'file.pdf';
            const lowerName = name.toLowerCase();
            const isPdf = lowerName.endsWith('.pdf') || href.toLowerCase().includes('pdf');

            if (isPdf) {
                files.push({ type: 'pdf', url: href, name });
                seenUrls.add(href);
            }
        });

        return files;
    }

    // ============================================================
    // ОТПРАВКА ФАЙЛА НА SBP API
    // ============================================================

    async function sendToSbpEndpoint(files, apiKey) {
        const targetFile = files[0];
        if (!targetFile) throw new Error('Нет файлов для отправки');
        if (targetFile.type !== 'image' && targetFile.type !== 'pdf') {
            throw new Error(`Неизвестный тип файла: ${targetFile.type}`);
        }

        const blob = await gmGetBlob(targetFile.url);
        if (!blob || blob.size === 0) {
            throw new Error(`Получен файл размером 0 байт. MIME: ${blob && blob.type}`);
        }

        const fileName = normalizeFileName(
            targetFile.name,
            blob,
            targetFile.type === 'pdf' ? 'file.pdf' : 'image'
        );

        const formData = new FormData();
        formData.append('file', blob, fileName);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: API_URL,
                headers: {
                    // Передаем "голый" ключ без префикса Bearer, как требовалось
                    "authorization": apiKey
                },
                data: formData,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (e) {
                        reject(new Error('Сервер вернул не JSON: ' + response.responseText));
                    }
                },
                onerror: () => reject(new Error('Сетевая ошибка при отправке файла')),
                ontimeout: () => reject(new Error('Таймаут при отправке файла')),
            });
        });
    }

    // ============================================================
    // РЕЗУЛЬТАТ (успех / ошибка)
    // ============================================================

    function getMessageTextTarget(messageBlock) {
        return messageBlock.querySelector('.ticket-conversation__message-text') || messageBlock;
    }

    function clearOldResult(messageBlock) {
        const old = messageBlock.querySelector('.sbp-result-container');
        if (old) old.remove();
    }

    function renderSuccess(messageBlock, sbpId) {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'sbp-result-container';
        resultDiv.innerHTML = `
            <span class="sbp-label">SBP ID:</span>
            <span class="sbp-value" title="Нажмите чтобы скопировать">${sbpId}</span>
            <span class="sbp-copy-hint">копировать</span>
        `;

        const valueElement = resultDiv.querySelector('.sbp-value');
        const hint = resultDiv.querySelector('.sbp-copy-hint');

        valueElement.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(sbpId);
                const originalText = hint.textContent;
                hint.textContent = '✅ Скопировано!';
                setTimeout(() => { hint.textContent = originalText; }, 1500);
            } catch (error) {
                console.error('[SBP Checker] Ошибка копирования:', error);
            }
        });

        getMessageTextTarget(messageBlock).appendChild(resultDiv);
    }

    function renderError(messageBlock, message, isEmptyResult = false) {
        const div = document.createElement('div');
        div.className = 'sbp-result-container error';
        div.innerHTML = isEmptyResult
            ? '<span>SBP ID не найден в чеке</span>'
            : `<span>⚠️ Ошибка: ${message}</span>`;
        getMessageTextTarget(messageBlock).appendChild(div);
    }

    // ============================================================
    // КНОПКА
    // ============================================================

    function createSendButton(files, messageBlock) {
        const button = document.createElement('button');
        button.className = 'ticket-conversation__actions_button image-sender-btn';
        button.title = `Проверить чек через AI (${files.length} файл.)`;
        button.innerHTML = AI_ICON_SVG;

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // === СЕКРЕТНАЯ ФУНКЦИЯ: Смена/удаление ключа по Shift + Клик ===
            if (e.shiftKey) {
                const currentKey = GM_getValue(STORAGE_KEY, '');
                const newKey = prompt('Введите новый API ключ для SBP Checker\n(оставьте поле пустым и нажмите ОК, чтобы удалить текущий ключ):', currentKey);

                if (newKey !== null) { // Если не нажата кнопка "Отмена"
                    if (newKey.trim() === '') {
                        GM_setValue(STORAGE_KEY, '');
                        alert('API ключ удален. При следующем нажатии скрипт запросит его заново.');
                    } else {
                        GM_setValue(STORAGE_KEY, newKey.trim());
                        alert('API ключ успешно обновлен!');
                    }
                }
                return; // Прерываем обычную проверку при смене ключа
            }

            // Проверяем или запрашиваем ключ перед выполнением
            const apiKey = getApiKey();
            if (!apiKey) {
                alert('Действие отменено: API ключ не был введен.');
                return;
            }

            const originalIcon = button.innerHTML;
            clearOldResult(messageBlock);
            button.innerHTML = '<span style="font-size:12px;">⏳</span>';
            button.disabled = true;

            try {
                const result = await sendToSbpEndpoint(files, apiKey);
                if (result && result.sbp_id) {
                    renderSuccess(messageBlock, result.sbp_id);
                } else {
                    renderError(messageBlock, null, true);
                }
            } catch (error) {
                console.error('[SBP Checker] Ошибка:', error);
                renderError(messageBlock, error.message);
            } finally {
                button.innerHTML = originalIcon;
                button.disabled = false;
            }
        });

        return button;
    }

    function ensureButtonIsFirst(spanElement, btn) {
        if (spanElement.firstChild !== btn) {
            spanElement.insertBefore(btn, spanElement.firstChild);
        }
    }

    // ============================================================
    // ОБРАБОТКА СООБЩЕНИЯ / СКАНИРОВАНИЕ СТРАНИЦЫ
    // ============================================================

    function processMessage(messageBlockElement) {
        const files = findFilesInMessage(messageBlockElement);
        if (files.length === 0) return;

        const actionsContainer = messageBlockElement.querySelector('.ticket-conversation__actions');
        if (!actionsContainer) return;

        const buttonsSpan = actionsContainer.querySelector('span.ticket-conversation__actions-btn');
        if (!buttonsSpan) return;

        let btn = myButtonsMap.get(buttonsSpan);

        if (!btn) {
            btn = createSendButton(files, messageBlockElement);
            myButtonsMap.set(buttonsSpan, btn);
            buttonsSpan.insertBefore(btn, buttonsSpan.firstChild);

            // Следим, чтобы HelpDeskeddy не переставил нашу кнопку
            new MutationObserver(() => {
                if (buttonsSpan.contains(btn)) ensureButtonIsFirst(buttonsSpan, btn);
            }).observe(buttonsSpan, { childList: true });
        } else {
            ensureButtonIsFirst(buttonsSpan, btn);
        }
    }

    function scanPage() {
        document
            .querySelectorAll('.ticket-conversation__message-block')
            .forEach(processMessage);
    }

    // ============================================================
    // ЗАПУСК
    // ============================================================

    let debounceTimer;
    new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanPage, 500);
    }).observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        console.log('[SBP Checker] запущен');
        scanPage();
        setTimeout(scanPage, 3000);
    }, 2000);

})();