import { setup } from '@rivet-dev/agentos';
import { isLocalDev } from './env.ts';
import { user } from './user/index.ts';
import { vm } from './vm.ts';
import { specPlan } from './spec-plan/index.ts';
import { specPlanRun } from './spec-plan-run/index.ts';
import { specPlanWorker } from './spec-plan-worker/index.ts';

export const registry = setup({
	use: { user, vm, specPlan, specPlanRun, specPlanWorker },
	startEngine: isLocalDev() ? true : undefined
});

export type Registry = typeof registry;
