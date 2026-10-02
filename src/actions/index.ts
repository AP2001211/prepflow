import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createInterview } from './prep-actions'
import { planningActions } from './planning-actions'

export const actions: Record<string, ActionHandler<Env>> = { createInterview, ...planningActions }
