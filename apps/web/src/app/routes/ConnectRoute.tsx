import * as React from 'react';
import { getEnterpriseWebModule } from '../../lib/enterpriseWebLoader';
import type { AgentConnectPageProps } from '../../lib/enterpriseWebLoader';
import { WorldScreen } from './WorldScreen';

function requireLogin(): void {
  window.location.hash = '#/login?next=' + encodeURIComponent(window.location.hash);
}

/** Full-page `#/connect` slot. Reachable without a session. */
export function ConnectRoute({ requestId }: { requestId: string | null }): React.ReactElement {
  const [Page, setPage] = React.useState<React.ComponentType<AgentConnectPageProps> | null | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    void getEnterpriseWebModule().then((mod) => {
      if (active) setPage(() => mod?.AgentConnectPage ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (Page === undefined) {
    return <div style={{ padding: 40 }}>Loading…</div>;
  }
  if (Page === null) {
    return <WorldScreen />;
  }
  return <Page requestId={requestId} onRequireLogin={requireLogin} />;
}
