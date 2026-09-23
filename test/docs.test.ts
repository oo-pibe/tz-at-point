import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const SKILL = 'skills/tz-at-point';

/** Minimal frontmatter reader: `key: value` lines between the opening `---` lines. */
function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(match, 'SKILL.md must start with frontmatter');
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"(.*)"$/, '$1')];
  }));
}

const docs = () => [
  'README.md', 'AGENTS.md', 'llms.txt', `${SKILL}/SKILL.md`,
  ...readdirSync(join(root, SKILL, 'references')).map((f) => `${SKILL}/references/${f}`),
];

test('SKILL.md frontmatter uses only shared Agent Skills fields, within their limits', () => {
  const skill = read(`${SKILL}/SKILL.md`);
  const fm = frontmatter(skill);
  assert.deepEqual(Object.keys(fm).sort(), ['description', 'license', 'name']);
  assert.equal(fm.name, 'tz-at-point');
  assert.ok(fm.description.length > 100 && fm.description.length <= 1024, `description is ${fm.description.length} characters`);
  assert.ok(skill.split('\n').length <= 250, `SKILL.md is ${skill.split('\n').length} lines`);
});

test('every relative link in the docs resolves', () => {
  for (const file of docs()) {
    for (const [, target] of read(file).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      assert.ok(existsSync(resolve(root, dirname(file), target)), `${file} links to missing ${target}`);
    }
  }
});

/**
 * README links must be absolute: npm renders it through GitHub's Markdown API, which does not
 * rewrite relative URLs. That moves them out of reach of the check above, so verify them here.
 */
test('every link into our own repo points at a file that exists', () => {
  const self = /https:\/\/(?:github\.com\/oo-pibe\/tz-at-point\/(?:blob|tree)|raw\.githubusercontent\.com\/oo-pibe\/tz-at-point)\/main\/([^)\s"]+)/g;
  let found = 0;
  for (const file of docs()) {
    for (const [, target] of read(file).matchAll(self)) {
      assert.ok(existsSync(resolve(root, target)), `${file} links to missing ${target}`);
      found++;
    }
  }
  assert.ok(found >= 9, `expected the README's absolute self-links, found ${found}`);
});

test('the test count the README advertises is the number of tests there are', () => {
  const declared = /\| Tests \| (\d+),/.exec(read('README.md'));
  assert.ok(declared, 'README no longer states a test count');
  const actual = readdirSync(join(root, 'test'))
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (read(`test/${f}`).match(/^test\(/gm)?.length ?? 0), 0);
  assert.equal(Number(declared[1]), actual, 'README says a different number of tests than test/ declares');
});

/** GitHub's heading anchors: lowercased, punctuation dropped, spaces hyphenated. */
const slug = (heading: string) => heading.toLowerCase().replace(/[^\w\- ]/g, '').trim().replace(/ /g, '-');

/**
 * A `## Heading` inside a fenced block is sample text, not a heading, and gets
 * no anchor. Docs here quote whole markdown files, so this is not hypothetical:
 * the table of contents once linked to a heading that only existed in a sample.
 */
const withoutFences = (markdown: string) => markdown.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');

test('every in-page anchor link points at a heading that still exists', () => {
  for (const file of docs()) {
    const text = withoutFences(read(file));
    const headings = new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(([, h]) => slug(h)));
    for (const [, anchor] of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
      assert.ok(headings.has(anchor), `${file} links to #${anchor}, which is not a heading`);
    }
  }
});

/** Every message a user can see, as fragments. Each must still be in src/ and be explained in references/cli.md. */
const MESSAGES = [
  'up to date:', 'missing from', 'disagrees', 'by a different UTC offset', 'built with geo-tz', 're-resolved at --max-radius', 'kept changing underneath this build', 'does not exist yet', 'run: npx tz-at-point build', 'wrote ', 'resolved', 'changed',
  'is within 10m of another zone', 'lookups that round to it answer', 'but its key', 'lookups there answer',
  'table says', 'polygons say', 'reaches another zone', "not a zone this runtime's Intl accepts", 'ok:',
  'the polygons', 'fix: rebuild the table with --refresh', 'fix: update Node', 'this command needs geo-tz 8 or later',
  'not valid JSON', 'points must be a .json or .csv file', '--check and --refresh cannot be combined',
  '--max-radius must be a multiple of', 'no zone found for', 'JSON points must be an array',
  'expected [lat, lng] or { lat, lng }', 'CSV header must have lat and lng columns', 'unterminated quote',
  'lat and lng must be decimal numbers in range', 'is not a canonical point key', 'must map to [zone, radius]',
  'has an invalid zone name', 'has radius', 'unsupported version', 'must be a plain object',
  'unknown option', 'needs a value', 'does not take a value', 'no such file or directory', 'no such directory',
  'not writable', 'is a directory', 'not a directory', 'permission denied', 'has no points', 'attribution must be a string',
];

test('the CLI reference covers every flag and every message', () => {
  const source = readdirSync(join(root, 'src')).map((f) => read(`src/${f}`)).join('\n');
  const reference = read(`${SKILL}/references/cli.md`);
  const flags = [...read('src/cli.ts').matchAll(/^\s+'?([a-z-]+)'?: \{ type: '(?:string|boolean)'/gm)].map((m) => m[1]);
  assert.ok(flags.length >= 5, `found only ${flags}`);
  for (const flag of flags) assert.ok(reference.includes(`--${flag}`), `references/cli.md does not mention --${flag}`);
  for (const message of MESSAGES) {
    assert.ok(source.includes(message), `"${message}" is no longer in src/: update MESSAGES and references/cli.md`);
    assert.ok(reference.includes(message), `references/cli.md does not explain "${message}"`);
  }
});

test('the API reference covers every public export', () => {
  const reference = read(`${SKILL}/references/api.md`);
  for (const [, names] of read('src/index.ts').matchAll(/export (?:type )?\{([^}]+)\}/g)) {
    for (const name of names.split(',').map((n) => n.trim())) {
      assert.match(reference, new RegExp(`\`${name}[\`(]`), `references/api.md does not document ${name}`);
    }
  }
});

test('the plugin manifests agree with each other and with package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  const claude = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  const kimi = JSON.parse(read('kimi.plugin.json'));
  assert.equal(claude.name, 'tz-at-point');
  assert.equal(claude.version, pkg.version, 'bump .claude-plugin/plugin.json with package.json: plugin users only update when it changes');
  assert.equal(market.name, 'tz-at-point');
  assert.deepEqual(market.plugins.map((p: { name: string; source: string }) => [p.name, p.source]), [['tz-at-point', './']]);
  assert.equal(kimi.name, 'tz-at-point');
  assert.equal(kimi.skills, './skills/');
  for (const description of [claude.description, market.plugins[0].description, kimi.description]) assert.equal(description, pkg.description);
});

test('the npm package ships the skill and llms.txt', () => {
  const { files } = JSON.parse(read('package.json'));
  assert.ok(files.includes('skills') && files.includes('llms.txt'), JSON.stringify(files));
});

test('package.json is importable, and tz-at-point/core exists for table-only consumers', () => {
  const { exports: map, engines, peerDependencies } = JSON.parse(read('package.json'));
  assert.equal(map['./package.json'], './package.json');
  assert.equal(map['./core'].default, './dist/lookup.js');
  // require() of an ES module lands on Node 22.12; 22.0-22.11 throw ERR_REQUIRE_ESM.
  assert.equal(engines.node, '^20.19.0 || >=22.12.0');
  assert.equal(peerDependencies['geo-tz'], '^8.0.0'); // 8.0.0 already exports geo-tz/all
});

test('Claude Code contributors get AGENTS.md through .claude/CLAUDE.md, not a plugin-root CLAUDE.md', () => {
  assert.equal(read('.claude/CLAUDE.md').trim(), '@../AGENTS.md');
  assert.ok(!existsSync(join(root, 'CLAUDE.md')), 'a CLAUDE.md at the plugin root is not loaded and fails plugin validation');
});
