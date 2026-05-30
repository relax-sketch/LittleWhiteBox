import {
    defaultAliasMergePrompt,
    defaultChapterAssetsPrompt,
    defaultConsolidatePrompt,
    defaultDirectorFrameworkPrompt,
    defaultDirectorInjectionPrompt,
    defaultMergePrompt,
    defaultPlotPrompt,
    defaultStylePrompt,
    defaultWorldbookPrompt,
} from '../core/constants.js';

export const PROMPT_MODULE_IDS = Object.freeze({
    LANGUAGE_ZH: 'common.language.zh',
    GEMINI_USER_BRIDGE: 'common.gemini.user-bridge',
    WORLDBOOK_SYSTEM: 'worldbook.system',
    WORLDBOOK_PLOT: 'worldbook.plot',
    WORLDBOOK_STYLE: 'worldbook.style',
    WORLDBOOK_PREVIOUS_CONTEXT: 'worldbook.previous-context',
    WORLDBOOK_RELEVANT_CONTEXT: 'worldbook.relevant-context',
    WORLDBOOK_PREVIOUS_END_PARALLEL: 'worldbook.previous-end.parallel',
    WORLDBOOK_PREVIOUS_END_SERIAL: 'worldbook.previous-end.serial',
    WORLDBOOK_FORCE_CHAPTER: 'worldbook.force-chapter',
    WORLDBOOK_FORCE_REMINDER: 'worldbook.force-reminder',
    WORLDBOOK_PARALLEL_REQUEST: 'worldbook.extract.parallel',
    WORLDBOOK_SERIAL_REQUEST: 'worldbook.extract.serial',
    WORLDBOOK_SERIAL_START: 'worldbook.extract.serial-start',
    WORLDBOOK_SERIAL_INCREMENTAL: 'worldbook.extract.serial-incremental',
    WORLDBOOK_SERIAL_ACCUMULATE: 'worldbook.extract.serial-accumulate',
    WORLDBOOK_REROLL_EXTRA: 'worldbook.reroll.extra',
    WORLDBOOK_REPAIR: 'worldbook.repair',
    WORLDBOOK_REPAIR_EXISTING: 'worldbook.repair.existing-worldbook',
    WORLDBOOK_SINGLE_REROLL: 'worldbook.reroll.single-entry',
    WORLDBOOK_SINGLE_REROLL_CATEGORY_GUIDE: 'worldbook.reroll.category-guide',
    WORLDBOOK_SINGLE_REROLL_PREVIOUS_END: 'worldbook.reroll.previous-end',
    WORLDBOOK_SINGLE_REROLL_CURRENT_ENTRY: 'worldbook.reroll.current-entry',
    MERGE_IMPORTED: 'merge.imported-entry',
    MERGE_CONSOLIDATE: 'merge.consolidate',
    MERGE_CONSOLIDATE_RULES: 'merge.consolidate.rules',
    MERGE_ALIAS: 'merge.alias',
    MERGE_ALIAS_PAIR: 'merge.alias.pair',
    DIRECTOR_CHAPTER_ASSETS: 'director.chapter-assets',
    DIRECTOR_CHAPTER_ASSETS_PREVIOUS: 'director.chapter-assets.previous-outline',
    DIRECTOR_CHAPTER_ASSETS_RETRY: 'director.chapter-assets.retry',
    DIRECTOR_ENTRY_EVENTS: 'director.entry-events',
    DIRECTOR_FRAMEWORK: 'director.framework',
    DIRECTOR_INJECTION: 'director.injection',
    DIRECTOR_FALLBACK_NEW_BEAT: 'director.fallback.new-beat',
    DIRECTOR_FALLBACK_IN_BEAT: 'director.fallback.in-beat',
    DIRECTOR_FALLBACK_END: 'director.fallback.end',
    DIRECTOR_CONTEXT_EMPTY: 'director.context.empty',
    DIRECTOR_CONTEXT_CURRENT_BEAT: 'director.context.current-beat',
    DIRECTOR_CONTEXT_MODE_NEW: 'director.context.mode.new-beat',
    DIRECTOR_CONTEXT_MODE_IN_BEAT: 'director.context.mode.in-beat',
    DIRECTOR_CONTEXT_ENTRY_LINE: 'director.context.entry-line',
    DIRECTOR_CONTEXT_START_NEW_DEFAULT: 'director.context.start.new-beat-default',
    DIRECTOR_CONTEXT_START_IN_BEAT_DEFAULT: 'director.context.start.in-beat-default',
    DIRECTOR_CONTEXT_START_LARGE_ENTRY: 'director.context.start.large-jump-entry',
    DIRECTOR_CONTEXT_START_LARGE_USER: 'director.context.start.large-jump-user',
    DIRECTOR_CONTEXT_START_LARGE_DEFAULT: 'director.context.start.large-jump-default',
    DIRECTOR_CONTEXT_START_ASSISTANT_NEW: 'director.context.start.assistant-new-beat',
    DIRECTOR_CONTEXT_START_ASSISTANT: 'director.context.start.assistant',
    DIRECTOR_CONTEXT_START_ENTRY: 'director.context.start.entry',
    DIRECTOR_CONTEXT_START_USER: 'director.context.start.user',
    DIRECTOR_CONTEXT_START_DEFAULT: 'director.context.start.default',
    DIRECTOR_CONTEXT_END_BOUNDARY: 'director.context.end.boundary',
    DIRECTOR_CONTEXT_END_FREE_PLAY: 'director.context.end.free-play',
    DIRECTOR_CONTEXT_END_USER: 'director.context.end.user',
    DIRECTOR_CONTEXT_END_DEFAULT: 'director.context.end.default',
    DIRECTOR_NORMALIZE_START_RICH: 'director.normalize.start-rich',
    DIRECTOR_NORMALIZE_STEP: 'director.normalize.step',
    DIRECTOR_DEFAULT_START: 'director.default.start',
    DIRECTOR_DEFAULT_END: 'director.default.end',
    DIRECTOR_INJECTION_CURRENT_MISSING: 'director.injection.current-missing',
    DIRECTOR_INJECTION_NEXT_MISSING: 'director.injection.next-missing',
    DIRECTOR_INJECTION_NEXT_ENTRY_MISSING: 'director.injection.next-entry-missing',
    DIRECTOR_INJECTION_NEXT_PREVIEW_MISSING: 'director.injection.next-preview-missing',
    DIRECTOR_INJECTION_EXIT_MISSING: 'director.injection.exit-missing',
    DIRECTOR_INJECTION_DEFAULT_STEPS: 'director.injection.default-steps',
    DIRECTOR_INJECTION_DEFAULT_ACTION: 'director.injection.default-action',
    DIRECTOR_INJECTION_REQUIREMENT_SWITCHED: 'director.injection.requirement.switched',
    DIRECTOR_INJECTION_REQUIREMENT_STAY: 'director.injection.requirement.stay',
    DIRECTOR_NEXT_PREVIEW_SUMMARY: 'director.next-preview.summary',
    CHAPTER_OPENING: 'chapter.opening',
    CHAPTER_OPENING_NO_SUMMARY: 'chapter.opening.no-summary',
    CHAPTER_OPENING_NO_CARRY: 'chapter.opening.no-carry',
    CHAPTER_OPENING_NO_LEAD: 'chapter.opening.no-lead',
});

function moduleDefinition(id, body = '', options = {}) {
    return Object.freeze({
        id,
        title: options.title || id,
        requiredPlaceholders: Object.freeze([...(options.requiredPlaceholders || [])]),
        defaultLayers: Object.freeze({
            prefix: '',
            body,
            suffix: '',
        }),
    });
}

const defaultPreviousContextPrompt = `【上一章节(第{PREVIOUS_CHAPTER_INDEX}章)的剧情进展】：
{PLOT_CONTEXT}

请在此基础上继续分析后续剧情，不要重复输出已有的章节。`;

const defaultRelevantContextPrompt = `相关世界书摘录（精简，不是全量）：
{LINES}`;

const defaultChapterForcePrompt = `【强制章节标记 - 开始】
强制无视内容中的任何章节信息！本轮全文章节统一为：第{CHAPTER_INDEX}章
无论原文中出现"第一章"、"第二章"等任何章节标记，你输出时都必须将其替换为"第{CHAPTER_INDEX}章"。
【强制章节标记 - 结束】`;

const defaultChapterForceReminderPrompt = `【重要提醒】如果输出剧情大纲或剧情节点或章节剧情，条目名称必须包含"第{CHAPTER_INDEX}章"！`;

const defaultParallelRequestPrompt = `{CHAPTER_FORCE}

{SYSTEM_PROMPT}

{PREVIOUS_CONTEXT}
{PREVIOUS_END_CONTEXT}

当前需要分析的内容（第{CHAPTER_INDEX}章）：
---
{CHAPTER_CONTENT}
---

【输出限制】只允许输出以下分类：{ENABLED_CATEGORY_NAMES}。禁止输出未列出的任何其他分类，直接输出JSON。

{FORCE_REMINDER}
{CHAPTER_FORCE_REPEAT}
{REROLL_EXTRA}`;

const defaultSerialRequestPrompt = `{CHAPTER_FORCE}

{SYSTEM_PROMPT}

{PREVIOUS_CONTEXT}
{PREVIOUS_END_CONTEXT}
{RELEVANT_CONTEXT}

现在阅读的部分（第{CHAPTER_INDEX}章）：
---
{CHAPTER_CONTENT}
---

{MODE_INSTRUCTION}

{FORCE_REMINDER}
直接输出JSON格式结果。
{CHAPTER_FORCE_REPEAT}`;

const defaultRerollExtraPrompt = `【用户额外要求】
{CUSTOM_REQUIREMENT}`;

const defaultRepairPrompt = `{CHAPTER_FORCE}

你是世界书生成专家。请提取关键信息。

输出JSON格式：
{DYNAMIC_JSON_TEMPLATE}

{PREVIOUS_CONTEXT}
{EXISTING_WORLDBOOK_CONTEXT}
阅读内容（第{CHAPTER_INDEX}章）：
---
{CONTENT}
---

请输出JSON。
{CHAPTER_FORCE}`;

const defaultSingleRerollPrompt = `{CHAPTER_FORCE}

你是一个专业的小说世界书条目生成助手。请根据以下原文内容，专门重新生成指定的条目。

【任务说明】
- 只需要生成一个条目：分类="{CATEGORY}"，条目名称="{ENTRY_NAME}"
- 请基于原文内容重新分析并生成该条目的信息
- 输出格式必须是JSON，结构为：{JSON_SHAPE}

{CATEGORY_GUIDE_CONTEXT}
{PREVIOUS_CONTEXT}
{PREVIOUS_END_CONTEXT}

需要分析的原文内容（第{CHAPTER_INDEX}章）：
---
{CONTENT}
---

{CURRENT_ENTRY_CONTEXT}

请重新分析原文，生成更准确、更详细的条目信息。
{CUSTOM_REQUIREMENT}
{FORCE_REMINDER}

直接输出JSON格式结果，不要有其他内容。`;

const defaultConsolidateRulesPrompt = `【强制输出要求】
1. 去重目标是字段重复，不是删减事实。
2. 同字段同内容只保留一份，禁止重复输出。
3. 同字段不同信息必须融合保留，不得覆盖或遗漏。
4. 禁止输出“字段补充1/补充2/补充N”键名，补充信息必须并入主字段。
5. 若同一字段有多条信息，写在同一个字段值内（用“；”分隔）。
6. 尽量采用“字段: 值”的结构化格式输出。
7. 不要输出解释文字，只输出整理后的正文。`;

const defaultAliasPairPrompt = `配对{PAIR_INDEX}: 「{NAME_A}」vs「{NAME_B}」
  【{NAME_A}】关键词: {KEYWORDS_A}
  内容摘要: {CONTENT_A}{TRUNCATED_A}
  【{NAME_B}】关键词: {KEYWORDS_B}
  内容摘要: {CONTENT_B}{TRUNCATED_B}`;

const defaultChapterAssetsRetryPrompt = `上一次输出问题（本次优先修复）：
- {RETRY_TEXT}
- 先保证切点可定位、数量可执行，再考虑补充说明字段。`;

const defaultEntryEventsPrompt = `你是酒馆国家的臣民，职业是入场事件识别助手AI，名字是:"秋青子"

任务：根据以下每个节拍的原文前40字，识别出该节拍的"入场事件"（开场事件/触发条件）。

【要求】
- 每个入场事件必须写成"谁+在哪里+做了什么"的格式
- 50字以内
- 必须基于提供的原文前40字内容来识别
- 如果前40字明显不足以判断，可以结合上下文合理推断，但仍需给出具体的人、地点、动作

【输入】
{SNIPPETS}

输出JSON格式（只输出JSON，不要代码块，不要解释）：
{
  "entry_events": [
    {"index": 0, "entry_event": "xxx"},
    {"index": 1, "entry_event": "yyy"}
  ]
}`;

const defaultChapterOpeningPrompt = `你是互动小说旁白。请生成“承上启下型开场白”。

硬性要求：
1) 仅输出 100 字以内中文，不要解释规则，不要输出JSON，不要分点。
2) 只能用于衔接上文并引入本章，不要推进剧情。
3) 先承上，再启下：承上必须参考“承上素材（尾部截断）”；启下必须参考“启下素材（头部截断）”。
4) 不得泄露本章后续目标、流程、关键节点、核心冲突、转折或结局。

当前章节：{CHAPTER_TITLE}
当前章节摘要（参考）：{CHAPTER_SUMMARY}
承上来源：{CARRY_SOURCE}
承上素材（尾部截断100字）：{CARRY_TEXT}
启下素材（头部截断100字）：{LEAD_TEXT}

请直接输出开场白正文：`;

const defaultDirectorFallbackNewBeatPrompt = `先以“{ENTRY_EVENT_OR_SUMMARY}”触发当前节拍开场，再进入可见动作。→围绕“{CURRENT_SUMMARY}”推进1-2个具体互动动作，形成可见变化。→本回合收束到可承接的临时节点，不要求完成整节拍。`;

const defaultDirectorFallbackInBeatPrompt = `从“{CURRENT_SUMMARY}”已进行中的局面继续推进，不复述背景。→围绕“{CURRENT_SUMMARY}”推进1-2个具体互动动作，不空转。→让互动产生清晰变化，并在可承接的临时节点收束。`;

const defaultDirectorFallbackEndPrompt = `承接“{CURRENT_SUMMARY}”的当前局面继续动作。→完成本节拍内仍未落定的可见互动。→在本节拍边界内形成可承接的临时收束。`;

export const DEFAULT_PROMPT_MODULE_DEFINITIONS = Object.freeze({
    [PROMPT_MODULE_IDS.LANGUAGE_ZH]: moduleDefinition(
        PROMPT_MODULE_IDS.LANGUAGE_ZH,
        '\u8bf7\u7528\u4e2d\u6587\u56de\u590d\u3002',
    ),
    [PROMPT_MODULE_IDS.GEMINI_USER_BRIDGE]: moduleDefinition(
        PROMPT_MODULE_IDS.GEMINI_USER_BRIDGE,
        '请根据以下对话执行任务。',
    ),
    [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: moduleDefinition(
        PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM,
        defaultWorldbookPrompt,
        { requiredPlaceholders: ['{DYNAMIC_JSON_TEMPLATE}', '{ENABLED_CATEGORY_NAMES}'] },
    ),
    [PROMPT_MODULE_IDS.WORLDBOOK_PLOT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PLOT, defaultPlotPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_STYLE]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_STYLE, defaultStylePrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT, defaultPreviousContextPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_RELEVANT_CONTEXT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_RELEVANT_CONTEXT, defaultRelevantContextPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_END_PARALLEL]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_END_PARALLEL, `前文结尾（供参考）：
---
{PREVIOUS_END}
---`),
    [PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_END_SERIAL]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_END_SERIAL, `上次阅读结尾：
---
{PREVIOUS_END}
---`),
    [PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER, defaultChapterForcePrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_FORCE_REMINDER]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_FORCE_REMINDER, defaultChapterForceReminderPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_PARALLEL_REQUEST]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PARALLEL_REQUEST, defaultParallelRequestPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_REQUEST]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_REQUEST, defaultSerialRequestPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_START]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_START, '请开始分析小说内容。'),
    [PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_INCREMENTAL]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_INCREMENTAL, '请增量更新世界书，只输出变更的条目。'),
    [PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_ACCUMULATE]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_ACCUMULATE, '请累积补充世界书。'),
    [PROMPT_MODULE_IDS.WORLDBOOK_REROLL_EXTRA]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_REROLL_EXTRA, defaultRerollExtraPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_REPAIR]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_REPAIR, defaultRepairPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_REPAIR_EXISTING]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_REPAIR_EXISTING, `当前世界书：
{EXISTING_WORLDBOOK}`),
    [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL, defaultSingleRerollPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_CATEGORY_GUIDE]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_CATEGORY_GUIDE, `【该分类的内容指南】
{CATEGORY_GUIDE}`),
    [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_PREVIOUS_END]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_PREVIOUS_END, `前文结尾（供参考）：
---
{PREVIOUS_END}
---`),
    [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_CURRENT_ENTRY]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL_CURRENT_ENTRY, `【当前条目信息（供参考，请重新分析生成）】
{CURRENT_ENTRY}`),
    [PROMPT_MODULE_IDS.MERGE_IMPORTED]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_IMPORTED, defaultMergePrompt),
    [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_CONSOLIDATE, defaultConsolidatePrompt),
    [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE_RULES]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_CONSOLIDATE_RULES, defaultConsolidateRulesPrompt),
    [PROMPT_MODULE_IDS.MERGE_ALIAS]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_ALIAS, defaultAliasMergePrompt),
    [PROMPT_MODULE_IDS.MERGE_ALIAS_PAIR]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_ALIAS_PAIR, defaultAliasPairPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS, defaultChapterAssetsPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_PREVIOUS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_PREVIOUS, '上一章摘要：{PREVIOUS_OUTLINE}'),
    [PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_RETRY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_RETRY, defaultChapterAssetsRetryPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_ENTRY_EVENTS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_ENTRY_EVENTS, defaultEntryEventsPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK, defaultDirectorFrameworkPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION, defaultDirectorInjectionPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT, defaultDirectorFallbackNewBeatPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT, defaultDirectorFallbackInBeatPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END, defaultDirectorFallbackEndPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_EMPTY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_EMPTY, '无'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_CURRENT_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_CURRENT_BEAT, '当前节拍'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_NEW]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_NEW, '新入节拍'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_IN_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_MODE_IN_BEAT, '节拍中段续写'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_ENTRY_LINE]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_ENTRY_LINE, '- 入场事件：{ENTRY_EVENT}'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_NEW_DEFAULT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_NEW_DEFAULT, '先触发当前节拍入场动作，再进入可见互动。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_IN_BEAT_DEFAULT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_IN_BEAT_DEFAULT, '承接最近AI输出，再接入用户动作继续推进。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_ENTRY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_ENTRY, '检测到跨节拍跳转（约{JUMP_DISTANCE}拍），本回合以“{ENTRY_EVENT}”作为新起点，不承接最近AI输出末尾。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_USER]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_USER, '检测到跨节拍跳转（约{JUMP_DISTANCE}拍），以用户当前互动“{RECENT_USER}”作为新起点，不承接最近AI输出末尾。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_DEFAULT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_LARGE_DEFAULT, '检测到跨节拍跳转，本回合从当前节拍可见起点直接开场，不承接最近AI输出末尾。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT_NEW]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT_NEW, '先承接最近AI输出末尾“{RECENT_ASSISTANT}”角色行为或话语，再以“{ENTRY_EVENT}”触发入场事件。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ASSISTANT, '优先承接最近AI输出末尾“{RECENT_ASSISTANT}”角色行为或话语。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ENTRY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ENTRY, '以“{ENTRY_EVENT}”作为入场触发继续推进，并与用户当前互动保持连续。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_USER]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_USER, '以用户刚给出的互动“{RECENT_USER}”作为当前起点继续推进，不补写超出输入边界的动作。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_DEFAULT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_DEFAULT, '从当前可见动作直接续写，保持连续，不补写超出用户输入边界的剧情。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_BOUNDARY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_BOUNDARY, '本回合收束到可中断临时节点，不要求完成整节拍，且不得超出用户输入边界。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_FREE_PLAY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_FREE_PLAY, '本回合只需收束到可中断的临时节点（小结果、可追问钩子或局势变化），不要求完成整个节拍；'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_USER]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_USER, '以用户本轮输入末尾的可见状态为收束锚点，不得越界续写用户未给出的后续动作或结果。'),
    [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_DEFAULT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_END_DEFAULT, '本回合收束到可承接的临时节点，不要求完成整节拍。'),
    [PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_START_RICH]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_START_RICH, '先锚定当前回合可见动作，再展开本回合推进，不复述背景。'),
    [PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_STEP]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_NORMALIZE_STEP, '沿当前目标继续推进，并确保动作可见。'),
    [PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_START]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_START, '从当前局面直接接续。'),
    [PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_END]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_DEFAULT_END, '本回合收束到可承接的临时节点。'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_CURRENT_MISSING]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_CURRENT_MISSING, '（当前节拍缺少原文，请优先遵循导演演绎指导并保持语气连续）'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_MISSING]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_MISSING, '（当前已是最后节拍）'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_ENTRY_MISSING]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_ENTRY_MISSING, '（无）'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_PREVIEW_MISSING]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_NEXT_PREVIEW_MISSING, '（当前已是最后节拍，无下一节拍原文预览）'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_EXIT_MISSING]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_EXIT_MISSING, '无明确退出事件'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_STEPS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_STEPS, '围绕当前节拍推进一个可见动作。→在可承接位置收束本轮输出。'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_ACTION]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_DEFAULT_ACTION, '围绕当前节拍推进可见动作并收束。'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_SWITCHED]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_SWITCHED, '- 执行要求: 本回合发生切拍时，先用1-2句完成过渡/回接，再进入动作链；终点只做临时收束，不等于继续切拍。'),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_STAY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_STAY, '- 执行要求: 严格停留在当前节拍内推进动作链；终点只做临时收束，不得跳出当前节拍。'),
    [PROMPT_MODULE_IDS.DIRECTOR_NEXT_PREVIEW_SUMMARY]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_NEXT_PREVIEW_SUMMARY, '摘要：{NEXT_BEAT_SUMMARY}'),
    [PROMPT_MODULE_IDS.CHAPTER_OPENING]: moduleDefinition(PROMPT_MODULE_IDS.CHAPTER_OPENING, defaultChapterOpeningPrompt),
    [PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_SUMMARY]: moduleDefinition(PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_SUMMARY, '无'),
    [PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_CARRY]: moduleDefinition(PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_CARRY, '无可用AI尾部承接（非首章且聊天中暂无AI输出）'),
    [PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_LEAD]: moduleDefinition(PROMPT_MODULE_IDS.CHAPTER_OPENING_NO_LEAD, '本章开头素材缺失'),
});

function copyLayers(layers = {}) {
    return {
        prefix: typeof layers.prefix === 'string' ? layers.prefix : '',
        body: typeof layers.body === 'string' ? layers.body : '',
        suffix: typeof layers.suffix === 'string' ? layers.suffix : '',
    };
}

function interpolate(text, variables) {
    return String(text || '').replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : match
    ));
}

function renderLayers(layers, variables) {
    return ['prefix', 'body', 'suffix']
        .map((key) => interpolate(layers[key], variables))
        .filter((text) => text !== '')
        .join('\n\n');
}

export function createPromptRegistryService(deps = {}) {
    const AppState = deps.AppState || { settings: {} };
    const definitions = deps.moduleDefinitions || DEFAULT_PROMPT_MODULE_DEFINITIONS;

    function getSettings() {
        if (!AppState.settings || typeof AppState.settings !== 'object') AppState.settings = {};
        if (!AppState.settings.promptGlobal || typeof AppState.settings.promptGlobal !== 'object') {
            AppState.settings.promptGlobal = { prefix: '', suffix: '' };
        }
        if (!AppState.settings.promptOverrides || typeof AppState.settings.promptOverrides !== 'object') {
            AppState.settings.promptOverrides = {};
        }
        return AppState.settings;
    }

    function getDefinition(id) {
        const definition = definitions[id];
        if (!definition) throw new Error(`Unknown prompt module: ${id}`);
        return definition;
    }

    function getResolvedModule(id) {
        const definition = getDefinition(id);
        const override = getSettings().promptOverrides[id] || {};
        const layers = {};
        for (const key of ['prefix', 'body', 'suffix']) {
            layers[key] = Object.prototype.hasOwnProperty.call(override, key)
                ? String(override[key] ?? '')
                : definition.defaultLayers[key];
        }
        return {
            id,
            title: definition.title,
            requiredPlaceholders: [...definition.requiredPlaceholders],
            ...layers,
        };
    }

    function listModules() {
        return Object.keys(definitions).map((id) => getResolvedModule(id));
    }

    function setOverride(id, layers = {}) {
        getDefinition(id);
        const settings = getSettings();
        const next = { ...(settings.promptOverrides[id] || {}) };
        for (const key of ['prefix', 'body', 'suffix']) {
            if (Object.prototype.hasOwnProperty.call(layers, key)) {
                next[key] = String(layers[key] ?? '');
            }
        }
        settings.promptOverrides[id] = next;
        return getResolvedModule(id);
    }

    function resetOverride(id) {
        getDefinition(id);
        delete getSettings().promptOverrides[id];
        return getResolvedModule(id);
    }

    function renderModule(id, variables = {}) {
        return renderLayers(getResolvedModule(id), variables);
    }

    function composeFragments(fragments = [], options = {}) {
        const includeGlobal = options.includeGlobal !== false;
        const settings = getSettings();
        const rendered = [];
        if (includeGlobal && settings.language === 'zh') {
            rendered.push(renderModule(PROMPT_MODULE_IDS.LANGUAGE_ZH));
        }
        if (includeGlobal && typeof settings.promptGlobal.prefix === 'string' && settings.promptGlobal.prefix !== '') {
            rendered.push(settings.promptGlobal.prefix);
        }
        for (const fragment of fragments) {
            const content = String(fragment || '');
            if (content !== '') rendered.push(content);
        }
        if (includeGlobal && typeof settings.promptGlobal.suffix === 'string' && settings.promptGlobal.suffix !== '') {
            rendered.push(settings.promptGlobal.suffix);
        }
        return rendered.join('\n\n');
    }

    function composeRequest(moduleIds, variablesById = {}, options = {}) {
        return composeFragments(
            moduleIds.map((id) => renderModule(id, variablesById[id] || {})),
            options,
        );
    }

    function getWarnings(id, layers = getResolvedModule(id)) {
        const definition = getDefinition(id);
        const warnings = [];
        if (!String(layers.body || '').trim()) {
            warnings.push({ type: 'empty-body', moduleId: id });
        }
        const combined = `${layers.prefix || ''}\n${layers.body || ''}\n${layers.suffix || ''}`;
        for (const placeholder of definition.requiredPlaceholders) {
            if (!combined.includes(placeholder)) {
                warnings.push({ type: 'missing-placeholder', moduleId: id, placeholder });
            }
        }
        return warnings;
    }

    function migrateLegacySettings(settings = {}) {
        const source = settings && typeof settings === 'object' ? settings : {};
        const alreadyLayered = Number(source.promptConfigVersion) >= 1;
        const migrated = {
            ...source,
            promptConfigVersion: 1,
            promptGlobal: {
                prefix: typeof source.promptGlobal?.prefix === 'string' ? source.promptGlobal.prefix : '',
                suffix: typeof source.promptGlobal?.suffix === 'string' ? source.promptGlobal.suffix : '',
            },
            promptOverrides: {
                ...(source.promptOverrides || {}),
            },
        };
        if (alreadyLayered) return migrated;

        if (!migrated.promptGlobal.prefix && typeof source.promptPrefixPreset === 'string') {
            migrated.promptGlobal.prefix = source.promptPrefixPreset;
        }
        if (!migrated.promptGlobal.suffix && typeof source.customSuffixPrompt === 'string') {
            migrated.promptGlobal.suffix = source.customSuffixPrompt;
        }

        const bodyMappings = [
            ['customWorldbookPrompt', PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM],
            ['customPlotPrompt', PROMPT_MODULE_IDS.WORLDBOOK_PLOT],
            ['customStylePrompt', PROMPT_MODULE_IDS.WORLDBOOK_STYLE],
            ['customMergePrompt', PROMPT_MODULE_IDS.MERGE_IMPORTED],
            ['customConsolidatePrompt', PROMPT_MODULE_IDS.MERGE_CONSOLIDATE],
            ['customAliasMergePrompt', PROMPT_MODULE_IDS.MERGE_ALIAS],
            ['customChapterAssetsPrompt', PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS],
            ['customDirectorFrameworkPrompt', PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK],
            ['customDirectorInjectionPrompt', PROMPT_MODULE_IDS.DIRECTOR_INJECTION],
            ['customRerollPrompt', PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL],
        ];
        for (const [legacyKey, moduleId] of bodyMappings) {
            if (typeof source[legacyKey] !== 'string' || source[legacyKey] === '') continue;
            migrated.promptOverrides[moduleId] = {
                ...(migrated.promptOverrides[moduleId] || {}),
                body: source[legacyKey],
            };
        }

        const suffixMappings = [
            ['customDirectorFrameworkSuffix', PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK],
            ['customDirectorInjectionSuffix', PROMPT_MODULE_IDS.DIRECTOR_INJECTION],
        ];
        for (const [legacyKey, moduleId] of suffixMappings) {
            if (typeof source[legacyKey] !== 'string' || source[legacyKey] === '') continue;
            migrated.promptOverrides[moduleId] = {
                ...(migrated.promptOverrides[moduleId] || {}),
                suffix: source[legacyKey],
            };
        }

        migrated.directorMode = source.directorEnabled === false ? 'off' : 'api';
        migrated.directorFallbackOnError = source.directorAutoFallbackToMain !== false;
        return migrated;
    }

    return {
        listModules,
        getResolvedModule,
        setOverride,
        resetOverride,
        renderModule,
        composeFragments,
        composeRequest,
        getWarnings,
        migrateLegacySettings,
    };
}
