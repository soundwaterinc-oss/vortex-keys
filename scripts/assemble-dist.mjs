// Compose the family's static site: VORTEX KEYS at the root (keeps its URL), other instruments in subfolders.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs'
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist')
cpSync('apps/vortex-keys/dist', 'dist', { recursive: true })
if (existsSync('apps/orbit/dist')) cpSync('apps/orbit/dist', 'dist/orbit', { recursive: true })
if (existsSync('apps/ensemble/dist')) cpSync('apps/ensemble/dist', 'dist/ensemble', { recursive: true })
if (existsSync('apps/drum/dist')) cpSync('apps/drum/dist', 'dist/drum', { recursive: true })
console.log('dist assembled: / = VORTEX KEYS, /orbit/ = ORBIT, /ensemble/ = ENSEMBLE, /drum/ = SPIRA')
