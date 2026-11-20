import { acquireMemberAsset } from './memberAssets';

export interface MemberImageResult {
  image: HTMLImageElement;
  release: () => void;
}

export interface MemberImageOptions {
  signal?: AbortSignal;
  crossOrigin?: string | null;
}

// Load a protected member asset into an <img>-ready element. The caller owns
// the handle: resolve keeps it alive (canvas may still draw the image),
// reject releases it because nothing can use the URL then.
export async function loadMemberImageElement(ref: string, opts?: MemberImageOptions): Promise<MemberImageResult> {
  const { url, release } = await acquireMemberAsset(ref, opts?.signal ? { signal: opts.signal } : undefined);
  return new Promise<MemberImageResult>((resolve, reject) => {
    const image = new Image();
    if (opts?.crossOrigin !== undefined) image.crossOrigin = opts.crossOrigin;
    image.onload = () => resolve({ image, release });
    image.onerror = () => {
      release();
      reject(new Error(`Member image failed to load: ${ref}`));
    };
    image.src = url;
  });
}
