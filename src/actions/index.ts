import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createInterview } from './prep-actions'
import { acceptPrepPlan } from './planner-acceptance'
import { createPrepPlan, updatePrepPlan } from './prep-plan-actions'
import { planningActions } from './planning-actions'

export const actions: Record<string, ActionHandler<Env>> = { createInterview, createPrepPlan, updatePrepPlan, ...planningActions, acceptPrepPlan }
