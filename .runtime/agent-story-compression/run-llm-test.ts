import fs from 'node:fs/promises'
import mammoth from 'mammoth'
import * as promptTools from '../../src/lib/novel-promotion/short-drama-video-prompt.ts'

const API_KEY = 'sk-o4PnaTakQEIV27Svm13MQjC5BYpEyl2veuwjemVeVaYKXILc'
const API_URL = 'https://www.hfsyapi.cn/v1/chat/completions'
const MODEL = 'gpt-5.5'
const outDir = '.runtime/agent-story-compression'

async function callLLM(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  temperature = 0.35,
  timeoutMs = 180000,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`)
    }
    const content = payload?.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') {
      throw new Error(`empty completion: ${JSON.stringify(payload).slice(0, 1000)}`)
    }
    return content.trim()
  } finally {
    clearTimeout(timer)
  }
}

function normalizeShotScript(raw: string) {
  let text = raw
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
  const sceneIndex = text.search(/^##\s+S\d+\s+\[/m)
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
  const doc = await mammoth.extractRawText({ path: '/Users/headmasterx/Desktop/故事.docx' })
  const raw = doc.value.trim()
  await fs.writeFile(`${outDir}/source-extracted.txt`, raw)
  console.log(JSON.stringify({ step: 'extracted', chars: raw.length, shots: promptTools.parseShotSheetText(raw).length }))

  const story = await callLLM([
    {
      role: 'system',
      content: [
        '你是专业短剧剧本整理师。把结构化 SH 镜头稿压缩成一个连续完整的剧情故事。',
        '只输出故事正文，不要标题，不要分镜编号，不要镜头语言，不要 bullet。',
        '保留角色姓名、人物关系、核心冲突、关键道具、反转、情绪推进和英文对白大意。',
        '压缩后应该像可拍摄短剧故事梗概，长度控制在 1800-2600 中文字符。',
      ].join('\n'),
    },
    { role: 'user', content: raw },
  ], 0.25)
  await fs.writeFile(`${outDir}/compressed-story.txt`, story)
  console.log(JSON.stringify({ step: 'compressed', chars: story.length, preview: story.slice(0, 260) }))

  const shotPrompt = [
    '请把下面这个短剧故事重新生成结构化 SH 镜头稿。',
    '注意：你不能参考原始 SH 镜头稿，只能根据故事重新导演。目标是高质量、可执行、接近专业分镜稿。',
    '',
    '输出只允许是纯文本 SH 镜头稿，不要 JSON，不要 markdown，不要解释。',
    '格式：',
    '## S1 [场景名] 角色：角色A / 角色B',
    '### SH001 [00:00-00:04]',
    '景别：中景',
    '机位：平视',
    '运镜：固定',
    '画面：具体可拍摄画面',
    '角色：角色A / 角色B',
    '动作：具体动作，必须推动剧情',
    '微表情：眼神、嘴角、呼吸、停顿等表演细节',
    '对白/字幕：（对口型）Speaker: short natural English line. 或 （画外）Speaker: line. 或 （空）',
    '光影：场景光线和角色脸部受光',
    '声音/剪辑：环境声、脚步声、衣料声、医疗仪器声或（空）',
    '道具：关键道具或（空）',
    '',
    '硬性要求：',
    '- SH 编号从 SH001 连续递增。',
    '- 时间码连续递增，格式 [mm:ss-mm:ss]。',
    '- 单个 SH 2-6 秒；后续 video generation 单分镜最长 15 秒，所以复杂动作必须拆开。',
    '- 生成 18-28 个 SH，覆盖完整故事因果，不要只写大纲。',
    '- 欧美医疗短剧质感，现代美国私立医院环境，英文环境标识，真实真人短剧质感。',
    '- 所有可见说话角色使用英文口型同步；不要中文字幕；不要背景音乐。',
    '- Ava、Dr. Grayson、Nurse Sarah、Dr. Carter 的身份、服装和气质必须前后一致。',
    '- 不要把道具写成商品卖点，不要出现 CTA。',
    '',
    '【故事】',
    story,
  ].join('\n')

  const shotScriptRaw = await callLLM([
    { role: 'system', content: '你是 NoriVideo 的剧本层导演，负责把故事生成结构化 SH 镜头稿。严格按用户给定格式输出。' },
    { role: 'user', content: shotPrompt },
  ], 0.35)
  const validation = validateShotScript(shotScriptRaw)
  await fs.writeFile(`${outDir}/generated-shot-script.txt`, validation.script)

  const videoBlocks = validation.blocks.map((block: any, index: number) => ({
    index: index + 1,
    range: `${block.shots[0].code}-${block.shots.at(-1).code}`,
    duration: block.durationSeconds,
    preview: block.text.slice(0, 500),
  }))
  await fs.writeFile(`${outDir}/video-prompt-blocks-preview.json`, JSON.stringify(videoBlocks, null, 2))
  await fs.writeFile(`${outDir}/validation.json`, JSON.stringify({
    errors: validation.errors,
    shotCount: validation.shots.length,
    blockCount: validation.blocks.length,
    maxBlockDuration: validation.blocks.length ? Math.max(...validation.blocks.map((block: any) => block.durationSeconds)) : 0,
    ranges: validation.blocks.map((block: any) => `${block.shots[0].code}-${block.shots.at(-1).code}`),
  }, null, 2))
  console.log(JSON.stringify({
    step: 'shot-script-generated',
    shotCount: validation.shots.length,
    blockCount: validation.blocks.length,
    maxBlockDuration: validation.blocks.length ? Math.max(...validation.blocks.map((block: any) => block.durationSeconds)) : 0,
    errorCount: validation.errors.length,
    firstErrors: validation.errors.slice(0, 8),
    firstShotScript: validation.script.slice(0, 900),
    firstVideoPromptPreview: validation.blocks[0]?.text.slice(0, 900),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
