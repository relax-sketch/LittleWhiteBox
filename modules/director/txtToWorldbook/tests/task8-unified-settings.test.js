import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const settingsHtmlPath = path.resolve('settings.html');
const indexJsPath = path.resolve('index.js');
const styleCssPath = path.resolve('style.css');

test('settings.html exposes unified module tabs and panels', () => {
    const source = fs.readFileSync(settingsHtmlPath, 'utf8');

    const requiredSnippets = [
        'id="xiaobaix_unified_modules"',
        'data-xb-module-tab="ena"',
        'data-xb-module-tab="vectors"',
        'data-xb-module-tab="director"',
        'data-xb-module-tab="preset"',
        'data-xb-module-panel="ena"',
        'data-xb-module-panel="vectors"',
        'data-xb-module-panel="director"',
        'data-xb-module-panel="preset"',
        'id="xiaobaix_vectors_enabled"',
        'id="xiaobaix_director_enabled"',
        'id="xiaobaix_vectors_settings_mount"',
        'id="xiaobaix_director_settings_mount"',
        'vectorsResults',
        'westworldDirector',
    ];

    for (const snippet of requiredSnippets) {
        assert.equal(source.includes(snippet), true, `expected settings.html to contain ${snippet}`);
    }
});

test('index.js wires unified module tab switching', () => {
    const source = fs.readFileSync(indexJsPath, 'utf8');
    const requiredSnippets = [
        "querySelectorAll('[data-xb-module-tab]')",
        "getAttribute('data-xb-module-tab')",
        "querySelectorAll('[data-xb-module-panel]')",
        "getAttribute('data-xb-module-panel') === key",
    ];

    for (const snippet of requiredSnippets) {
        assert.equal(source.includes(snippet), true, `expected index.js to contain ${snippet}`);
    }
});

test('style.css contains unified module tab styles', () => {
    const source = fs.readFileSync(styleCssPath, 'utf8');
    const requiredSnippets = [
        '.xiaobaix-unified-modules',
        '.xiaobaix-module-tabs',
        '.xiaobaix-module-tab',
        '.xiaobaix-module-tab.active',
        '.xiaobaix-module-panel',
        '.xiaobaix-module-panel.active',
    ];

    for (const snippet of requiredSnippets) {
        assert.equal(source.includes(snippet), true, `expected style.css to contain ${snippet}`);
    }
});
