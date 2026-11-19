import { useId } from 'react';
import { ResilientImage } from './ResilientImage';

interface AfaLaurelFrameProps {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  fallbackLabel?: string;
  size?: 'hero' | 'intro';
}

interface LeafNode {
  deg: number;
  scale: number;
  tiltOuter: number;
  tiltInner: number;
  berry?: boolean;
}

const REALISTIC_LEAVES: LeafNode[] = [
  { deg: 106, scale: 0.78, tiltOuter: -24, tiltInner: 30 },
  { deg: 120, scale: 0.92, tiltOuter: -20, tiltInner: 26, berry: true },
  { deg: 134, scale: 1.0, tiltOuter: -18, tiltInner: 24 },
  { deg: 148, scale: 1.04, tiltOuter: -16, tiltInner: 22 },
  { deg: 162, scale: 1.06, tiltOuter: -15, tiltInner: 21, berry: true },
  { deg: 176, scale: 1.04, tiltOuter: -15, tiltInner: 21 },
  { deg: 190, scale: 1.0, tiltOuter: -16, tiltInner: 22 },
  { deg: 204, scale: 0.96, tiltOuter: -17, tiltInner: 23, berry: true },
  { deg: 218, scale: 0.9, tiltOuter: -19, tiltInner: 24 },
  { deg: 232, scale: 0.84, tiltOuter: -21, tiltInner: 26 },
  { deg: 246, scale: 0.76, tiltOuter: -22, tiltInner: 27, berry: true },
  { deg: 259, scale: 0.66, tiltOuter: -18, tiltInner: 24 },
];

/**
 * Hoja de laurel botánica realista con forma lanceolada, nervadura central y venas laterales.
 */
function RealisticLeaf({
  fillId,
  flip = false,
  rotate = 0,
  scale = 1,
}: {
  fillId: string;
  flip?: boolean;
  rotate?: number;
  scale?: number;
}) {
  const sx = flip ? -scale : scale;
  return (
    <g transform={`rotate(${rotate}) scale(${sx.toFixed(2)}, ${scale.toFixed(2)})`}>
      {/* Pecíolo / tallito */}
      <path d="M 0 0 Q 2 -2 4 -4" stroke="#14532d" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* Silueta orgánica de hoja de laurel real con borde suavemente curvado y punta afilada */}
      <path
        d="M 3 -3 C 7 -11, 16 -18, 25 -17 C 21 -9, 15 -2, 6 0 C 4.5 0.3, 3.3 -1.2, 3 -3 Z"
        fill={`url(#${fillId})`}
        stroke="#052e16"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      {/* Brillo superior de la hoja */}
      <path
        d="M 5 -4 C 9 -10, 15 -14.5, 22 -15 C 17 -11, 12 -7, 6 -3.5 Z"
        fill="#bbf7d0"
        fillOpacity="0.22"
      />
      {/* Nervadura central curva */}
      <path
        d="M 3.5 -3 Q 13 -10.5 23.5 -16"
        fill="none"
        stroke="#dcfce7"
        strokeWidth="0.85"
        strokeOpacity="0.78"
        strokeLinecap="round"
      />
      {/* Venas laterales finas para aspecto botánico real */}
      <path
        d="M 8 -6.5 L 10 -11.5 M 12.5 -9.5 L 15 -14 M 17 -12.5 L 19.5 -15.2 M 9.5 -6.5 L 13.5 -5.8 M 14 -9.5 L 17.5 -9.2"
        fill="none"
        stroke="#bbf7d0"
        strokeWidth="0.48"
        strokeOpacity="0.58"
        strokeLinecap="round"
      />
    </g>
  );
}

function LaurelBranch({
  uid,
  mirrored = false,
}: {
  uid: string;
  mirrored?: boolean;
}) {
  return (
    <g transform={mirrored ? 'translate(240,0) scale(-1,1)' : undefined}>
      {/* Tallo principal orgánico ahusado */}
      <path
        d="M 116 213 C 54 203, 18 158, 21 104 C 24 56, 56 24, 104 17"
        fill="none"
        stroke={`url(#${uid}-stem)`}
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* Enredadera fina entrelazada */}
      <path
        d="M 113 209 C 60 194, 26 152, 27 104 C 28 60, 58 30, 102 22"
        fill="none"
        stroke="#4ade80"
        strokeWidth="1.2"
        strokeOpacity="0.65"
        strokeLinecap="round"
      />

      {/* Pares de hojas reales escalonadas a lo largo de la rama */}
      {REALISTIC_LEAVES.map((node, idx) => {
        const rad = (node.deg * Math.PI) / 180;
        const radius = 98;
        const cx = 120 + Math.cos(rad) * radius;
        const cy = 120 + Math.sin(rad) * radius;
        const tangentDeg = node.deg + 90;

        return (
          <g
            key={node.deg}
            transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) rotate(${tangentDeg.toFixed(1)})`}
          >
            {/* Hoja exterior más grande */}
            <RealisticLeaf
              fillId={idx % 2 === 0 ? `${uid}-leaf-light` : `${uid}-leaf-mid`}
              rotate={node.tiltOuter}
              scale={node.scale}
            />
            {/* Hoja interior complementaria */}
            <RealisticLeaf
              fillId={idx % 2 === 0 ? `${uid}-leaf-dark` : `${uid}-leaf-light`}
              flip
              rotate={node.tiltInner}
              scale={node.scale * 0.86}
            />
            {/* Hojita superpuesta de brote para dar volumen natural */}
            {idx % 2 === 1 && (
              <RealisticLeaf
                fillId={`${uid}-leaf-tip`}
                rotate={node.tiltOuter + 14}
                scale={node.scale * 0.58}
              />
            )}
            {/* Pequeñas bayas de laurel / olivo */}
            {node.berry && (
              <g>
                <circle cx="2" cy="-2" r="2.6" fill={`url(#${uid}-berry)`} stroke="#14532d" strokeWidth="0.65" />
                <circle cx="1.2" cy="-2.8" r="0.8" fill="#fef9c3" fillOpacity="0.85" />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Marco circular con hojas de laurel botánicas realistas estilo AFA,
 * fondo transparente y borde luminoso alrededor del escudo que cambia de color suavemente.
 */
export function AfaLaurelFrame({
  src,
  fallbackSrc,
  alt,
  fallbackLabel = 'LMA PES6',
  size = 'hero',
}: AfaLaurelFrameProps) {
  const uid = useId().replace(/:/g, '');

  const outerClass =
    size === 'intro'
      ? 'relative w-64 h-64 sm:w-76 sm:h-76 shrink-0 flex items-center justify-center bg-transparent'
      : 'relative w-44 h-44 sm:w-52 sm:h-52 lg:w-56 lg:h-56 shrink-0 flex items-center justify-center bg-transparent';

  const ringWrapperClass =
    size === 'intro'
      ? 'relative w-44 h-44 sm:w-52 sm:h-52 rounded-full p-[4px] flex items-center justify-center bg-transparent'
      : 'relative w-30 h-30 sm:w-36 sm:h-36 lg:w-40 lg:h-40 rounded-full p-[4px] flex items-center justify-center bg-transparent';

  return (
    <div className={outerClass}>
      {/* Corona de hojas de laurel botánicas realistas */}
      <svg
        viewBox="0 0 240 240"
        className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-[0_8px_16px_rgba(0,0,0,0.85)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}-stem`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14532d" />
            <stop offset="50%" stopColor="#15803d" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          <linearGradient id={`${uid}-leaf-light`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14532d" />
            <stop offset="45%" stopColor="#16a34a" />
            <stop offset="82%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#bbf7d0" />
          </linearGradient>
          <linearGradient id={`${uid}-leaf-mid`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#052e16" />
            <stop offset="48%" stopColor="#15803d" />
            <stop offset="88%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#86efac" />
          </linearGradient>
          <linearGradient id={`${uid}-leaf-dark`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#052e16" />
            <stop offset="55%" stopColor="#166534" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id={`${uid}-leaf-tip`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#16a34a" />
            <stop offset="60%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#dcfce7" />
          </linearGradient>
          <radialGradient id={`${uid}-berry`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="55%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#854d0e" />
          </radialGradient>
          <linearGradient id={`${uid}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef9c3" />
            <stop offset="50%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>

        <LaurelBranch uid={uid} />
        <LaurelBranch uid={uid} mirrored />

        {/* Estrella superior dorada entre las ramas */}
        <polygon
          points="120,6 123.1,13 130.7,13.7 125,18.7 126.7,26.2 120,22.2 113.3,26.2 115,18.7 109.3,13.7 116.9,13"
          fill={`url(#${uid}-gold)`}
          stroke="#422006"
          strokeWidth="0.9"
        />

        {/* Lazo / nudo dorado inferior uniendo las dos ramas */}
        <path
          d="M 103 212 Q 120 223 137 212 L 133 224 Q 120 231 107 224 Z"
          fill={`url(#${uid}-gold)`}
          stroke="#422006"
          strokeWidth="1"
        />
        <circle cx="120" cy="214" r="4.8" fill="#fef08a" stroke="#78350f" strokeWidth="1" />
      </svg>

      {/* Borde giratorio multicolor + anillo luminoso que cambia de color suavemente */}
      <div className={ringWrapperClass}>
        <div
          className="absolute inset-0 rounded-full crest-ring-spin crest-border-0 opacity-95"
          aria-hidden="true"
        />
        <div className="relative z-10 w-full h-full rounded-full overflow-hidden bg-transparent lma-crest-color-ring">
          <ResilientImage
            src={src}
            fallbackSrc={fallbackSrc}
            alt={alt}
            className="w-full h-full object-cover"
            fallbackLabel={fallbackLabel}
          />
        </div>
      </div>
    </div>
  );
}
