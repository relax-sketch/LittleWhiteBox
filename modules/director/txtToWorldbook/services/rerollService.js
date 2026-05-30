export function createRerollService(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        MemoryHistoryDB,
        updateStopButtonVisibility,
        updateStreamContent,
        updateMemoryQueueUI,
        processMemoryChunkIndependent,
        mergeWorldbookDataWithHistory,
        updateWorldbookPreview,
        setProcessingStatus,
        getProcessingStatus,
        callAPI,
        parseAIResponse,
        getChapterForcePrompt,
        getPreviousMemoryContext,
        Semaphore,
        updateProgress,
        showProgressSection,
    } = deps;

    function getWorldbookStatus(memory) {
        const status = String(memory?.worldbookStatus || '').trim().toLowerCase();
        return status || 'pending';
    }

    function setWorldbookStatus(memory, status, error = '') {
        const next = ['pending', 'generating', 'done', 'failed'].includes(String(status || '').toLowerCase())
            ? String(status).toLowerCase()
            : 'pending';
        memory.worldbookStatus = next;
        memory.worldbookError = next === 'failed' ? String(error || '未知错误') : '';
        memory.processed = next === 'done' || next === 'failed';
        memory.failed = next === 'failed';
        memory.processing = next === 'generating';
        if (next === 'failed') {
            memory.failedError = memory.worldbookError;
        } else if (next !== 'generating') {
            memory.failedError = '';
        }
    }

    const transitionTo = (status) => {
        if (typeof setProcessingStatus === 'function') {
            setProcessingStatus(status);
            return;
        }
        const next = status || 'idle';
        AppState.processing.status = next;
        AppState.processing.isStopped = next === 'stopped';
        AppState.processing.isRerolling = next === 'rerolling';
        AppState.processing.isRepairing = next === 'repairing';
        AppState.processing.isRunning = next === 'running' || next === 'rerolling' || next === 'repairing';
    };

    const currentStatus = () => {
        if (typeof getProcessingStatus === 'function') return getProcessingStatus();
        return AppState.processing.status || 'idle';
    };

    function findEntrySourceMemories(category, entryName) {
        const sources = [];
        for (let i = 0; i < AppState.memory.queue.length; i++) {
            const memory = AppState.memory.queue[i];
            const status = getWorldbookStatus(memory);
            if (!memory.result || status === 'failed') continue;
            if (memory.result[category] && memory.result[category][entryName]) {
                sources.push({
                    memoryIndex: i,
                    memory,
                    entry: memory.result[category][entryName],
                });
            }
        }
        return sources;
    }

    async function runRerollMemory(index, customPrompt = '', options = {}) {
        const { manageStatus = true } = options;
        const memory = AppState.memory.queue[index];
        if (!memory) return;

        if (manageStatus) {
            transitionTo('rerolling');
        }
        updateStopButtonVisibility(true);

        updateStreamContent(`\n🎲 开始重Roll: ${memory.title} (第${index + 1}章)\n`);

        try {
            setWorldbookStatus(memory, 'generating');
            updateMemoryQueueUI();

            const result = await processMemoryChunkIndependent({ index, retryCount: 0, customPromptSuffix: customPrompt });

            setWorldbookStatus(memory, memory.result ? 'done' : 'pending');

            if (result) {
                await MemoryHistoryDB.saveRollResult(index, result);
                memory.result = result;
                setWorldbookStatus(memory, 'done');
                await mergeWorldbookDataWithHistory({
                    target: AppState.worldbook.generated,
                    source: result,
                    memoryIndex: index,
                    memoryTitle: `${memory.title}-重Roll`,
                });
                updateStreamContent(`✅ 重Roll完成: ${memory.title}\n`);
                updateMemoryQueueUI();
                updateWorldbookPreview();
                return result;
            }
        } catch (error) {
            if (error.message !== 'ABORTED') {
                setWorldbookStatus(memory, 'failed', error.message);
            } else {
                setWorldbookStatus(memory, memory.result ? 'done' : 'pending');
            }
            if (error.message !== 'ABORTED') {
                updateStreamContent(`❌ 重Roll失败: ${error.message}\n`);
            }
            updateMemoryQueueUI();
            throw error;
        } finally {
            if (manageStatus && currentStatus() !== 'stopped') transitionTo('idle');
        }
    }

    async function handleRerollMemory(index, customPrompt = '') {
        return runRerollMemory(index, customPrompt, { manageStatus: true });
    }

    async function handleRerollSingleEntry(options) {
        const { memoryIndex, category, entryName, customPrompt = '' } = options;
        const memory = AppState.memory.queue[memoryIndex];
        if (!memory) {
            throw new Error('找不到对应的章节');
        }

        transitionTo('rerolling');
        updateStopButtonVisibility(true);

        updateStreamContent(`\n🎯 开始单独重Roll条目: [${category}] ${entryName} (来自第${memoryIndex + 1}章)\n`);

        const chapterIndex = memoryIndex + 1;
        const chapterForcePrompt = AppState.settings.forceChapterMarker ? getChapterForcePrompt(chapterIndex) : '';

        const categoryConfig = AppState.persistent.customCategories.find(c => c.name === category);
        const contentGuide = categoryConfig?.promptLayers
            ? [categoryConfig.promptLayers.prefix, categoryConfig.promptLayers.body, categoryConfig.promptLayers.suffix].filter(Boolean).join('\n\n')
            : (categoryConfig?.contentGuide || '');

        const prevContext = getPreviousMemoryContext(memoryIndex);
        const currentEntry = memory.result?.[category]?.[entryName];
        const categoryGuideContext = contentGuide
            ? promptRegistryService.renderModule('worldbook.reroll.category-guide', { CATEGORY_GUIDE: contentGuide })
            : '';
        const previousEndContext = memoryIndex > 0 && AppState.memory.queue[memoryIndex - 1].content
            ? promptRegistryService.renderModule('worldbook.reroll.previous-end', {
                PREVIOUS_END: AppState.memory.queue[memoryIndex - 1].content.slice(-500),
            })
            : '';
        const currentEntryContext = currentEntry
            ? promptRegistryService.renderModule('worldbook.reroll.current-entry', {
                CURRENT_ENTRY: JSON.stringify(currentEntry, null, 2),
            })
            : '';
        const customRequirement = customPrompt
            ? promptRegistryService.renderModule('worldbook.reroll.extra', { CUSTOM_REQUIREMENT: customPrompt })
            : '';
        const forceReminder = AppState.settings.forceChapterMarker
            && (category === '剧情大纲' || category === '剧情节点' || category === '章节剧情')
            ? promptRegistryService.renderModule('worldbook.force-reminder', { CHAPTER_INDEX: chapterIndex })
            : '';
        const prompt = promptRegistryService.composeRequest(['worldbook.reroll.single-entry'], {
            'worldbook.reroll.single-entry': {
                CHAPTER_INDEX: chapterIndex,
                CHAPTER_FORCE: chapterForcePrompt,
                CATEGORY: category,
                ENTRY_NAME: entryName,
                JSON_SHAPE: `{ "${category}": { "${entryName}": { "关键词": [...], "内容": "..." } } }`,
                CATEGORY_GUIDE_CONTEXT: categoryGuideContext,
                PREVIOUS_CONTEXT: prevContext,
                PREVIOUS_END_CONTEXT: previousEndContext,
                CONTENT: memory.content,
                CURRENT_ENTRY_CONTEXT: currentEntryContext,
                CUSTOM_REQUIREMENT: customRequirement,
                FORCE_REMINDER: forceReminder,
            },
        });

        try {
            memory.processing = true;
            updateMemoryQueueUI();

            const response = await callAPI(prompt, memoryIndex + 1);

            memory.processing = false;

            if (AppState.processing.isStopped) {
                updateMemoryQueueUI();
                throw new Error('ABORTED');
            }

            let entryUpdate = parseAIResponse(response);

            if (!entryUpdate || !entryUpdate[category] || !entryUpdate[category][entryName]) {
                if (entryUpdate && entryUpdate[category]) {
                    const keys = Object.keys(entryUpdate[category]);
                    if (keys.length === 1) {
                        const returnedEntry = entryUpdate[category][keys[0]];
                        entryUpdate[category] = { [entryName]: returnedEntry };
                    }
                }
            }

            if (entryUpdate && entryUpdate[category] && entryUpdate[category][entryName]) {
                if (!memory.result) {
                    memory.result = {};
                }
                if (!memory.result[category]) {
                    memory.result[category] = {};
                }
                memory.result[category][entryName] = entryUpdate[category][entryName];

                await MemoryHistoryDB.saveRollResult(memoryIndex, memory.result);
                await MemoryHistoryDB.saveEntryRollResult(category, entryName, memoryIndex, entryUpdate[category][entryName], customPrompt);

                if (!AppState.worldbook.generated[category]) {
                    AppState.worldbook.generated[category] = {};
                }
                AppState.worldbook.generated[category][entryName] = entryUpdate[category][entryName];

                updateStreamContent(`✅ 条目重Roll完成: [${category}] ${entryName}\n`);
                updateMemoryQueueUI();
                updateWorldbookPreview();

                return entryUpdate[category][entryName];
            }

            throw new Error('AI返回的结果格式不正确，请重试');
        } catch (error) {
            memory.processing = false;
            if (error.message !== 'ABORTED') {
                updateStreamContent(`❌ 条目重Roll失败: ${error.message}\n`);
            }
            updateMemoryQueueUI();
            throw error;
        } finally {
            if (currentStatus() !== 'stopped') transitionTo('idle');
        }
    }

    async function batchRerollMemories(options = {}) {
        const {
            memoryIndices = [],
            customPrompt = '',
            useParallel = AppState.config.parallel.enabled && memoryIndices.length > 1,
            onStep,
        } = options;

        if (!Array.isArray(memoryIndices) || memoryIndices.length === 0) {
            return { success: 0, fail: 0, stopped: false };
        }

        showProgressSection(true);
        transitionTo('rerolling');

        let successCount = 0;
        let failCount = 0;
        let completed = 0;

        if (useParallel) {
            updateStreamContent(`\n🚀 批量重Roll开始 (并行模式, ${AppState.config.parallel.concurrency}并发)\n${'='.repeat(50)}\n`);

            const semaphore = new Semaphore(AppState.config.parallel.concurrency);
            const processOne = async (index) => {
                if (AppState.processing.isStopped) return null;
                try {
                    await semaphore.acquire();
                } catch (e) {
                    if (e.message === 'ABORTED') return null;
                    throw e;
                }
                if (AppState.processing.isStopped) {
                    semaphore.release();
                    return null;
                }

                try {
                    updateStreamContent(`🎲 [并行] 第${index + 1}章 开始重Roll...\n`);
                    const result = await runRerollMemory(index, customPrompt, { manageStatus: false });
                    if (result) {
                        successCount++;
                        updateStreamContent(`✅ [并行] 第${index + 1}章 完成\n`);
                    }
                    return result;
                } catch (error) {
                    failCount++;
                    updateStreamContent(`❌ [并行] 第${index + 1}章 失败: ${error.message}\n`);
                    return null;
                } finally {
                    completed++;
                    updateProgress((completed / memoryIndices.length) * 100, `批量重Roll中 (${completed}/${memoryIndices.length})`);
                    if (typeof onStep === 'function') {
                        onStep({ completed, total: memoryIndices.length, successCount, failCount });
                    }
                    semaphore.release();
                }
            };

            await Promise.allSettled(memoryIndices.map((index) => processOne(index)));
        } else {
            updateStreamContent(`\n🔄 批量重Roll开始 (串行模式)\n${'='.repeat(50)}\n`);
            for (let i = 0; i < memoryIndices.length; i++) {
                if (AppState.processing.isStopped) break;
                const index = memoryIndices[i];
                try {
                    updateStreamContent(`\n🎲 [${i + 1}/${memoryIndices.length}] 第${index + 1}章...\n`);
                    await runRerollMemory(index, customPrompt, { manageStatus: false });
                    successCount++;
                } catch (error) {
                    failCount++;
                    updateStreamContent(`❌ 第${index + 1}章重Roll失败: ${error.message}\n`);
                } finally {
                    completed++;
                    updateProgress((completed / memoryIndices.length) * 100, `批量重Roll中 (${completed}/${memoryIndices.length})`);
                    if (typeof onStep === 'function') {
                        onStep({ completed, total: memoryIndices.length, successCount, failCount });
                    }
                }
            }
        }

        updateStreamContent(`\n${'='.repeat(50)}\n📦 批量重Roll完成: 成功 ${successCount}, 失败 ${failCount}\n`);
        updateProgress(100, `批量重Roll完成: 成功 ${successCount}, 失败 ${failCount}`);
        updateMemoryQueueUI();

        const stopped = AppState.processing.isStopped;
        if (!stopped) {
            transitionTo('idle');
        }

        return { success: successCount, fail: failCount, stopped };
    }

    return {
        findEntrySourceMemories,
        handleRerollMemory,
        handleRerollSingleEntry,
        batchRerollMemories,
    };
}
