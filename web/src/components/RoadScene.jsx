export default function RoadScene() {
  return (
    <svg
      className="scene"
      viewBox="0 0 480 400"
      role="img"
      aria-label="A gyroscope trace with a sharp spike, linked to a pothole marked on a road below it"
    >
      <text x="24" y="36" className="scene__label">GYRO Z / 50 HZ</text>
      <text x="456" y="36" textAnchor="end" className="scene__label">LIVE FROM PHONE</text>

      <rect x="262" y="52" width="76" height="120" rx="6" fill="#FBF3DB" />
      <line x1="24" y1="112" x2="456" y2="112" stroke="#EAEAEA" strokeWidth="1" />
      <polyline
        fill="none"
        stroke="#111111"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points="24,112 44,108 64,115 84,110 104,114 124,109 144,113 164,111 184,115 204,110 224,112 244,108 262,112 274,112 284,64 294,164 304,78 314,146 324,100 338,113 358,110 378,114 398,109 418,113 438,111 456,112"
      />
      <text x="300" y="192" textAnchor="middle" className="scene__label scene__label--amber">
        SPIKE
      </text>

      <line x1="300" y1="200" x2="300" y2="292" stroke="#956400" strokeWidth="1.5" strokeDasharray="3 5" />

      <rect x="0" y="240" width="480" height="140" rx="10" fill="#111111" />
      <line x1="0" y1="310" x2="196" y2="310" stroke="#F2B705" strokeWidth="4" strokeDasharray="26 22" />
      <line x1="404" y1="310" x2="480" y2="310" stroke="#F2B705" strokeWidth="4" strokeDasharray="26 22" />
      <ellipse cx="300" cy="316" rx="46" ry="22" fill="#2a2a2a" />
      <ellipse cx="300" cy="319" rx="34" ry="14" fill="#000000" />

      <g transform="translate(300 268)">
        <path d="M0 0 C-11 -13 -14 -20 -14 -27 a14 14 0 1 1 28 0 C14 -20 11 -13 0 0Z" fill="#F2B705" />
        <circle cx="0" cy="-27" r="5" fill="#111111" />
      </g>

      <text x="24" y="366" className="scene__label scene__label--light">N CLARK ST, CHICAGO</text>
    </svg>
  )
}
