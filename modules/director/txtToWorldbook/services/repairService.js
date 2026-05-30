import { PROMPT_MODULE_IDS } from './promptRegistryService.js';

export function createRepairService(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        MemoryHistoryDB,
        updateProgress,
        updateMemoryQueueUI,
        isTokenLimitError,
        getChapterForcePrompt,
        generateDynamicJsonTemplate,
        getPreviousMemoryContext,
        callAPI,
        parseAIResponse,
        postProcessResultWithChapterIndex,
        mergeWorldbookDataWithHistory,
        handleStartNewVolume,
        splitMemoryIntoTwo,
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

    function countWorldbookReady(queue) {
        return queue.filter((item) => {
            const status = getWorldbookStatus(item);
            return status === 'done' || status === 'failed';
        }).length;
    }

    async function handleRepairSingleMemory(index) {
        const memory = AppState.memory.queue[index];
        const chapterIndex = index + 1;

        const chapterForcePrompt = AppState.settings.forceChapterMarker ? getChapterForcePrompt(chapterIndex) : '';

        const prevContext = getPreviousMemoryContext(index);
        const existingWorldbookContext = Object.keys(AppState.worldbook.generated).length > 0
            ? promptRegistryService.renderModule(PROMPT_MODULE_IDS.WORLDBOOK_REPAIR_EXISTING, {
                EXISTING_WORLDBOOK: JSON.stringify(AppState.worldbook.generated, null, 2),
            })
            : '';
        const prompt = promptRegistryService.composeRequest([PROMPT_MODULE_IDS.WORLDBOOK_REPAIR], {
            [PROMPT_MODULE_IDS.WORLDBOOK_REPAIR]: {
                CHAPTER_INDEX: chapterIndex,
                DYNAMIC_JSON_TEMPLATE: generateDynamicJsonTemplate(),
                PREVIOUS_CONTEXT: prevContext,
                EXISTING_WORLDBOOK_CONTEXT: existingWorldbookContext,
                CONTENT: memory.content,
                CHAPTER_FORCE: chapterForcePrompt,
            },
        });

        const response = await callAPI(prompt);
        let memoryUpdate = parseAIResponse(response);
        memoryUpdate = postProcessResultWithChapterIndex(memoryUpdate, chapterIndex);
        await mergeWorldbookDataWithHistory({
            target: AppState.worldbook.generated,
            source: memoryUpdate,
            memoryIndex: index,
            memoryTitle: `修复-${memory.title}`,
        });
        await MemoryHistoryDB.saveRollResult(index, memoryUpdate);
        memory.result = memoryUpdate;
    }

    async function handleRepairMemoryWithSplit(memoryIndex, stats) {
        const memory = AppState.memory.queue[memoryIndex];
        if (!memory) return;
        updateProgress((memoryIndex / AppState.memory.queue.length) * 100, `正在修复: ${memory.title}`);

        try {
            await handleRepairSingleMemory(memoryIndex);
            setWorldbookStatus(memory, 'done');
            stats.successCount++;
            updateMemoryQueueUI();
            await MemoryHistoryDB.saveState(countWorldbookReady(AppState.memory.queue));
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
            if (isTokenLimitError(error.message || '')) {
                if (AppState.processing.volumeMode) {
                    handleStartNewVolume();
                    await MemoryHistoryDB.saveState(countWorldbookReady(AppState.memory.queue));
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    await handleRepairMemoryWithSplit(memoryIndex, stats);
                    return;
                }

                const splitResult = splitMemoryIntoTwo(memoryIndex);
                if (splitResult) {
                    updateMemoryQueueUI();
                    await MemoryHistoryDB.saveState(countWorldbookReady(AppState.memory.queue));
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    const part1Index = AppState.memory.queue.indexOf(splitResult.part1);
                    await handleRepairMemoryWithSplit(part1Index, stats);
                    const part2Index = AppState.memory.queue.indexOf(splitResult.part2);
                    await handleRepairMemoryWithSplit(part2Index, stats);
                } else {
                    stats.stillFailedCount++;
                    setWorldbookStatus(memory, 'failed', error.message);
                }
            } else {
                stats.stillFailedCount++;
                setWorldbookStatus(memory, 'failed', error.message);
                updateMemoryQueueUI();
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    return {
        handleRepairSingleMemory,
        handleRepairMemoryWithSplit,
    };
}
