import {
    DEFAULT_WORLDBOOK_CATEGORIES,
    defaultAliasMergePrompt,
    defaultChapterAssetsPrompt,
    defaultConsolidatePrompt,
    defaultDirectorFrameworkPrompt,
    defaultDirectorInjectionPrompt,
    defaultWorldbookPrompt,
} from '../core/constants.js';

export function bindActionEvents(deps = {}) {
    const {
        AppState,
        handleStartConversion,
        handleStartDirectorConversion,
        handleStopProcessing,
        handleRepairFailedMemories,
        showStartFromSelector,
        showProcessedResults,
        toggleMultiSelectMode,
        deleteSelectedMemories,
        updateMemoryQueueUI,
        showSearchModal,
        showReplaceModal,
        showWorldbookView,
        showHistoryView,
        showConsolidateCategorySelector,
        showCleanTagsModal,
        showAliasMergeUI,
        showTxtConverterPanel,
        showProgressPanel,
        showStoryOutlinePanel,
        showCurrentChapterPanel,
        showSettingsPanel,
    } = deps;
    const LAST_MODAL_VIEW_STORAGE_KEY = 'westworldTxtToWorldbookLastModalView';
    const SUPPORTED_VIEW_MODES = new Set(['txt', 'outline', 'current', 'progress', 'settings', 'prompt-editor']);

    function normalizeViewMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        return SUPPORTED_VIEW_MODES.has(normalized) ? normalized : '';
    }

    function resolveInitialViewMode() {
        const fromUi = normalizeViewMode(AppState?.ui?.lastModalView);
        if (fromUi) return fromUi;

        const fromSettings = normalizeViewMode(AppState?.settings?.lastModalView);
        if (fromSettings) return fromSettings;

        try {
            const fromStorage = normalizeViewMode(localStorage.getItem(LAST_MODAL_VIEW_STORAGE_KEY));
            if (fromStorage) return fromStorage;
        } catch (_) {
            // ignore localStorage read errors
        }

        return 'txt';
    }

    function restoreInitialView() {
        const initialView = resolveInitialViewMode();
        if (initialView === 'outline' && typeof showStoryOutlinePanel === 'function') {
            showStoryOutlinePanel();
            return;
        }
        if (initialView === 'current' && typeof showCurrentChapterPanel === 'function') {
            void Promise.resolve(showCurrentChapterPanel());
            return;
        }
        if (initialView === 'progress' && typeof showProgressPanel === 'function') {
            showProgressPanel();
            return;
        }
        if (initialView === 'settings' && typeof showSettingsPanel === 'function') {
            showSettingsPanel();
            return;
        }

        if (typeof showTxtConverterPanel === 'function') {
            showTxtConverterPanel();
        }
    }

    document.getElementById('ttw-start-btn').addEventListener('click', handleStartConversion);
    const directorStartBtn = document.getElementById('ttw-start-director-btn');
    if (directorStartBtn && typeof handleStartDirectorConversion === 'function') {
        directorStartBtn.addEventListener('click', handleStartDirectorConversion);
    }
    document.getElementById('ttw-stop-btn').addEventListener('click', handleStopProcessing);
    document.getElementById('ttw-repair-btn').addEventListener('click', handleRepairFailedMemories);
    document.getElementById('ttw-select-start').addEventListener('click', showStartFromSelector);
    document.getElementById('ttw-view-processed').addEventListener('click', showProcessedResults);

    document.getElementById('ttw-multi-delete-btn').addEventListener('click', toggleMultiSelectMode);
    document.getElementById('ttw-confirm-multi-delete').addEventListener('click', deleteSelectedMemories);
    document.getElementById('ttw-cancel-multi-select').addEventListener('click', () => {
        AppState.ui.isMultiSelectMode = false;
        AppState.ui.selectedIndices.clear();
        updateMemoryQueueUI();
    });

    document.getElementById('ttw-search-btn').addEventListener('click', showSearchModal);
    document.getElementById('ttw-replace-btn').addEventListener('click', showReplaceModal);
    document.getElementById('ttw-view-worldbook').addEventListener('click', showWorldbookView);
    document.getElementById('ttw-view-history').addEventListener('click', showHistoryView);
    document.getElementById('ttw-consolidate-entries').addEventListener('click', showConsolidateCategorySelector);
    document.getElementById('ttw-clean-tags').addEventListener('click', showCleanTagsModal);
    document.getElementById('ttw-alias-merge').addEventListener('click', showAliasMergeUI);

    const storyOutlineBtn = document.getElementById('ttw-open-story-outline');
    if (storyOutlineBtn && typeof showStoryOutlinePanel === 'function') {
        storyOutlineBtn.addEventListener('click', showStoryOutlinePanel);
    }

    const currentChapterBtn = document.getElementById('ttw-open-current-chapter');
    if (currentChapterBtn && typeof showCurrentChapterPanel === 'function') {
        currentChapterBtn.addEventListener('click', showCurrentChapterPanel);
    }

    const progressBtn = document.getElementById('ttw-open-progress');
    if (progressBtn && typeof showProgressPanel === 'function') {
        progressBtn.addEventListener('click', showProgressPanel);
    }

    restoreInitialView();
}

export function bindExportEvents(deps = {}) {
    const {
        AppState,
        showPromptPreview,
        showPlotOutlineConfigModal,
        showBatchDeleteRepeatedSegmentsModal,
        importAndMergeWorldbook,
        importAndMergeCharacterCard,
        restoreTaskSnapshot,
        loadTaskState,
        saveTaskState,
        exportSettings,
        importSettings,
        exportCharacterCard,
        exportVolumes,
        exportToSillyTavern,
        showMemoryContentModal,
    } = deps;

    document.getElementById('ttw-preview-prompt').addEventListener('click', showPromptPreview);
    document.getElementById('ttw-plot-export-config').addEventListener('click', showPlotOutlineConfigModal);
    document.getElementById('ttw-import-json').addEventListener('click', importAndMergeWorldbook);
    const importCharaBtn = document.getElementById('ttw-import-chara');
    if (importCharaBtn && typeof importAndMergeCharacterCard === 'function') {
        importCharaBtn.addEventListener('click', importAndMergeCharacterCard);
    }
    const restoreSnapshotBtn = document.getElementById('ttw-restore-snapshot');
    if (restoreSnapshotBtn && typeof restoreTaskSnapshot === 'function') {
        restoreSnapshotBtn.addEventListener('click', restoreTaskSnapshot);
    }
    const cleanRepeatBtn = document.getElementById('ttw-clean-repeat-segments');
    if (cleanRepeatBtn && typeof showBatchDeleteRepeatedSegmentsModal === 'function') {
        cleanRepeatBtn.addEventListener('click', showBatchDeleteRepeatedSegmentsModal);
    }
    document.getElementById('ttw-import-task').addEventListener('click', loadTaskState);
    document.getElementById('ttw-export-task').addEventListener('click', saveTaskState);
    document.getElementById('ttw-export-settings').addEventListener('click', exportSettings);
    document.getElementById('ttw-import-settings').addEventListener('click', importSettings);
    document.getElementById('ttw-export-json').addEventListener('click', exportCharacterCard);
    document.getElementById('ttw-export-volumes').addEventListener('click', exportVolumes);
    document.getElementById('ttw-export-st').addEventListener('click', exportToSillyTavern);
    const memoryQueueContainer = document.getElementById('ttw-memory-queue');
    if (memoryQueueContainer) {
        memoryQueueContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.ttw-memory-item');
            if (!item) return;

            const index = parseInt(item.dataset.index, 10);
            if (isNaN(index)) return;

            if (AppState.ui.isMultiSelectMode) {
                const checkbox = item.querySelector('.ttw-memory-checkbox');
                if (e.target.type !== 'checkbox' && checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            } else {
                showMemoryContentModal(index);
            }
        });

        memoryQueueContainer.addEventListener('change', (e) => {
            if (!e.target.classList.contains('ttw-memory-checkbox')) return;

            const item = e.target.closest('.ttw-memory-item');
            const index = parseInt(item?.dataset.index, 10);
            if (isNaN(index)) return;

            if (e.target.checked) {
                AppState.ui.selectedIndices.add(index);
                item.classList.add('selected-for-delete');
            } else {
                AppState.ui.selectedIndices.delete(index);
                item.classList.remove('selected-for-delete');
            }

            const selectedCountEl = document.getElementById('ttw-selected-count');
            if (selectedCountEl) {
                selectedCountEl.textContent = `已选: ${AppState.ui.selectedIndices.size}`;
            }
        });
    }
}

export function bindFileEvents(deps = {}) {
    const {
        AppState,
        ErrorHandler,
        confirmAction,
        handleFileSelect,
        handleClearFile,
        previewRepeatedSegmentsCleanup,
        executeRepeatedSegmentsCleanup,
    } = deps;

    const uploadArea = document.getElementById('ttw-upload-area');
    const fileInput = document.getElementById('ttw-file-input');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e67e22';
        uploadArea.style.background = 'rgba(230,126,34,0.1)';
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#555';
        uploadArea.style.background = 'transparent';
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#555';
        uploadArea.style.background = 'transparent';
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });

    document.getElementById('ttw-clear-file').addEventListener('click', handleClearFile);
    document.getElementById('ttw-novel-name-input').addEventListener('input', (e) => {
        AppState.file.novelName = e.target.value.trim();
    });

    const cleanInput = document.getElementById('ttw-inline-clean-repeat-input');
    const cleanHint = document.getElementById('ttw-inline-clean-repeat-hint');
    const cleanPreviewBtn = document.getElementById('ttw-inline-clean-repeat-preview');
    const cleanExecBtn = document.getElementById('ttw-inline-clean-repeat-execute');
    const cleanResultWrap = document.getElementById('ttw-inline-clean-repeat-results');
    const cleanSummary = document.getElementById('ttw-inline-clean-repeat-summary');
    const cleanDetails = document.getElementById('ttw-inline-clean-repeat-details');
    const rangeEls = document.querySelectorAll('input[name="ttw-inline-clean-repeat-range"]');

    if (!cleanInput || !cleanPreviewBtn || !cleanExecBtn || !cleanResultWrap || !cleanSummary || !cleanDetails) {
        return;
    }

    const showError = (message) => {
        if (ErrorHandler && typeof ErrorHandler.showUserError === 'function') {
            ErrorHandler.showUserError(message);
            return;
        }
        alert(message);
    };

    const showSuccess = (message) => {
        if (ErrorHandler && typeof ErrorHandler.showUserSuccess === 'function') {
            ErrorHandler.showUserSuccess(message);
            return;
        }
        alert(message);
    };

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const parseSegmentsForHint = (input) => {
        const raw = String(input || '').replace(/\r\n?/g, '\n').trim();
        if (!raw) return [];

        const blocks = raw
            .split(/\n\s*\n+/)
            .map((item) => item.trim())
            .filter(Boolean);

        const source = blocks.length > 1
            ? blocks
            : raw
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);

        const unique = [];
        const seen = new Set();
        for (const item of source) {
            if (!item || seen.has(item)) continue;
            seen.add(item);
            unique.push(item);
        }
        return unique;
    };

    const getRangeMode = () => {
        const selected = document.querySelector('input[name="ttw-inline-clean-repeat-range"]:checked');
        return selected ? selected.value : 'all';
    };

    const renderPreviewResult = (preview) => {
        cleanResultWrap.style.display = 'block';

        if (!preview || preview.totalHits <= 0) {
            cleanSummary.innerHTML = '<span style="color:#95a5a6;">预览完成：未命中任何重复片段。</span>';
            cleanDetails.innerHTML = '';
            cleanExecBtn.disabled = true;
            cleanExecBtn.textContent = '🧹 执行删除';
            return;
        }

        cleanSummary.innerHTML = `
            <div style="color:#2ecc71;font-weight:bold;">预览命中 ${preview.totalHits} 次，涉及 ${preview.chapterStats.length} 章，预计删除 ${preview.totalRemovedChars} 字。</div>
            <div style="font-size:11px;color:#aaa;margin-top:4px;">匹配方式：精确字面量匹配（不使用正则）。</div>
        `;

        const chapterLines = preview.chapterStats
            .slice(0, 12)
            .map((item) => {
                const chapter = escapeHtml(item.chapterTitle || `第${item.index + 1}章`);
                return `<li>${chapter}：命中 ${item.hits} 次，删除 ${item.removedChars} 字</li>`;
            })
            .join('');

        const segmentLines = preview.segmentHits
            .filter((item) => item.hits > 0)
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 6)
            .map((item) => {
                const text = escapeHtml(item.segment.slice(0, 40));
                const suffix = item.segment.length > 40 ? '...' : '';
                return `<li>片段「${text}${suffix}」命中 ${item.hits} 次</li>`;
            })
            .join('');

        cleanDetails.innerHTML = `
            <div style="font-size:12px;color:#ddd;margin-bottom:6px;">章节命中（最多12条）</div>
            <ul style="margin:0 0 8px 16px;padding:0;line-height:1.7;">${chapterLines}</ul>
            <div style="font-size:12px;color:#ddd;margin-bottom:6px;">片段统计（Top 6）</div>
            <ul style="margin:0 0 0 16px;padding:0;line-height:1.7;">${segmentLines || '<li>无</li>'}</ul>
        `;

        cleanExecBtn.disabled = false;
        cleanExecBtn.textContent = `🧹 执行删除（${preview.totalHits} 处）`;
    };

    let previewState = null;

    const markPreviewDirty = () => {
        previewState = null;
        cleanExecBtn.disabled = true;
        cleanExecBtn.textContent = '🧹 执行删除';
        cleanResultWrap.style.display = 'none';
    };

    const refreshHint = () => {
        const segments = parseSegmentsForHint(cleanInput.value || '');
        if (!cleanHint) return;
        cleanHint.textContent = segments.length > 0
            ? `已解析 ${segments.length} 个待删片段（去重后）`
            : '尚未解析片段';
    };

    cleanInput.addEventListener('input', () => {
        refreshHint();
        markPreviewDirty();
    });

    rangeEls.forEach((el) => {
        el.addEventListener('change', markPreviewDirty);
    });

    cleanPreviewBtn.addEventListener('click', () => {
        if (typeof previewRepeatedSegmentsCleanup !== 'function') {
            showError('当前版本不支持预览清洗');
            return;
        }

        const rangeMode = getRangeMode();
        const previewResult = previewRepeatedSegmentsCleanup(cleanInput.value || '', rangeMode, []);
        if (!previewResult || !previewResult.ok) {
            showError((previewResult && previewResult.error) || '预览失败');
            return;
        }

        previewState = {
            segments: previewResult.segments,
            chapterIndices: previewResult.chapterIndices,
            preview: previewResult.preview,
        };

        renderPreviewResult(previewResult.preview);
    });

    cleanExecBtn.addEventListener('click', async () => {
        if (!previewState || !previewState.preview || previewState.preview.totalHits <= 0) {
            showError('请先预览并确认有命中内容');
            return;
        }

        const preview = previewState.preview;
        const confirmed = typeof confirmAction === 'function'
            ? await confirmAction(
                `确定执行删除吗？\n\n将删除 ${preview.totalHits} 处重复片段，涉及 ${preview.chapterStats.length} 章。`,
                { title: '确认批量删除', danger: true },
            )
            : window.confirm(`确定执行删除吗？\n\n将删除 ${preview.totalHits} 处重复片段，涉及 ${preview.chapterStats.length} 章。`);

        if (!confirmed) return;

        if (typeof executeRepeatedSegmentsCleanup !== 'function') {
            showError('当前版本不支持执行清洗');
            return;
        }

        const executeResult = executeRepeatedSegmentsCleanup(previewState.segments, previewState.chapterIndices);
        if (!executeResult || !executeResult.ok) {
            showError((executeResult && executeResult.error) || '执行失败');
            return;
        }

        const result = executeResult.result || {
            changedIndices: [],
            resetProcessedIndices: [],
            deletedHits: 0,
            deletedChars: 0,
        };

        if (result.changedIndices.length === 0) {
            showError('执行完成，但没有检测到可删除内容');
            return;
        }

        const resetCount = result.resetProcessedIndices.length;
        const suffix = resetCount > 0
            ? `，其中 ${resetCount} 章原为已处理，已重置为未处理`
            : '';
        showSuccess(`清洗完成：删除 ${result.deletedHits} 处，影响 ${result.changedIndices.length} 章，共移除约 ${result.deletedChars} 字${suffix}`);

        markPreviewDirty();
    });

    refreshHint();
}

export function bindStreamEvents(deps = {}) {
    const {
        updateStreamContent,
    } = deps;

    document.getElementById('ttw-toggle-stream').addEventListener('click', () => {
        const container = document.getElementById('ttw-stream-container');
        container.style.display = container.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('ttw-clear-stream').addEventListener('click', () => updateStreamContent('', true));

    document.getElementById('ttw-copy-stream').addEventListener('click', () => {
        const streamEl = document.getElementById('ttw-stream-content');
        if (streamEl && streamEl.textContent) {
            navigator.clipboard.writeText(streamEl.textContent).then(() => {
                const btn = document.getElementById('ttw-copy-stream');
                const orig = btn.textContent;
                btn.textContent = '✅ 已复制';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = streamEl.textContent;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                const btn = document.getElementById('ttw-copy-stream');
                btn.textContent = '✅ 已复制';
                setTimeout(() => { btn.textContent = '📋 复制全部'; }, 1500);
            });
        }
    });

    document.getElementById('ttw-debug-mode').addEventListener('change', (e) => {
        const copyBtn = document.getElementById('ttw-copy-stream');
        if (copyBtn) copyBtn.style.display = e.target.checked ? 'inline-block' : 'none';
    });
}

export function bindSettingEvents(deps = {}) {
    const {
        EventDelegate,
        modalContainer,
        AppState,
        saveCurrentSettings,
        handleUseTavernApiChange,
        handleProviderChange,
        switchApiTab,
        handleFetchModels,
        handleQuickTest,
        rechunkMemories,
        showAddCategoryModal,
        saveCustomCategories,
        confirmAction,
        resetToDefaultCategories,
        renderCategoriesList,
        renderCategoryGuidePromptEditors,
        showAddDefaultEntryModal,
        saveDefaultWorldbookEntriesUI,
        applyDefaultWorldbookEntries,
        showResultSection,
        updateWorldbookPreview,
        ErrorHandler,
        testChapterRegex,
        handlePluginSelfUpdate,
    } = deps;

    const getPromptDefaultValue = (type) => {
        if (type === 'worldbook') return defaultWorldbookPrompt;
        if (type === 'consolidate') return defaultConsolidatePrompt;
        if (type === 'alias-merge') return defaultAliasMergePrompt;
        if (type === 'chapter-assets') return defaultChapterAssetsPrompt;
        if (type === 'director-framework') return defaultDirectorFrameworkPrompt;
        if (type === 'director-injection') return defaultDirectorInjectionPrompt;
        return '';
    };

    const getDirectorApi = () => {
        if (typeof window === 'undefined') return null;
        return window.WestWorld || window.WestWorldTxtToWorldbook || window.StoryWeaver || null;
    };

    const formatTime = (value) => {
        const at = Number(value || 0);
        if (!at) return '无';
        try {
            return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
        } catch (_) {
            return String(at);
        }
    };

    const writeClipboard = async (text) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
    };

    const buildDirectorDiagnosticsSnapshot = () => {
        const api = getDirectorApi();
        if (!api) {
            return {
                available: false,
                reason: 'westworld-api-missing',
                status: null,
                gate: null,
                context: null,
                logs: [],
            };
        }
        const status = api.getDirectorRuntimeStatus?.() || api.getDirectorStatus?.() || null;
        const gate = api.getDirectorGateStatus?.() || null;
        const promptManager = api.getDirectorPromptManagerStatus?.() || gate?.promptManager || null;
        const context = api.getDirectorContext?.({ includeRuntime: true }) || null;
        const logs = api.getDirectorLogs?.(20) || [];
        return {
            available: true,
            status,
            gate,
            promptManager,
            context,
            logs,
        };
    };

    const renderDirectorDiagnostics = () => {
        const summaryEl = document.getElementById('ttw-director-diagnostics-summary');
        const jsonEl = document.getElementById('ttw-director-diagnostics-json');
        const logsEl = document.getElementById('ttw-director-diagnostics-logs');
        if (!summaryEl && !jsonEl && !logsEl) return;

        const snapshot = buildDirectorDiagnosticsSnapshot();
        const status = snapshot.status || {};
        const injection = status.lastInjection || {};
        const boundSession = status.boundSession || null;
        const context = snapshot.context || {};
        const promptManager = snapshot.promptManager || {};
        const chapter = context.chapter || {};
        const beat = context.beat || {};

        const cells = [
            ['API', snapshot.available ? '已连接' : '缺失'],
            ['Hook', status.hookRegistered ? '已注册' : '未注册'],
            ['ST预设条目', promptManager.exists ? (promptManager.activeEnabled ? '已启用' : '已关闭') : '缺失'],
            ['深度/顺序', promptManager.exists ? `${promptManager.injectionDepth ?? '-'} / ${promptManager.injectionOrder ?? '-'}` : '无'],
            ['阶段', status.phase || 'unknown'],
            ['跳过原因', status.lastSkipReason || '无'],
            ['章节', Number.isInteger(chapter.index) ? `${chapter.index + 1}` : (Number.isInteger(status.lastChapterIndex) && status.lastChapterIndex >= 0 ? `${status.lastChapterIndex + 1}` : '无')],
            ['Beat', Number.isInteger(beat.index) ? `${beat.index + 1}/${beat.count || 0}` : (Number.isInteger(status.lastBeatIndex) && status.lastBeatIndex >= 0 ? `${status.lastBeatIndex + 1}/${status.lastBeatCount || 0}` : '无')],
            ['注入', injection.injected ? '已插入' : '未确认'],
            ['Marker', injection.markerFoundAfterInsert ? '存在' : '未确认'],
            ['绑定', boundSession ? `第${Number(boundSession.chapterIndex || 0) + 1}章` : '未绑定'],
            ['最近运行', formatTime(status.lastRunAt)],
            ['失效', status.invalidated ? (status.invalidationReason || 'needs-resync') : '否'],
        ];

        if (summaryEl) {
            summaryEl.innerHTML = cells.map(([label, value]) => `
                <div style="padding:7px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;min-width:0;">
                    <div style="font-size:10px;color:#aaa;margin-bottom:3px;">${String(label)}</div>
                    <div style="font-size:12px;color:#fff;overflow-wrap:anywhere;">${String(value)}</div>
                </div>
            `).join('');
        }
        if (jsonEl) {
            jsonEl.textContent = JSON.stringify(snapshot, null, 2);
        }
        if (logsEl) {
            const logs = Array.isArray(snapshot.logs) ? snapshot.logs.slice().reverse() : [];
            logsEl.innerHTML = logs.length > 0
                ? logs.map((log) => `
                    <div style="padding:5px 7px;background:rgba(0,0,0,0.22);border-radius:5px;color:#ddd;">
                        <span style="color:#888;">${formatTime(log.at)}</span>
                        <span style="color:#8bc5ff;">${String(log.phase || log.level || '')}</span>
                        <span>${String(log.message || '')}</span>
                    </div>
                `).join('')
                : '<div style="color:#888;">暂无日志</div>';
        }
    };

    const copyDirectorDiagnostics = async () => {
        const snapshot = buildDirectorDiagnosticsSnapshot();
        await writeClipboard(JSON.stringify(snapshot, null, 2));
        ErrorHandler?.showUserSuccess?.('导演诊断 JSON 已复制');
    };

    const testDirectorInjection = () => {
        const api = getDirectorApi();
        const result = api?.testDirectorInjection?.() || { ok: false, reason: 'westworld-api-missing' };
        renderDirectorDiagnostics();
        if (result.ok) {
            ErrorHandler?.showUserSuccess?.('模拟注入测试通过');
        } else {
            ErrorHandler?.showUserError?.(`模拟注入测试失败：${result.reason || result.result?.reason || 'unknown'}`);
        }
    };

    const clearDirectorLogs = () => {
        const api = getDirectorApi();
        api?.clearDirectorLogs?.();
        renderDirectorDiagnostics();
        ErrorHandler?.showUserSuccess?.('导演日志已清空');
    };

    const repairDirectorPromptManagerEntry = () => {
        const api = getDirectorApi();
        const result = api?.repairDirectorPromptManagerEntry?.() || { ok: false, reason: 'westworld-api-missing' };
        renderDirectorDiagnostics();
        if (result.ok) {
            ErrorHandler?.showUserSuccess?.('已修复/创建 SillyTavern 预设条目：WestWorld Director');
        } else {
            ErrorHandler?.showUserError?.(`修复失败：${result.reason || 'unknown'}`);
        }
    };

    const bindDirectorSession = () => {
        const api = getDirectorApi();
        const result = api?.bindDirectorSessionToCurrentChapter?.() || { ok: false, reason: 'westworld-api-missing' };
        renderDirectorDiagnostics();
        if (result.ok) {
            const chapterNo = Number.isInteger(result.binding?.chapterIndex) ? result.binding.chapterIndex + 1 : 0;
            ErrorHandler?.showUserSuccess?.(`已绑定当前聊天到第${chapterNo}章`);
        } else {
            ErrorHandler?.showUserError?.(`绑定失败：${result.reason || 'unknown'}`);
        }
    };

    const savePromptByType = (type) => {
        const textarea = document.getElementById(`ttw-${type}-prompt`);
        if (!textarea) return;

        if (type === 'worldbook') {
            AppState.settings.customWorldbookPrompt = textarea.value || '';
        } else if (type === 'consolidate') {
            AppState.settings.customConsolidatePrompt = textarea.value || '';
        } else if (type === 'alias-merge') {
            AppState.settings.customAliasMergePrompt = textarea.value || '';
        } else if (type === 'chapter-assets') {
            AppState.settings.customChapterAssetsPrompt = textarea.value || '';
        } else if (type === 'director-framework') {
            AppState.settings.customDirectorFrameworkPrompt = textarea.value || '';
        } else if (type === 'director-injection') {
            AppState.settings.customDirectorInjectionPrompt = textarea.value || '';
        }

        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        if (ErrorHandler && typeof ErrorHandler.showUserSuccess === 'function') {
            ErrorHandler.showUserSuccess('提示词已保存');
        }
    };

    EventDelegate.batchOn(modalContainer, {
        '#ttw-use-tavern-api': { change: () => { handleUseTavernApiChange(); saveCurrentSettings(); } },
        '#ttw-api-provider': { change: () => { handleProviderChange('main'); saveCurrentSettings(); } },
        '#ttw-api-provider-main': { change: () => { handleProviderChange('main'); saveCurrentSettings(); } },
        '#ttw-api-provider-director': { change: () => { handleProviderChange('director'); saveCurrentSettings(); } },
        '#ttw-model-select': { change: (e) => { if (e.target.value) { const input = document.getElementById('ttw-api-model-main') || document.getElementById('ttw-api-model'); if (input) input.value = e.target.value; saveCurrentSettings(); } } },
        '#ttw-model-select-main': { change: (e) => { if (e.target.value) { const input = document.getElementById('ttw-api-model-main') || document.getElementById('ttw-api-model'); if (input) input.value = e.target.value; saveCurrentSettings(); } } },
        '#ttw-model-select-director': { change: (e) => { if (e.target.value) { const input = document.getElementById('ttw-api-model-director'); if (input) input.value = e.target.value; saveCurrentSettings(); } } },
        '#ttw-fetch-models': { click: () => handleFetchModels('main') },
        '#ttw-quick-test': { click: () => handleQuickTest('main') },
        '#ttw-fetch-models-main': { click: () => handleFetchModels('main') },
        '#ttw-quick-test-main': { click: () => handleQuickTest('main') },
        '#ttw-fetch-models-director': { click: () => handleFetchModels('director') },
        '#ttw-quick-test-director': { click: () => handleQuickTest('director') },
        '#ttw-api-tab-main': { click: () => switchApiTab?.('main') },
        '#ttw-api-tab-director': { click: () => switchApiTab?.('director') },
        '#ttw-parallel-enabled': { change: (e) => { AppState.config.parallel.enabled = e.target.checked; saveCurrentSettings(); } },
        '#ttw-parallel-concurrency': { change: (e) => {
            AppState.config.parallel.concurrency = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 3));
            AppState.config.parallel.mainConcurrency = AppState.config.parallel.concurrency;
            AppState.config.parallel.directorConcurrency = AppState.config.parallel.concurrency;
            e.target.value = AppState.config.parallel.concurrency;
            const mainEl = document.getElementById('ttw-parallel-main-concurrency');
            if (mainEl) mainEl.value = AppState.config.parallel.mainConcurrency;
            const directorEl = document.getElementById('ttw-parallel-director-concurrency');
            if (directorEl) directorEl.value = AppState.config.parallel.directorConcurrency;
            saveCurrentSettings();
        } },
        '#ttw-parallel-main-concurrency': { change: (e) => {
            AppState.config.parallel.mainConcurrency = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
            e.target.value = AppState.config.parallel.mainConcurrency;
            saveCurrentSettings();
        } },
        '#ttw-parallel-director-concurrency': { change: (e) => {
            AppState.config.parallel.directorConcurrency = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
            e.target.value = AppState.config.parallel.directorConcurrency;
            saveCurrentSettings();
        } },
        '#ttw-parallel-mode': { change: (e) => { AppState.config.parallel.mode = e.target.value; saveCurrentSettings(); } },
        '#ttw-chapter-completion-mode': { change: (e) => {
            AppState.settings.chapterCompletionMode = e.target.value === 'throughput' ? 'throughput' : 'consistency';
            saveCurrentSettings();
        } },
        '#ttw-volume-mode': { change: (e) => { AppState.processing.volumeMode = e.target.checked; const indicator = document.getElementById('ttw-volume-indicator'); if (indicator) indicator.style.display = AppState.processing.volumeMode ? 'block' : 'none'; } },
        '#ttw-rechunk-btn': { click: rechunkMemories },
        '#ttw-add-category': { click: showAddCategoryModal },
        '#ttw-reset-categories': { click: async () => { if (await confirmAction('确定重置为默认分类配置吗？这将清除所有自定义分类。', { title: '重置分类', danger: true })) { await resetToDefaultCategories(); renderCategoriesList(); if (typeof renderCategoryGuidePromptEditors === 'function') renderCategoryGuidePromptEditors(AppState); } } },
        '#ttw-add-default-entry': { click: showAddDefaultEntryModal },
        '#ttw-apply-default-entries': { click: () => { saveDefaultWorldbookEntriesUI(); const applied = applyDefaultWorldbookEntries(); if (applied) { showResultSection(true); updateWorldbookPreview(); ErrorHandler.showUserSuccess('默认世界书条目已应用！'); } else { ErrorHandler.showUserError('没有默认世界书条目'); } } },
        '#ttw-chapter-regex': { change: (e) => { AppState.config.chapterRegex.pattern = e.target.value; saveCurrentSettings(); } },
        '#ttw-test-chapter-regex': { click: testChapterRegex },
        '#ttw-update-plugin-btn': { click: () => { if (typeof handlePluginSelfUpdate === 'function') handlePluginSelfUpdate(); } },
        '#ttw-director-diagnostics-refresh': { click: renderDirectorDiagnostics },
        '#ttw-director-diagnostics-copy': { click: () => { copyDirectorDiagnostics().catch((error) => ErrorHandler?.showUserError?.(`复制失败：${error?.message || error}`)); } },
        '#ttw-director-diagnostics-repair-pm': { click: repairDirectorPromptManagerEntry },
        '#ttw-director-diagnostics-test': { click: testDirectorInjection },
        '#ttw-director-diagnostics-bind': { click: bindDirectorSession },
        '#ttw-director-diagnostics-clear': { click: clearDirectorLogs },
        '.ttw-chapter-preset': { click: (e, btn) => { const regex = btn.dataset.regex; document.getElementById('ttw-chapter-regex').value = regex; AppState.config.chapterRegex.pattern = regex; saveCurrentSettings(); } },
        '.ttw-reset-prompt': {
            click: (e, btn) => {
                const type = btn.getAttribute('data-type');
                const textarea = document.getElementById(`ttw-${type}-prompt`);
                if (!textarea) return;

                if (type === 'worldbook' || type === 'consolidate' || type === 'alias-merge' || type === 'chapter-assets' || type === 'director-framework' || type === 'director-injection') {
                    textarea.value = getPromptDefaultValue(type);
                    if (ErrorHandler && typeof ErrorHandler.showUserSuccess === 'function') {
                        ErrorHandler.showUserSuccess('已恢复默认内容，请点击保存按钮生效');
                    }
                    return;
                }

                textarea.value = '';
                saveCurrentSettings({ syncPromptFieldsFromDom: true });
            }
        },
        '#ttw-save-worldbook-prompt': { click: () => savePromptByType('worldbook') },
        '#ttw-save-consolidate-prompt': { click: () => savePromptByType('consolidate') },
        '#ttw-save-alias-merge-prompt': { click: () => savePromptByType('alias-merge') },
        '#ttw-save-chapter-assets-prompt': { click: () => savePromptByType('chapter-assets') },
        '#ttw-save-director-framework-prompt': { click: () => savePromptByType('director-framework') },
        '#ttw-save-director-injection-prompt': { click: () => savePromptByType('director-injection') }
    });

    EventDelegate.on(modalContainer, '.ttw-save-cat-guide', 'click', async (e, btn) => {
        const index = parseInt(btn.getAttribute('data-category-index'), 10);
        if (!Number.isInteger(index) || index < 0) return;

        const category = AppState.persistent.customCategories[index];
        if (!category) return;

        const textarea = modalContainer.querySelector(`.ttw-cat-guide-prompt-input[data-category-index="${index}"]`);
        if (!textarea) return;

        const nextGuide = (textarea.value || '').trim();
        category.contentGuide = nextGuide || `基于原文的${category.name}描述`;
        if (typeof saveCustomCategories === 'function') {
            await saveCustomCategories();
        }
        if (ErrorHandler && typeof ErrorHandler.showUserSuccess === 'function') {
            ErrorHandler.showUserSuccess(`已保存分类提示词：${category.name}`);
        }
    });

    EventDelegate.on(modalContainer, '.ttw-reset-cat-guide', 'click', async (e, btn) => {
        const index = parseInt(btn.getAttribute('data-category-index'), 10);
        if (!Number.isInteger(index) || index < 0) return;

        const category = AppState.persistent.customCategories[index];
        if (!category) return;

        const defaultCategory = DEFAULT_WORLDBOOK_CATEGORIES.find((item) => item.name === category.name);
        const fallbackGuide = `基于原文的${category.name}描述`;
        const nextGuide = defaultCategory?.contentGuide || fallbackGuide;

        category.contentGuide = nextGuide;
        const textarea = modalContainer.querySelector(`.ttw-cat-guide-prompt-input[data-category-index="${index}"]`);
        if (textarea) textarea.value = nextGuide;

        if (typeof saveCustomCategories === 'function') {
            await saveCustomCategories();
        }
        if (ErrorHandler && typeof ErrorHandler.showUserSuccess === 'function') {
            ErrorHandler.showUserSuccess(`已恢复分类默认提示词：${category.name}`);
        }
    });

    ['ttw-api-key', 'ttw-api-endpoint', 'ttw-api-model', 'ttw-api-max-tokens', 'ttw-chunk-size', 'ttw-min-chunk-size', 'ttw-api-timeout', 'ttw-api-key-main', 'ttw-api-endpoint-main', 'ttw-api-model-main', 'ttw-api-max-tokens-main', 'ttw-api-key-director', 'ttw-api-endpoint-director', 'ttw-api-model-director', 'ttw-api-max-tokens-director'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveCurrentSettings);
    });

    ['ttw-director-framework-suffix', 'ttw-director-injection-suffix'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (id === 'ttw-director-framework-suffix') {
                AppState.settings.customDirectorFrameworkSuffix = el.value;
            } else if (id === 'ttw-director-injection-suffix') {
                AppState.settings.customDirectorInjectionSuffix = el.value;
            }
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
        });
    });

    ['ttw-incremental-mode', 'ttw-volume-mode', 'ttw-enable-plot', 'ttw-enable-style', 'ttw-force-chapter-marker', 'ttw-allow-recursion', 'ttw-director-run-every-turn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveCurrentSettings);
    });
    ['ttw-director-state-start-tag', 'ttw-director-state-end-tag'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveCurrentSettings);
    });
    const directorMode = document.getElementById('ttw-director-mode');
    if (directorMode) directorMode.addEventListener('change', () => {
        AppState.settings.directorMode = directorMode.value;
        AppState.settings.directorEnabled = directorMode.value !== 'off';
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
    });
    const directorFallback = document.getElementById('ttw-director-fallback-on-error');
    if (directorFallback) directorFallback.addEventListener('change', () => {
        AppState.settings.directorFallbackOnError = directorFallback.checked;
        AppState.settings.directorAutoFallbackToMain = directorFallback.checked;
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
    });

    // --- Prompt Prefix Presets ---
    bindPromptPrefixPresetEvents({
        AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer,
    });

    // --- AI Route Presets ---
    bindAiRoutePresetEvents({
        AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer, handleProviderChange,
    });

    // --- Director Framework Prompt Presets ---
    bindDirectorPromptPresetEvents({
        AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer,
        presetKey: 'westworldDirectorFrameworkPresets',
        selectedKey: 'westworldSelectedDirectorFrameworkPreset',
        selectId: 'ttw-director-framework-preset-select',
        loadBtnId: 'ttw-director-framework-preset-load',
        saveBtnId: 'ttw-director-framework-preset-save-as',
        deleteBtnId: 'ttw-director-framework-preset-delete',
        textareaId: 'ttw-director-framework-prompt',
        settingKey: 'customDirectorFrameworkPrompt',
        label: '导演AI框架提示词',
    });

    // --- Director Injection Prompt Presets ---
    bindDirectorPromptPresetEvents({
        AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer,
        presetKey: 'westworldDirectorInjectionPresets',
        selectedKey: 'westworldSelectedDirectorInjectionPreset',
        selectId: 'ttw-director-injection-preset-select',
        loadBtnId: 'ttw-director-injection-preset-load',
        saveBtnId: 'ttw-director-injection-preset-save-as',
        deleteBtnId: 'ttw-director-injection-preset-delete',
        textareaId: 'ttw-director-injection-prompt',
        settingKey: 'customDirectorInjectionPrompt',
        label: '导演注入演员前置提示词',
    });

    renderDirectorDiagnostics();
}

export function bindPromptEvents(deps = {}) {
    const {
        saveCurrentSettings,
    } = deps;

    ['ttw-plot-prompt', 'ttw-style-prompt', 'ttw-suffix-prompt'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => saveCurrentSettings({ syncPromptFieldsFromDom: true }));
    });
}

export function bindMessageChainEvents(deps = {}) {
    const {
        AppState,
        renderMessageChainUI,
        saveCurrentSettings,
        confirmAction,
    } = deps;

    renderMessageChainUI();
    document.getElementById('ttw-add-chain-msg').addEventListener('click', () => {
        if (!AppState.settings.promptMessageChain) AppState.settings.promptMessageChain = [];
        AppState.settings.promptMessageChain.push({ role: 'user', content: '', enabled: true });
        renderMessageChainUI();
        saveCurrentSettings();
    });
    document.getElementById('ttw-reset-chain').addEventListener('click', async () => {
        if (await confirmAction('确定恢复默认消息链？', { title: '恢复默认消息链' })) {
            AppState.settings.promptMessageChain = [{ role: 'user', content: '{PROMPT}', enabled: true }];
            renderMessageChainUI();
            saveCurrentSettings();
        }
    });
}

function toggleCollapsePanel(contentId, header) {
    const content = document.getElementById(contentId);
    const icon = header.querySelector('.ttw-collapse-icon');
    if (content.style.display === 'none' || !content.style.display) {
        content.style.display = 'block';
        icon.textContent = '▼';
    } else {
        content.style.display = 'none';
        icon.textContent = '▶';
    }
}

export function bindCollapsePanelEvents() {
    const defaultEntriesHeader = document.querySelector('[data-target="ttw-default-entries-content"]');
    if (defaultEntriesHeader) {
        defaultEntriesHeader.addEventListener('click', () => toggleCollapsePanel('ttw-default-entries-content', defaultEntriesHeader));
    }

    document.querySelectorAll('.ttw-prompt-header[data-target]').forEach((header) => {
        header.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            const targetId = header.getAttribute('data-target');
            if (targetId === 'ttw-default-entries-content') return;
            toggleCollapsePanel(targetId, header);
        });
    });
}

function escapeHtmlForPresets(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readApiConfigFromDomForPreset(target) {
    const suffix = target === 'director' ? 'director' : 'main';
    const provider = document.getElementById(`ttw-api-provider-${suffix}`)?.value
        || document.getElementById('ttw-api-provider')?.value
        || 'openai-compatible';
    const apiKey = document.getElementById(`ttw-api-key-${suffix}`)?.value
        || (suffix === 'main' ? document.getElementById('ttw-api-key')?.value : '')
        || '';
    const endpoint = document.getElementById(`ttw-api-endpoint-${suffix}`)?.value
        || (suffix === 'main' ? document.getElementById('ttw-api-endpoint')?.value : '')
        || '';
    const model = document.getElementById(`ttw-api-model-${suffix}`)?.value
        || (suffix === 'main' ? document.getElementById('ttw-api-model')?.value : '')
        || 'gemini-2.5-flash';
    const maxTokensRaw = parseInt(
        document.getElementById(`ttw-api-max-tokens-${suffix}`)?.value
            || (suffix === 'main' ? document.getElementById('ttw-api-max-tokens')?.value : ''),
        10
    );
    const maxTokens = Number.isFinite(maxTokensRaw) ? Math.max(1, Math.min(8192, maxTokensRaw)) : 2048;
    return { provider, apiKey, endpoint, model, maxTokens };
}

function writeApiConfigToDom(target, config = {}) {
    const suffix = target === 'director' ? 'director' : 'main';
    const setVal = (idList, value) => {
        for (const id of idList) {
            const el = document.getElementById(id);
            if (el) { el.value = value; break; }
        }
    };
    setVal([`ttw-api-provider-${suffix}`, 'ttw-api-provider'], config.provider || 'openai-compatible');
    setVal([`ttw-api-key-${suffix}`, 'ttw-api-key'], config.apiKey || '');
    setVal([`ttw-api-endpoint-${suffix}`, 'ttw-api-endpoint'], config.endpoint || '');
    setVal([`ttw-api-model-${suffix}`, 'ttw-api-model'], config.model || 'gemini-2.5-flash');
    setVal([`ttw-api-max-tokens-${suffix}`, 'ttw-api-max-tokens'], String(config.maxTokens || 2048));
}

const PREFIX_PRESETS_KEY = 'westworldPromptPrefixPresets';
const PREFIX_SELECTED_KEY = 'westworldSelectedPromptPrefixPreset';

function bindPromptPrefixPresetEvents(deps) {
    const { AppState, saveCurrentSettings, ErrorHandler, modalContainer } = deps;
    const select = modalContainer.querySelector('#ttw-prefix-preset-select');
    const textarea = modalContainer.querySelector('#ttw-prefix-prompt');
    const loadBtn = modalContainer.querySelector('#ttw-prefix-preset-load');
    const saveBtn = modalContainer.querySelector('#ttw-prefix-preset-save-as');
    const deleteBtn = modalContainer.querySelector('#ttw-prefix-preset-delete');
    if (!select || !textarea || !loadBtn || !saveBtn || !deleteBtn) return;

    const getPresets = () => {
        try { return JSON.parse(localStorage.getItem(PREFIX_PRESETS_KEY)) || []; } catch (_) { return []; }
    };
    const setPresets = (arr) => {
        localStorage.setItem(PREFIX_PRESETS_KEY, JSON.stringify(arr));
    };
    const getSelected = () => {
        try { return localStorage.getItem(PREFIX_SELECTED_KEY) || ''; } catch (_) { return ''; }
    };
    const setSelected = (name) => {
        localStorage.setItem(PREFIX_SELECTED_KEY, name);
    };

    function renderDropdown() {
        const presets = getPresets();
        const selected = getSelected();
        select.innerHTML = '<option value="">-- 选择预设 --</option>';
        presets.forEach((p, i) => {
            const sel = p.name === selected ? ' selected' : '';
            select.innerHTML += `<option value="${i}"${sel}>${escapeHtmlForPresets(p.name)}</option>`;
        });
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    }

    textarea.value = AppState.settings.promptGlobal?.prefix || AppState.settings.promptPrefixPreset || '';
    textarea.addEventListener('input', () => {
        AppState.settings.promptGlobal = {
            ...(AppState.settings.promptGlobal || {}),
            prefix: textarea.value,
        };
        AppState.settings.promptPrefixPreset = textarea.value;
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
    });

    select.addEventListener('change', () => {
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    });

    loadBtn.addEventListener('click', () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const preset = getPresets()[idx];
        if (!preset) return;
        AppState.settings.promptGlobal = {
            ...(AppState.settings.promptGlobal || {}),
            prefix: preset.prefix,
        };
        AppState.settings.promptPrefixPreset = preset.prefix;
        setSelected(preset.name);
        textarea.value = preset.prefix;
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已加载提示词开头预设：${preset.name}`);
    });

    saveBtn.addEventListener('click', () => {
        const name = window.prompt('请输入预设名称：', getSelected() || '');
        if (!name || !name.trim()) return;
        const presets = getPresets();
        const existingIdx = presets.findIndex(p => p.name === name.trim());
        const prefix = textarea.value;
        if (existingIdx >= 0) {
            presets[existingIdx].prefix = prefix;
        } else {
            presets.push({ name: name.trim(), prefix });
        }
        setPresets(presets);
        setSelected(name.trim());
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已保存提示词开头预设：${name.trim()}`);
    });

    deleteBtn.addEventListener('click', async () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const presets = getPresets();
        const preset = presets[idx];
        if (!preset) return;
        const confirmed = typeof confirmAction === 'function'
            ? await confirmAction(`确定删除预设「${preset.name}」吗？`, { title: '删除预设', danger: true })
            : window.confirm(`确定删除预设「${preset.name}」吗？`);
        if (!confirmed) return;
        presets.splice(idx, 1);
        if (getSelected() === preset.name) {
            setSelected('');
        }
        setPresets(presets);
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已删除预设：${preset.name}`);
    });

    renderDropdown();
}

const ROUTE_PRESETS_KEY = 'westworldAiRoutePresets';
const ROUTE_SELECTED_KEY = 'westworldSelectedAiRoutePreset';

function bindAiRoutePresetEvents(deps) {
    const { AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer, handleProviderChange } = deps;
    const select = modalContainer.querySelector('#ttw-route-preset-select');
    const loadBtn = modalContainer.querySelector('#ttw-route-preset-load');
    const saveBtn = modalContainer.querySelector('#ttw-route-preset-save-as');
    const deleteBtn = modalContainer.querySelector('#ttw-route-preset-delete');
    if (!select || !loadBtn || !saveBtn || !deleteBtn) return;

    const getPresets = () => {
        try { return JSON.parse(localStorage.getItem(ROUTE_PRESETS_KEY)) || []; } catch (_) { return []; }
    };
    const setPresets = (arr) => {
        localStorage.setItem(ROUTE_PRESETS_KEY, JSON.stringify(arr));
    };
    const getSelected = () => {
        try { return localStorage.getItem(ROUTE_SELECTED_KEY) || ''; } catch (_) { return ''; }
    };
    const setSelected = (name) => {
        localStorage.setItem(ROUTE_SELECTED_KEY, name);
    };

    function renderDropdown() {
        const presets = getPresets();
        const selected = getSelected();
        select.innerHTML = '<option value="">-- 选择预设 --</option>';
        presets.forEach((p, i) => {
            const sel = p.name === selected ? ' selected' : '';
            select.innerHTML += `<option value="${i}"${sel}>${escapeHtmlForPresets(p.name)}</option>`;
        });
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    }

    select.addEventListener('change', () => {
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    });

    loadBtn.addEventListener('click', () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const preset = getPresets()[idx];
        if (!preset) return;
        AppState.settings.mainApi = { ...(preset.mainApi || {}) };
        AppState.settings.directorApi = { ...(preset.directorApi || {}) };
        setSelected(preset.name);
        // Sync backward compatibility fields
        AppState.settings.customApiProvider = AppState.settings.mainApi.provider;
        AppState.settings.customApiKey = AppState.settings.mainApi.apiKey;
        AppState.settings.customApiEndpoint = AppState.settings.mainApi.endpoint;
        AppState.settings.customApiModel = AppState.settings.mainApi.model;
        AppState.settings.customApiMaxTokens = AppState.settings.mainApi.maxTokens;
        writeApiConfigToDom('main', AppState.settings.mainApi);
        writeApiConfigToDom('director', AppState.settings.directorApi);
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        if (typeof handleProviderChange === 'function') {
            handleProviderChange('main');
            handleProviderChange('director');
        }
        ErrorHandler.showUserSuccess(`已加载AI路由预设：${preset.name}`);
    });

    saveBtn.addEventListener('click', () => {
        const name = window.prompt('请输入预设名称：', getSelected() || '');
        if (!name || !name.trim()) return;
        const presets = getPresets();
        const existingIdx = presets.findIndex(p => p.name === name.trim());
        const mainApi = readApiConfigFromDomForPreset('main');
        const directorApi = readApiConfigFromDomForPreset('director');
        if (existingIdx >= 0) {
            presets[existingIdx].mainApi = mainApi;
            presets[existingIdx].directorApi = directorApi;
        } else {
            presets.push({ name: name.trim(), mainApi, directorApi });
        }
        setPresets(presets);
        setSelected(name.trim());
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已保存AI路由预设：${name.trim()}`);
    });

    deleteBtn.addEventListener('click', async () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const presets = getPresets();
        const preset = presets[idx];
        if (!preset) return;
        const confirmed = typeof confirmAction === 'function'
            ? await confirmAction(`确定删除预设「${preset.name}」吗？`, { title: '删除预设', danger: true })
            : window.confirm(`确定删除预设「${preset.name}」吗？`);
        if (!confirmed) return;
        presets.splice(idx, 1);
        if (getSelected() === preset.name) {
            setSelected('');
        }
        setPresets(presets);
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已删除预设：${preset.name}`);
    });

    renderDropdown();
}

function bindDirectorPromptPresetEvents(deps) {
    const {
        AppState, saveCurrentSettings, confirmAction, ErrorHandler, modalContainer,
        presetKey, selectedKey, selectId, loadBtnId, saveBtnId, deleteBtnId, textareaId, settingKey, label,
    } = deps;
    const select = modalContainer.querySelector('#' + selectId);
    const textarea = modalContainer.querySelector('#' + textareaId);
    const loadBtn = modalContainer.querySelector('#' + loadBtnId);
    const saveBtn = modalContainer.querySelector('#' + saveBtnId);
    const deleteBtn = modalContainer.querySelector('#' + deleteBtnId);
    if (!select || !textarea || !loadBtn || !saveBtn || !deleteBtn) return;

    const getPresets = () => {
        try { return JSON.parse(localStorage.getItem(presetKey)) || []; } catch (_) { return []; }
    };
    const setPresets = (arr) => {
        localStorage.setItem(presetKey, JSON.stringify(arr));
    };
    const getSelected = () => {
        try { return localStorage.getItem(selectedKey) || ''; } catch (_) { return ''; }
    };
    const setSelected = (name) => {
        localStorage.setItem(selectedKey, name);
    };

    function renderDropdown() {
        const presets = getPresets();
        const selected = getSelected();
        select.innerHTML = '<option value="">-- 选择预设 --</option>';
        presets.forEach((p, i) => {
            const sel = p.name === selected ? ' selected' : '';
            select.innerHTML += `<option value="${i}"${sel}>${escapeHtmlForPresets(p.name)}</option>`;
        });
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    }

    select.addEventListener('change', () => {
        deleteBtn.style.display = select.value !== '' ? 'inline-block' : 'none';
    });

    loadBtn.addEventListener('click', () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const preset = getPresets()[idx];
        if (!preset) return;
        AppState.settings[settingKey] = preset.content;
        setSelected(preset.name);
        textarea.value = preset.content;
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已加载${label}预设：${preset.name}`);
    });

    saveBtn.addEventListener('click', () => {
        const name = window.prompt('请输入预设名称：', getSelected() || '');
        if (!name || !name.trim()) return;
        const presets = getPresets();
        const existingIdx = presets.findIndex(p => p.name === name.trim());
        const content = textarea.value;
        if (existingIdx >= 0) {
            presets[existingIdx].content = content;
        } else {
            presets.push({ name: name.trim(), content });
        }
        setPresets(presets);
        setSelected(name.trim());
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已保存${label}预设：${name.trim()}`);
    });

    deleteBtn.addEventListener('click', async () => {
        const idx = parseInt(select.value, 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        const presets = getPresets();
        const preset = presets[idx];
        if (!preset) return;
        const confirmed = typeof confirmAction === 'function'
            ? await confirmAction(`确定删除预设「${preset.name}」吗？`, { title: '删除预设', danger: true })
            : window.confirm(`确定删除预设「${preset.name}」吗？`);
        if (!confirmed) return;
        presets.splice(idx, 1);
        if (getSelected() === preset.name) {
            setSelected('');
        }
        setPresets(presets);
        renderDropdown();
        saveCurrentSettings({ syncPromptFieldsFromDom: false });
        ErrorHandler.showUserSuccess(`已删除${label}预设：${preset.name}`);
    });

    renderDropdown();
}

export function bindModalBasicEvents(deps = {}) {
    const {
        modalContainer,
        closeModal,
        showHelpModal,
        handleEscKey,
    } = deps;

    const modal = modalContainer.querySelector('.ttw-modal');
    if (!modal) return;

    // Prevent bubbling to SillyTavern extension bar (collapse side effect).
    const stopPropagationHandler = (e) => e.stopPropagation();
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((eventName) => {
        modalContainer.addEventListener(eventName, stopPropagationHandler);
    });

    modalContainer.querySelector('.ttw-modal-close').addEventListener('click', closeModal);
    modalContainer.querySelector('.ttw-help-btn').addEventListener('click', showHelpModal);
    document.addEventListener('keydown', handleEscKey, true);
}
