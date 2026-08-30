/**
 * E-WP2 — node test for the quick-reply parser contract.
 * Run: npx tsx scripts/_test-quick-replies.ts
 */
import { parseQuickReplies } from '../client/src/components/ops/quick-replies';

let failures = 0;

function check(name: string, actual: { body: string; options: string[] }, expected: { body: string; options: string[] }) {
    const ok = actual.body === expected.body
        && actual.options.length === expected.options.length
        && actual.options.every((o, i) => o === expected.options[i]);
    if (ok) {
        console.log(`PASS  ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL  ${name}`);
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
}

// 1. Valid 2-option block
{
    const content = 'Which Craig do you mean?\n\n```options\n["Craig Smith", "Craig Jones"]\n```';
    check('valid 2-option block', parseQuickReplies(content), {
        body: 'Which Craig do you mean?',
        options: ['Craig Smith', 'Craig Jones'],
    });
}

// 2. Block plus trailing newline(s)
{
    const content = 'Confirm?\n\n```options\n["Yes", "No"]\n```\n\n';
    check('block plus trailing newlines', parseQuickReplies(content), {
        body: 'Confirm?',
        options: ['Yes', 'No'],
    });
}

// 3. No block
{
    const content = 'Just a normal reply with no options at all.';
    check('no block', parseQuickReplies(content), { body: content, options: [] });
}

// 4. Block NOT at end (mid-message) → no options
{
    const content = 'Here are choices:\n```options\n["A", "B"]\n```\nBut I kept talking after them.';
    check('block mid-message', parseQuickReplies(content), { body: content, options: [] });
}

// 5. Bad JSON → no options
{
    const content = 'Pick one:\n```options\n["A", "B"\n```';
    check('bad JSON', parseQuickReplies(content), { body: content, options: [] });
}

// 6. 1 entry → no options
{
    const content = 'Only one:\n```options\n["Solo"]\n```';
    check('1 entry', parseQuickReplies(content), { body: content, options: [] });
}

// 7. 7 entries → no options
{
    const content = 'Too many:\n```options\n["1", "2", "3", "4", "5", "6", "7"]\n```';
    check('7 entries', parseQuickReplies(content), { body: content, options: [] });
}

// 8. Non-string entry → no options
{
    const content = 'Mixed:\n```options\n["A", 2]\n```';
    check('non-string entry', parseQuickReplies(content), { body: content, options: [] });
}

// 9. Body correctly stripped when block spans max valid entries
{
    const content = 'Line one.\nLine two.\n\n```options\n["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]\n```\n';
    check('6 entries, multi-line body stripped', parseQuickReplies(content), {
        body: 'Line one.\nLine two.',
        options: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    });
}

// 10. Non-array JSON → no options
{
    const content = 'Object:\n```options\n{"a": "b"}\n```';
    check('non-array JSON', parseQuickReplies(content), { body: content, options: [] });
}

// 11. Empty-string entry → no options
{
    const content = 'Empty entry:\n```options\n["A", ""]\n```';
    check('empty-string entry', parseQuickReplies(content), { body: content, options: [] });
}

// 12. Entry over 80 chars → no options
{
    const long = 'x'.repeat(81);
    const content = `Long entry:\n\`\`\`options\n["A", "${long}"]\n\`\`\``;
    check('entry over 80 chars', parseQuickReplies(content), { body: content, options: [] });
}

if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
}
console.log('\nAll tests passed.');
