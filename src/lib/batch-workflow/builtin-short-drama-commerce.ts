/**
 * Compatibility re-export shim for legacy imports.
 * All built-in 5-stage track templates and 14 pluggable skills live in `./builtin-presets`.
 */
export {
  BUILTIN_DRAMA_REMAKE_TEMPLATE,
  BUILTIN_FILM_STYLE_REMAKE_TEMPLATE,
  BUILTIN_SHORT_DRAMA_COMMERCE_TEMPLATE,
  BUILTIN_SKILL_ID_PREFIX,
  BUILTIN_TEMPLATE_ID_PREFIX,
  BUILTIN_WORKFLOW_SKILLS,
  BUILTIN_WORKFLOW_SKILLS as BUILTIN_SHORT_DRAMA_COMMERCE_SKILLS,
  BUILTIN_WORKFLOW_TEMPLATES,
  getBuiltinWorkflowSkillById,
  getBuiltinWorkflowSkillBySlug,
  getBuiltinWorkflowSkills,
  getBuiltinWorkflowTemplateById,
  getBuiltinWorkflowTemplates,
  isBuiltinSkillId,
  isBuiltinTemplateId,
} from './builtin-presets'
