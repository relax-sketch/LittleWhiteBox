export const DEFAULT_DIRECTOR_STATE_START_TAG = '<state>';
export const DEFAULT_DIRECTOR_STATE_END_TAG = '</state>';
export const DEFAULT_DIRECTOR_STATE_UNKNOWN = '未知';

export function normalizeDirectorStateTags(options = {}) {
    const startTag = String(options.startTag || options.directorStateStartTag || DEFAULT_DIRECTOR_STATE_START_TAG).trim();
    const endTag = String(options.endTag || options.directorStateEndTag || DEFAULT_DIRECTOR_STATE_END_TAG).trim();
    return {
        startTag: startTag || DEFAULT_DIRECTOR_STATE_START_TAG,
        endTag: endTag || DEFAULT_DIRECTOR_STATE_END_TAG,
    };
}

export function getDirectorStateDisplayText(value = '', options = {}) {
    const unknown = String(options.unknown || DEFAULT_DIRECTOR_STATE_UNKNOWN);
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return unknown;
    const chars = Array.from(normalized);
    if (chars.length <= 4) return normalized;
    return `${chars.slice(0, 4).join('')}..`;
}

export function extractDirectorStateTag(text = '', options = {}) {
    const { startTag, endTag } = normalizeDirectorStateTags(options);
    const source = String(text || '');
    const start = source.lastIndexOf(startTag);
    if (start < 0) {
        return {
            found: false,
            value: '',
            display: getDirectorStateDisplayText('', options),
            startTag,
            endTag,
        };
    }

    const valueStart = start + startTag.length;
    const end = source.indexOf(endTag, valueStart);
    if (end < 0) {
        return {
            found: false,
            value: '',
            display: getDirectorStateDisplayText('', options),
            startTag,
            endTag,
        };
    }

    const value = source.slice(valueStart, end).trim();
    return {
        found: !!value,
        value,
        display: getDirectorStateDisplayText(value, options),
        startTag,
        endTag,
    };
}
