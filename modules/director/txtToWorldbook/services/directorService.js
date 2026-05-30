import { PROMPT_MODULE_IDS } from './promptRegistryService.js';
import {
    ensureDirectorRuntimeReady,
    getSillyTavernSessionFingerprint,
    diffSessionFingerprint,
    diffBoundDirectorSession,
    normalizeDirectorBeatState,
    ensureMemoryDirectorRuntime,
} from './directorStateService.js';
import {
    insertDirectorInjection,
    inspectDirectorInjection,
    withDirectorInjectionMarker,
    hashText,
} from './directorInjectionService.js';

export function createDirectorService(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        MemoryHistoryDB,
        Logger,
        callDirectorAPI,
        debugLog,
        updateStreamContent,
        directorTelemetry,
    } = deps;
    const directorToastState = {
        lastKey: '',
        lastAt: 0,
    };

    function directorDebug(msg) {
        if (typeof debugLog === 'function') {
            debugLog(`[Director] ${msg}`);
        }
    }

    function directorWarn(msg, detail = '') {
        const suffix = detail ? ` | ${detail}` : '';
        Logger?.warn?.('Director', `${msg}${suffix}`);
        if (typeof updateStreamContent === 'function') {
            updateStreamContent(`⚠️ [导演] ${msg}${suffix}\n`);
        }
    }

    function directorInfo(msg) {
        Logger?.info?.('Director', msg);
        directorDebug(msg);
    }

    function notifyDirectorJudgement(kind, message) {
        try {
            const toast = globalThis?.toastr;
            if (!toast) return;
            const key = `${kind}:${message}`;
            const now = Date.now();
            if (directorToastState.lastKey === key && now - directorToastState.lastAt < 1500) return;
            directorToastState.lastKey = key;
            directorToastState.lastAt = now;
            const method = typeof toast[kind] === 'function' ? kind : 'info';
            toast[method](message, 'WestWorld 导演', {
                timeOut: kind === 'info' ? 1800 : 2600,
                extendedTimeOut: 1000,
                preventDuplicates: true,
            });
        } catch (_) { }
    }

    function buildDirectorTurnPrefix(chapterIndex) {
        const chapterNo = Number.isInteger(chapterIndex) ? chapterIndex + 1 : 0;
        return chapterNo > 0
            ? `[第${chapterNo}章][导演裁判]`
            : '[导演裁判]';
    }

    function toShortText(text, maxLen = 180) {
        const plain = String(text || '').replace(/\s+/g, ' ').trim();
        if (!plain) return '';
        return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
    }

    function toTailText(text, maxLen = 180) {
        const plain = String(text || '').replace(/\s+/g, ' ').trim();
        if (!plain) return '';
        if (plain.length <= maxLen) return plain;
        return `...${plain.slice(Math.max(0, plain.length - maxLen))}`;
    }

    function toHeadText(text, maxLen = 200) {
        const plain = String(text || '').replace(/\s+/g, ' ').trim();
        if (!plain) return '';
        return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
    }

    function renderDirectorFragment(moduleId, variables = {}) {
        return promptRegistryService.renderModule(moduleId, variables);
    }

    function renderPromptTemplate(template, variables = {}) {
        let output = String(template || '');
        for (const [key, value] of Object.entries(variables)) {
            output = output.split(`{${key}}`).join(value == null ? '' : String(value));
        }
        return output;
    }

    function normalizeActionSegment(text, maxLen = 120) {
        const plain = String(text || '')
            .replace(/[“”"']/g, '')
            .replace(/[「」]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return toShortText(plain, maxLen);
    }

    function splitActionChain(actionChain, limit = 4) {
        const normalized = String(actionChain || '')
            .replace(/[\r\n]+/g, '→')
            .replace(/\s*→\s*/g, '→')
            .trim();
        if (!normalized) return [];
        return normalized
            .split('→')
            .map((segment) => normalizeActionSegment(segment, 120))
            .filter(Boolean)
            .slice(0, limit);
    }

    function buildActionChain(steps, maxLen = 420) {
        const normalizedSteps = Array.isArray(steps)
            ? steps
                .map((step) => normalizeActionSegment(step, 120))
                .filter(Boolean)
                .slice(0, 4)
            : [];
        return toShortText(normalizedSteps.join('→'), maxLen);
    }

    const SPLIT_TYPES = new Set([
        'scene_change',
        'time_jump',
        'goal_shift',
        'conflict_closed',
    ]);
    const LEGACY_SPLIT_TYPE_MAP = {
        scene_switch: 'scene_change',
        situation_change: 'scene_change',
        action_closed: 'conflict_closed',
        dialogue_closed: 'conflict_closed',
        plot_twist: 'conflict_closed',
        perspective_switch: 'scene_change',
        relationship_shift: 'conflict_closed',
        revelation: 'conflict_closed',
        decision_point: 'goal_shift',
        emotional_turn: 'conflict_closed',
        interaction_point: 'goal_shift',
        scene_change: 'scene_change',
        time_skip: 'time_jump',
        time_jump: 'time_jump',
        goal_shift: 'goal_shift',
        conflict_closed: 'conflict_closed',
        '场景明显切换': 'scene_change',
        '时间明显跳转': 'time_jump',
        '人物核心目标完全改变': 'goal_shift',
        '完整冲突闭环结束': 'conflict_closed',
        '一个完整冲突/行动闭环结束': 'conflict_closed',
    };

    function normalizeSplitType(type) {
        const raw = String(type || '').trim();
        if (SPLIT_TYPES.has(raw)) return raw;
        if (LEGACY_SPLIT_TYPE_MAP[raw]) return LEGACY_SPLIT_TYPE_MAP[raw];
        return 'goal_shift';
    }

    function normalizeSplitRule(rawRule = {}) {
        const source = rawRule && typeof rawRule === 'object' ? rawRule : {};
        const primary = normalizeSplitType(source.primary || source.rule || source.main || source.type || 'goal_shift');
        const rationale = String(source.rationale || source.reason || '').trim()
            || `选择 ${primary} 以保持叙事单元完整并避免事件被切开。`;
        return {
            primary,
            rationale,
        };
    }

    function normalizeBeat(rawBeat, idx) {
        const source = rawBeat && typeof rawBeat === 'object' ? rawBeat : {};
        const tags = Array.isArray(source.tags)
            ? source.tags.map((t) => toShortText(t, 16)).filter(Boolean).slice(0, 4)
            : [];
        return {
            id: String(source.id || `b${idx + 1}`),
            summary: toShortText(source.event_summary || source.eventSummary || source.summary || source.event || source.description || `事件点${idx + 1}`, 200),
            entryEvent: toShortText(
                source.entryEvent
                || source.entry_event
                || source.opening_event
                || source.openingEvent
                || source.entry_condition
                || source.enter_condition
                || '从上一节拍结果自然衔接进入当前事件。',
                120
            ),
            exitCondition: toShortText(
                source.exitCondition
                || source.exit_condition
                || source.exist_condition
                || source.existCondition
                || source['exist condition']
                || '等待关键互动完成',
                100
            ),
            tags,
            original_text: typeof source.original_text === 'string'
                ? source.original_text
                : (typeof source.originalText === 'string' ? source.originalText : ''),
            split_rule: normalizeSplitRule(source.split_rule || source.splitRule || {}),
        };
    }

    function normalizeCompareText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[\u2000-\u206F\u2E00-\u2E7F'"`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?，。！？；：、“”‘’（）【】《》…—\n\r\t]+/g, '');
    }

    function scoreSummaryAgainstOriginal(summary, originalText) {
        const s = normalizeCompareText(summary);
        const t = normalizeCompareText(originalText);
        if (!s || !t) return 0;

        const probeLen = Math.min(12, s.length);
        if (probeLen >= 6 && t.includes(s.slice(0, probeLen))) {
            return 1;
        }

        let hit = 0;
        const unique = new Set(s.split(''));
        for (const ch of unique) {
            if (t.includes(ch)) hit++;
        }
        return unique.size > 0 ? (hit / unique.size) * 0.5 : 0;
    }

    function isDefaultEntryEvent(text) {
        const raw = String(text || '').trim();
        return (
            !raw
            || raw === '从上一节拍结果自然衔接进入当前事件。'
            || raw === '从上一节拍结果自然进入当前节拍。'
            || raw === '从上一节拍结果自然衔接进入当前事件'
            || raw === '从上一节拍结果自然进入当前节拍'
        );
    }

    function isDefaultExitCondition(text) {
        const raw = String(text || '').trim();
        return (
            !raw
            || raw === '等待关键互动完成'
            || raw === '等待用户行动或关键互动完成'
            || raw === '等待关键互动完成。'
            || raw === '等待用户行动或关键互动完成。'
            || raw === '当本节拍核心目标完成或局势发生明显转折时。'
        );
    }

    function maybeRepairShiftedBeatMetadata(rawBeats) {
        const beats = Array.isArray(rawBeats)
            ? rawBeats.map((beat, idx) => normalizeBeat(beat, idx))
            : [];
        if (beats.length < 3) return beats;

        const first = beats[0] || {};
        const firstLooksDefault = isDefaultEntryEvent(first.entryEvent) || isDefaultExitCondition(first.exitCondition);

        let shiftedVotes = 0;
        let totalVotes = 0;
        for (let i = 1; i < beats.length; i++) {
            const summary = String(beats[i]?.summary || '').trim();
            if (!summary) continue;

            const prevScore = scoreSummaryAgainstOriginal(summary, beats[i - 1]?.original_text || '');
            const currentScore = scoreSummaryAgainstOriginal(summary, beats[i]?.original_text || '');
            if (prevScore <= 0 && currentScore <= 0) continue;

            totalVotes++;
            if (prevScore > currentScore + 0.08) {
                shiftedVotes++;
            }
        }

        const shouldRepair = firstLooksDefault
            && totalVotes >= 2
            && shiftedVotes >= Math.max(2, Math.ceil(totalVotes * 0.6));

        if (!shouldRepair) return beats;

        const repaired = beats.map((beat) => ({
            ...beat,
            tags: Array.isArray(beat.tags) ? [...beat.tags] : [],
            split_rule: normalizeSplitRule(beat.split_rule || {}),
        }));

        for (let i = 0; i < repaired.length - 1; i++) {
            const source = beats[i + 1] || {};
            repaired[i].summary = String(source.summary || '').trim() || repaired[i].summary;
            repaired[i].event_summary = repaired[i].summary;
            repaired[i].entryEvent = String(source.entryEvent || '').trim() || repaired[i].entryEvent;
            repaired[i].exitCondition = String(source.exitCondition || '').trim() || repaired[i].exitCondition;
            repaired[i].tags = Array.isArray(source.tags) ? [...source.tags] : repaired[i].tags;
            repaired[i].split_rule = normalizeSplitRule(source.split_rule || repaired[i].split_rule || {});
        }

        const lastIdx = repaired.length - 1;
        const last = repaired[lastIdx];
        const lastSummary = toShortText(last?.original_text || '', 200)
            || String(last?.summary || '').trim()
            || `事件点${lastIdx + 1}`;
        last.summary = lastSummary;
        last.event_summary = lastSummary;
        if (isDefaultEntryEvent(last.entryEvent)) {
            last.entryEvent = `以“${toShortText(lastSummary, 60) || `事件点${lastIdx + 1}`}”为起点展开当前节拍动作。`;
        }
        if (isDefaultExitCondition(last.exitCondition)) {
            last.exitCondition = '当本节拍核心目标完成或局势发生明显转折时。';
        }

        directorWarn('检测到历史节拍字段整体错位，已自动执行对齐修复');
        return repaired;
    }

    function splitBeatCandidates(text, limit = 6) {
        return String(text || '')
            .split(/[，,。；;、\n]/)
            .map((part) => toShortText(part, 60))
            .filter(Boolean)
            .slice(0, limit);
    }

    function ensureMinimumBeatCount(beats, fallbackText = '') {
        const normalized = Array.isArray(beats)
            ? beats.map((beat, idx) => normalizeBeat(beat, idx)).slice(0, 8)
            : [];
        const minCount = 3;
        if (normalized.length >= minCount) {
            return normalized;
        }

        const seen = new Set(normalized.map((beat) => beat.summary));
        const candidates = splitBeatCandidates(fallbackText, 8);
        for (const candidate of candidates) {
            if (normalized.length >= minCount) break;
            if (!candidate || seen.has(candidate)) continue;
            normalized.push(normalizeBeat({
                summary: candidate,
                exitCondition: '出现明显推进动作或关键信息变化',
            }, normalized.length));
            seen.add(candidate);
        }

        const genericFallback = [
            '继续在当前场景搜集线索并形成判断',
            '与关键角色或环境发生互动以验证线索',
            '在确认新信息后推进到下一步行动',
        ];
        for (const fallback of genericFallback) {
            if (normalized.length >= minCount) break;
            if (seen.has(fallback)) continue;
            normalized.push(normalizeBeat({
                summary: fallback,
                exitCondition: '出现明确行动决策或关键反馈',
            }, normalized.length));
            seen.add(fallback);
        }

        return normalized.slice(0, 8).map((beat, idx) => normalizeBeat(beat, idx));
    }

    function ensureChapterBeats(memory) {
        if (!memory || !memory.chapterScript || typeof memory.chapterScript !== 'object') {
            return [];
        }

        if (!Array.isArray(memory.chapterScript.beats)) {
            memory.chapterScript.beats = [];
        }

        if (memory.chapterScript.beats.length > 0) {
            memory.chapterScript.beats = ensureMinimumBeatCount(
                memory.chapterScript.beats,
                `${memory.chapterOutline || ''}`
            );
            memory.chapterScript.beats = maybeRepairShiftedBeatMetadata(memory.chapterScript.beats);
            return memory.chapterScript.beats;
        }

        const keyNodes = Array.isArray(memory.chapterScript.keyNodes)
            ? memory.chapterScript.keyNodes.map((n) => toShortText(n, 80)).filter(Boolean)
            : [];

        memory.chapterScript.beats = ensureMinimumBeatCount(
            keyNodes.map((node, idx) => normalizeBeat({ summary: node }, idx)),
            `${memory.chapterOutline || ''} ${keyNodes.join('，')}`
        );
        memory.chapterScript.beats = maybeRepairShiftedBeatMetadata(memory.chapterScript.beats);
        return memory.chapterScript.beats;
    }

    function extractJsonObject(text) {
        const raw = String(text || '').trim();
        if (!raw) return null;

        const cleaned = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        try {
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {
            // noop
        }

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                const parsed = JSON.parse(cleaned.slice(start, end + 1));
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (_) {
                return null;
            }
        }

        return null;
    }

    function getSillyTavernChatHistory() {
        try {
            const st = typeof SillyTavern !== 'undefined' ? SillyTavern : null;
            if (!st || typeof st.getContext !== 'function') return [];
            const chat = st.getContext()?.chat;
            return Array.isArray(chat) ? chat : [];
        } catch (_) {
            return [];
        }
    }

    function getChatItemContent(item) {
        return String(item?.mes || item?.content || '').trim();
    }

    function resolveChatItemRole(item) {
        if (item?.is_user === true) return 'user';
        if (item?.is_system === true) return 'system';

        const role = String(item?.role || '').toLowerCase();
        if (role === 'user' || role === 'assistant' || role === 'system') {
            return role;
        }

        return 'assistant';
    }

    function isUserChatItem(item) {
        return resolveChatItemRole(item) === 'user';
    }

    function isAssistantChatItem(item) {
        if (resolveChatItemRole(item) !== 'assistant') return false;
        if (item?.is_system === true) return false;
        if (item?.is_westworld_director === true || item?.is_storyweaver_director === true) return false;
        if (item?.prefix === true) return false;
        return true;
    }

    function pickLatestFromChat(chat, matcher) {
        const source = Array.isArray(chat) ? chat : [];
        for (let i = source.length - 1; i >= 0; i--) {
            const item = source[i] || {};
            if (!matcher(item)) continue;
            const content = getChatItemContent(item);
            if (content) return content;
        }
        return '';
    }

    function getEventLatestUserOverride(eventData) {
        if (!eventData || typeof eventData !== 'object') return '';
        const candidates = [
            eventData.latestUserMessage,
            eventData.userInput,
            eventData.rawUserInput,
            eventData.originalUserInput,
            eventData.message,
        ];
        for (const candidate of candidates) {
            const text = String(candidate || '').trim();
            if (text) return text;
        }
        return '';
    }

    function getLatestDialogue(eventData) {
        const lines = [];

        const realChat = getSillyTavernChatHistory();
        const lastAssistant = pickLatestFromChat(realChat, isAssistantChatItem);
        const lastUser = getEventLatestUserOverride(eventData) || pickLatestFromChat(realChat, isUserChatItem);

        if (lastAssistant) lines.push(`AI:${toShortText(lastAssistant, 320)}`);
        if (lastUser) lines.push(`用户:${toShortText(lastUser, 320)}`);

        return lines.length > 0 ? lines.join('\n') : '无最近对话';
    }

    function getLatestUserMessage(eventData) {
        const override = getEventLatestUserOverride(eventData);
        if (override) return override;
        const realChat = getSillyTavernChatHistory();
        return pickLatestFromChat(realChat, isUserChatItem);
    }

    function getLatestAssistantMessage(eventData) {
        void eventData;
        const realChat = getSillyTavernChatHistory();
        return pickLatestFromChat(realChat, isAssistantChatItem);
    }

    function buildDirectionContext({
        beats,
        currentBeatIdx,
        isNewBeat = false,
        latestAssistantMessage = '',
        latestUserMessage = '',
        isLargeBeatJump = false,
        beatJumpDistance = 0,
    }) {
        const maxIdx = Math.max(0, (Array.isArray(beats) ? beats.length : 0) - 1);
        const safeIdx = Math.max(0, Math.min(currentBeatIdx || 0, maxIdx));
        const currentBeat = Array.isArray(beats) ? (beats[safeIdx] || beats[0] || null) : null;
        const entryEvent = toShortText(currentBeat?.entryEvent || '', 120);
        const recentAssistant = toTailText(latestAssistantMessage || '', 200);
        const recentUser = toShortText(latestUserMessage || '', 220);
        const jumpDistance = Math.max(0, Number.isFinite(Number(beatJumpDistance)) ? Number(beatJumpDistance) : 0);
        const hasLargeBeatJump = isLargeBeatJump === true || jumpDistance >= 2;

        let startAnchor = '';
        if (hasLargeBeatJump) {
            if (entryEvent) {
                startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_ENTRY, {
                    JUMP_DISTANCE: Math.max(2, Math.round(jumpDistance)),
                    ENTRY_EVENT: entryEvent,
                });
            } else if (recentUser) {
                startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_USER, {
                    JUMP_DISTANCE: Math.max(2, Math.round(jumpDistance)),
                    RECENT_USER: recentUser,
                });
            } else {
                startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_DEFAULT);
            }
        } else if (recentAssistant) {
            if (isNewBeat && entryEvent) {
                startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT_NEW, {
                    RECENT_ASSISTANT: recentAssistant,
                    ENTRY_EVENT: entryEvent,
                });
            } else {
                startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT, {
                    RECENT_ASSISTANT: recentAssistant,
                });
            }   
        } else if (entryEvent) {
            startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ENTRY, {
                ENTRY_EVENT: entryEvent,
            });
        } else if (recentUser) {
            startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_USER, {
                RECENT_USER: recentUser,
            });
        } else {
            startAnchor = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_DEFAULT);
        }

        const freePlayKeywords = /自由推进|随意推进|自由发挥|随意发挥|自由演绎|随意演绎|你继续|你推进|自由写|随便写|随意写|自由发挥剧情|随意发挥剧情/;
        const isFreePlay = freePlayKeywords.test(recentUser);

        let endGuideline = '';
        if (isFreePlay) {
            endGuideline = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_FREE_PLAY);
        } else if (recentUser) {
            endGuideline = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_USER);
        } else {
            endGuideline = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_DEFAULT);
        }
        return {
            mode: isNewBeat ? 'new_beat' : 'in_beat',
            start_anchor: toShortText(startAnchor, 180),
            end_guideline: toShortText(endGuideline, 180),
            entry_event: entryEvent || '',
            recent_assistant: recentAssistant || '',
            recent_user: recentUser || '',
            is_large_beat_jump: hasLargeBeatJump,
            beat_jump_distance: jumpDistance,
        };
    }

    function detectExplicitBeatSwitchCommand(userMessage) {
        const rawText = String(userMessage || '');
        const text = rawText.replace(/\s+/g, '');
        if (!text) {
            return {
                requested: false,
                direction: 'none',
                signal: '',
                reason: 'empty-user-message',
                source: 'rule-explicit',
                targetIndex: null,
            };
        }

        const negationPatterns = [
            /(不|别|不要|先不|先别|暂不|暂时不).{0,10}(切换到|切到|切|跳到|跳转到|跳|转到|转向|转|进入|接到|推进到|推进|回到|退到|退回到|移到|到).{0,8}(下一个|下一|下个|上一个|上一|上个)?节拍/,
            /(别|不要).{0,8}(下一节拍|下个节拍|下一个节拍|上一节拍|上个节拍|上一个节拍)/,
        ];
        if (negationPatterns.some((pattern) => pattern.test(text))) {
            return {
                requested: false,
                direction: 'none',
                signal: 'negated-switch-command',
                reason: 'explicit-negation',
                source: 'rule-explicit',
                targetIndex: null,
            };
        }

        const indexMatch = text.match(/(?:切换到|切到|跳到|跳转到|转到|转向|进入|推进到|回到|退到|移到|到)第?(\d+)节拍/);
        if (indexMatch) {
            const targetIndex = Math.max(0, Number(indexMatch[1]) - 1);
            return {
                requested: true,
                direction: 'index',
                signal: 'switch-index-beat',
                reason: 'explicit-switch-command',
                source: 'rule-explicit',
                targetIndex: Number.isFinite(targetIndex) ? targetIndex : null,
            };
        }

        const switchRules = [
            {
                direction: 'next',
                signal: 'verb-next-beat',
                patterns: [
                    /(切换到|切到|切|跳到|跳转到|跳|转到|转向|转|进入|接到|推进到|推进|移到|到)(下一个|下一|下个)节拍/,
                    /(切换下一个节拍|切下一节拍|跳下一个节拍|跳下一节拍|转下一个节拍|转下一节拍)/,
                ],
            },
            {
                direction: 'next',
                signal: 'next-beat-command',
                patterns: [
                    /^(下一个节拍|下个节拍|下一节拍)(吧|。|！|!|,|，)?$/,
                    /nextbeat|next_beat|nextbeatplease|nextchapterbeat/i,
                ],
            },
            {
                direction: 'prev',
                signal: 'verb-prev-beat',
                patterns: [
                    /(回到|退到|退回到|切回到|切回|转回到|转回|切换到|切到|跳到|转到|移到|到)(上一个|上一|上个)节拍/,
                    /(切换上一个节拍|切上一节拍|跳上一个节拍|跳上一节拍|转上一个节拍|转上一节拍)/,
                ],
            },
            {
                direction: 'prev',
                signal: 'prev-beat-command',
                patterns: [
                    /^(上一个节拍|上个节拍|上一节拍)(吧|。|！|!|,|，)?$/,
                    /previousbeat|prevbeat|previous_beat/i,
                ],
            },
            {
                direction: 'stay',
                signal: 'stay-current-beat',
                patterns: [
                    /(当前节拍|这个节拍|这一个节拍|留在当前节拍|继续当前节拍)/,
                ],
            },
        ];

        for (const rule of switchRules) {
            if (rule.patterns.some((pattern) => pattern.test(text))) {
                return {
                    requested: rule.direction !== 'stay',
                    direction: rule.direction,
                    signal: rule.signal,
                    reason: rule.direction === 'stay' ? 'explicit-stay-command' : 'explicit-switch-command',
                    source: 'rule-explicit',
                    targetIndex: null,
                };
            }
        }

        return {
            requested: false,
            direction: 'none',
            signal: '',
            reason: 'no-explicit-switch-command',
            source: 'rule-explicit',
            targetIndex: null,
        };
    }

    function buildDirectorPrompt({ chapterTitle, chapterOutline, currentBeatIdx, beats, latestDialogue, latestUserMessage, directionContext }) {
        const compactBeats = beats.map((beat, idx) => ({
            idx,
            id: beat.id,
            summary: beat.summary,
            entryEvent: beat.entryEvent,
            exitCondition: beat.exitCondition,
        }));
        const currentBeat = beats[currentBeatIdx] || beats[0] || null;
        const context = directionContext && typeof directionContext === 'object' ? directionContext : {};
        const contextMode = context.mode === 'new_beat' ? 'new_beat' : 'in_beat';
        const startAnchor = toShortText(context.start_anchor || '', 180)
            || (contextMode === 'new_beat'
                ? renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_NEW_DEFAULT)
                : renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_IN_BEAT_DEFAULT));
        const emptyContext = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_EMPTY);
        const contextEntryEvent = toShortText(context.entry_event || '', 120) || emptyContext;
        const contextRecentAssistant = toTailText(context.recent_assistant || '', 200) || emptyContext;
        const contextRecentUser = toShortText(context.recent_user || '', 220) || emptyContext;
        const endGuideline = toShortText(context.end_guideline || '', 180)
            || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_BOUNDARY);
        const currentOriginal = String(currentBeat?.original_text || '').trim();
        const currentOriginalForPrompt = currentOriginal || emptyContext;
        const contextModeLabel = contextMode === 'new_beat'
            ? renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_NEW)
            : renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_IN_BEAT);
        const entryEventLine = contextMode === 'new_beat'
            ? renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_ENTRY_LINE, { ENTRY_EVENT: contextEntryEvent })
            : '';
        return promptRegistryService.composeRequest([PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK], {
            [PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK]: {
                CHAPTER_TITLE: String(chapterTitle || ''),
                CHAPTER_OUTLINE: String(chapterOutline || ''),
                CURRENT_BEAT_INDEX: String(currentBeatIdx),
                LATEST_USER_MESSAGE: toShortText(latestUserMessage || '', 320) || emptyContext,
                CONTEXT_MODE_LABEL: contextModeLabel,
                RECENT_ASSISTANT: contextRecentAssistant,
                ENTRY_EVENT_LINE: entryEventLine,
                CURRENT_BEAT_ORIGINAL: currentOriginalForPrompt,
                RECENT_USER: contextRecentUser,
                START_ANCHOR: startAnchor,
                END_GUIDELINE: endGuideline,
                COMPACT_BEATS_JSON: JSON.stringify(compactBeats, null, 2),
                FIXED_STAGE_IDX: String(currentBeatIdx),
            },
        });
    }

    function buildDefaultDirectionScript(currentBeat, nextBeat, directionContext = {}) {
        const currentBeatFallback = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_CURRENT_BEAT);
        const currentSummary = toShortText(currentBeat?.summary || currentBeatFallback, 200) || currentBeatFallback;
        const context = directionContext && typeof directionContext === 'object' ? directionContext : {};
        const mode = context.mode === 'new_beat' ? 'new_beat' : 'in_beat';
        const startAnchor = toShortText(context.start_anchor || '', 160);
        const entryEvent = toShortText(context.entry_event || '', 100) || currentSummary;
        const moduleId = !nextBeat
            ? PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END
            : (mode === 'new_beat'
                ? PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT
                : PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT);
        const actionChain = promptRegistryService.renderModule(moduleId, {
            CURRENT_SUMMARY: currentSummary,
            ENTRY_EVENT_OR_SUMMARY: entryEvent,
        });
        const steps = splitActionChain(actionChain, 4);
        return {
            start: startAnchor || steps[0] || actionChain,
            action_chain: buildActionChain(steps) || actionChain,
            steps,
            end: steps[steps.length - 1] || actionChain,
        };
    }

    function normalizeDirectionScript(rawScript, fallbackScript) {
        const scriptText = typeof rawScript === 'string' ? rawScript : '';
        const source = rawScript && typeof rawScript === 'object' ? rawScript : {};
        const fallback = fallbackScript && typeof fallbackScript === 'object' ? fallbackScript : {};

        let start = toShortText(
            source.start || source.opening || source.begin || scriptText || fallback.start || '',
            180
        );
        if (start.length < 20) {
            const richerFallback = toShortText(
                fallback.start || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_START_RICH),
                150
            );
            start = toShortText([start, richerFallback].filter(Boolean).join(' '), 180);
        }

        const stepCandidates = Array.isArray(source.steps)
            ? source.steps
            : (Array.isArray(source.middle_steps)
                ? source.middle_steps
                : (Array.isArray(source.process) ? source.process : []));

        const sourceChainText = source.action_chain || source.actionChain || source.chain
            || (typeof source.process === 'string' ? source.process : '');
        const sourceChainSteps = splitActionChain(sourceChainText, 4);
        const fallbackChainText = fallback.action_chain || fallback.actionChain || fallback.chain || '';
        const fallbackChainSteps = splitActionChain(fallbackChainText, 4);
        const fallbackSteps = [
            ...(Array.isArray(fallback.steps) ? fallback.steps : []),
            ...fallbackChainSteps,
        ]
            .map((step) => normalizeActionSegment(step, 120))
            .filter(Boolean)
            .slice(0, 4);

        const steps = (stepCandidates.length > 0 ? stepCandidates : sourceChainSteps)
            .map((step) => normalizeActionSegment(step, 120))
            .filter(Boolean)
            .slice(0, 4);

        while (steps.length < 2) {
            const nextFallback = fallbackSteps[steps.length]
                || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_STEP);
            const normalized = normalizeActionSegment(nextFallback, 120);
            if (!normalized) break;
            steps.push(normalized);
        }

        const normalizedActionChain = buildActionChain(steps);

        const end = toShortText(
            source.end || source.closing || source.finish || fallback.end || '',
            180
        );

        return {
            start: start || toShortText(fallback.start || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_START), 180),
            action_chain: normalizedActionChain || buildActionChain(fallbackSteps),
            steps,
            end: end || toShortText(fallback.end || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_END), 180),
        };
    }

    function resolveBeatSwitchControl(currentBeatIdx, beats, switchCommand) {
        const maxIdx = Math.max(0, beats.length - 1);
        const safeCurrentIdx = Math.max(0, Math.min(currentBeatIdx, maxIdx));
        const hasNextBeat = safeCurrentIdx < maxIdx;
        const hasPreviousBeat = safeCurrentIdx > 0;

        const direction = String(switchCommand?.direction || 'none');
        const signal = String(switchCommand?.signal || '');
        const requested = switchCommand?.requested === true;

        if (!requested || direction === 'none' || direction === 'stay') {
            return {
                switched: false,
                lockedBeatIdx: safeCurrentIdx,
                direction: 'none',
                signal,
                reason: switchCommand?.reason || 'locked-current',
            };
        }

        if (direction === 'index' && Number.isInteger(switchCommand?.targetIndex)) {
            const targetIdx = Math.max(0, Math.min(Number(switchCommand.targetIndex), maxIdx));
            const switched = targetIdx !== safeCurrentIdx;
            return {
                switched,
                lockedBeatIdx: targetIdx,
                direction: switched ? (targetIdx > safeCurrentIdx ? 'next' : 'prev') : 'none',
                signal,
                reason: switched ? 'user-switched-index' : 'index-no-change',
            };
        }

        if (direction === 'next') {
            if (!hasNextBeat) {
                return {
                    switched: false,
                    lockedBeatIdx: safeCurrentIdx,
                    direction: 'none',
                    signal,
                    reason: 'last-beat-no-advance',
                };
            }
            return {
                switched: true,
                lockedBeatIdx: safeCurrentIdx + 1,
                direction: 'next',
                signal,
                reason: 'user-switched-next',
            };
        }

        if (direction === 'prev') {
            if (!hasPreviousBeat) {
                return {
                    switched: false,
                    lockedBeatIdx: safeCurrentIdx,
                    direction: 'none',
                    signal,
                    reason: 'first-beat-no-backward',
                };
            }
            return {
                switched: true,
                lockedBeatIdx: safeCurrentIdx - 1,
                direction: 'prev',
                signal,
                reason: 'user-switched-prev',
            };
        }

        return {
            switched: false,
            lockedBeatIdx: safeCurrentIdx,
            direction: 'none',
            signal,
            reason: 'unsupported-switch-direction',
        };
    }

    function normalizeDecision(rawDecision, currentBeatIdx, beats, directionContext = {}) {
        const maxIdx = Math.max(0, beats.length - 1);
        const parsedIdx = Number.isInteger(rawDecision?.stage_idx)
            ? rawDecision.stage_idx
            : Number.isInteger(Number(rawDecision?.stage_idx))
                ? Number(rawDecision.stage_idx)
                : currentBeatIdx;

        const stageIdx = Math.max(0, Math.min(maxIdx, parsedIdx));
        const targetBeat = beats[stageIdx] || beats[0] || null;
        const nextBeat = beats[Math.min(maxIdx, stageIdx + 1)] || null;
        const fallbackDirectionScript = buildDefaultDirectionScript(targetBeat, nextBeat, directionContext);
        const directionScript = normalizeDirectionScript(
            rawDecision?.direction_script || rawDecision?.directionScript || rawDecision?.director_script || rawDecision?.guidance,
            fallbackDirectionScript
        );

        return {
            stage_idx: stageIdx,
            direction_script: directionScript,
        };
    }

    function buildFallbackDecision(currentBeatIdx, beats, reason = 'fallback', directionContext = {}) {
        const safeIdx = Math.max(0, Math.min(currentBeatIdx, Math.max(0, beats.length - 1)));
        const currentBeat = beats[safeIdx] || beats[0] || null;
        const nextBeat = beats[safeIdx + 1] || null;
        const directionScript = buildDefaultDirectionScript(currentBeat, nextBeat, directionContext);
        return {
            stage_idx: safeIdx,
            direction_script: directionScript,
            reason,
        };
    }

    function stripExistingDirectorInjection(chat) {
        if (!Array.isArray(chat)) return;
        for (let i = chat.length - 1; i >= 0; i--) {
            const item = chat[i];
            if (item?.is_westworld_director === true || item?.is_storyweaver_director === true) {
                chat.splice(i, 1);
                continue;
            }
            const itemContent = String(item?.content || item?.mes || '');
            if (
                itemContent.includes('# StoryWeaver 导演提示（宽松模式）')
                || itemContent.includes('# StoryWeaver 导演提示（硬导演模式）')
                || itemContent.includes('# WestWorld 导演提示（宽松模式）')
                || itemContent.includes('# WestWorld 导演提示（硬导演模式）')
            ) {
                chat.splice(i, 1);
            }
        }
    }

    function buildInjection(decision, beats) {
        const stageIdx = Number.isInteger(decision.stage_idx) ? decision.stage_idx : 0;
        const currentBeat = beats[stageIdx] || beats[0] || null;
        const nextBeat = beats[stageIdx + 1] || null;
        const previousStageIdx = Number.isInteger(decision.previous_stage_idx)
            ? Math.max(0, Math.min(decision.previous_stage_idx, beats.length - 1))
            : Math.max(0, stageIdx - 1);
        const switchedStage = stageIdx !== previousStageIdx;
        const currentOriginal = String(currentBeat?.original_text || '').trim();
        const currentOriginalSection = currentOriginal
            || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_CURRENT_MISSING);
        const nextBeatSummary = toShortText(
            decision?.next_beat_summary
            || nextBeat?.summary
            || '',
            120
        ) || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_MISSING);
        const nextBeatEntryEvent = toShortText(
            decision?.next_beat_entry_event
            || nextBeat?.entryEvent
            || '',
            140
        ) || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_ENTRY_MISSING);
        const nextBeatPreview200 = toHeadText(
            decision?.next_beat_preview_200
            || nextBeat?.original_text
            || '',
            220
        ) || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_PREVIEW_MISSING);
        const currentExitCondition = toShortText(currentBeat?.exitCondition || '', 140)
            || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_EXIT_MISSING);
        const directionContext = decision?.direction_context && typeof decision.direction_context === 'object'
            ? decision.direction_context
            : buildDirectionContext({
                beats,
                currentBeatIdx: stageIdx,
                isNewBeat: decision?.is_new_beat === true,
                latestAssistantMessage: decision?.latest_assistant_message || '',
                latestUserMessage: decision?.latest_user_message || '',
            });
        const directionScript = normalizeDirectionScript(
            decision.direction_script,
            buildDefaultDirectionScript(currentBeat, nextBeat, directionContext)
        );
        const actionChainSteps = splitActionChain(directionScript.action_chain || '', 4);
        const defaultSteps = splitActionChain(
            renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_STEPS),
            4
        );
        const steps = actionChainSteps.length > 0
            ? actionChainSteps
            : (Array.isArray(directionScript.steps) && directionScript.steps.length > 0
                ? directionScript.steps
                : defaultSteps);
        const actionChain = buildActionChain(steps);

        const processLines = steps
            .slice(0, 4)
            .map((step, idx) => `  ${idx + 1}. ${step}`)
            .join('\n');

        const stageExecutionRequirement = renderDirectorFragment(
            switchedStage
                ? PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_SWITCHED
                : PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_STAY
        );
        const defaultStart = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_START);
        const defaultEnd = renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_END);

        return promptRegistryService.renderModule(PROMPT_MODULE_IDS.DIRECTOR_INJECTION, {
            CURRENT_BEAT_ID: String(currentBeat?.id || `b${stageIdx + 1}`),
            CURRENT_BEAT_SUMMARY: String(currentBeat?.summary || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_CURRENT_BEAT)),
            CURRENT_BEAT_ORIGINAL: currentOriginalSection,
            DIRECTION_START: String(directionScript.start || defaultStart),
            DIRECTION_ACTION_CHAIN: String(actionChain || renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_ACTION)),
            DIRECTION_PROCESS_LINES: processLines || defaultSteps.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n'),
            DIRECTION_END: String(directionScript.end || defaultEnd),
            STAGE_EXECUTION_REQUIREMENT: stageExecutionRequirement,
            CURRENT_EXIT_CONDITION: currentExitCondition,
            NEXT_BEAT_SUMMARY: nextBeatSummary,
            NEXT_BEAT_ENTRY_EVENT: nextBeatEntryEvent,
            NEXT_BEAT_PREVIEW_200: nextBeatPreview200,
            START_RECAP: String(directionScript.start || defaultStart),
        });
    }

    function getDirectorContext(options = {}) {
        void options;
        normalizeDirectorBeatState(AppState);
        const queue = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue : [];
        if (queue.length <= 0) {
            return { ok: false, reason: 'state-missing' };
        }
        const chapterIndex = Number.isInteger(AppState.experience?.currentChapterIndex)
            ? Math.max(0, Math.min(AppState.experience.currentChapterIndex, queue.length - 1))
            : 0;
        const memory = queue[chapterIndex] || null;
        if (!memory) return { ok: false, reason: 'chapter-missing' };
        ensureMemoryDirectorRuntime(memory, chapterIndex);
        const beats = ensureChapterBeats(memory);
        const beatCount = Array.isArray(beats) ? beats.length : 0;
        const beatIndex = Number.isInteger(memory.chapterCurrentBeatIndex)
            ? Math.max(0, Math.min(memory.chapterCurrentBeatIndex, Math.max(0, beatCount - 1)))
            : 0;
        const beat = beats[beatIndex] || null;
        const decision = memory.directorDecision || AppState.experience?.directorLastDecision || null;
        const directionScript = decision?.direction_script || {};

        return {
            ok: true,
            reason: '',
            session: getSillyTavernSessionFingerprint(),
            chapter: {
                index: chapterIndex,
                title: memory.chapterTitle || `第${chapterIndex + 1}章`,
                outlinePreview: toShortText(memory.chapterOutline || '', 260),
            },
            beat: {
                index: beatIndex,
                count: beatCount,
                id: String(beat?.id || `b${beatIndex + 1}`),
                summary: toShortText(beat?.summary || beat?.event_summary || '', 220),
                entryEvent: toShortText(beat?.entryEvent || '', 160),
                exitCondition: toShortText(beat?.exitCondition || '', 160),
                originalPreview: toHeadText(beat?.original_text || '', 260),
            },
            decision: decision ? {
                source: AppState.experience?.directorLastInjectionMeta?.source || '',
                at: decision.at || AppState.experience?.directorLastDecisionAt || 0,
                isNewBeat: decision.is_new_beat === true,
                switchDirection: decision.switch_direction || '',
                directionStart: directionScript.start || '',
                actionChain: directionScript.action_chain || '',
                directionEnd: directionScript.end || '',
            } : null,
            runtime: directorTelemetry?.getStatus?.() || AppState.experience?.directorRuntime || null,
        };
    }

    function getDirectorInjectionPrompt(options = {}) {
        normalizeDirectorBeatState(AppState);
        const directorMode = String(AppState.settings.directorMode || (AppState.settings.directorEnabled === false ? 'off' : 'api'));
        if (directorMode === 'off' || AppState.settings.directorEnabled === false) {
            return { ok: false, reason: 'directorMode=off', content: '', meta: {} };
        }
        const mode = String(options.mode || 'current');
        let content = '';
        let meta = AppState.experience?.directorLastInjectionMeta || {};

        if (mode === 'lastInjected' && AppState.experience?.directorLastInjectionPrompt) {
            content = AppState.experience.directorLastInjectionPrompt;
        } else {
            const queue = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue : [];
            const chapterIndex = Number.isInteger(AppState.experience?.currentChapterIndex)
                ? Math.max(0, Math.min(AppState.experience.currentChapterIndex, Math.max(0, queue.length - 1)))
                : 0;
            const memory = queue[chapterIndex] || null;
            if (!memory) return { ok: false, reason: 'chapter-missing', content: '', meta: {} };
            ensureMemoryDirectorRuntime(memory, chapterIndex);
            const beats = ensureChapterBeats(memory);
            let decision = memory.directorDecision || AppState.experience?.directorLastDecision || null;
            const beatIndex = Number.isInteger(decision?.stage_idx)
                ? Math.max(0, Math.min(decision.stage_idx, Math.max(0, beats.length - 1)))
                : (Number.isInteger(memory.chapterCurrentBeatIndex)
                    ? Math.max(0, Math.min(memory.chapterCurrentBeatIndex, Math.max(0, beats.length - 1)))
                    : 0);
            if (!decision) {
                const directionContext = buildDirectionContext({
                    beats,
                    currentBeatIdx: beatIndex,
                    isNewBeat: false,
                    latestAssistantMessage: '',
                    latestUserMessage: '',
                });
                decision = {
                    ...buildFallbackDecision(beatIndex, beats, 'current-beat-fallback', directionContext),
                    previous_stage_idx: beatIndex,
                    is_new_beat: false,
                    direction_context: directionContext,
                };
            }
            const finalBeatIndex = Number.isInteger(decision.stage_idx)
                ? Math.max(0, Math.min(decision.stage_idx, Math.max(0, beats.length - 1)))
                : 0;
            const runId = meta.runId || directorTelemetry?.makeRunId?.('wwd-preview') || `wwd-preview-${Date.now().toString(36)}`;
            content = withDirectorInjectionMarker(
                buildInjection(decision, beats),
                { runId, chapterIndex, beatIndex: finalBeatIndex },
                { includeMarker: options.includeMarker !== false },
            );
            meta = {
                ...meta,
                runId,
                chapterIndex,
                beatIndex: finalBeatIndex,
                source: meta.source || (decision.reason === 'current-beat-fallback' ? 'current-beat-fallback' : 'current-decision'),
            };
        }

        const maxLength = Math.max(0, Number(options.maxLength || 0));
        const finalContent = maxLength > 0 && content.length > maxLength
            ? content.slice(0, maxLength)
            : content;
        return {
            ok: true,
            reason: '',
            content: finalContent,
            meta: {
                ...meta,
                contentLength: content.length,
                contentHash: hashText(content),
                truncated: finalContent.length < content.length,
            },
        };
    }

    function getDirectorPromptForLittleWhiteBox(options = {}) {
        const prompt = getDirectorInjectionPrompt(options);
        if (!prompt.ok) {
            return {
                ok: false,
                reason: prompt.reason,
            };
        }
        return {
            ok: true,
            reason: '',
            injection: {
                role: 'system',
                content: prompt.content,
                identifier: 'westworld-director-current',
                position: 'IN_PROMPT',
                depth: 0,
            },
            context: getDirectorContext(options),
            meta: prompt.meta,
        };
    }

    function testDirectorInjection(options = {}) {
        const runId = options.runId || directorTelemetry?.makeRunId?.('wwd-test') || `wwd-test-${Date.now().toString(36)}`;
        const chat = Array.isArray(options.chat)
            ? options.chat.map((item) => ({ ...(item || {}) }))
            : [{ role: 'user', content: 'test user message', mes: 'test user message', is_user: true }];
        const content = withDirectorInjectionMarker(
            String(options.content || 'WestWorld director injection test body.'),
            {
                runId,
                chapterIndex: Number.isInteger(options.chapterIndex) ? options.chapterIndex : 0,
                beatIndex: Number.isInteger(options.beatIndex) ? options.beatIndex : 0,
            },
            { includeMarker: options.includeMarker !== false },
        );
        const result = insertDirectorInjection(chat, content, {
            runId,
            chapterIndex: Number.isInteger(options.chapterIndex) ? options.chapterIndex : 0,
            beatIndex: Number.isInteger(options.beatIndex) ? options.beatIndex : 0,
            source: 'test',
        });
        return {
            ok: result.injected === true,
            result,
            chat,
        };
    }

    function bindDirectorSessionToCurrentChapter() {
        normalizeDirectorBeatState(AppState);
        const queue = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue : [];
        if (queue.length <= 0) {
            return { ok: false, reason: 'state-missing' };
        }
        const chapterIndex = Number.isInteger(AppState.experience?.currentChapterIndex)
            ? Math.max(0, Math.min(AppState.experience.currentChapterIndex, queue.length - 1))
            : 0;
        const memory = queue[chapterIndex] || null;
        if (!memory) return { ok: false, reason: 'chapter-missing' };
        const beatIndex = Number.isInteger(memory.chapterCurrentBeatIndex) ? Math.max(0, memory.chapterCurrentBeatIndex) : 0;
        const session = getSillyTavernSessionFingerprint();
        const binding = {
            ...session,
            chapterIndex,
            beatIndex,
            boundAt: Date.now(),
        };
        const runtime = directorTelemetry?.runtime?.() || AppState.experience.directorRuntime;
        runtime.boundSession = binding;
        runtime.invalidated = false;
        runtime.invalidationReason = '';
        runtime.invalidatedAt = 0;
        directorTelemetry?.writeLog?.('info', 'bound', 'director session bound to current chapter', binding);
        return { ok: true, binding };
    }

    async function runDirectorBeforeGeneration(eventData, options = {}) {
        const shouldInjectChat = options.injectChat !== false;
        normalizeDirectorBeatState(AppState);
        const directorMode = String(AppState.settings.directorMode || (AppState.settings.directorEnabled === false ? 'off' : 'api'));
        if (directorMode === 'off' || AppState.settings.directorEnabled === false) {
            directorTelemetry?.markGateSkipped?.('directorMode=off');
            directorDebug('skip: directorMode=off');
            return shouldInjectChat ? null : { ok: false, reason: 'directorMode=off' };
        }
        if (AppState.settings.directorRunEveryTurn === false) {
            directorTelemetry?.markGateSkipped?.('directorRunEveryTurn=false');
            directorDebug('skip: directorRunEveryTurn=false');
            return shouldInjectChat ? null : { ok: false, reason: 'directorRunEveryTurn=false' };
        }
        if (!eventData || typeof eventData !== 'object' || eventData.dryRun) {
            directorTelemetry?.markGateSkipped?.('invalid-or-dryrun');
            directorDebug('skip: invalid eventData or dryRun');
            return shouldInjectChat ? null : { ok: false, reason: 'invalid-or-dryrun' };
        }
        if (shouldInjectChat && !Array.isArray(eventData.chat)) {
            directorTelemetry?.markGateSkipped?.('eventData.chat-not-array');
            directorDebug('skip: eventData.chat is not an array');
            return null;
        }

        const ready = await ensureDirectorRuntimeReady({
            AppState,
            MemoryHistoryDB,
            telemetry: directorTelemetry,
        });
        if (!ready?.ok) {
            const reason = ready?.reason || ready?.status || 'state-missing';
            directorTelemetry?.markGateSkipped?.(reason, ready);
            directorWarn(`导演运行态未就绪：${reason}`);
            return null;
        }

        const session = getSillyTavernSessionFingerprint(eventData);
        const previousSession = AppState.experience?.directorRuntime?.lastSession || null;
        const sessionDiff = diffSessionFingerprint(previousSession, session);
        if (sessionDiff.length > 0) {
            directorTelemetry?.markInvalidated?.(`session-changed:${sessionDiff.join(',')}`, {
                previous: previousSession,
                current: session,
            });
        }
        const boundSession = AppState.experience?.directorRuntime?.boundSession || null;
        const boundDiff = diffBoundDirectorSession(boundSession, session);
        if (boundDiff.length > 0) {
            const reason = `session-mismatch:${boundDiff.join(',')}`;
            directorTelemetry?.markGateSkipped?.(reason, { boundSession, current: session });
            directorWarn(`当前聊天与已绑定导演章节不匹配：${boundDiff.join(',')}`);
            return null;
        }
        if (boundSession && Number.isInteger(boundSession.chapterIndex)) {
            const queueLength = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue.length : 0;
            AppState.experience.currentChapterIndex = Math.max(0, Math.min(boundSession.chapterIndex, Math.max(0, queueLength - 1)));
        }
        normalizeDirectorBeatState(AppState);

        const chapterIndex = Number.isInteger(AppState.experience?.currentChapterIndex)
            ? AppState.experience.currentChapterIndex
            : 0;
        const memory = AppState.memory?.queue?.[chapterIndex];
        if (!memory) {
            directorTelemetry?.markGateSkipped?.('chapter-missing', { chapterIndex });
            directorWarn(`当前章节不存在，chapterIndex=${chapterIndex}`);
            return null;
        }
        ensureMemoryDirectorRuntime(memory, chapterIndex);

        const beats = ensureChapterBeats(memory);
        if (!Array.isArray(beats) || beats.length === 0) {
            directorTelemetry?.markGateSkipped?.('beats-missing', { chapterIndex });
            directorWarn(`无可用轻节拍，chapter=${chapterIndex + 1}`);
            return null;
        }

        const currentBeatIdx = Number.isInteger(memory.chapterCurrentBeatIndex)
            ? Math.max(0, Math.min(memory.chapterCurrentBeatIndex, beats.length - 1))
            : 0;
        memory.chapterCurrentBeatIndex = currentBeatIdx;
        const turnPrefix = buildDirectorTurnPrefix(chapterIndex);
        const runStartedAt = Date.now();
        const runId = directorTelemetry?.makeRunId?.() || `wwd-${runStartedAt.toString(36)}`;
        directorTelemetry?.markRunStarted?.({
            runId,
            chapterIndex,
            beatIndex: currentBeatIdx,
            beatCount: beats.length,
            session,
        });
        directorDebug(`start chapter=${chapterIndex + 1}, beat=${currentBeatIdx + 1}/${beats.length}`);

        const latestUserMessage = getLatestUserMessage(eventData);
        const latestAssistantMessage = getLatestAssistantMessage(eventData);
        const latestDialogue = getLatestDialogue(eventData);
        const switchCommand = detectExplicitBeatSwitchCommand(latestUserMessage);
        const switchControl = resolveBeatSwitchControl(currentBeatIdx, beats, switchCommand);
        const lockedBeatIdx = switchControl.lockedBeatIdx;
        const chapterQueue = Array.isArray(AppState.memory?.queue) ? AppState.memory.queue : [];
        const chapterMaxIdx = Math.max(0, chapterQueue.length - 1);
        const previousChapterIdx = Number.isInteger(AppState.experience?.lastChapterIdx)
            ? Math.max(0, Math.min(AppState.experience.lastChapterIdx, chapterMaxIdx))
            : chapterIndex;
        const chapterChanged = previousChapterIdx !== chapterIndex;

        const beatCountCache = new Map();
        beatCountCache.set(chapterIndex, beats.length);

        function getChapterBeatCount(idx) {
            if (!Number.isInteger(idx) || idx < 0 || idx > chapterMaxIdx) return 0;
            if (beatCountCache.has(idx)) return beatCountCache.get(idx);
            const chapterMemory = chapterQueue[idx];
            const chapterBeats = ensureChapterBeats(chapterMemory);
            const count = Array.isArray(chapterBeats) ? chapterBeats.length : 0;
            beatCountCache.set(idx, Math.max(0, count));
            return beatCountCache.get(idx);
        }

        function clampBeatIdxByChapter(idx, beatIdx) {
            if (!Number.isInteger(beatIdx)) return -1;
            const beatCount = getChapterBeatCount(idx);
            if (beatCount <= 0) return -1;
            return Math.max(0, Math.min(beatIdx, beatCount - 1));
        }

        function toGlobalBeatOrdinal(idx, beatIdx) {
            if (!Number.isInteger(idx) || idx < 0 || idx > chapterMaxIdx) return null;
            const safeBeatIdx = clampBeatIdxByChapter(idx, beatIdx);
            if (safeBeatIdx < 0) return null;
            let offset = 0;
            for (let i = 0; i < idx; i++) {
                offset += getChapterBeatCount(i);
            }
            return offset + safeBeatIdx;
        }

        const previousBeatIdx = clampBeatIdxByChapter(
            previousChapterIdx,
            Number.isInteger(AppState.experience?.lastBeatIdx) ? AppState.experience.lastBeatIdx : -1
        );
        const currentGlobalBeatOrdinal = toGlobalBeatOrdinal(chapterIndex, lockedBeatIdx);
        const previousGlobalBeatOrdinal = previousBeatIdx >= 0
            ? toGlobalBeatOrdinal(previousChapterIdx, previousBeatIdx)
            : null;
        const hasReliableBeatHistory = Number.isInteger(currentGlobalBeatOrdinal) && Number.isInteger(previousGlobalBeatOrdinal);
        const beatJumpDistance = (Number.isInteger(currentGlobalBeatOrdinal) && Number.isInteger(previousGlobalBeatOrdinal))
            ? Math.abs(currentGlobalBeatOrdinal - previousGlobalBeatOrdinal)
            : 0;
        const isLargeBeatJump = beatJumpDistance >= 2;
        const isNewBeat = hasReliableBeatHistory
            ? currentGlobalBeatOrdinal !== previousGlobalBeatOrdinal
            : (chapterChanged || switchControl.switched === true);
        const directionContext = buildDirectionContext({
            beats,
            currentBeatIdx: lockedBeatIdx,
            isNewBeat,
            latestAssistantMessage,
            latestUserMessage,
            isLargeBeatJump,
            beatJumpDistance,
        });
        directorDebug(`switch-command=${switchCommand.requested ? `on(${switchCommand.signal || 'explicit'})` : 'off'}`);
        directorDebug(`switch-control=${switchControl.reason}, lockedBeat=${lockedBeatIdx + 1}/${beats.length}`);
        directorDebug(`jump-detect chapterChanged=${chapterChanged ? 'yes' : 'no'}, beatGap=${beatJumpDistance}, global=${previousGlobalBeatOrdinal ?? -1}->${currentGlobalBeatOrdinal ?? -1}, history=${hasReliableBeatHistory ? 'reliable' : 'fallback'}`);
        directorDebug(`start-mode=${directionContext.mode}, prevBeat=${previousBeatIdx >= 0 ? previousBeatIdx + 1 : 0}`);

        // 新增：输出导演回合判定开始日志
        if (typeof updateStreamContent === 'function') {
            const userMsgPreview = toShortText(latestUserMessage || '', 60) || '（无）';
            const modeLabel = directionContext.mode === 'new_beat' ? '新入节拍' : '节拍中段续写';
            updateStreamContent(`\n🎬 ${turnPrefix} ========== 导演回合判定开始 ==========\n`);
            updateStreamContent(`   章节: ${memory.chapterTitle || `第${chapterIndex + 1}章`}\n`);
            updateStreamContent(`   当前节拍: ${currentBeatIdx + 1}/${beats.length}\n`);
            updateStreamContent(`   用户消息: ${userMsgPreview}\n`);
            updateStreamContent(`   切拍指令: ${switchCommand.requested ? switchCommand.signal || '显式' : '无'}\n`);
            updateStreamContent(`   锁定节拍: ${lockedBeatIdx + 1}/${beats.length}\n`);
            updateStreamContent(`   判定模式: ${modeLabel}\n`);
        }

        const prompt = directorMode === 'api'
            ? buildDirectorPrompt({
                chapterTitle: memory.chapterTitle || `第${chapterIndex + 1}章`,
                chapterOutline: toShortText(memory.chapterOutline || '', 200),
                currentBeatIdx: lockedBeatIdx,
                beats,
                latestDialogue,
                latestUserMessage,
                directionContext,
            })
            : '';

        // 新增：输出导演提示词构建完成日志
        if (typeof updateStreamContent === 'function' && prompt) {
            updateStreamContent(`📝 ${turnPrefix} 导演提示词构建完成 (${prompt.length}字符)\n`);
        }

        let decision = null;
        let decisionSource = 'model';
        if (directorMode === 'local-fallback') {
            decision = buildFallbackDecision(lockedBeatIdx, beats, 'local-fallback', directionContext);
            decisionSource = 'fallback-local';
        } else try {
            if (typeof updateStreamContent === 'function') {
                updateStreamContent(`🧭 ${turnPrefix} 发起回合判定请求（节拍 ${lockedBeatIdx + 1}/${beats.length}）\n`);
            }
            notifyDirectorJudgement('info', `导演判定请求已发送：第${chapterIndex + 1}章，节拍 ${lockedBeatIdx + 1}/${beats.length}`);
            const response = await callDirectorAPI(prompt, chapterIndex + 1);
            if (typeof updateStreamContent === 'function') {
                updateStreamContent(`✅ ${turnPrefix} 判定请求成功，响应 ${String(response || '').length} 字符\n`);
            }
            const parsed = extractJsonObject(response);
            if (!parsed) {
                if (AppState.settings.directorFallbackOnError === false) {
                    directorTelemetry?.markGateSkipped?.('directorFallbackOnError=false', { failure: 'parse' });
                    return shouldInjectChat ? null : { ok: false, reason: 'directorFallbackOnError=false' };
                }
                notifyDirectorJudgement('warning', '导演判定收到响应，但不是有效 JSON，已使用兜底判定');
                directorWarn('导演返回内容无法解析为JSON，已使用回退判定', toShortText(response, 220));
                if (typeof updateStreamContent === 'function') {
                    updateStreamContent(`⚠️ ${turnPrefix} 响应不是有效JSON，已切换回退判定\n`);
                }
                decision = buildFallbackDecision(lockedBeatIdx, beats, 'parse-fallback', directionContext);
                decisionSource = 'fallback-parse';
            } else {
                decision = normalizeDecision(parsed, lockedBeatIdx, beats, directionContext);
                notifyDirectorJudgement('success', `导演判定成功：锁定节拍 ${decision.stage_idx + 1}/${beats.length}`);
            }

            // 新增：输出导演决策详情日志
            if (typeof updateStreamContent === 'function' && decision) {
                const ds = decision.direction_script || {};
                const steps = Array.isArray(ds.steps) ? ds.steps : [];
                const actionChain = ds.action_chain || '';
                updateStreamContent(`📋 ${turnPrefix} 导演决策详情:\n`);
                updateStreamContent(`   来源: ${decisionSource}\n`);
                updateStreamContent(`   锁定节拍: ${decision.stage_idx + 1}/${beats.length}\n`);
                updateStreamContent(`   新节拍: ${decision.is_new_beat ? '是' : '否'}\n`);
                updateStreamContent(`   大跳转: ${decision.is_large_beat_jump ? '是' : '否'}\n`);
                updateStreamContent(`   起点: ${toShortText(ds.start || '', 100) || '（默认）'}\n`);
                if (actionChain) {
                    updateStreamContent(`   动作链: ${toShortText(actionChain, 120)}\n`);
                }
                if (steps.length > 0) {
                    updateStreamContent(`   动作步骤:\n`);
                    steps.slice(0, 4).forEach((step, i) => {
                        updateStreamContent(`     ${i + 1}. ${toShortText(step, 100)}\n`);
                    });
                }
                updateStreamContent(`   终点: ${toShortText(ds.end || '', 100) || '（默认）'}\n`);
            }
        } catch (error) {
            if (AppState.settings.directorFallbackOnError === false) {
                directorTelemetry?.markGateSkipped?.('directorFallbackOnError=false', { failure: 'api-error' });
                return shouldInjectChat ? null : { ok: false, reason: 'directorFallbackOnError=false' };
            }
            notifyDirectorJudgement('warning', `导演判定请求失败，已使用兜底：${error?.message || String(error)}`);
            directorWarn('导演判定失败，已使用回退判定', error?.message || String(error));
            if (typeof updateStreamContent === 'function') {
                updateStreamContent(`❌ ${turnPrefix} 判定请求失败: ${error?.message || String(error)}\n`);
                updateStreamContent(`⚠️ ${turnPrefix} 已启用本地回退判定\n`);
            }
            decision = buildFallbackDecision(lockedBeatIdx, beats, 'error-fallback', directionContext);
            decisionSource = 'fallback-error';
        }

        // 节拍切换由流程层决定，导演输出仅负责“怎么演”。
        decision.stage_idx = lockedBeatIdx;
        decision.switch_direction = switchControl.direction;
        decision.switch_signal = switchControl.signal;
        decision.switch_gate = switchControl.reason;
        decision.is_new_beat = isNewBeat;
        decision.is_large_beat_jump = isLargeBeatJump;
        decision.beat_jump_distance = beatJumpDistance;
        decision.direction_context = directionContext;
        decision.latest_assistant_message = toTailText(latestAssistantMessage || '', 200);
        decision.latest_user_message = toShortText(latestUserMessage || '', 220);

        const nextBeat = beats[lockedBeatIdx + 1] || null;
        const nextBeatSummary = toShortText(nextBeat?.summary || '', 200);
        const nextBeatEntryEvent = toShortText(nextBeat?.entryEvent || '', 140);
        const nextBeatPreview200 = toHeadText(nextBeat?.original_text || '', 200)
            || (nextBeatSummary
                ? renderDirectorFragment(PROMPT_MODULE_IDS.DIRECTOR_NEXT_PREVIEW_SUMMARY, {
                    NEXT_BEAT_SUMMARY: nextBeatSummary,
                })
                : '');

        // 新增：输出下一节拍信息
        if (typeof updateStreamContent === 'function' && nextBeatSummary) {
            updateStreamContent(`⏭️ ${turnPrefix} 下一节拍:\n`);
            updateStreamContent(`   摘要: ${nextBeatSummary}\n`);
            updateStreamContent(`   入场事件: ${nextBeatEntryEvent || '（无）'}\n`);
        }

        decision.next_beat_summary = nextBeatSummary || '';
        decision.next_beat_entry_event = nextBeatEntryEvent || '';
        decision.next_beat_preview_200 = nextBeatPreview200 || '';
        decision.direction_context = {
            ...decision.direction_context,
            next_beat_summary: nextBeatSummary || '',
            next_beat_entry_event: nextBeatEntryEvent || '',
        };

        const decisionActionChainSteps = splitActionChain(decision?.direction_script?.action_chain || '', 4);
        const hasValidActionChain = decisionActionChainSteps.length >= 2;
        const hasValidSteps = Array.isArray(decision?.direction_script?.steps) && decision.direction_script.steps.length >= 2;
        if (!decision?.direction_script || (!hasValidActionChain && !hasValidSteps)) {
            directorDebug('invalid-direction-script fallback applied');
            decision.direction_script = normalizeDirectionScript(
                decision.direction_script,
                buildDefaultDirectionScript(
                    beats[lockedBeatIdx] || null,
                    beats[lockedBeatIdx + 1] || null,
                    directionContext
                )
            );
        }

        decision.previous_stage_idx = currentBeatIdx;

        directorInfo(`判定完成 source=${decisionSource}, stage=${decision.stage_idx}, switch=${decision.switch_direction || 'none'}`);
        if (typeof updateStreamContent === 'function') {
            updateStreamContent(`✅ ${turnPrefix} 判定完成：source=${decisionSource}, 锁定节拍=${decision.stage_idx + 1}/${beats.length}, switch=${decision.switch_direction || 'none'}\n`);
        }

        memory.chapterCurrentBeatIndex = decision.stage_idx;
        memory.directorDecision = {
            ...decision,
            at: Date.now(),
        };
        AppState.experience.currentBeatIndex = decision.stage_idx;
        AppState.experience.lastBeatIdx = lockedBeatIdx;
        AppState.experience.lastChapterIdx = chapterIndex;
        AppState.experience.directorLastDecision = { ...memory.directorDecision };
        AppState.experience.directorLastDecisionAt = Date.now();
        directorTelemetry?.markApiResult?.({
            runId,
            source: decisionSource,
            durationMs: Date.now() - runStartedAt,
            chapterIndex,
            beatIndex: decision.stage_idx,
            beatCount: beats.length,
        });

        const injection = withDirectorInjectionMarker(
            buildInjection(decision, beats),
            {
                runId,
                chapterIndex,
                beatIndex: decision.stage_idx,
            },
            {
                includeMarker: AppState?.settings?.directorInjectionMarkerEnabled !== false,
            },
        );
        AppState.experience.directorLastInjectionPrompt = injection;
        AppState.experience.directorLastInjectionMeta = {
            runId,
            chapterIndex,
            beatIndex: decision.stage_idx,
            source: decisionSource,
            contentLength: injection.length,
            contentHash: hashText(injection),
            at: Date.now(),
        };

        if (!shouldInjectChat) {
            const contentPreview = injection.slice(0, 180).replace(/\s+/g, ' ').trim();
            directorTelemetry?.writeLog?.('info', 'prompt-manager-ready', 'director prompt prepared for PromptManager', {
                pendingPromptManagerInjection: true,
                viaPromptManager: true,
                markerFound: injection.includes('[WestWorld Director Injection]'),
                role: 'system',
                contentLength: injection.length,
                contentHash: hashText(injection),
                contentPreview,
                runId,
            });
            directorInfo(`PromptManager director prompt ready chapter=${chapterIndex + 1}, activeBeat=${decision.stage_idx + 1}`);
            if (typeof updateStreamContent === 'function') {
                updateStreamContent(`鉁?${turnPrefix} PromptManager瀵兼紨鎵ц鍗曞凡鍑嗗锛坅ctiveBeat=${decision.stage_idx + 1}锛塡n`);
            }
            return {
                ok: true,
                reason: '',
                content: injection,
                meta: { ...AppState.experience.directorLastInjectionMeta },
                decision,
            };
        }

        const injectionInfo = insertDirectorInjection(eventData.chat, injection, {
            runId,
            chapterIndex,
            beatIndex: decision.stage_idx,
            source: decisionSource,
        });
        directorTelemetry?.markInjected?.(injectionInfo);
        directorInfo(`注入完成 chapter=${chapterIndex + 1}, activeBeat=${decision.stage_idx + 1}`);
        if (typeof updateStreamContent === 'function') {
            updateStreamContent(`✅ ${turnPrefix} 注入导演提示词完成（activeBeat=${decision.stage_idx + 1}, marker=${injectionInfo.markerFoundAfterInsert ? 'ok' : 'missing'}）\n`);
        }

        return decision;
    }

    async function prepareDirectorInjectionForGeneration(eventContext = {}) {
        return runDirectorBeforeGeneration(
            { ...(eventContext || {}) },
            { injectChat: false },
        );
    }

    function recordDirectorPromptReadyInspection(chat) {
        const inspected = inspectDirectorInjection(chat);
        directorTelemetry?.markInjected?.({
            ...inspected,
            viaPromptManager: true,
            at: Date.now(),
        });
        return inspected;
    }

    return {
        runDirectorBeforeGeneration,
        prepareDirectorInjectionForGeneration,
        recordDirectorPromptReadyInspection,
        getDirectorContext,
        getDirectorInjectionPrompt,
        getDirectorPromptForLittleWhiteBox,
        inspectDirectorInjection,
        testDirectorInjection,
        bindDirectorSessionToCurrentChapter,
    };
}
