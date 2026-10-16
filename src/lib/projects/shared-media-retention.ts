import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// The registry itself is not a use of a file. Durable media references live in
// the project's/global assets, material index, canvas JSON and saved workflows.
const MEDIA_FIELD_PATTERN = /(?:url|mediaid|storagekey|document|references|history|images|videos|audios|nodes|params|^data$|^metadata$|speakervoices)/i

function identifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid schema identifier')
  return Prisma.raw(`\`${value}\``)
}

function pattern(value: string) {
  return `%${value.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`
}

/** Never remove an object that survives as a cross-project/global reference. */
export async function unreferencedProjectStorageKeys(projectId: string, keys: readonly string[]) {
  const uniqueKeys = [...new Set(keys)]
  if (!uniqueKeys.length) return []
  const media = await prisma.mediaObject.findMany({
    where: { storageKey: { in: uniqueKeys } },
    select: { storageKey: true, publicId: true, id: true },
  })
  const aliases = new Map(uniqueKeys.map((key) => [key, [key]]))
  for (const item of media) aliases.get(item.storageKey)?.push(`/m/${item.publicId}`, item.id)
  const tables = Prisma.dmmf.datamodel.models.filter((model) => model.name !== 'MediaObject').flatMap((model) => {
    const fields = model.fields.filter((field) => field.kind !== 'object'
      && (field.type === 'String' || field.type === 'Json') && MEDIA_FIELD_PATTERN.test(field.name))
    return fields.length ? [{ model, fields }] : []
  })
  const safe: string[] = []
  for (const key of uniqueKeys) {
    let referenced = false
    for (const { model, fields } of tables) {
      const predicates = fields.flatMap((field) => aliases.get(key)!.map((alias) =>
        Prisma.sql`CAST(${identifier(field.dbName || field.name)} AS CHAR) LIKE ${pattern(alias)} ESCAPE '!'`))
      const projectField = model.fields.find((field) => field.name === 'projectId' && field.kind !== 'object')
      const outsidePurgedProject = projectField
        ? Prisma.sql`NOT (${identifier(projectField.dbName || projectField.name)} <=> ${projectId}) AND`
        : Prisma.empty
      const rows = await prisma.$queryRaw<Array<{ retained: number }>>(Prisma.sql`
        SELECT 1 AS retained FROM ${identifier(model.dbName || model.name)}
        WHERE ${outsidePurgedProject} (${Prisma.join(predicates, ' OR ')}) LIMIT 1
      `)
      if (rows.length) { referenced = true; break }
    }
    if (!referenced) safe.push(key)
  }
  return safe
}
