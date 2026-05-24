const EMPTY_DICE_TURN_CONTEXT = Object.freeze({
    plannerPrompt: '',
    fallbackPrompt: '',
});

export const DICE_PROMPT_BLOCK_ID = 'ena-dice-system-001';
export const DICE_PROMPT_BLOCK_NAME = '公平骰子规则';

export const DEFAULT_DICE_PROMPT_CONTENT = `<合理性审查>
核心原则:
  - 创作目标: 建立繁复细腻的世界观，剧情符合逻辑
  - 作为DM，你必须维护规则公平性

# 输入审查流程
1. 拆分行动与结果：先判断<user>输入声明的行动是否可行，再判断其声称的结果是否合理
2. 行动合理 → 接受行动，由DM根据世界观逻辑决定实际结果
3. 行动合理但结果不合理 → 接受行动作为尝试，剥离期望结果，由DM演绎合理的实际结果
4. 行动本身不合理 → 世界照常运转，忽略不合理的部分，NPC按其身份和性格对不合逻辑的言行作出真实反应（怀疑、嘲笑、拒绝、敌对等）
   - 例：<user>声称自己是神仙转世 → DM审查其背景发现出身是普通农民 → NPC将其当作神经病或骗子看待
   - 例：<user>声称可以剁掉敌人的肢体 → DM根据<hp叙事>审查敌人血量，只有敌人HP减低到濒死(低于25%)时才允许出现肉体伤残 → 敌人hp尚且健康，不描述剁掉肢体。**弱点攻击可以总增破绽伤害，但不允许切割肢体使敌人失能！**

# 拟真原则：越违背世界观，执行阻力越大
- 一切口胡都要经过逻辑和证据链检验，无法自证的声明等同于吹牛
- 世界不会配合<user>的幻想，说大话不会改变事实
- 反复口胡会导致NPC的不信任和排斥自然累积
- 不合理的声明越离谱，周围人的反应越负面（从无视到嘲笑到警惕到驱逐）

# 常见口胡类型与处理
- 凭空获得或使用物品：<user>声称捡到/获得/使用某物品 → DM核查当前场景是否存在合理来源、物品栏中是否持有，不存在则该物品无法获得或使用
- 凭空建立关系：<user>声称与某NPC一见如故/结为挚友 → DM核查双方身份差距、互动内容、NPC性格，关系建立需要时间和合理互动积累
- 使用冷却中的技能：<user>声称使用某技能 → DM核查该技能的冷却/消耗状态，冷却未结束或资源不足则技能施放失败
- 顿悟突破、濒死反杀、受神眷顾等主角光环式发展：绝不可能。玩家只是普通人，濒死状态绝没有健康时好，满状态都无法战胜的对手濒死只会更糟

# 骰子锁定
- 一切检定结果必须严格按<骰子池>依序获取，禁止根据情形操纵随机数结果
- 失败就坦然描写失败的后果，允许<user>因检定失败面临不利后果甚至死亡
- 大成功是行动的极致体现，不是神的意志
</合理性审查>

<骰子池>
取骰规则:
  - 所有检定的骰子数值必须直接取用 Pool，由左至右顺序消耗，禁止随机生成或乱序取用
  - 每次直接从最左第一颗骰子开始取用，不要考虑前文
  - 不同面数的骰子各自独立消耗，不可混用
  - 骰子数值不可修改、重投或干预，失败就是失败
  - 何时需要掷骰判定参考 DND 5E，以目标属性和事件难度合理定义，必须合理而无情地判断 DC，不得迁就玩家
  - 日常生活不要过于频繁的检定

Pool:
  行动用D20（同DND规则）:
    D20: [{{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}, {{roll:1d20}}]
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
    let hasBlock = false;
    for (const block of Array.isArray(promptBlocks) ? promptBlocks : []) {
        if (block?.id !== DICE_PROMPT_BLOCK_ID) {
            blocks.push(block);
        } else if (!hasBlock) {
            blocks.push({ ...block, role: 'system', name: DICE_PROMPT_BLOCK_NAME });
            hasBlock = true;
        }
    }
    if (!hasBlock) blocks.push(createDefaultDicePromptBlock());

    const chain = [];
    let hasModule = false;
    for (const module of Array.isArray(moduleChain) ? moduleChain : []) {
        if (module?.kind !== 'promptBlock' || module.blockId !== DICE_PROMPT_BLOCK_ID) {
            chain.push(module);
        } else if (!hasModule) {
            chain.push({ ...module, enabled: true });
            hasModule = true;
        }
    }
    if (!hasModule) {
        const firstBuiltin = chain.findIndex(module => module?.kind === 'builtin');
        const insertAt = firstBuiltin >= 0 ? firstBuiltin : chain.length;
        chain.splice(insertAt, 0, { kind: 'promptBlock', blockId: DICE_PROMPT_BLOCK_ID, enabled: true });
    }
    return { promptBlocks: blocks, moduleChain: chain };
}

export function normalizeDiceSystemSettings(rawSettings) {
    return { enabled: rawSettings?.enabled === true };
}

export async function buildDiceTurnContext(rawSettings, promptContent, renderPromptText) {
    if (!normalizeDiceSystemSettings(rawSettings).enabled || !String(promptContent ?? '').trim()) {
        return { ...EMPTY_DICE_TURN_CONTEXT };
    }
    const resolvedRules = String(await renderPromptText(String(promptContent)));
    return {
        plannerPrompt: `<ena_dice_system mode="planner">
你是剧情规划器。依据下方规则与本轮固定骰池裁定玩家行动；需要检定时使用已有骰点并把裁定写入规划，不得重新掷骰。

${resolvedRules}
</ena_dice_system>`,
        fallbackPrompt: `<ena_dice_system mode="direct_response_fallback">
剧情规划器未提供可用规划。你是正文回复模型，必须直接依据下方规则与本轮固定骰池裁定并叙述结果；使用已有骰点，不得重新掷骰、篡改结果或顺从玩家预设结局。

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
