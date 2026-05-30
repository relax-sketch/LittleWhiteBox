/* eslint-env node */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const importFromPattern = /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"];?/gm;
const dynamicImportPattern = /import\(\s*['"]([^'"]+)['"]\s*(?:,\s*[^)]*)?\)/gm;
const exportFromPattern = /^\s*export\s+(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*)?\s+from|\{[\s\S]*?\}\s+from)\s*['"]([^'"]+)['"];?/gm;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(js|mjs)$/i.test(entry.name)) out.push(full);
    }
    return out;
}

function resolveRelativeImport(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;
    return path.resolve(path.dirname(fromFile), specifier);
}

function isInsideRoot(candidate) {
    const relative = path.relative(ROOT, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function existsImport(fromFile, specifier) {
    const resolved = resolveRelativeImport(fromFile, specifier);
    if (!resolved) return true;
    const candidates = [
        resolved,
        `${resolved}.js`,
        `${resolved}.mjs`,
        path.join(resolved, 'index.js'),
        path.join(resolved, 'index.mjs'),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
}

const files = walk(ROOT);
const unresolvedInternalImports = [];
const skippedExternalImports = [];
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of [importFromPattern, dynamicImportPattern, exportFromPattern]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
            const specifier = match[1];
            const resolved = resolveRelativeImport(file, specifier);
            if (!resolved) continue;
            const relativeFile = path.relative(ROOT, file).split(path.sep).join('/');
            const relativeResolved = path.relative(ROOT, resolved).split(path.sep).join('/');
            if (!isInsideRoot(resolved)) {
                skippedExternalImports.push({
                    file: relativeFile,
                    specifier,
                    resolved: relativeResolved,
                });
                continue;
            }
            if (!existsImport(file, specifier)) {
                unresolvedInternalImports.push({
                    file: relativeFile,
                    specifier,
                    resolved: relativeResolved,
                });
            }
        }
    }
}

const summary = {
    checkedFiles: files.length,
    unresolvedInternalImports,
    skippedExternalImports,
};

console.log(JSON.stringify(summary, null, 2));

if (unresolvedInternalImports.length) {
    process.exit(1);
}
