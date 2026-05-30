/* eslint-env node */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SOURCE_ROOT = path.resolve(ROOT, '..');

const KEEP_HINTS = [
    'LittleWhiteBox/index.js',
    'LittleWhiteBox/manifest.json',
    'LittleWhiteBox/settings.html',
    'LittleWhiteBox/style.css',
    'LittleWhiteBox/core/',
    'LittleWhiteBox/bridges/',
    'LittleWhiteBox/shared/',
    'LittleWhiteBox/widgets/button-collapse.js',
    'LittleWhiteBox/modules/ena-planner/',
    'LittleWhiteBox/modules/story-summary/',
    'LittleWhiteBox/modules/story-outline/',
    'LittleWhiteBox/modules/streaming-generation.js',
    'LittleWhiteBox/modules/iframe-renderer.js',
    'LittleWhiteBox/modules/variables/var-commands.js',
    'LittleWhiteBox/libs/',
];

const DROP_HINTS = [
    'LittleWhiteBox/modules/scheduled-tasks/',
    'LittleWhiteBox/modules/message-preview.js',
    'LittleWhiteBox/modules/immersive-mode.js',
    'LittleWhiteBox/modules/template-editor/',
    'LittleWhiteBox/modules/fourth-wall/',
    'LittleWhiteBox/modules/control-audio.js',
    'LittleWhiteBox/modules/novel-draw/',
    'LittleWhiteBox/modules/tts/',
    'LittleWhiteBox/modules/assistant/',
    'LittleWhiteBox/modules/variables/variables-panel.js',
    'LittleWhiteBox/modules/variables/varevent-editor.js',
    'LittleWhiteBox/modules/variables/state2/',
    'vectors-enhanced/src/core/memory/MemoryService.js',
    'vectors-enhanced/src/ui/components/MemoryUI.js',
];

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

function readUtf8(file) {
    const bytes = fs.readFileSync(file);
    return {
        bytes,
        text: bytes.toString('utf8'),
        bom: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    };
}

function classify(relative) {
    if (KEEP_HINTS.some((hint) => relative === hint || relative.startsWith(hint))) return 'keep';
    if (DROP_HINTS.some((hint) => relative === hint || relative.startsWith(hint))) return 'drop';
    return 'review';
}

const files = walk(SOURCE_ROOT)
    .filter((file) => /\.(js|mjs|json|html|css|md|txt)$/i.test(file))
    .map((file) => {
        const relative = toPosix(path.relative(SOURCE_ROOT, file));
        const { text, bom } = readUtf8(file);
        return {
            relative,
            classification: classify(relative),
            bom,
            replacementChars: (text.match(/\uFFFD/g) || []).length,
            bytes: fs.statSync(file).size,
        };
    });

const scopeFiles = files.filter((file) => file.classification === 'keep' || file.classification === 'drop');
const reviewFiles = files.filter((file) => file.classification === 'review');
const scopeGarbled = scopeFiles.filter((file) => file.replacementChars > 0);
const reviewGarbled = reviewFiles.filter((file) => file.replacementChars > 0);
const bomFiles = files.filter((file) => file.bom);
const grouped = files.reduce((acc, file) => {
    acc[file.classification] ||= [];
    acc[file.classification].push(file.relative);
    return acc;
}, {});

console.log(JSON.stringify({
    root: SOURCE_ROOT,
    totalFiles: files.length,
    keepCount: grouped.keep?.length || 0,
    dropCount: grouped.drop?.length || 0,
    reviewCount: grouped.review?.length || 0,
    bomFiles,
    scopeGarbled,
    reviewGarbled,
    dropFiles: grouped.drop || [],
}, null, 2));

if (scopeGarbled.length > 0) {
    process.exitCode = 1;
}
