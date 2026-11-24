// Sel satu shift pada tabel clock-in BO (dipakai Dashboard dan menu Clock-in BO): "rider clock-in / budget" dan jumlah yang tepat waktu.
// Hijau bila budget shift itu terpenuhi, kuning bila kurang, tanpa warna bila shift itu tidak punya budget.
export function SelShift({ b, h, t }: { b: number; h: number; t: number }) {
  if (!b && !h) return <td className="text-center text-muted-foreground">–</td>
  const warna = b > 0 ? (h >= b ? 'text-success' : 'text-warning') : ''
  return (
    <td className="text-center">
      <span className={`font-semibold ${warna}`}>{h}/{b || '–'}</span>
      {h > 0 && <span className="block text-[11px] leading-tight text-muted-foreground">{t} tepat</span>}
    </td>
  )
}
