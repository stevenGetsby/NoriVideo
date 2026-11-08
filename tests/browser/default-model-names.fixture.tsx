import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { DefaultModelCards } from '../../src/app/[locale]/profile/components/api-config-tab/DefaultModelCards'
import '../../src/styles/frameos-replica.css'

const models = [
  { modelKey: 'openlux::gpt-image-2.5-sunburst', modelId: 'gpt-image-2.5-sunburst', capabilities: { image: { resolutionOptions: ['1K', '2K'] } } },
  { modelKey: 'openlux::gpt-image-2.6-flare-c', modelId: 'gpt-image-2.6-flare-c', capabilities: { image: { resolutionOptions: ['1K', '2K'] } } },
  { modelKey: 'kuaizi::doubao-seedance-2-5-260628', modelId: 'doubao-seedance-2-5-260628', capabilities: { video: { durationOptions: [4, 8] } } },
  { modelKey: 'kuaizi::speech-2.8-hd', modelId: 'speech-2.8-hd', capabilities: { audio: {} } },
]
const defaults = {
  characterModel: 'openlux::gpt-image-2.5-sunburst',
  locationModel: 'openlux::gpt-image-2.5-sunburst',
  storyboardModel: 'openlux::gpt-image-2.5-sunburst',
  editModel: 'openlux::gpt-image-2.5-sunburst',
  videoModel: 'kuaizi::doubao-seedance-2-5-260628',
  audioModel: 'kuaizi::speech-2.8-hd',
}

function Fixture() {
  return <NextIntlClientProvider locale="zh" messages={{}}>
    <DefaultModelCards
      t={(key) => key}
      defaultModels={defaults}
      getEnabledModelsByType={(type) => models.filter((model) => model.modelKey.startsWith(type === 'video' || type === 'audio' ? 'kuaizi::' : 'openlux::'))}
      parseModelKey={(key) => {
        const [provider, modelId] = key?.split('::') || []
        return provider && modelId ? { provider, modelId } : null
      }}
      encodeModelKey={(provider, modelId) => `${provider}::${modelId}`}
      updateDefaultModel={() => {}}
      batchUpdateDefaultModels={() => {}}
      extractCapabilityFieldsFromModel={() => []}
      toCapabilityFieldLabel={(field) => field}
      capabilityDefaults={{}}
      updateCapabilityDefault={() => {}}
      parseBySample={(input) => input}
      workflowConcurrency={{ analysis: 1, image: 1, video: 1 }}
      handleWorkflowConcurrencyChange={() => {}}
    />
  </NextIntlClientProvider>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
