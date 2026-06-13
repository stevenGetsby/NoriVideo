import fs from 'node:fs/promises'
import * as promptTools from '../../src/lib/novel-promotion/short-drama-video-prompt.ts'

const API_KEY = 'sk-o4PnaTakQEIV27Svm13MQjC5BYpEyl2veuwjemVeVaYKXILc'
const API_URL = 'https://www.hfsyapi.cn/v1/chat/completions'
const MODEL = 'gpt-5.5'
const outDir = '.runtime/agent-story-compression'

async function callLLM(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.1,
      stream: false,
    }),
  })
  const payload = await response.json() as any
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`)
  const content = payload?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('empty completion')
  return content.trim()
}

function normalizeShotScript(raw: string) {
  let text = raw
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
  const sceneIndex = text.search(/^##\s+S\d+\s+/m)
  if (sceneIndex > 0) text = text.slice(sceneIndex).trim()
  return text
}

function validateShotScript(text: string) {
  const script = normalizeShotScript(text)
  const shots = promptTools.parseShotSheetText(script)
  const errors: string[] = []
  if (!/^##\s+S\d+\s+\[/m.test(script)) errors.push('missing scene header')
  if (shots.length === 0) errors.push('no shots parsed')
  const nums = shots.map((shot: any) => shot.number)
  for (let index = 0; index < nums.length; index += 1) {
    if (nums[index] !== index + 1) {
      errors.push(`shot number not continuous at ${index + 1}`)
      break
    }
  }
  for (const shot of shots as any[]) {
    if (shot.durationSeconds > 15) errors.push(`${shot.code} duration > 15s`)
    for (const name of ['景别', '机位', '运镜', '画面', '角色', '动作', '微表情', '对白/字幕', '光影', '声音/剪辑', '道具']) {
      if (!String(shot.fields[name] || '').trim()) errors.push(`${shot.code} missing ${name}`)
    }
  }
  const blocks = shots.length ? promptTools.buildVideoPromptBlocks(script) : []
  const longBlock = blocks.find((block: any) => block.durationSeconds > 15)
  if (longBlock) errors.push(`${longBlock.shots[0].code}-${longBlock.shots.at(-1).code} block > 15s`)
  return { script, shots, blocks, errors }
}

async function main() {
  const previous = await fs.readFile(`${outDir}/generated-shot-script.txt`, 'utf8')
  const repairedRaw = await callLLM([
    {
      role: 'system',
      content: '你是严格的 SH 镜头稿格式修复器。只能修格式，不要改剧情，不要删减镜头，不要解释。',
    },
    {
      role: 'user',
      content: [
        '下面镜头稿内容基本可用，但场景标题格式错误。',
        '请修复为：## S1 [私立医院VIP走廊] 角色：Ava / Dr. Grayson / Nurse Sarah',
        '如果后续出现新场景，也必须用：## Sx [场景名] 角色：...',
        '保留所有 ### SH、时间码、字段、动作、对白和顺序。',
        '只输出修复后的 SH 镜头稿纯文本。',
        '',
        previous,
      ].join('\n'),
    },
  ])
  const validation = validateShotScript(repairedRaw)
  await fs.writeFile(`${outDir}/generated-shot-script-repaired.txt`, validation.script)
  await fs.writeFile(`${outDir}/validation-repaired.json`, JSON.stringify({
    errors: validation.errors,
    shotCount: validation.shots.length,
    blockCount: validation.blocks.length,
    maxBlockDuration: validation.blocks.length ? Math.max(...validation.blocks.map((block: any) => block.durationSeconds)) : 0,
    firstScene: validation.shots[0]?.scene?.heading,
    ranges: validation.blocks.map((block: any) => `${block.shots[0].code}-${block.shots.at(-1).code}`),
  }, null, 2))
  console.log(JSON.stringify({
    shotCount: validation.shots.length,
    blockCount: validation.blocks.length,
    maxBlockDuration: validation.blocks.length ? Math.max(...validation.blocks.map((block: any) => block.durationSeconds)) : 0,
    errorCount: validation.errors.length,
    errors: validation.errors.slice(0, 8),
    firstScene: validation.shots[0]?.scene?.heading,
    firstPromptPreview: validation.blocks[0]?.text.slice(0, 900),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
