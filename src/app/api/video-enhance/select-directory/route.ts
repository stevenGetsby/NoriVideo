import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)
const DIRECTORY_PICKER_TIMEOUT_MS = 5 * 60 * 1000

class DirectorySelectionCancelled extends Error {
  constructor() {
    super('目录选择已取消')
    this.name = 'DirectorySelectionCancelled'
  }
}

function normalizeSelectedPath(stdout: string | Buffer): string {
  const directoryPath = stdout.toString('utf8').trim()
  if (!directoryPath) throw new DirectorySelectionCancelled()
  return directoryPath
}

function errorText(error: unknown): string {
  const value = error as { message?: unknown; stderr?: unknown; stdout?: unknown }
  return [value.message, value.stderr, value.stdout]
    .filter((item): item is string | Buffer => typeof item === 'string' || Buffer.isBuffer(item))
    .map((item) => item.toString())
    .join('\n')
}

function isCancelError(error: unknown): boolean {
  const value = error as { code?: unknown }
  const text = errorText(error).toLowerCase()
  return text.includes('user canceled')
    || text.includes('用户已取消')
    || text.includes('用户取消')
    || text.includes('directory_selection_cancelled')
    || text.includes('(-128)')
    || value.code === 2
}

async function runDirectoryCommand(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: DIRECTORY_PICKER_TIMEOUT_MS,
      windowsHide: false,
    })
    return normalizeSelectedPath(stdout)
  } catch (error) {
    if (isCancelError(error)) throw new DirectorySelectionCancelled()
    throw error
  }
}

async function selectMacDirectory(): Promise<string> {
  return await runDirectoryCommand('osascript', [
    '-e',
    'POSIX path of (choose folder with prompt "选择视频下载目录")',
  ])
}

async function selectWindowsDirectory(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择视频下载目录'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
} else {
  Write-Error 'DIRECTORY_SELECTION_CANCELLED'
  exit 2
}
`.trim()

  return await runDirectoryCommand('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
}

async function selectLinuxDirectory(): Promise<string> {
  const commands: Array<{ command: string; args: string[] }> = [
    { command: 'zenity', args: ['--file-selection', '--directory', '--title=选择视频下载目录'] },
    { command: 'kdialog', args: ['--getexistingdirectory', '.', '选择视频下载目录'] },
  ]
  const errors: string[] = []

  for (const item of commands) {
    try {
      return await runDirectoryCommand(item.command, item.args)
    } catch (error) {
      if (error instanceof DirectorySelectionCancelled) throw error
      errors.push(errorText(error))
    }
  }

  throw new ApiError('EXTERNAL_ERROR', {
    message: '当前 Linux 环境没有可用的系统目录选择器，请手动填写目录路径',
    errors: errors.filter(Boolean),
  })
}

async function selectDirectory(): Promise<string> {
  const configuredDirectory = process.env.VIDEO_ENHANCE_DEFAULT_DOWNLOAD_DIR?.trim()
  if (configuredDirectory) return configuredDirectory

  if (process.platform === 'darwin') return await selectMacDirectory()
  if (process.platform === 'win32') return await selectWindowsDirectory()
  if (process.platform === 'linux') return await selectLinuxDirectory()
  throw new ApiError('EXTERNAL_ERROR', { message: '当前系统不支持自动选择目录，请手动填写目录路径' })
}

export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  try {
    const directoryPath = await selectDirectory()
    return NextResponse.json({ success: true, selected: true, directoryPath })
  } catch (error) {
    if (error instanceof DirectorySelectionCancelled) {
      return NextResponse.json({ success: true, selected: false, directoryPath: null })
    }
    if (error instanceof ApiError) throw error
    throw new ApiError('EXTERNAL_ERROR', {
      message: error instanceof Error ? error.message : '打开系统目录选择器失败，请手动填写目录路径',
    })
  }
})
