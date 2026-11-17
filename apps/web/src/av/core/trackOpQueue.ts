/**
 * Serialize async track operations on a shared promise chain so rapid toggles
 * cannot interleave and lose state.
 */
export function enqueueTrackOp(chain: Promise<void>, task: () => Promise<void>): Promise<void> {
  return chain.catch(() => {}).then(task);
}
