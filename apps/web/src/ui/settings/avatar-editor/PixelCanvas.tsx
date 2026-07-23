import React from 'react';

/**
 * Draws one composed RGBA frame at its native size and lets CSS scale it up
 * pixel-crisp. Shared by the live preview and the sprite tiles so there is a
 * single place that knows how a composed frame reaches a canvas.
 */
export function PixelCanvas({
  frame,
  width,
  height,
  className,
}: {
  frame: Uint8ClampedArray | null;
  width: number;
  height: number;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    if (frame === null) return; // unrenderable config: the caller disables the option
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(frame);
    ctx.putImageData(imageData, 0, 0);
  }, [frame, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} />;
}

export default PixelCanvas;
