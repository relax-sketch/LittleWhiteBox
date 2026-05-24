import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    buildDiceTurnContext,
    buildFinalInputWithDiceFallback,
    normalizeDiceSystemSettings,
} from '../ena-planner-dice.js';

test('normalizeDiceSystemSettings defaults to disabled and normalizes enabled values', () => {
    assert.deepEqual(normalizeDiceSystemSettings(undefined), { enabled: false });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: true }), { enabled: true });
    assert.deepEqual(normalizeDiceSystemSettings({ enabled: 0 }), { enabled: false });
});

test('buildDiceTurnContext does not render dice content when the system is disabled', async () => {
    let renderCalls = 0;
    const context = await buildDiceTurnContext({ enabled: false }, async () => {
        renderCalls += 1;
        return 'unexpected';
    });

    assert.equal(renderCalls, 0);
    assert.deepEqual(context, { plannerPrompt: '', fallbackPrompt: '' });
});

test('buildDiceTurnContext rolls once and shares resolved pool across planner and fallback', async () => {
    let renderCalls = 0;
    let value = 0;
    const context = await buildDiceTurnContext({ enabled: true }, async (template) => {
        renderCalls += 1;
        assert.match(template, /{{roll 1d20}}/);
        assert.doesNotMatch(template, /{{roll:/);
        return template.replace(/{{roll (1d\d+)}}/g, (_match, formula) => `${formula}-${++value}`);
    });

    assert.equal(renderCalls, 1);
    assert.match(context.plannerPrompt, /你是剧情规划器/);
    assert.match(context.fallbackPrompt, /你是最终正文回复模型/);
    assert.match(context.plannerPrompt, /D20: \[1d20-1, 1d20-2/);
    assert.match(context.fallbackPrompt, /D20: \[1d20-1, 1d20-2/);
    assert.doesNotMatch(context.fallbackPrompt, /{{roll /);
});

test('buildFinalInputWithDiceFallback only appends the resolved fallback prompt on empty planning output', () => {
    const fallback = '<正文兜底>\nD20: [12]\n</正文兜底>';

    assert.equal(
        buildFinalInputWithDiceFallback('我攻击盗贼', '<plot>命中</plot>', fallback),
        '我攻击盗贼\n\n<plot>命中</plot>',
    );
    assert.equal(
        buildFinalInputWithDiceFallback('我攻击盗贼', ' \n ', fallback),
        '我攻击盗贼\n\n<正文兜底>\nD20: [12]\n</正文兜底>',
    );
    assert.equal(buildFinalInputWithDiceFallback('我攻击盗贼', '', ''), '我攻击盗贼');
});

test('ena planner main module wires dice generation into planning and empty-result fallback', async () => {
    const source = await readFile(new URL('../ena-planner.js', import.meta.url), 'utf8');

    assert.match(source, /buildDiceTurnContext/);
    assert.match(source, /buildFinalInputWithDiceFallback/);
    assert.match(source, /diceSystem:\s*\{\s*enabled:\s*false/s);
    assert.match(source, /diceFallbackPrompt/);
});

test('ena planner settings UI exposes the built-in dice system toggle and empty-planning hint', async () => {
    const html = await readFile(new URL('../ena-planner.html', import.meta.url), 'utf8');

    assert.match(html, /id="ep_dice_system_enabled"/);
    assert.match(html, /骰子/);
    assert.match(html, /空回/);
});
