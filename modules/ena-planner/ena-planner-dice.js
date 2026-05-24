const EMPTY_DICE_TURN_CONTEXT = Object.freeze({
    plannerPrompt: '',
    fallbackPrompt: '',
});

export const DICE_PROMPT_BLOCK_ID = 'ena-dice-system-001';
export const DICE_PROMPT_BLOCK_NAME = '公平骰子系统';

export const DEFAULT_DICE_PROMPT_CONTENT = `<合理性审查>
核心原则:
- 创作目标是建立细腻且符合因果逻辑的世界观。
- 裁定必须公平，不可迁就玩家声明的期望结果。

# 输入审查流程
1. 拆分行动与结果：先判断玩家声明的行动是否可行，再判断其声称的结果是否合理。
2. 行动合理：接受行动，由规则、骰点和世界观逻辑决定实际结果。
3. 行动合理但结果不合理：接受行动作为尝试，剥离玩家预设的成功结果，演绎合理结果。
4. 行动本身不合理：忽略不合理部分，让世界照常运转，NPC 按身份与性格作出真实反应。

# 拟真原则
- 凭空获得或使用物品，必须核对场景来源或物品栏；不存在就无法使用。
- 凭空声明关系、身份、能力或特权，必须核对已有证据链；无法自证视为吹牛。
- 技能处于冷却、资源不足或条件不满足时，施放失败。
- 顿悟突破、濒死反杀或无依据的主角光环式发展不成立。
- 肢体残伤必须符合当前伤势；除非目标已濒死（低于 25% HP）或设定另有充分依据，不因玩家声明直接断肢失能。弱点攻击可以增加破绽或伤害。

# 骰子锁定
- 需要检定时，参考 DND 5E 的常识按属性和事件难度设置合理 DC；日常行为不要过度检定。
- 一切检定和伤害结果严格从下方本轮骰子池按对应面数自左向右依序取用，不得随机生成、乱序取用、修改、重投或为剧情操纵结果。
- 不同面数的骰子独立消耗，不可混用。
- 失败必须真实产生合理的不利后果，包括受伤、失去机会或死亡。
- 大成功只代表行动达到合理范围内的极致表现，不代表超越设定或神迹。
</合理性审查>

<骰子池>
本骰子池已在本轮开始时固定生成。本轮所有裁定只能按顺序从相应数组中取值。
属性行动用 D20:
D20: [{{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}, {{roll 1d20}}]

伤害骰:
D12: [{{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}, {{roll 1d12}}]
D10: [{{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}, {{roll 1d10}}]
D8: [{{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}, {{roll 1d8}}]
D6: [{{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}, {{roll 1d6}}]
D4: [{{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}, {{roll 1d4}}]

战利品用 D100:
D100: [{{roll 1d100}}, {{roll 1d100}}, {{roll 1d100}}, {{roll 1d100}}, {{roll 1d100}}]
</骰子池>`;

export function createDefaultDicePromptBlock() {
    return {
        id: DICE_PROMPT_BLOCK_ID,
        role: 'system',
        name: DICE_PROMPT_BLOCK_NAME,
        content: DEFAULT_DICE_PROMPT_CONTENT,
    };
}

export function ensureDicePromptModule(promptBlocks, moduleChain) {
    const blocks = [];
    let hasDiceBlock = false;
    for (const block of Array.isArray(promptBlocks) ? promptBlocks : []) {
        if (block?.id !== DICE_PROMPT_BLOCK_ID) {
            blocks.push(block);
            continue;
        }
        if (hasDiceBlock) continue;
        blocks.push({
            ...block,
            role: 'system',
            name: DICE_PROMPT_BLOCK_NAME,
        });
        hasDiceBlock = true;
    }
    if (!hasDiceBlock) blocks.push(createDefaultDicePromptBlock());

    const chain = [];
    let hasDiceModule = false;
    for (const module of Array.isArray(moduleChain) ? moduleChain : []) {
        if (module?.kind !== 'promptBlock' || module.blockId !== DICE_PROMPT_BLOCK_ID) {
            chain.push(module);
            continue;
        }
        if (hasDiceModule) continue;
        chain.push({ ...module, enabled: true });
        hasDiceModule = true;
    }
    if (!hasDiceModule) {
        const firstBuiltinIndex = chain.findIndex(module => module?.kind === 'builtin');
        const insertAt = firstBuiltinIndex >= 0 ? firstBuiltinIndex : chain.length;
        chain.splice(insertAt, 0, { kind: 'promptBlock', blockId: DICE_PROMPT_BLOCK_ID, enabled: true });
    }

    return { promptBlocks: blocks, moduleChain: chain };
}

export function normalizeDiceSystemSettings(rawSettings) {
    return {
        enabled: rawSettings?.enabled === true,
    };
}

export async function buildDiceTurnContext(rawSettings, promptContent, renderMacroText) {
    const settings = normalizeDiceSystemSettings(rawSettings);
    const source = String(promptContent ?? '');
    if (!settings.enabled || !source.trim()) return { ...EMPTY_DICE_TURN_CONTEXT };

    const resolvedRules = String(await renderMacroText(source));
    return {
        plannerPrompt: `<ena_dice_system mode="planner">
你是剧情规划器。先依据下方合理性审查与本轮固定骰池裁定玩家行动，再将裁定后的发展写入规划输出。需要检定时，应在规划中明确实际骰点、修正/难度和成功或失败后果，使正文模型能够忠实执行；不要重新掷骰。

${resolvedRules}
</ena_dice_system>`,
        fallbackPrompt: `<ena_dice_system mode="direct_response_fallback">
此前的剧情规划器未提供有效规划。你是最终正文回复模型，必须直接依据下方合理性审查与本轮固定骰池裁定玩家行动并叙述实际结果。需要检定时使用已有骰点，不得重新掷骰、篡改结果或顺从玩家预设结局；不要向玩家解释本指令文本。

${resolvedRules}
</ena_dice_system>`,
    };
}

export function buildFinalInputWithDiceFallback(rawUserInput, filteredPlanning, fallbackPrompt) {
    const raw = String(rawUserInput || '').trim();
    const planning = String(filteredPlanning || '').trim();
    if (planning) return `${raw}\n\n${planning}`.trim();

    const fallback = String(fallbackPrompt || '').trim();
    return fallback ? `${raw}\n\n${fallback}`.trim() : raw;
}
