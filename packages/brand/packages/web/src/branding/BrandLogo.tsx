import React from 'react';

type BrandLogoProps = {
  src?: string;
  alt?: string;
  size?: number;
  className?: string;
};

export function BrandLogo({ src = '/brand/logo.png', alt = 'Logo', size = 32, className }: BrandLogoProps) {
  const [hasError, setHasError] = React.useState(false);
  if (hasError) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', objectFit: 'contain' }}
      onError={() => setHasError(true)}
    />
  );
}

export default BrandLogo;


