import { chromium } from 'playwright'
const out = '/private/tmp/claude-501/-Users-nakamuraryuuakira/f9796eb0-831b-44ef-b1c6-5d15bf5b29d9/scratchpad/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://localhost:4179/')
await page.waitForTimeout(500)
await page.screenshot({ path: out + 'shot0.png' })
await page.click('button.start')
await page.waitForTimeout(300)
// play a few spiral notes: find canvas center and click nodes along the spiral
const box = await page.locator('canvas.spiral').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
const outer = Math.min(box.width, box.height) / 2 - 40
const inner = Math.max(40, outer * 0.32)
const n = 5, oct = 4
const spacing = (outer - inner) / (n * oct - 1)
for (const i of [0, 2, 4, 6, 9, 12]) {
  const th = -Math.PI / 2 + (2 * Math.PI * i) / n
  const r = inner + spacing * i
  await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th))
  await page.waitForTimeout(250)
}
await page.waitForTimeout(2500)
await page.screenshot({ path: out + 'shot1.png' })
// switch to wave
await page.getByRole('button', { name: 'WAVE' }).click()
for (const i of [3, 7]) {
  const th = -Math.PI / 2 + (2 * Math.PI * i) / n
  const r = inner + spacing * i
  await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th))
}
await page.waitForTimeout(3000)
await page.screenshot({ path: out + 'shot2.png' })
const status = await page.evaluate(() => document.querySelector('canvas') ? 'ok' : 'no canvas')
const startVisible = await page.locator('button.start').count()
// stress: tight vortex preset, mash many notes, check the page stays alive
await page.selectOption('select >> nth=0', { label: 'Tight Vortex' })
await page.waitForTimeout(300)
for (let k = 0; k < 40; k++) {
  const i = k % 20
  const th = -Math.PI / 2 + (2 * Math.PI * i) / n
  const r = inner + spacing * i
  await page.mouse.click(cx + r * Math.cos(th), cy + r * Math.sin(th))
}
await page.waitForTimeout(4000)
await page.screenshot({ path: out + 'shot3.png' })
console.log('startVisible', startVisible)
console.log('status', status, 'errors', errors)
await browser.close()
