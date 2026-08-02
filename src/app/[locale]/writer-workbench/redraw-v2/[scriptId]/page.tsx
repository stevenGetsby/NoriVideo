import { FosVideoRepaintClient } from '@/components/frameos/FosVideoRepaintClient'

interface WriterRedrawV2PageProps {
  params: Promise<{
    locale: string
    scriptId: string
  }>
}

export default async function WriterRedrawV2Page({ params }: WriterRedrawV2PageProps) {
  const { scriptId } = await params
  return <FosVideoRepaintClient scriptId={scriptId} />
}
