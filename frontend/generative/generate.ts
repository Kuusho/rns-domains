import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAvatar, describe } from './src/avatar';
import { renderOg, type OgState } from './src/og';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

// The 12 names from the brand deck (slide 08) so output diffs 1:1 against it.
const NAMES = [
  'alice.rise', 'max.rise', 'satoshi.rise', 'dao.rise', 'agent.rise', 'davit.rise',
  'rise.rise', 'rns.rise', 'fork.rise', 'block.rise', 'commit.rise', 'reveal.rise',
];

mkdirSync(join(OUT, 'avatars'), { recursive: true });
mkdirSync(join(OUT, 'og'), { recursive: true });

// 1. Avatars
for (const name of NAMES) {
  writeFileSync(join(OUT, 'avatars', `${name}.svg`), renderAvatar(name));
}

// 2. OG cards — one of each state, plus a couple extras
const ogJobs: Array<[string, OgState, Parameters<typeof renderOg>[2]]> = [
  ['alice.rise', 'profile', { bio: 'Independent researcher, building the agentic web one quiet morning at a time.', block: '12,345,678', expires: '2027-05-27' }],
  ['max.rise', 'available', { price: '0.005 ETH / year', tier: '5-character tier' }],
  ['satoshi.rise', 'reserved', {}],
  ['agent.rise', 'profile', { bio: 'Autonomous trading agent. Resolves to a treasury, answers to no one.', block: '12,201,004', expires: '2028-01-14' }],
  ['rise.rise', 'reserved', {}],
];
for (const [name, state, opts] of ogJobs) {
  writeFileSync(join(OUT, 'og', `${name}-${state}.svg`), renderOg(name, state, opts));
}

// 3. Gallery viewer
const avatarCards = NAMES.map((n) => `
  <figure class="a">
    <img src="avatars/${n}.svg" width="160" height="160" alt="${n}"/>
    <figcaption><span class="nm">${n}</span><span class="ds">${describe(n)}</span></figcaption>
  </figure>`).join('');

const ogCards = ogJobs.map(([n, s]) => `
  <figure class="o">
    <img src="og/${n}-${s}.svg" alt="${n} ${s}"/>
    <figcaption>${n} · <span class="st">${s.toUpperCase()}</span></figcaption>
  </figure>`).join('');

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>RNS — generative output</title>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,500;1,300&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{--night:#0A0E27;--apex:#FFEFD5;--amber:#F4A261;--dim:rgba(255,239,213,.6);--mute:rgba(255,239,213,.32)}
  *{box-sizing:border-box;margin:0}body{background:var(--night);color:var(--apex);font-family:'Newsreader',serif;padding:64px}
  h1{font-weight:300;font-size:48px;letter-spacing:-.02em;margin-bottom:8px}h1 em{font-style:italic;color:var(--amber)}
  p.sub{color:var(--dim);font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:.04em;margin-bottom:56px}
  h2{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--amber);margin:48px 0 24px}
  .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:24px}
  figure.a img{border-radius:16px;display:block;width:100%;height:auto}
  figure.a figcaption{margin-top:12px;display:flex;flex-direction:column;gap:2px}
  .nm{font-style:italic;font-size:18px}.ds{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mute);letter-spacing:.02em}
  .og{display:flex;flex-direction:column;gap:40px;max-width:1000px}
  figure.o img{width:100%;height:auto;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  figure.o figcaption{margin-top:14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--dim);letter-spacing:.08em}
  .st{color:var(--amber)}
</style></head><body>
  <h1>Every name has a <em>face</em> before it has a photo.</h1>
  <p class="sub">deterministic from keccak256(namehash(name)) · ${NAMES.length} avatars · 3 OG states · rendered ${new Date().toISOString().slice(0, 10)}</p>
  <h2>Avatars (D-07)</h2>
  <div class="grid">${avatarCards}</div>
  <h2>Link previews (D-19) · 1200×630</h2>
  <div class="og">${ogCards}</div>
</body></html>`;

writeFileSync(join(OUT, 'index.html'), html);

console.log(`✓ ${NAMES.length} avatars → ${join(OUT, 'avatars')}`);
console.log(`✓ ${ogJobs.length} OG cards → ${join(OUT, 'og')}`);
console.log(`✓ gallery → ${join(OUT, 'index.html')}`);
console.log('\nParams per name:');
for (const n of NAMES) console.log(`  ${n.padEnd(14)} ${describe(n)}`);
