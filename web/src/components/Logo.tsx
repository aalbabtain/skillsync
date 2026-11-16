export default function Logo({ animated = false }: { animated?: boolean }) {
  return (
    <span className={animated ? "logo logo-animated" : "logo"} dir="ltr">
      <svg
        width="32"
        height="32"
        viewBox="0 0 64 64"
        fill="none"
        stroke="#ECEEF2"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 47 L27 31 L41 39 L53 17" pathLength={1} className="logo-line" />
        <circle className="logo-node" cx="13" cy="47" r="5" fill="#0F1115" />
        <circle className="logo-node" cx="27" cy="31" r="5" fill="#0F1115" />
        <circle className="logo-node" cx="41" cy="39" r="5" fill="#0F1115" />
        <circle className="logo-dot" cx="53" cy="17" r="7" fill="#8DA2FB" stroke="#8DA2FB" strokeWidth={2} />
      </svg>
      <span className="logo-word">
        <span className="logo-skill">Skill</span>
        <span className="logo-sync">Sync</span>
      </span>
    </span>
  );
}
