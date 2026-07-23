// Bounds a publish operation (getUserMedia + SDP) so a stuck signal or an
// unanswered device-permission prompt cannot leave it pending forever. Shared by
// the microphone and camera publish paths so both clear their in-flight state on
// the same contract. On timeout the op is abandoned (rejected); a track that
// resolves after the deadline is not tracked — matching the pre-existing mic
// behavior. Callers rethrow so the UI/publishing flag reacts.
export async function withPublishTimeout<T>(op: Promise<T>, timeoutMs: number): Promise<T> {
  const TIMEOUT_SENTINEL = Symbol('publish_timeout');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  try {
    const result = await Promise.race([op, timeoutPromise]);
    if (result === TIMEOUT_SENTINEL) {
      throw new Error('publish_timeout');
    }
    return result;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
