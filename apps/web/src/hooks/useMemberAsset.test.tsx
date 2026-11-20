import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { acquireMemberAsset, MemberAssetError } from '../lib/memberAssets';
import { useMemberAsset } from './useMemberAsset';

vi.mock('../lib/memberAssets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/memberAssets')>()),
  acquireMemberAsset: vi.fn(),
}));

const acquireMock = vi.mocked(acquireMemberAsset);

function Probe({ assetRef }: { assetRef: string | null | undefined }) {
  const { src, status, errorStatus } = useMemberAsset(assetRef);
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="src">{src ?? 'none'}</span>
      <span data-testid="error">{errorStatus === null ? 'none' : String(errorStatus)}</span>
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Handle = { url: string; release: () => void };

const seen: Array<{ ref: string; signal: AbortSignal | undefined }> = [];
const pendingByRef = new Map<string, ReturnType<typeof deferred<Handle>>>();

beforeEach(() => {
  acquireMock.mockReset();
  seen.length = 0;
  pendingByRef.clear();
  acquireMock.mockImplementation((ref: string, opts?: { signal?: AbortSignal }) => {
    seen.push({ ref, signal: opts?.signal });
    const pending = deferred<Handle>();
    pendingByRef.set(ref, pending);
    opts?.signal?.addEventListener('abort', () => pending.reject(new MemberAssetError(0, 'aborted')));
    return pending.promise;
  });
});

async function resolveRef(ref: string, url: string): Promise<() => void> {
  const release = vi.fn();
  const pending = pendingByRef.get(ref);
  await act(async () => {
    pending?.resolve({ url, release });
    await pending?.promise;
  });
  return release;
}

describe('useMemberAsset', () => {
  it('publishes the blob URL only after success', async () => {
    render(<Probe assetRef="/packs/a.png" />);
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('src')).toHaveTextContent('none');
    expect(screen.queryByText('/packs/a.png')).toBeNull();
    await resolveRef('/packs/a.png', 'blob:a');
    await waitFor(() => expect(screen.getByTestId('src')).toHaveTextContent('blob:a'));
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('releases on unmount', async () => {
    const { unmount } = render(<Probe assetRef="/packs/a.png" />);
    const release = await resolveRef('/packs/a.png', 'blob:a');
    await waitFor(() => expect(screen.getByTestId('src')).toHaveTextContent('blob:a'));
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('aborts the previous request when the ref changes', async () => {
    const { rerender } = render(<Probe assetRef="/packs/a.png" />);
    rerender(<Probe assetRef="/packs/b.png" />);
    expect(seen).toHaveLength(2);
    expect(seen[0].signal?.aborted).toBe(true);
    const releaseB = await resolveRef('/packs/b.png', 'blob:b');
    expect(releaseB).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('src')).toHaveTextContent('blob:b'));
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
  });

  it('shows the error status', async () => {
    render(<Probe assetRef="/packs/a.png" />);
    const pending = pendingByRef.get('/packs/a.png');
    await act(async () => {
      pending?.reject(new MemberAssetError(403, 'forbidden'));
      await pending?.promise.catch(() => {});
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('src')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('403');
  });

  it('stays idle without a ref', () => {
    render(<Probe assetRef={null} />);
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('src')).toHaveTextContent('none');
    expect(acquireMock).not.toHaveBeenCalled();
  });
});
