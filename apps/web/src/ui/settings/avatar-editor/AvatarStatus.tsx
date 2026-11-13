/**
 * Status line of the avatar editor. Pure props component: no states,
 * no effects, no network: the text comes from the hook and is only
 * ausgegeben.
 *
 * The region always exists, even without a message: a live region must come before the
 * be in the DOM before a message, otherwise nothing is announced. Without text
 * it is positioned absolutely so it adds no extra spacing in the column
 * creates it; it is not hidden, because a hidden container drops out of the
 * accessibility tree.
 */
export function AvatarStatus({ status }: { status: string | null }) {
  const hasText = typeof status === 'string' && status.trim().length > 0;
  return (
    <p
      className="av-ed__status"
      role="status"
      aria-atomic="true"
      style={hasText ? undefined : { position: 'absolute' }}
    >
      {hasText ? status : null}
    </p>
  );
}

export default AvatarStatus;
