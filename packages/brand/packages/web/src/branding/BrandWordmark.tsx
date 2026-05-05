import React from 'react';

type BrandWordmarkProps = {
  src?: string;
  alt?: string;
  height?: number;
  className?: string;
  renderFallback?: () => React.ReactNode;
};

export function BrandWordmark({ src = '/brand/wordmark.png', alt = 'Meetropolis', height = 20, className, renderFallback }: BrandWordmarkProps) {
  const [hasError, setHasError] = React.useState(false);
  if (hasError) {
    return renderFallback ? <>{renderFallback()}</> : null;
  }
  return (
    <img
      src={src}
      alt={alt}
      height={height}
      className={className}
      style={{ display: 'inline-block', objectFit: 'contain' }}
      onError={() => setHasError(true)}
    />
  );
}

export default BrandWordmark;


