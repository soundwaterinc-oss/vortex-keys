import { chromium } from 'playwright'
const out = process.env.SHOT_DIR ?? '/private/tmp/claude-501/-Users-nakamuraryuuakira/f9796eb0-831b-44ef-b1c6-5d15bf5b29d9/scratchpad/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://localhost:4179/')
await page.waitForTimeout(400)
await page.click('button.start')
await page.waitForTimeout(300)
const box = await page.locator('canvas.spiral').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
const outer = Math.min(box.width, box.height) / 2 - 40
const inner = Math.max(40, outer * 0.32)
async function play(n, oct, idxs, gap = 200) {
  const spacing = (outer - inner) / (n * oct - 1)
  for (const i of idxs) {
    const th = -Math.PI / 2 + (2 * Math.PI * i) / n
    const r = inner + spacing * i
    await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th))
    await page.waitForTimeout(gap)
  }
}
await page.getByRole('button', { name: 'MONITOR' }).click()
const presets = [
  ['Tight Vortex', 5, 4, [0, 2, 4, 6, 9, 12]],
  ['Elliptic Pulse', 5, 4, [1, 3, 7, 12]],
  ['Interference 3:4:5', 5, 4, [0, 3, 6, 11]],
  ['Gathering Pulse', 5, 4, [2, 5, 8]],
  ['Edge of Chaos', 5, 4, [0, 4, 7, 11]],
  ['Long Orbit', 7, 4, [0, 4, 9]],
]
let k = 0
for (const [name, n, oct, idxs] of presets) {
  await page.selectOption('select >> nth=0', { label: name })
  await page.waitForTimeout(200)
  await play(n, oct, idxs)
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${out}mode${k++}.png` })
}
// stress: mash under dense attractor + cross-mapping combo
await page.selectOption('select >> nth=0', { label: 'Dense Attractor' })
await page.selectOption('select >> nth=3', { label: 'Spiral Melody' })
await play(12, 4, Array.from({ length: 40 }, (_, i) => i % 24), 30)
await page.waitForTimeout(3000)
await page.screenshot({ path: `${out}stress.png` })
// rapid mode switching must not throw
for (const m of ['VORTEX', 'ORBIT', 'WAVE', 'COUPLED', 'CHAOS', 'MAN', 'VORTEX']) {
  await page.getByRole('button', { name: m, exact: true }).click()
  await page.waitForTimeout(150)
}
await page.waitForTimeout(500)
console.log('errors', errors)
await browser.close()
