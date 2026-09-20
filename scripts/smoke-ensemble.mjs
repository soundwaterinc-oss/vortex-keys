// ENSEMBLE causality smoke: performer → VORTEX → bus → ORBIT → orbit → gate → note.
import { chromium } from 'playwright'
const base = process.env.SMOKE_URL ?? 'http://localhost:4179/'
const out = process.env.SHOT_DIR ?? '/private/tmp/claude-501/-Users-nakamuraryuuakira/f9796eb0-831b-44ef-b1c6-5d15bf5b29d9/scratchpad/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const results = {}
const check = (name, ok, info = '') => { results[name] = ok; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`) }

await page.goto(base + 'ensemble/')
await page.waitForTimeout(500)
check('loads', await page.locator('canvas.spiral').count() === 1 && await page.locator('canvas.dial').count() === 1)
await page.click('button.start')
await page.waitForTimeout(400)
const diag = () => page.evaluate(() => window.__ensemble.diagnostics())
let d = await diag()
check('one AudioContext running', d.audioState === 'running' && d.contexts === 1, JSON.stringify(d.audioState))
// tuning choice
await page.selectOption('.top select', { label: 'Just intonation major (5-limit) (7)' })
await page.waitForTimeout(200)
d = await diag()
check('tuning applied to host', d.tuning === 'ji-major', d.tuning)
// bus capture
await page.evaluate(() => { window.__log = []; window.__ensemble.bus.onAny((e) => window.__log.push({ type: e.type, gen: e.meta.generation, payload: e.payload })) })
// play spiral degree 2 (7-note scale, 4 octaves, index 9 = degree 2 octave 1)
const box = await page.locator('canvas.spiral').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
const outer = Math.min(box.width, box.height) / 2 - 40, inner = Math.max(40, outer * 0.32)
const n = 7, oct = 4, spacing = (outer - inner) / (n * oct - 1)
const play = async (i) => { const th = -Math.PI / 2 + (2 * Math.PI * i) / n; const r = inner + spacing * i; await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th)) }
const bodiesBefore = (await diag()).orbitBodies
await play(9)
await page.waitForTimeout(300)
let log = await page.evaluate(() => window.__log)
const np = log.find((l) => l.type === 'vortex.notePlayed')
const sr = log.find((l) => l.type === 'ensemble.orbitSpawnRequested')
const bs = log.find((l) => l.type === 'orbit.bodySpawned')
check('vortex.notePlayed published', !!np && np.payload.scaleDegree === 2 && np.payload.octave === 1, JSON.stringify(np?.payload))
check('spawn requested with generation 1', !!sr && sr.gen === 1, JSON.stringify(sr))
check('orbit body spawned keeping degree', !!bs && bs.payload.scaleDegree === 2 && bs.payload.octave === 1, JSON.stringify(bs?.payload))
d = await diag()
check('orbit body count increased', d.orbitBodies === bodiesBefore + 1, `${bodiesBefore} -> ${d.orbitBodies}`)
// body moves
const pos0 = await page.evaluate(() => window.__ensemble.orbit.snapshot().bodies.map((b) => [b.snapshot.angle, b.snapshot.radius]))
await page.waitForTimeout(600)
const pos1 = await page.evaluate(() => window.__ensemble.orbit.snapshot().bodies.map((b) => [b.snapshot.angle, b.snapshot.radius]))
check('body moves', pos0.length && Math.abs(pos0[0][0] - pos1[0][0]) > 0.01, `${pos0[0]?.[0]?.toFixed(3)} -> ${pos1[0]?.[0]?.toFixed(3)}`)
// second note, different degree
await play(4)
await page.waitForTimeout(3500)
log = await page.evaluate(() => window.__log)
const gate = log.find((l) => l.type === 'orbit.gateCrossed' || l.type === 'orbit.periapsis')
const gen = log.filter((l) => l.type === 'orbit.noteGenerated')
check('physical trigger event occurred', !!gate, gate?.type)
check('musical ORBIT events generated', gen.length > 0, `${gen.length} notes`)
check('generated notes keep body identity', gen.some((g) => g.payload.scaleDegree === 2) && gen.some((g) => g.payload.scaleDegree === 4), [...new Set(gen.map((g) => g.payload.scaleDegree))].join(','))
check('no chain beyond max generation', log.every((l) => l.gen <= 2))
await page.screenshot({ path: out + 'ensemble.png' })
// BPM change affects orbit timing (notes/s should change with tempo since ORBIT speed is per beat)
const rateBefore = gen.length
await page.evaluate(() => window.__ensemble.host.setTempo(180))
await page.evaluate(() => { window.__log = [] })
await page.waitForTimeout(3000)
log = await page.evaluate(() => window.__log)
const genFast = log.filter((l) => l.type === 'orbit.noteGenerated').length
check('BPM change changes ORBIT rate', genFast > rateBefore * 0.9, `112bpm:${rateBefore}/3.5s vs 180bpm:${genFast}/3s`)
check('VORTEX still free timing', await page.evaluate(() => window.__ensemble.vortex.getState().time.mode) === 'free')
// routing off
await page.getByRole('button', { name: 'VORTEX → ORBIT' }).click()
const bodiesOff = (await diag()).orbitBodies
await page.evaluate(() => { window.__log = [] })
await play(2)
await page.waitForTimeout(300)
log = await page.evaluate(() => window.__log)
check('routing OFF: direct note still published', log.some((l) => l.type === 'vortex.notePlayed'))
check('routing OFF: no body spawned', (await diag()).orbitBodies === bodiesOff && !log.some((l) => l.type === 'orbit.bodySpawned'))
await page.getByRole('button', { name: 'VORTEX → ORBIT' }).click()
// tuning change keeps identity, changes frequency
const before = await page.evaluate(() => window.__ensemble.orbit.snapshot().bodies.map((b) => [b.identity.degree, b.identity.octave]))
await page.evaluate(() => { window.__log = [] })
await page.selectOption('.top select', { label: 'Pythagorean diatonic (3-limit) (7)' })
await page.waitForTimeout(2500)
const after = await page.evaluate(() => window.__ensemble.orbit.snapshot().bodies.map((b) => [b.identity.degree, b.identity.octave]))
log = await page.evaluate(() => window.__log)
const genAfter = log.filter((l) => l.type === 'orbit.noteGenerated')
check('tuning change keeps body identities', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after))
const f2 = genAfter.find((g) => g.payload.scaleDegree === 2)?.payload.frequency
const f2before = gen.find((g) => g.payload.scaleDegree === 2)?.payload.frequency
check('tuning change re-resolves frequency', !!f2 && !!f2before && Math.abs(f2 - f2before) > 0.5, `${f2before?.toFixed(2)} -> ${f2?.toFixed(2)}`)
// mute
await page.getByRole('button', { name: 'ORBIT', exact: true }).click()
const muted = await page.evaluate(() => window.__ensemble.host.instrumentBus('orbit').isMuted)
await page.getByRole('button', { name: 'MUTED' }).click()
const unmuted = await page.evaluate(() => window.__ensemble.host.instrumentBus('orbit').isMuted)
check('mute toggles bus', muted === true && unmuted === false)
// reset
await page.getByRole('button', { name: 'RESET' }).click()
await page.waitForTimeout(200)
check('RESET clears bodies', (await diag()).orbitBodies === 0)
// voices audio acceptance: switch VORTEX sound models and play
await page.getByRole('button', { name: /INSTRUMENTS/ }).click()
for (const name of ['Fender Rhodes', 'Hammond / Drawbar', 'Pipe Organ', 'Voice / Choir', 'Glass / Bell']) {
  const ok = await page.evaluate((nm) => [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.label === nm)), name)
  if (!ok) { check(`voice ${name}`, false, 'not in list'); continue }
  const idx = await page.evaluate((nm) => [...document.querySelectorAll('select')].findIndex((s) => [...s.options].some((o) => o.label === nm)), name)
  await page.selectOption(`select >> nth=${idx}`, { label: name })
  await play(9); await play(11)
  await page.waitForTimeout(700)
  const lvl = (await diag()).level
  check(`voice ${name} sounds`, lvl > 0.002, `level ${lvl.toFixed(4)}`)
}
// standalone routes
for (const path of ['', 'orbit/']) {
  await page.goto(base + path)
  await page.waitForTimeout(400)
  check(`route /${path} loads`, await page.locator('canvas').count() >= 1)
}
console.log('errors', errors)
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k)
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'ALL PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
