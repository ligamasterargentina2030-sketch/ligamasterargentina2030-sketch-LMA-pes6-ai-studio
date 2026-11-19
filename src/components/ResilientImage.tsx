import { useState } from 'react';
import { Shield } from 'lucide-react';
import { resolveAssetUrl } from '../utils/assetUrl';

interface ResilientImageProps {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  fetchPriority?: 'high' | 'low' | 'auto';
}

export function ResilientImage({
  src,
  fallbackSrc,
  alt,
  className = '',
  fallbackLabel,
  fetchPriority = 'auto',
}: ResilientImageProps) {
  const [failedPrimary, setFailedPrimary] = useState(false);
  const [failedFallback, setFailedFallback] = useState(false);

  const resolvedSrc = resolveAssetUrl(src);
  const resolvedFallback = resolveAssetUrl(fallbackSrc);
  const activeSrc =
    !failedPrimary && resolvedSrc
      ? resolvedSrc
      : !failedFallback && resolvedFallback
      ? resolvedFallback
      : '';

  if (!activeSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#061B36] via-[#0B2D56] to-[#041224] text-sky-200 border border-amber-400/45 ${className}`}
        role="img"
        aria-label={alt}
      >
        <Shield className="w-7 h-7 opacity-85 text-amber-300" />
        {fallbackLabel && (
          <span className="mt-1 px-2 text-center text-xs font-medium tracking-wide text-white truncate max-w-full">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={activeSrc}
      alt={alt}
      decoding="async"
      fetchPriority={fetchPriority}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (!failedPrimary && src) {
          setFailedPrimary(true);
        } else {
          setFailedFallback(true);
        }
      }}
    />
  );
}
