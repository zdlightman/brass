/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

function saveGameLog(): Plugin {
  return {
    name: 'save-game-log',
    configureServer(server) {
      server.middlewares.use('/api/game-log', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const now = new Date()
          const pad = (value: number) => String(value).padStart(2, '0')
          const name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.log`
          fs.writeFileSync(path.resolve(server.config.root, name), text.endsWith('\n') ? text : `${text}\n`, 'utf8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(name)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), saveGameLog()],
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/**'],
  },
})
