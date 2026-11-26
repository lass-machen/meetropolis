import { useEffect, useState } from 'react';
import { MemberAssetError, acquireMemberAsset } from '../lib/memberAssets';

export type MemberAssetStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MemberAssetState {
  src: string | null;
  status: MemberAssetStatus;
  errorStatus: number | null;
}

// Load a protected member asset for <img> usage. The blob URL is published
// only after acquire succeeds, never the raw stored ref. Switching the ref
// or unmounting aborts the pending request and releases the handle; a late
// result after abort is released immediately and never rendered.
export function useMemberAsset(ref: string | null | undefined): MemberAssetState {
  const [state, setState] = useState<MemberAssetState>(() => ({
    src: null,
    status: ref ? 'loading' : 'idle',
    errorStatus: null,
  }));

  useEffect(() => {
    if (!ref) {
      setState({ src: null, status: 'idle', errorStatus: null });
      return;
    }
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | null = null;
    setState({ src: null, status: 'loading', errorStatus: null });
    acquireMemberAsset(ref, { signal: controller.signal }).then(
      (handle) => {
        if (!active) {
          handle.release();
          return;
        }
        release = handle.release;
        setState({ src: handle.url, status: 'ready', errorStatus: null });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          src: null,
          status: 'error',
          errorStatus: error instanceof MemberAssetError ? error.status : 0,
        });
      },
    );
    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, [ref]);

  return state;
}
