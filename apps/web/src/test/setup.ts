import '@testing-library/jest-dom/vitest';

// Polyfill matchMedia for jsdom
if (typeof window !== 'undefined' && !('matchMedia' in window)) {
  // @ts-expect-error jsdom polyfill
  window.matchMedia = (query: string) => {
    const mql: MediaQueryList = {
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as any;
    return mql;
  };
}

// Minimal canvas 2D context stub for Phaser/device checks under jsdom.
if (typeof window !== 'undefined' && typeof window.HTMLCanvasElement !== 'undefined') {
  const proto = window.HTMLCanvasElement.prototype as any;
  const existingGetContext = proto.getContext;

  proto.getContext = function getContext(type: string) {
    if (type === '2d') {
      const data = new Uint8ClampedArray([255, 0, 0, 255]);
      return {
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data }),
        putImageData: () => {},
      } as any;
    }
    return existingGetContext ? existingGetContext.call(this, type) : null;
  };
}

