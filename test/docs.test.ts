import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const SKILL = 'skills/pinzone';

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
  assert.equal(fm.name, 'pinzone');
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

/** Every message a user can see, as fragments. Each must still be in src/ and be explained in references/cli.md. */
const MESSAGES = [
  'up to date:', 'missing from', 'does not exist yet', 'run: npx pinzone build', 'wrote ', 'resolved', 'changed',
  'is within 10m of another zone', 'lookups that round to it answer', 'but its key', 'lookups there answer',
  'table says', 'polygons say', 'reaches another zone', "not a zone this runtime's Intl accepts", 'ok:',
  'the polygons', 'fix: rebuild the table with --refresh', 'fix: update Node', 'this command needs geo-tz 8.1 or later',
  'not valid JSON', 'points must be a .json or .csv file', '--check and --refresh cannot be combined',
  '--max-radius must be a multiple of', 'no zone found for', 'JSON points must be an array',
  'expected [lat, lng] or { lat, lng }', 'CSV header must have lat and lng columns', 'unterminated quote',
  'lat and lng must be decimal numbers in range', 'is not a canonical point key', 'must map to [zone, radius]',
  'has an invalid zone name', 'has radius', 'unsupported version', 'must be a plain object',
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
  assert.equal(claude.name, 'pinzone');
  assert.equal(claude.version, pkg.version, 'bump .claude-plugin/plugin.json with package.json: plugin users only update when it changes');
  assert.equal(market.name, 'pinzone');
  assert.deepEqual(market.plugins.map((p: { name: string; source: string }) => [p.name, p.source]), [['pinzone', './']]);
  assert.equal(kimi.name, 'pinzone');
  assert.equal(kimi.skills, './skills/');
  for (const description of [claude.description, market.plugins[0].description, kimi.description]) assert.equal(description, pkg.description);
});

test('the npm package ships the skill and llms.txt', () => {
  const { files } = JSON.parse(read('package.json'));
  assert.ok(files.includes('skills') && files.includes('llms.txt'), JSON.stringify(files));
});

test('Claude Code contributors get AGENTS.md through .claude/CLAUDE.md, not a plugin-root CLAUDE.md', () => {
  assert.equal(read('.claude/CLAUDE.md').trim(), '@../AGENTS.md');
  assert.ok(!existsSync(join(root, 'CLAUDE.md')), 'a CLAUDE.md at the plugin root is not loaded and fails plugin validation');
});
