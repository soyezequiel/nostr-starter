'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';

type SkeletonImageProps = Omit<ImageProps, 'fill'> & {
  containerClassName?: string;
};

export default function SkeletonImage({
  alt,
  className,
  containerClassName,
  onLoad,
  sizes,
  ...props
}: SkeletonImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={['lc-img-skeleton relative w-full h-full', containerClassName].filter(Boolean).join(' ')}>
      <Image
        {...props}
        alt={alt}
        fill
        sizes={sizes}
        unoptimized
        className={[className, loaded ? 'loaded' : ''].filter(Boolean).join(' ')}
        onLoad={(event) => {
          setLoaded(true);
          onLoad?.(event);
        }}
      />
    </div>
  );
}
