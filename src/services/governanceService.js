export async function loadGovernanceProjection() {
  return {
    systemUser: null,
    capabilities: [],
    workflowTransitions: [],
    workflowStates: [],
    loaded: true,
    loading: false,
    failed: false,
  };
}
