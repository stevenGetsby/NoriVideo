import { apiHandler } from '@/lib/api-errors'
import { handleAssignmentPost } from '@/lib/collaboration/assignment-http'

export const POST = apiHandler((request) => handleAssignmentPost(request, 'reopen'))
