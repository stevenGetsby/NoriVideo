import { readFileSync, writeFileSync } from 'node:fs'

const files = process.argv.slice(2)
const UNIT_RE = /(\d+(?:\.\d+)?)(dvh|svh|lvh)/g

let total = 0
let modified = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const out = []
  let fileModified = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!UNIT_RE.test(line)) { out.push(line); continue }
    UNIT_RE.lastIndex = 0
    const prev = out[out.length - 1]
    if (prev && prev.trim() === line.replace(UNIT_RE, (_m, n) => `${n}vh`).trim()) {
      out.push(line); continue
    }
    if (/^\s*@supports/.test(line) || !line.includes(':')) { out.push(line); continue }
    const fallback = line.replace(UNIT_RE, (_m, n) => `${n}vh`)
    if (fallback === line) { out.push(line); continue }
    out.push(fallback)
    out.push(line)
    total += 1
    fileModified = true
  }
  if (fileModified) {
    writeFileSync(file, out.join('\n'))
    modified += 1
  }
}
console.log(`Inserted ${total} fallback declarations across ${modified} files`)
