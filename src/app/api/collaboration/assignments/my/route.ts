import { apiHandler } from '@/lib/api-errors'
import { handleAssignmentGet } from '@/lib/collaboration/assignment-http'

export const GET = apiHandler((request) => handleAssignmentGet(request, 'my'))
