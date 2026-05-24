# EnaPlanner Optional Dice System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, editable, ordered dice-rules module that resolves one fixed dice pool per formal planner turn and safely reuses it for final-response fallback.

**Architecture:** A focused `ena-planner-dice.js` module owns protected-block identity, migration, one-time resolution, and final-input fallback composition. Existing EnaPlanner configuration and template normalization incorporate that protected prompt block, while the current module-chain traversal becomes the only place that renders dice macros for a turn. The iframe UI exposes the master switch and edits/reorders the protected block without permitting deletion or per-module disabling.

**Tech Stack:** JavaScript ES modules, DOM-based iframe UI, SillyTavern macro rendering, Node.js `node:test`, ESLint

---

## File Map

- Create `modules/ena-planner/ena-planner-dice.js`: pure dice configuration, protected prompt block, normalization, one-time turn context, and fallback input helpers.
- Create `modules/ena-planner/tests/dice-system.test.js`: Node test coverage for pure behavior plus targeted integration wiring assertions.
- Modify `modules/ena-planner/ena-planner-presets.js`: add the protected dice block to the built-in default prompt template.
- Modify `modules/ena-planner/ena-planner.js`: normalize persisted configuration/templates, build resolved dice context at its ordered chain location, and route empty/error planning outcomes into cached fallback.
- Modify `modules/ena-planner/ena-planner.html`: expose `diceSystem.enabled`, render a protected editable module card, and clarify preview roll behavior.
- Modify `package.json`: register `npm run test:ena-planner`.

### Task 1: Dice Domain Module And Unit Tests

**Files:**
- Create: `modules/ena-planner/tests/dice-system.test.js`
- Create: `modules/ena-planner/ena-planner-dice.js`
- Modify: `package.json`

- [x] **Step 1: Write failing tests for settings, protected-module migration, single resolution, and fallback composition**

Create `modules/ena-planner/tests/dice-system.test.js` with these initial behavior tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DICE_PROMPT_BLOCK_ID,
    DICE_PROMPT_BLOCK_NAME,
    buildDiceTurnContext,
    buildFinalInputWithDiceFallback,
    createDefaultDicePromptBlock,
    ensureDicePromptModule,
    normalizeDiceSystemSettings,
} from '../ena-planner-dice.js';

test('dice settings are independently disabled unless explicitly enabled', () => {
    assert.deepEqual(normalizeDiceSystemSettings(undefined), { enabled: false });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: 1 }), { enabled: false });
});

test('default protected block retains approved colon roll macros and identity', () => {
    const block = createDefaultDicePromptBlock();
    assert.equal(block.id, DICE_PROMPT_BLOCK_ID);
    assert.equal(block.name, DICE_PROMPT_BLOCK_NAME);
    assert.equal(block.role, 'system');
    assert.equal((block.content.match(/{{roll:1d20}}/g) || []).length, 10);
});

test('normalization inserts exactly one protected block and preserves edited content/order', () => {
    const migrated = ensureDicePromptModule(
        [{ id: 'system', role: 'system', name: 'Base', content: 'base' }],
        [
            { kind: 'promptBlock', blockId: 'system', enabled: true },
            { kind: 'builtin', key: 'charCard', enabled: true },
        ],
    );
    assert.equal(migrated.moduleChain[1].blockId, DICE_PROMPT_BLOCK_ID);

    const edited = ensureDicePromptModule(
        [{ id: DICE_PROMPT_BLOCK_ID, role: 'user', name: 'changed', content: 'edited' }],
        [{ kind: 'promptBlock', blockId: DICE_PROMPT_BLOCK_ID, enabled: false }],
    );
    assert.deepEqual(edited.promptBlocks, [{
        id: DICE_PROMPT_BLOCK_ID,
        role: 'system',
        name: DICE_PROMPT_BLOCK_NAME,
        content: 'edited',
    }]);
    assert.equal(edited.moduleChain[0].enabled, true);
});

test('disabled dice skip render while enabled dice render once and share the resolved pool', async () => {
    let renderCalls = 0;
    const render = async source => {
        renderCalls += 1;
        return source.replace(/{{roll:1d20}}/g, '17');
    };
    assert.deepEqual(
        await buildDiceTurnContext({ enabled: false }, '{{roll:1d20}}', render),
        { plannerPrompt: '', fallbackPrompt: '' },
    );
    const context = await buildDiceTurnContext(
        { enabled: true },
        'D20: [{{roll:1d20}}]',
        render,
    );
    assert.equal(renderCalls, 1);
    assert.match(context.plannerPrompt, /D20: \[17\]/);
    assert.match(context.fallbackPrompt, /D20: \[17\]/);
    assert.doesNotMatch(context.fallbackPrompt, /{{roll:/);
});

test('final input appends cached dice only when planning output is unusable', () => {
    const fallback = '<dice>D20: [17]</dice>';
    assert.equal(
        buildFinalInputWithDiceFallback('attack', '<plot>hit</plot>', fallback),
        'attack\n\n<plot>hit</plot>',
    );
    assert.equal(
        buildFinalInputWithDiceFallback('attack', ' \n ', fallback),
        'attack\n\n<dice>D20: [17]</dice>',
    );
    assert.equal(buildFinalInputWithDiceFallback('attack', '', ''), 'attack');
});
```

- [x] **Step 2: Run the focused test to prove the new module does not yet exist**

Run: `node --test modules/ena-planner/tests/dice-system.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../ena-planner-dice.js`.

- [x] **Step 3: Implement the pure dice helper with the approved default content and cached wrappers**

Create `modules/ena-planner/ena-planner-dice.js`:

```js
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
```

- [x] **Step 4: Register the focused test command**

Add this property within `package.json`'s existing `"scripts"` object:

```json
"test:ena-planner": "node --test modules/ena-planner/tests/dice-system.test.js"
```

- [x] **Step 5: Run unit tests and commit the pure behavior**

Run: `npm run test:ena-planner`

Expected: PASS for all five initial tests.

Commit:

```bash
git add package.json modules/ena-planner/ena-planner-dice.js modules/ena-planner/tests/dice-system.test.js
git commit -m "Add EnaPlanner dice domain helpers"
```

### Task 2: Configuration, Default Template, And Migration Wiring

**Files:**
- Modify: `modules/ena-planner/tests/dice-system.test.js`
- Modify: `modules/ena-planner/ena-planner-presets.js`
- Modify: `modules/ena-planner/ena-planner.js:1-329`

- [ ] **Step 1: Add failing integration assertions for default/template/config wiring**

Append to `modules/ena-planner/tests/dice-system.test.js`:

```js
import { readFile } from 'node:fs/promises';

test('default presets and runtime normalize the protected dice module and independent switch', async () => {
    const presets = await readFile(new URL('../ena-planner-presets.js', import.meta.url), 'utf8');
    const runtime = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');

    assert.match(presets, /createDefaultDicePromptBlock/);
    assert.match(presets, /DEFAULT_PROMPT_BLOCKS[\s\S]*createDefaultDicePromptBlock\(\)/);
    assert.match(runtime, /normalizeDiceSystemSettings/);
    assert.match(runtime, /diceSystem:\s*\{\s*enabled:\s*false\s*\}/);
    assert.match(runtime, /ensureDicePromptModule/);
    assert.match(runtime, /s\.promptTemplates\s*=\s*normalizePromptTemplates/);
});
```

- [ ] **Step 2: Run the test and verify configuration integration is absent**

Run: `npm run test:ena-planner`

Expected: FAIL in `default presets and runtime normalize...` because the preset/runtime sources do not import or call the dice helpers yet.

- [ ] **Step 3: Include the dice block in default prompt presets**

At the start of `modules/ena-planner/ena-planner-presets.js`, import the constructor and add the block between the default system prompt and assistant seed:

```js
import { createDefaultDicePromptBlock } from './ena-planner-dice.js';

export const DEFAULT_PROMPT_BLOCKS = [
    {
        id: 'ena-default-system-001',
        role: 'system',
        name: 'Ena Planner System',
        content: `你是一位剧情规划师（Story Planner）。你的工作是在幕后为互动叙事提供方向指引，而不是直接扮演角色或撰写正文。
```

After the closing `},` of `ena-default-system-001`, insert:

```js
    createDefaultDicePromptBlock(),
```

- [ ] **Step 4: Wire persisted settings and template normalization through the protected-block helper**

In `modules/ena-planner/ena-planner.js`, import the dice APIs:

```js
import {
    DICE_PROMPT_BLOCK_ID,
    buildDiceTurnContext,
    buildFinalInputWithDiceFallback,
    ensureDicePromptModule,
    normalizeDiceSystemSettings,
} from './ena-planner-dice.js';
```

Add the master setting to the object returned by `getDefaultSettings()`:

```js
        diceSystem: {
            enabled: false,
        },
```

Replace `normalizePromptTemplate()` with a normalization flow that protects block identity and chain membership:

```js
function normalizePromptTemplate(rawTemplate, settingsLike = {}) {
    const legacyPromptBlocks = Array.isArray(rawTemplate) ? rawTemplate : null;
    if (legacyPromptBlocks) {
        const promptBlocks = normalizeLegacyPromptBlocks(legacyPromptBlocks);
        return ensureDicePromptModule(
            promptBlocks,
            buildLegacyCompatibleModuleChain(legacyPromptBlocks, settingsLike),
        );
    }
    const promptBlocks = structuredClone(Array.isArray(rawTemplate?.promptBlocks) ? rawTemplate.promptBlocks : []);
    return ensureDicePromptModule(
        promptBlocks,
        normalizeModuleChain(rawTemplate?.moduleChain, promptBlocks, settingsLike),
    );
}
```

In `ensureSettings()`, after defaults are merged and after existing chain normalization has executed, normalize the master switch and enforce the protected block once:

```js
    s.diceSystem = normalizeDiceSystemSettings(s.diceSystem);
    const diceNormalized = ensureDicePromptModule(s.promptBlocks, s.moduleChain);
    s.promptBlocks = diceNormalized.promptBlocks;
    s.moduleChain = diceNormalized.moduleChain;
    s.promptTemplates = normalizePromptTemplates(s.promptTemplates, s);
```

When restoring default prompt configuration in the existing `xb-ena:reset-default-prompts` handler, retain `s.diceSystem` and use the default `promptBlocks` and `moduleChain` already containing the protected block.

- [ ] **Step 5: Run focused tests and commit configuration integration**

Run: `npm run test:ena-planner`

Expected: PASS, including the preset/runtime integration assertion.

Commit:

```bash
git add modules/ena-planner/ena-planner-presets.js modules/ena-planner/ena-planner.js modules/ena-planner/tests/dice-system.test.js
git commit -m "Integrate dice block into EnaPlanner configuration"
```

### Task 3: Ordered Turn Resolution And Empty/Error Fallback

**Files:**
- Modify: `modules/ena-planner/tests/dice-system.test.js`
- Modify: `modules/ena-planner/ena-planner.js:1615-1882`

- [ ] **Step 1: Add failing assertions for ordered construction and recoverable planner failure**

Append to `modules/ena-planner/tests/dice-system.test.js`:

```js
test('planner runtime resolves dice while visiting module order and keeps cached fallback through API failure', async () => {
    const source = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');
    const builderStart = source.indexOf('async function buildPlannerMessages');
    const chainLoop = source.indexOf('for (const module of s.moduleChain || [])', builderStart);
    const diceBuild = source.indexOf('buildDiceTurnContext(', builderStart);

    assert.ok(builderStart >= 0);
    assert.ok(diceBuild > chainLoop, 'dice must resolve only at its module-chain position');
    assert.match(source, /meta:\s*\{[\s\S]*diceFallbackPrompt/);
    assert.match(source, /allowDiceFallbackOnError/);
    assert.match(source, /buildFinalInputWithDiceFallback\(\s*raw,\s*filtered,\s*diceFallbackPrompt\s*\)/s);
});

test('an unavailable planner output reuses its previously resolved pool without a second render', async () => {
    let renderCalls = 0;
    const context = await buildDiceTurnContext(
        { enabled: true },
        'D20: [{{roll:1d20}}]',
        async source => {
            renderCalls += 1;
            return source.replace('{{roll:1d20}}', '4');
        },
    );
    const releasedInput = buildFinalInputWithDiceFallback('attack', '', context.fallbackPrompt);
    assert.equal(renderCalls, 1);
    assert.match(releasedInput, /D20: \[4\]/);
    assert.doesNotMatch(releasedInput, /{{roll:/);
});
```

- [ ] **Step 2: Run the test and confirm runtime fallback is not yet wired**

Run: `npm run test:ena-planner`

Expected: FAIL because `buildPlannerMessages()` has no dice turn metadata and the interception flow does not call `buildFinalInputWithDiceFallback()`.

- [ ] **Step 3: Resolve the enabled dice block exactly once at its configured chain position**

Within `buildPlannerMessages(rawUserInput)`, initialize per-turn cached fallback before traversing the chain:

```js
    let diceFallbackPrompt = '';
```

In its existing `promptBlock` branch, insert the protected-block path before the ordinary prompt-block rendering path:

```js
        const block = promptBlockMap.get(module.blockId);
        if (!block) continue;
        if (block.id === DICE_PROMPT_BLOCK_ID) {
            const diceContext = await buildDiceTurnContext(
                s.diceSystem,
                block.content,
                template => renderTemplateAll(template, env, messageVars),
            );
            diceFallbackPrompt = diceContext.fallbackPrompt;
            if (diceContext.plannerPrompt) {
                messages.push({ role: 'system', content: diceContext.plannerPrompt });
            }
            continue;
        }
        if (module.enabled === false) continue;
        const content = await renderTemplateAll(block.content, env, messageVars);
        if (String(content).trim()) messages.push({ role: block.role, content });
```

Add cached content to the existing returned metadata:

```js
            diceFallbackPrompt,
```

- [ ] **Step 4: Preserve resolved fallback across planner errors and use it only when planning is empty**

Change `runPlanningOnce()` so message construction happens before its API failure recovery decision and returns cached fallback on permitted errors:

```js
async function runPlanningOnce(rawUserInput, silent = false, options = {}) {
    const log = {
        timestamp: Date.now(),
        requestMessages: [],
        rawReply: '',
        filtered: '',
        error: '',
    };
    let diceFallbackPrompt = '';
    try {
        const built = await buildPlannerMessages(rawUserInput);
        log.requestMessages = built.messages;
        diceFallbackPrompt = String(built.meta?.diceFallbackPrompt || '');
        const rawReply = await callPlanner(built.messages, options);
        const filtered = filterPlannerForInput(rawReply);
        log.rawReply = rawReply;
        log.filtered = filtered;
        return { rawReply, filtered, diceFallbackPrompt };
    } catch (error) {
        log.error = String(error?.message || error);
        if (options.allowDiceFallbackOnError && diceFallbackPrompt) {
            return { rawReply: '', filtered: '', diceFallbackPrompt, plannerError: error };
        }
        throw error;
    } finally {
        state.logs.unshift(log);
        scheduleSaveConfig();
        if (!silent) updateSettingsIframe();
    }
}
```

Preserve any current log size limiting and toast behavior surrounding this function while adopting the shown return contract. In `doInterceptAndPlanThenSend()`, enable planner-error recovery only for the actual send and compose the released text from cached data:

```js
        const {
            filtered,
            diceFallbackPrompt,
            plannerError,
        } = await runPlanningOnce(raw, false, {
            allowDiceFallbackOnError: true,
            onDelta: (_, full) => {
                ta.value = `${raw}\n\n${full}`.trim();
            },
        });
        if (plannerError) {
            toastInfo('Ena Planner：规划不可用，已改由正文按本轮骰子规则处理');
        }
        const merged = buildFinalInputWithDiceFallback(raw, filtered, diceFallbackPrompt);
        ta.value = merged;
```

This error branch must use the already returned `diceFallbackPrompt` and must not call `buildPlannerMessages()` or `renderTemplateAll()` again.

- [ ] **Step 5: Run focused tests and commit runtime behavior**

Run: `npm run test:ena-planner`

Expected: PASS, including ordered-chain and fallback wiring assertions.

Commit:

```bash
git add modules/ena-planner/ena-planner.js modules/ena-planner/tests/dice-system.test.js
git commit -m "Reuse resolved dice for planner fallback"
```

### Task 4: Settings UI, Protected Editor Card, And Template Persistence

**Files:**
- Modify: `modules/ena-planner/tests/dice-system.test.js`
- Modify: `modules/ena-planner/ena-planner.html:60-1298`

- [ ] **Step 1: Add failing UI source assertions**

Append to `modules/ena-planner/tests/dice-system.test.js`:

```js
test('settings UI exposes the master switch and protects the dice prompt editor', async () => {
    const html = await readFile(new URL('../ena-planner.html', import.meta.url), 'utf8');
    assert.match(html, /id="ep_dice_system_enabled"/);
    assert.match(html, /DICE_PROMPT_BLOCK_ID\s*=\s*'ena-dice-system-001'/);
    assert.match(html, /isDicePromptBlock/);
    assert.match(html, /由基本设置中的骰子系统开关控制/);
    assert.match(html, /diceSystem:\s*\{\s*enabled:/);
    assert.match(html, /预览.*生成独立骰池/);
});
```

- [ ] **Step 2: Run tests and establish that UI controls are missing**

Run: `npm run test:ena-planner`

Expected: FAIL in `settings UI exposes...` due to absent switch/protected-card behavior.

- [ ] **Step 3: Add the independent switch and preview explanation**

Add a new basic settings field in `modules/ena-planner/ena-planner.html`, adjacent to the other master fields:

```html
            <label class="field">
              <span>骰子系统</span>
              <select id="ep_dice_system_enabled" class="input">
                <option value="false">关闭</option>
                <option value="true">开启</option>
              </select>
              <small>开启后，规划模型会收到本轮固定骰池；规划为空或失败时由正文模型复用同一骰池。</small>
            </label>
```

Under the existing true-send preview text, add:

```html
          <div class="muted">骰子系统开启时，预览或测试会生成独立骰池，仅用于本次检查，不是随后正式发送使用的骰池。</div>
```

- [ ] **Step 4: Render a protected editable card and persist only the master switch plus existing block/template structures**

In the iframe script, declare the fixed ID beside `BUILTIN_MODULES`:

```js
    const DICE_PROMPT_BLOCK_ID = 'ena-dice-system-001';
    const isDicePromptBlock = block => block?.id === DICE_PROMPT_BLOCK_ID;
```

In `createPromptBlockElement(module, block, idx, total)`, branch controls using:

```js
      const protectedDice = isDicePromptBlock(block);
```

For `protectedDice`, render fixed metadata and do not create role, enable, or delete controls:

```js
      if (protectedDice) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.textContent = '受保护的 system 模块；是否生效由基本设置中的骰子系统开关控制。';
        head.appendChild(note);
      }
```

Keep the existing editable textarea and up/down controls for this card; wrap existing role selector, module-enable checkbox, and delete-button construction in `if (!protectedDice) { ... }` using their existing event handlers unchanged for ordinary prompt blocks.

In `applyConfig(nextCfg)`, load the master switch:

```js
      $('ep_dice_system_enabled').value = String(toBool(cfg.diceSystem?.enabled, false));
```

In `collectPatch()`, save only global activation on its own field, while existing `promptBlocks`, `moduleChain`, and `promptTemplates` persistence continues to carry dice text/order:

```js
      p.diceSystem = {
        enabled: toBool($('ep_dice_system_enabled').value, false),
      };
```

- [ ] **Step 5: Run focused tests and commit UI/persistence integration**

Run: `npm run test:ena-planner`

Expected: PASS for all dice tests.

Commit:

```bash
git add modules/ena-planner/ena-planner.html modules/ena-planner/tests/dice-system.test.js
git commit -m "Expose protected dice module in EnaPlanner UI"
```

### Task 5: Verification And Delivery

**Files:**
- Verify: `modules/ena-planner/ena-planner-dice.js`
- Verify: `modules/ena-planner/ena-planner-presets.js`
- Verify: `modules/ena-planner/ena-planner.js`
- Verify: `modules/ena-planner/ena-planner.html`
- Verify: `modules/ena-planner/tests/dice-system.test.js`
- Verify: `package.json`

- [ ] **Step 1: Run focused automated coverage**

Run: `npm run test:ena-planner`

Expected: PASS covering switch normalization, protected block migration, preserved edits/order, disabled rendering bypass, one-time resolved reuse, normal output, empty output, error-path wiring, and UI source integration.

- [ ] **Step 2: Run repository checks for edited JavaScript and whitespace**

Run: `npm run lint`

Expected: PASS, or record unrelated pre-existing lint failures separately from this change.

Run: `git diff --check`

Expected: no output and exit code `0`.

- [ ] **Step 3: Manually validate EnaPlanner settings and send paths in the available local UI**

Validate these concrete observations:

1. Basic settings displays `骰子系统` and persists `关闭`/`开启` across reopen.
2. The protected dice card edits and saves content, moves within the module chain, and has no delete or per-card activation operation.
3. Template save/load retains dice content and position; restore-default restores the approved default content while leaving the master switch unchanged.
4. Preview with dice enabled shows a resolved D20 pool in the moved chain position and informs that preview rolls are independent.
5. A formal non-empty planning result injects planning only; a blank/filtered-blank planning result injects the already-resolved dice fallback.
6. A simulated planning API throw or timeout with dice enabled releases the same cached fallback to the final send; with dice disabled it retains the existing error behavior.

- [ ] **Step 4: Review final diff and commit any verification-only fixes**

Run:

```bash
git status --short
git diff --stat
git diff -- modules/ena-planner package.json
```

Expected: only intended product/test changes plus separately tracked planning records.

If verification requires a correction, rerun `npm run test:ena-planner`, `npm run lint`, and `git diff --check`, then commit the correction with:

```bash
git add modules/ena-planner package.json
git commit -m "Fix EnaPlanner dice verification findings"
```
