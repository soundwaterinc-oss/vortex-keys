import { chromium } from 'playwright'
const base = process.env.SMOKE_URL ?? 'http://localhost:4179/'
const out = process.env.SHOT_DIR ?? '/private/tmp/claude-501/-Users-nakamuraryuuakira/f9796eb0-831b-44ef-b1c6-5d15bf5b29d9/scratchpad/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
// 1-3: VORTEX KEYS still plays
await page.goto(base)
await page.click('button.start')
const box = await page.locator('canvas.spiral').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
const outer = Math.min(box.width, box.height) / 2 - 40, inner = Math.max(40, outer * 0.32)
const spacing = (outer - inner) / (5 * 4 - 1)
for (const i of [0, 2, 4, 7]) {
  const th = -Math.PI / 2 + (2 * Math.PI * i) / 5
  const r = inner + spacing * i
  await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th))
  await page.waitForTimeout(200)
}
await page.waitForTimeout(2500)
const vortexStatus = await page.evaluate(() => document.querySelector('canvas.spiral') ? 'ok' : 'missing')
await page.screenshot({ path: out + 'family-vortex.png' })
// 4: switch to ORBIT via the family nav
await page.click('nav.family a[href="./orbit/"]')
await page.waitForURL(/orbit/)
await page.click('button.start')
const dial = await page.locator('canvas.dial').boundingBox()
const dcx = dial.x + dial.width / 2, dcy = dial.y + dial.height / 2
const R = Math.min(dial.width, dial.height) * 0.42
// 5: launch bodies at two degrees / two radii
await page.mouse.click(dcx + Math.cos(-Math.PI / 2) * R * 0.8, dcy + Math.sin(-Math.PI / 2) * R * 0.8)
await page.waitForTimeout(300)
await page.mouse.click(dcx + Math.cos(-Math.PI / 2 + (2 * Math.PI * 2) / 5) * R * 0.5, dcy + Math.sin(-Math.PI / 2 + (2 * Math.PI * 2) / 5) * R * 0.5)
await page.waitForTimeout(4000)
await page.screenshot({ path: out + 'family-orbit.png' })
// 6: hits happened (status line shows notes/s and hit rings were drawn) — read via canvas status text is hard; use window hook
const orbit = await page.evaluate(() => { const e = window.__orbit; const s = e.snapshot(); return { bodies: s.bodies.length, bpm: e.clock.bpm, beats: Math.floor(s.beat), notesPerSecond: s.stats.notesPerSecond, physPerSecond: s.stats.physicsEventsPerSecond } })
console.log('vortex', vortexStatus, 'orbit', JSON.stringify(orbit), 'errors', errors)
await browser.close()
