import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function collectRelativeImports(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const patterns = [
        /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"];?/gm,
        /import\(\s*['"]([^'"]+)['"]\s*(?:,\s*[^)]*)?\)/gm,
        /^\s*export\s+(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*)?\s+from|\{[\s\S]*?\}\s+from)\s*['"]([^'"]+)['"];?/gm,
    ];
    const imports = [];
    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
            if (match[1].startsWith('.')) {
                imports.push(match[1]);
            }
        }
    }
    return imports;
}

function resolveImportCandidates(fromFile, specifier) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    return [
        resolved,
        `${resolved}.js`,
        `${resolved}.mjs`,
        path.join(resolved, 'index.js'),
        path.join(resolved, 'index.mjs'),
    ];
}

function isInsideRoot(filePath) {
    const relative = path.relative(ROOT, filePath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

test('extension entry modules resolve all internal relative imports', () => {
    const entryFiles = [
        path.join(ROOT, 'index.js'),
        path.join(ROOT, 'modules', 'vectors', 'index.js'),
        path.join(ROOT, 'modules', 'director', 'index.js'),
    ];

    const missing = [];

    for (const file of entryFiles) {
        for (const specifier of collectRelativeImports(file)) {
            const candidates = resolveImportCandidates(file, specifier);
            if (!isInsideRoot(candidates[0])) {
                continue;
            }
            if (!candidates.some((candidate) => fs.existsSync(candidate))) {
                missing.push({
                    from: path.relative(ROOT, file).split(path.sep).join('/'),
                    specifier,
                    resolved: path.relative(ROOT, candidates[0]).split(path.sep).join('/'),
                });
            }
        }
    }

    assert.deepEqual(missing, []);
});
