import { loadWorkflowRuntime, getWorkflowSnapshot, getWorkflowStateLabel, getAllowedTransitions, normalizeWorkflowStateKey, normalizeCapabilityList, canUserExecuteTransition, resolveWorkflowActions } from '../../services/workflowService.js';

export async function hydrateWorkflowRuntimeSnapshot(api, options = {}) {
  return loadWorkflowRuntime(api, options);
}

export function createWorkflowRuntimeFacade() {
  return {
    hydrateWorkflowRuntimeSnapshot,
    getWorkflowSnapshot,
    getWorkflowStateLabel,
    getAllowedTransitions,
    normalizeWorkflowStateKey,
    normalizeCapabilityList,
    canUserExecuteTransition,
    resolveWorkflowActions,
  };
}
