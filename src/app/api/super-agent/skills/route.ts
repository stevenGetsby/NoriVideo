import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { skillLibrary } from '@/lib/super-agent/skill-parser'
import { assertInternalAgentApiEnabled } from '@/lib/super-agent/internal-api-guard'

export const GET = apiHandler(async () => {
  assertInternalAgentApiEnabled()

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  return Response.json({
    skills: skillLibrary.getAllSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords,
      defaultConfig: skill.defaultConfig,
    })),
  })
})
