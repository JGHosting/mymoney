/** Feines Linienmuster wie auf Banknoten – das Erkennungszeichen der Kontokarte. */
export function Guilloche() {
  const lines = Array.from({ length: 18 }, (_, i) => {
    const amp = 18 + i * 2.2, phase = i * 0.35, base = 40 + i * 9;
    let d = '';
    for (let x = 0; x <= 400; x += 8) {
      const y = base + Math.sin(x / 38 + phase) * amp * 0.5 + Math.sin(x / 13 + phase * 2) * 3;
      d += `${x ? 'L' : 'M'}${x},${y.toFixed(1)}`;
    }
    return d;
  });
  return (
    <svg className="guilloche" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((d, i) => <path key={i} d={d} fill="none" stroke="white" strokeWidth="0.6" />)}
      <circle cx="340" cy="40" r="90" fill="none" stroke="white" strokeWidth="0.6" />
      <circle cx="340" cy="40" r="70" fill="none" stroke="white" strokeWidth="0.5" />
      <circle cx="340" cy="40" r="50" fill="none" stroke="white" strokeWidth="0.4" />
    </svg>
  );
}
