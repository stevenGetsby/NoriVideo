import { NextResponse } from 'next/server'
import { readSystemStatusSnapshot } from '@/lib/system/status'

export async function GET() {
  return NextResponse.json(await readSystemStatusSnapshot())
}
