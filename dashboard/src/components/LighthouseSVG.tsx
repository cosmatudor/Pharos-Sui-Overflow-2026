export default function LighthouseSVG() {
  return (
    <svg
      viewBox="0 0 80 180"
      width={72}
      height={162}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", margin: "0 auto" }}
    >
      <defs>
        <linearGradient id="ph-tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#4da2ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#1a3e7a" stopOpacity="0.98" />
        </linearGradient>
        <linearGradient id="ph-lantern" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#c8e8ff" stopOpacity="1" />
          <stop offset="100%" stopColor="#4da2ff" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="ph-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="1" />
          <stop offset="30%"  stopColor="#90ccff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#4da2ff" stopOpacity="0" />
        </radialGradient>
        <filter id="ph-blur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="ph-blur-sm" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      {/* ── Base platform ── */}
      <rect x="4"  y="163" width="72" height="14" rx="4" fill="#0d2044" opacity="0.95" />
      <rect x="10" y="164" width="60" height="1"  rx="0.5" fill="#4da2ff" opacity="0.3" />

      {/* ── Tower body — tapered trapezoid ── */}
      <path d="M26 163 L33 82 L47 82 L54 163Z" fill="url(#ph-tower)" />

      {/* Tower accent bands */}
      <path d="M27.5 148 L28.5 138 L51.5 138 L52.5 148Z" fill="rgba(77,162,255,0.12)" />
      <path d="M29  128 L30  118 L50  118 L51  128Z" fill="rgba(77,162,255,0.10)" />
      <path d="M30.5 108 L31.5 98  L48.5 98  L49.5 108Z" fill="rgba(77,162,255,0.08)" />

      {/* Tower windows */}
      <rect x="36" y="130" width="8" height="11" rx="1.5" fill="rgba(160,220,255,0.45)" />
      <rect x="36" y="105" width="8" height="9"  rx="1.5" fill="rgba(160,220,255,0.30)" />

      {/* ── Gallery railing ── */}
      <rect x="29" y="78" width="22" height="4" rx="2" fill="#4da2ff" opacity="0.9" />
      {/* railing posts */}
      <rect x="31" y="74" width="1.5" height="4" rx="0.75" fill="#4da2ff" opacity="0.6" />
      <rect x="36" y="74" width="1.5" height="4" rx="0.75" fill="#4da2ff" opacity="0.6" />
      <rect x="41" y="74" width="1.5" height="4" rx="0.75" fill="#4da2ff" opacity="0.6" />
      <rect x="46" y="74" width="1.5" height="4" rx="0.75" fill="#4da2ff" opacity="0.6" />

      {/* ── Lantern room ── */}
      <rect x="30" y="52" width="20" height="26" rx="2.5" fill="url(#ph-lantern)" opacity="0.92" />
      {/* Lantern glass panes */}
      <line x1="40" y1="52" x2="40" y2="78" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      <line x1="30" y1="65" x2="50" y2="65" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />

      {/* ── Dome cap ── */}
      <path d="M28 52 L40 36 L52 52Z" fill="#4da2ff" opacity="0.95" />
      {/* Cap tip accent */}
      <circle cx="40" cy="35" r="2" fill="#c8e8ff" opacity="0.9" />

      {/* ── Glow halo behind lantern — animated ── */}
      <circle cx="40" cy="52" r="22" fill="url(#ph-glow)" filter="url(#ph-blur)" opacity="0.55">
        <animate attributeName="opacity" values="0.35;0.65;0.35" dur="3s" repeatCount="indefinite" />
        <animate attributeName="r"       values="18;26;18"       dur="3s" repeatCount="indefinite" />
      </circle>

      {/* ── Inner glow ── */}
      <circle cx="40" cy="52" r="8" fill="rgba(200,235,255,0.6)" filter="url(#ph-blur-sm)">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* ── Lantern core ── */}
      <circle cx="40" cy="52" r="4" fill="white" opacity="0.95">
        <animate attributeName="r"       values="3;5;3"       dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;1;0.85" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}