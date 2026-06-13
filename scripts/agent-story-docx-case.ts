import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import {
  buildCompressedAgentPrompt,
  buildShortDramaVideoPromptText,
  buildVideoPromptBlocks,
} from '../src/lib/novel-promotion/short-drama-video-prompt'

const DEFAULT_DESKTOP = '/Users/headmasterx/Desktop'

function argValue(name: string, fallback: string): string {
  const prefix = `${name}=`
  const found = process.argv.find((item) => item.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraphXml(text: string): string {
  if (!text.trim()) {
    return '<w:p/>'
  }
  const isHeading = /^【.+】$/.test(text.trim()) || /^[-—]+/.test(text.trim())
  const size = isHeading ? '24' : '21'
  const bold = isHeading ? '<w:b/>' : ''
  return [
    '<w:p>',
    '<w:pPr>',
    '<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>',
    '</w:pPr>',
    '<w:r>',
    `<w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    '</w:r>',
    '</w:p>',
  ].join('')
}

async function writeDocx(paragraphs: string[], outputPath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '</Types>',
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/_rels/document.xml.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  ].join(''))
  zip.file('docProps/core.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:title>视频提示词</dc:title>',
    '<dc:creator>Nori Agent Workflow Test</dc:creator>',
    `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>`,
    '</cp:coreProperties>',
  ].join(''))
  zip.file('docProps/app.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    '<Application>Nori</Application>',
    '</Properties>',
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    ...paragraphs.map(paragraphXml),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
    '</w:body>',
    '</w:document>',
  ].join(''))

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  if (await pathExists(outputPath)) {
    await fs.chmod(outputPath, 0o644)
  }
  await fs.writeFile(outputPath, bytes)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const desktop = argValue('--desktop', DEFAULT_DESKTOP)
  const storyPath = argValue('--story', path.join(desktop, '故事.docx'))
  const outputPath = argValue('--out', path.join(desktop, '视频提示词.docx'))
  const promptPath = argValue('--prompt-out', path.join(desktop, '故事_agent_prompt.txt'))
  const backupPath = argValue('--backup', path.join(desktop, '视频提示词.参考备份.docx'))

  const extracted = await mammoth.extractRawText({ path: storyPath })
  const storyText = extracted.value.trim()
  if (!storyText) {
    throw new Error(`No text extracted from ${storyPath}`)
  }

  const prompt = buildCompressedAgentPrompt(storyText)
  const videoPromptText = buildShortDramaVideoPromptText(storyText)
  const blocks = buildVideoPromptBlocks(storyText)

  if (await pathExists(outputPath) && !(await pathExists(backupPath))) {
    await fs.copyFile(outputPath, backupPath)
  }

  await fs.writeFile(promptPath, prompt, 'utf8')
  await writeDocx(videoPromptText.split('\n'), outputPath)

  console.log(JSON.stringify({
    storyPath,
    promptPath,
    outputPath,
    backupPath: await pathExists(backupPath) ? backupPath : null,
    blockCount: blocks.length,
    totalShotCount: blocks.reduce((sum, block) => sum + block.shots.length, 0),
    firstBlock: blocks[0]?.text.split('\n')[0] || null,
    lastBlock: blocks[blocks.length - 1]?.text.split('\n')[0] || null,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
