// Hiasan HUD "inti orbit" untuk panel kiri halaman login (hanya tampil di gaya Cyber; di Neo disembunyikan lewat CSS).
// Seluruhnya SVG: dial berskala, cincin orbit miring dengan simpul, sapuan radar, bidik, dan teks pembacaan. Warna dari --cy dan --mg.
export function HudOrbit() {
  return (
    <svg className="hud-orbit" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hud-sapu" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* dial luar: garis skala halus dan tanda besar tiap 30° */}
      <g className="hud-dial" fill="none" stroke="currentColor">
        <circle cx="200" cy="200" r="192" strokeWidth="1" opacity="0.55" />
        <circle cx="200" cy="200" r="184" strokeWidth="8" strokeDasharray="1.5 7.6" opacity="0.5" />
        <circle cx="200" cy="200" r="184" strokeWidth="14" strokeDasharray="2 94.6" />
      </g>

      {/* cincin tengah berbusur putus, berputar berlawanan */}
      <g className="hud-balik" fill="none" stroke="currentColor">
        <circle cx="200" cy="200" r="150" strokeWidth="3" strokeDasharray="150 40 70 40 90 40" opacity="0.8" />
        <circle cx="200" cy="200" r="142" strokeWidth="1" opacity="0.4" />
      </g>

      {/* dua orbit miring dengan simpul yang mengelilingi */}
      <g transform="translate(200 200) rotate(-24) scale(1 0.36)">
        <g className="hud-putar">
          <circle r="172" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 7" opacity="0.7" />
          <rect x="164" y="-7" width="14" height="14" className="hud-simpul" />
          <rect x="-178" y="-4" width="8" height="8" fill="currentColor" />
        </g>
      </g>
      <g transform="translate(200 200) rotate(28) scale(1 0.36)">
        <g className="hud-putar hud-lambat">
          <circle r="150" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 6" opacity="0.55" />
          <rect x="-157" y="-7" width="14" height="14" className="hud-simpul" />
        </g>
      </g>

      {/* sapuan radar dan titik sasaran */}
      <g className="hud-radar">
        <path d="M200 200 L200 52 A148 148 0 0 1 340 152 Z" fill="url(#hud-sapu)" />
        <line x1="200" y1="200" x2="200" y2="52" stroke="currentColor" strokeWidth="1.5" />
      </g>
      <g className="hud-blip" fill="var(--mg)">
        <rect x="262" y="126" width="7" height="7" />
        <rect x="140" y="248" width="7" height="7" />
        <rect x="288" y="232" width="7" height="7" />
        <rect x="176" y="114" width="7" height="7" />
      </g>

      {/* bidik dan inti di tengah */}
      <g stroke="currentColor" fill="none" strokeWidth="1.5">
        <path d="M200 24v34M200 342v34M24 200h34M342 200h34" />
        <path d="M200 176v16M200 208v16M176 200h16M208 200h16" />
        <circle className="hud-nucleo" cx="200" cy="200" r="26" />
        <rect x="193" y="193" width="14" height="14" fill="var(--mg)" stroke="none" />
      </g>

      {/* pembacaan teknis */}
      <g className="hud-teks" fill="currentColor">
        <text x="44" y="322">ORBIT 01 // 342°</text>
        <text x="44" y="338">SYNC 99.8% ▮▮▮▮▯</text>
        <text x="236" y="322">SYS.ONLINE</text>
        <text x="236" y="338">LAT 09 MS</text>
      </g>
    </svg>
  )
}
