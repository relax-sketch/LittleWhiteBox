export function createInitialAppState(options = {}) {
    const {
        defaultCategoryLight,
        defaultPlotOutlineConfig,
        defaultParallelConfig,
        defaultChapterRegex,
        defaultWorldbookCategories,
        defaultSettings,
    } = options;

    return {
        worldbook: {
            generated: {},
            volumes: [],
            currentVolumeIndex: 0
        },
        memory: {
            queue: [],
            failedQueue: [],
            currentIndex: 0,
            startIndex: 0,
            userSelectedIndex: null
        },
        file: {
            current: null,
            hash: null,
            novelName: ''
        },
        processing: {
            status: 'idle',
            isStopped: false,
            isRunning: false,
            isRepairing: false,
            isRerolling: false,
            currentMode: 'both',
            directorOnDemand: false,
            directorOnDemandStartIndex: 0,
            directorOnDemandPromise: null,
            incrementalMode: true,
            volumeMode: false,
            streamContent: '',
            activeTasks: new Set(),
            runId: null,
            mainApiSemaphore: null,
            directorApiSemaphore: null,
            mainApiConcurrency: 0,
            directorApiConcurrency: 0,
            pendingChapterAssets: new Set(),
        },
        experience: {
            currentChapterIndex: 0,
            currentBeatIndex: 0,
            lastChapterIdx: 0,
            lastBeatIdx: 0,
            directorLastDecision: null,
            directorLastDecisionAt: 0,
            directorRuntime: createInitialDirectorRuntimeState(),
        },
        ui: {
            isMultiSelectMode: false,
            selectedIndices: new Set(),
            searchKeyword: '',
            tokenThreshold: 0,
            manualMergeHighlight: null
        },
        config: {
            entryPosition: {},
            categoryLight: { ...(defaultCategoryLight || {}) },
            categoryDefault: {},
            plotOutline: { ...(defaultPlotOutlineConfig || {}) },
            parallel: { ...(defaultParallelConfig || {}) },
            chapterRegex: { ...(defaultChapterRegex || {}) }
        },
        persistent: {
            defaultEntries: [],
            customCategories: JSON.parse(JSON.stringify(defaultWorldbookCategories || [])),
            pendingImport: null
        },
        settings: { ...(defaultSettings || {}) },
        globalSemaphore: null
    };
}

export function createInitialDirectorRuntimeState() {
    return {
        hookRegistered: false,
        hookRegisteredAt: 0,
        lastEventAt: 0,
        lastEventType: '',
        phase: 'idle',
        lastSkipReason: '',
        lastRunId: '',
        lastRunAt: 0,
        lastRunDurationMs: 0,
        lastChapterIndex: -1,
        lastBeatIndex: -1,
        lastBeatCount: 0,
        lastDecisionSource: '',
        restore: {
            status: 'idle',
            at: 0,
            restored: false,
            reason: '',
            memoryCount: 0,
            durationMs: 0,
        },
        session: null,
        lastSession: null,
        boundSession: null,
        invalidated: false,
        invalidatedAt: 0,
        invalidationReason: '',
        lastInjection: {
            injected: false,
            at: 0,
            runId: '',
            chatLengthBefore: 0,
            chatLengthAfter: 0,
            insertionIndex: -1,
            role: '',
            contentLength: 0,
            contentHash: '',
            contentPreview: '',
            markerFoundAfterInsert: false,
        },
        lastError: '',
    };
}
