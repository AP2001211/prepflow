import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createInterview, startPrepSession } from './prep-actions'

export const actions: Record<string, ActionHandler<Env>> = { createInterview, startPrepSession }
