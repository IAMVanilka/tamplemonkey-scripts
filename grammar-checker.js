// ==UserScript==
// @name         HelpDeskEddy Grammar Check
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Добавляет кнопку проверки грамматики.
// @match        *://*.helpdeskeddy.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @author       Artyom Kalashikov
// ==/UserScript==

(function () {
    'use strict';

    const ENDPOINT = 'https://api.my-sandbox.space/v1/check_grammar';
    const BUTTON_ID = 'grammar-check-btn';
    const STYLE_ID = 'grammar-check-btn-styles';
    const STORAGE_KEY = 'helpdeskeddy_api_key';

    const AI_ICON = `
        <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="14" height="14" viewBox="0 0 30 30" fill="white">
            <path d="M14.217,19.707l-1.112,2.547c-0.427,0.979-1.782,0.979-2.21,0l-1.112-2.547c-0.99-2.267-2.771-4.071-4.993-5.057
                l-2.965-1.301c-0.973-0.432-0.973-1.848,0-2.28l2.965-1.316C6.974,8.684,8.787,6.813,9.76,4.47l1.126-2.714
                c0.418-1.007,1.81-1.007,2.228,0L14.24,4.47c0.973,2.344,2.786,4.215,5.065,5.226l2.965,1.316c0.973,0.432,0.973,1.848,0,2.28
                l-3.061,1.359C16.988,15.637,15.206,17.441,14.217,19.707z"></path>
            <path d="M24.481,27.796l-0.339,0.777c-0.248,0.569-1.036,0.569-1.284,0l-0.339-0.777c-0.604-1.385-1.693-2.488-3.051-3.092
                l-1.044-0.464c-0.565-0.251-0.565-1.072,0-1.323l0.986-0.438c1.393-0.619,2.501-1.763,3.095-3.195l0.348-0.84
                c0.243-0.585,1.052-0.585,1.294,0l0.348,0.84c0.594,1.432,1.702,2.576,3.095,3.195l0.986,0.438c0.565,0.251,0.565,1.072,0,1.323
                l-1.044,0.464C26.174,25.308,25.085,26.411,24.481,27.796z"></path>
        </svg>
    `;

    let isButtonActive = false;
    let retryTimeoutId = null;

    // ============================================================
    // УПРАВЛЕНИЕ API КЛЮЧОМ (Безопасное и не блокирующее загрузку)
    // ============================================================

    function getApiKey() {
        // Пытаемся получить ключ из хранилища
        let key = GM_getValue(STORAGE_KEY, '');

        // Если ключа нет, запрашиваем его
        if (!key) {
            key = prompt('Для работы проверки грамматики необходим API ключ.\nПожалуйста, введите ваш API ключ:');

            if (key && key.trim() !== '') {
                key = key.trim();
                GM_setValue(STORAGE_KEY, key); // Сохраняем
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

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID} {
                margin-right: 8px !important;
                padding: 7px 15px !important;
                background-color: #2e8b9e !important;
                color: white !important;
                border: none !important;
                border-radius: 3px !important;
                cursor: pointer !important;
                font-size: 12px !important;
                line-height: 1 !important;
                transition: background-color 0.2s ease !important;
                display: inline-flex !important;
                align-items: center !important;
                vertical-align: middle !important;
            }
            #${BUTTON_ID}:hover {
                background-color: #3faeb5 !important;
            }
            #${BUTTON_ID}:disabled {
                opacity: 0.6 !important;
                cursor: not-allowed !important;
            }
            #${BUTTON_ID} svg {
                position: relative;
                left: -4px;
                color: white;
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // СЕТЕВОЙ ЗАПРОС
    // ============================================================

    function gmFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers,
                data: body,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error('HTTP ' + response.status + ': ' + response.responseText));
                        return;
                    }
                    let jsonData;
                    try {
                        jsonData = JSON.parse(response.responseText);
                    } catch (e) {
                        jsonData = response.responseText;
                    }
                    resolve(jsonData);
                },
                onerror: () => reject(new Error('Сетевая ошибка при запросе к ' + url)),
            });
        });
    }

    // ============================================================
    // ПОИСК CKEDITOR / КНОПКИ «ДОБАВИТЬ ОТВЕТ»
    // ============================================================

    function getCKEditorInstance(element) {
        if (!element) return null;

        const container = element.closest('.ck-editor__editable') || element.closest('.ck-content');
        if (container) {
            if (container.ckeditorInstance) return container.ckeditorInstance;
            const editorRoot = container.closest('.ck-editor');
            if (editorRoot && editorRoot.ckeditorInstance) return editorRoot.ckeditorInstance;
        }

        for (const key in window) {
            if (!key.startsWith('CKEditor') && !key.includes('Editor')) continue;
            const obj = window[key];
            if (obj && typeof obj.editors === 'object') {
                for (const edKey in obj.editors) return obj.editors[edKey];
            }
        }

        return null;
    }

    function findSubmitButton() {
        const buttons = document.querySelectorAll('button.el-button');
        for (const button of buttons) {
            const text = (button.textContent || button.innerText || '').trim();
            if (text === 'Добавить ответ') return button;
        }
        return null;
    }

    // ============================================================
    // ЛОГИКА КНОПКИ
    // ============================================================

    async function handleGrammarCheck(btn, event) {
        // === СЕКРЕТНАЯ ФУНКЦИЯ: Смена/удаление ключа по Shift + Клик ===
        if (event.shiftKey) {
            const currentKey = GM_getValue(STORAGE_KEY, '');
            const newKey = prompt('Введите новый API ключ\n(оставьте поле пустым и нажмите ОК, чтобы удалить текущий ключ):', currentKey);

            if (newKey !== null) { // Если не нажата кнопка "Отмена"
                if (newKey.trim() === '') {
                    GM_setValue(STORAGE_KEY, '');
                    alert('API ключ удален. При следующем нажатии скрипт запросит его заново.');
                } else {
                    GM_setValue(STORAGE_KEY, newKey.trim());
                    alert('API ключ успешно обновлен!');
                }
            }
            return;
        }

        // Проверяем или запрашиваем ключ перед выполнением
        const apiKey = getApiKey();
        if (!apiKey) {
            alert('Проверка отменена: API ключ не был введен.');
            return;
        }

        const editableArea = document.querySelector('.ck-content, [contenteditable="true"]');
        const editor = getCKEditorInstance(editableArea);

        const originalText = editor
            ? editor.ui.view.editable.element.innerText
            : (editableArea ? editableArea.innerText : '');

        if (!originalText || !originalText.trim()) {
            alert('Поле ввода пустое');
            return;
        }

        const originalHtml = btn.innerHTML;
        btn.innerHTML = AI_ICON + '<span> Проверяю...</span>';
        btn.disabled = true;

        try {
            const data = await gmFetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Убрали Bearer, теперь отправляется только сам ключ
                    'Authorization': apiKey
                },
                body: JSON.stringify({ text: originalText }),
            });

            const fixedText = data.remarked_text;

            if (!fixedText || fixedText === originalText) {
                alert('ИИ решил, что изменять нечего.');
                return;
            }

            const apply = confirm(
                `Текст от ИИ:\n ------ \n ${fixedText} \n ------ \n\n Заменить текст на исправленный вариант?`
            );

            if (apply) {
                if (editor && typeof editor.setData === 'function') {
                    editor.setData(fixedText);
                } else if (editableArea) {
                    editableArea.innerHTML = fixedText;
                }
            }
        } catch (err) {
            alert('Ошибка: ' + err.message);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }

    // ============================================================
    // ВСТАВКА КНОПКИ И НАБЛЮДЕНИЕ ЗА DOM
    // ============================================================

    function injectButton(submitBtn) {
        const oldBtn = document.getElementById(BUTTON_ID);
        if (oldBtn) oldBtn.remove();

        injectStyles();

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.innerHTML = AI_ICON + '<span>Проверить грамматику</span>';
        btn.addEventListener('click', (e) => handleGrammarCheck(btn, e));

        submitBtn.insertAdjacentElement('beforebegin', btn);
        isButtonActive = true;
    }

    function checkAndInject() {
        if (isButtonActive && document.getElementById(BUTTON_ID)) return;

        isButtonActive = false;

        const submitBtn = findSubmitButton();
        if (!submitBtn) return;

        setTimeout(() => {
            if (findSubmitButton()) injectButton(submitBtn);
        }, 200);
    }

    // Запускаем наблюдатель. Теперь он запустится ВСЕГДА, независимо от наличия ключа.
    new MutationObserver(() => {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = setTimeout(checkAndInject, 300);
    }).observe(document.body, { childList: true, subtree: true });

    // Первичная проверка
    checkAndInject();

})();