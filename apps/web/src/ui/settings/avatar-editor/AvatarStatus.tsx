/**
 * Statuszeile des Avatar-Editors. Reiner Props-Baustein: keine Zustände,
 * keine Effekte, kein Netzwerk — der Text kommt vom Hook und wird hier nur
 * ausgegeben.
 *
 * Die Region existiert immer, auch ohne Meldung: eine Live-Region muss vor der
 * Meldung im DOM stehen (ARIA22), sonst wird nichts angekündigt. Ohne Text
 * steht sie absolut, damit sie keinen zusätzlichen Abstand in der Spalte
 * erzeugt; versteckt wird sie nicht, weil ein verborgener Container aus dem
 * Accessibility-Baum fällt.
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
