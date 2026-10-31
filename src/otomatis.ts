// Susun jadwal otomatis: membagi shift pagi/siang sesuai kebutuhan (kuota) tiap hari, adil, dan menjaga kondisi rider.
// Murni (tanpa import) supaya mudah diuji. Hasilnya hanya DRAF — Captain memeriksa lalu menyimpan.
//
// Aturan (urut dari yang paling keras):
//  1. Isian TETAP dihormati: libur terkunci ('off') tidak akan dijadwalkan; shift yang dikunci tetap dan dihitung ke kuota.
//  2. Maksimal `maksHari` hari kerja per MINGGU Senin–Minggu (default 6 → minimal 1 hari libur).
//  3. Maksimal `maksBeruntun` hari kerja BERTURUT-TURUT (default 6), termasuk yang berasal dari periode sebelumnya.
//  4. Shift TIDAK boleh berganti tanpa libur dulu (pagi→siang atau siang→pagi harus melewati minimal 1 hari libur).
//     Kalau kuota tak mungkin terpenuhi tanpa melanggar ini, pelanggaran dilakukan sebagai pilihan terakhir dan dilaporkan (`langgar`).
//  5. Setelah libur, rider melanjutkan shift yang sama seperti sebelum libur (ritme tidur terjaga), kecuali selisih
//     pagi–siangnya sudah timpang (`ROTASI` hari): maka ia ditukar ke shift yang lebih jarang dikerjakannya. Slot shift barunya
//     dicadangkan dengan mengistirahatkan satu pelanjut di shift itu (selama kuota hari itu tetap penuh), jadi rotasi benar-benar
//     terjadi. Rider yang belum punya riwayat dibagi selang-seling, bukan menurut urutan nama.
//  6. Keadilan: yang total hari kerjanya paling sedikit didahulukan; di akhir pekan, yang akhir pekannya paling sedikit
//     didahulukan di antara yang hari kerjanya sama. Total ikut menghitung `riwayat` (jadwal tersimpan sebelum
//     periode ini, mis. 28 hari terakhir), jadi keadilan berlanjut walau jadwal dibuat minggu demi minggu.
//  Kuota boleh berbeda tiap hari (`kuotaHari`): kebutuhan mengikuti permintaan client.
// ponytail: aturan tetap tanpa preferensi per rider; tambahkan bila Captain membutuhkan.

export type Kurang = { tanggal: string; pagi: number; siang: number }
export type Langgar = { tanggal: string; riderId: string }
export type Draf = { grid: Record<string, string>; kurang: Kurang[]; langgar: Langgar[] }
// Keadaan seorang rider tepat sebelum periode dimulai
export type Riwayat = { hk: number; shiftKemarin: string; shiftTerakhir: string; beruntun: number; pekanBerjalan: number; pagi: number; siang: number; akhirPekan: number }
export type KuotaHari = { pagi: number; siang: number }
export type Opsi = {
  maksHari?: number
  maksBeruntun?: number
  riwayat?: Record<string, Riwayat>
  kuotaHari?: Record<string, KuotaHari> // tanggal -> kebutuhan hari itu (menimpa kuota bawaan)
  tetap?: Record<string, 'pagi' | 'siang' | 'off'> // "riderId|tanggal" -> isian yang tidak boleh diubah
}

export const ROTASI = 4 // selisih hari pagi–siang yang memicu pertukaran shift setelah libur
export const BATAS_RIWAYAT = 0.5 // hari: pengaruh maksimum ketimpangan riwayat terhadap prioritas seorang rider
export const TOLERANSI_HK = 1 // di akhir pekan, selisih hari kerja sebesar ini dianggap "hampir sama" sehingga jumlah akhir pekan yang menentukan
const KOSONG: Riwayat = { hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0, pagi: 0, siang: 0, akhirPekan: 0 }
const geser = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const senin = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}
const akhirPekan = (d: string) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())

// Ringkas jadwal tersimpan sebelum `dari` (mis. 28 hari terakhir) menjadi keadaan awal tiap rider.
export function hitungRiwayat(rows: { rider_id: string; tanggal: string; shift: string }[], riderIds: string[], dari: string): Record<string, Riwayat> {
  const kemarin = geser(dari, -1)
  const awalPekan = senin(dari)
  const out: Record<string, Riwayat> = {}
  for (const id of riderIds) {
    const hari = new Map(rows.filter((r) => r.rider_id === id && (r.shift === 'pagi' || r.shift === 'siang') && r.tanggal < dari).map((r) => [r.tanggal, r.shift]))
    let beruntun = 0
    for (let d = kemarin; hari.has(d); d = geser(d, -1)) beruntun++
    const urut = [...hari.keys()].sort()
    out[id] = {
      hk: hari.size,
      shiftKemarin: hari.get(kemarin) ?? '',
      shiftTerakhir: urut.length ? hari.get(urut[urut.length - 1])! : '',
      beruntun,
      pekanBerjalan: urut.filter((t) => t >= awalPekan).length, // hari kerja di minggu yang sama dengan hari pertama periode, sebelum periode
      pagi: [...hari.values()].filter((s) => s === 'pagi').length,
      siang: [...hari.values()].filter((s) => s === 'siang').length,
      akhirPekan: urut.filter(akhirPekan).length,
    }
  }
  return out
}

export function buatDraf(riderIds: string[], hari: string[], kuotaPagi: number, kuotaSiang: number, opsi: Opsi = {}): Draf {
  const maksHari = opsi.maksHari ?? 6
  const maksBeruntun = opsi.maksBeruntun ?? 6
  const awal = (id: string) => opsi.riwayat?.[id] ?? KOSONG
  const urutan = new Map(riderIds.map((id, i) => [id, i]))
  // Memori keadilan DIBATASI: selisih hari kerja riwayat terhadap rata-rata dipotong ±BATAS_RIWAYAT. Tanpa batas ini,
  // riwayat yang timpang dikompensasi penuh dalam satu periode dan seorang rider bisa mendadak hanya dapat 1 hari kerja,
  // padahal hari kerja adalah penghasilannya. Dengan batas, ketimpangan lama dikoreksi bertahap dari periode ke periode.
  const rata = riderIds.length ? riderIds.reduce((a, id) => a + awal(id).hk, 0) / riderIds.length : 0
  const kerja = new Map(riderIds.map((id) => [id, rata + Math.max(-BATAS_RIWAYAT, Math.min(BATAS_RIWAYAT, awal(id).hk - rata))]))
  const kemarin = new Map(riderIds.map((id) => [id, awal(id).shiftKemarin]))
  const terakhir = new Map(riderIds.map((id) => [id, awal(id).shiftTerakhir]))
  const beruntun = new Map(riderIds.map((id) => [id, awal(id).beruntun]))
  const nPagi = new Map(riderIds.map((id) => [id, awal(id).pagi]))
  const nSiang = new Map(riderIds.map((id) => [id, awal(id).siang]))
  const nAkhirPekan = new Map(riderIds.map((id) => [id, awal(id).akhirPekan]))
  const perPekan = new Map<string, number>() // "riderId|Senin" -> jumlah hari kerja di minggu itu
  if (hari.length) for (const id of riderIds) perPekan.set(`${id}|${senin(hari[0])}`, awal(id).pekanBerjalan)
  const grid: Record<string, string> = {}
  const kurang: Kurang[] = []
  const langgar: Langgar[] = []

  for (const tgl of hari) {
    const pekan = senin(tgl)
    const q = opsi.kuotaHari?.[tgl] ?? { pagi: kuotaPagi, siang: kuotaSiang }
    const sisa = { pagi: q.pagi, siang: q.siang }
    const hariIni = new Map<string, 'pagi' | 'siang'>()
    const ambil = (id: string, s: 'pagi' | 'siang') => {
      hariIni.set(id, s)
      sisa[s]--
    }

    // Tahap 0: isian tetap. Shift yang dikunci langsung terisi (dihitung ke kuota); libur terkunci tidak dijadwalkan.
    const liburKunci = new Set<string>()
    for (const id of riderIds) {
      const t = opsi.tetap?.[`${id}|${tgl}`]
      if (t === 'pagi' || t === 'siang') ambil(id, t)
      else if (t === 'off') liburKunci.add(id)
    }

    const weekend = akhirPekan(tgl)
    // Urutan keadilan: hari kerja paling sedikit dulu. Di akhir pekan, di antara rider yang hari kerjanya hampir sama
    // (selisih ≤ TOLERANSI_HK), yang akhir pekannya paling sedikit didahulukan. Tanpa ini, rider yang libur di tengah pekan
    // (HK lebih sedikit) selalu terpilih untuk akhir pekan dan terkunci di situ, sementara yang lain tidak pernah.
    const boleh = riderIds
      .filter((id) => !hariIni.has(id) && !liburKunci.has(id) && (perPekan.get(`${id}|${pekan}`) ?? 0) < maksHari && beruntun.get(id)! < maksBeruntun)
      .sort((a, b) => {
        const dk = kerja.get(a)! - kerja.get(b)!
        if (weekend && Math.abs(dk) <= TOLERANSI_HK) {
          const dw = nAkhirPekan.get(a)! - nAkhirPekan.get(b)!
          if (dw) return dw
        }
        return dk || Number(!!kemarin.get(a)) - Number(!!kemarin.get(b)) || Math.abs(nPagi.get(b)! - nSiang.get(b)!) - Math.abs(nPagi.get(a)! - nSiang.get(a)!) || urutan.get(a)! - urutan.get(b)!
      })

    // Tahap 1a: pilih SIAPA yang masuk berdasarkan keadilan. Rider yang kemarin masuk hanya bisa melanjutkan shift-nya,
    // jadi jumlah yang melanjutkan tiap shift dibatasi sebesar ruang yang tersisa; sisanya libur dan tempatnya diambil
    // rider yang lebih segar. (Tanpa batas ini, pemegang slot siang tak pernah libur.)
    const ruang = { pagi: Math.max(0, sisa.pagi), siang: Math.max(0, sisa.siang) }
    const total = ruang.pagi + ruang.siang
    const timpang = (id: string) => Math.abs(nPagi.get(id)! - nSiang.get(id)!)
    // Memilih shift untuk rider yang kemarin libur (atau belum punya riwayat): melanjutkan shift terakhirnya (ritme tidur terjaga),
    // kecuali selisih pagi–siangnya sudah timpang, maka ditukar ke shift yang lebih jarang dikerjakannya. Belum ada riwayat sama
    // sekali: isi shift yang slotnya paling banyak tersisa, jadi nama-nama awal tidak semuanya kebagian pagi.
    const pilihShift = (id: string, slot: { pagi: number; siang: number }): 'pagi' | 'siang' => {
      const selisih = nPagi.get(id)! - nSiang.get(id)!
      const t = terakhir.get(id)
      // (hanya bila rider cukup untuk mengisi semua slot; kalau kurang, pagi diisi dulu dan kekurangan jatuh ke siang)
      let pilihan: 'pagi' | 'siang' = t ? (t === 'siang' ? 'siang' : 'pagi') : terpilih.length >= total && slot.pagi < slot.siang ? 'siang' : 'pagi'
      if (pilihan === 'pagi' && selisih >= ROTASI && slot.siang > 0) pilihan = 'siang'
      else if (pilihan === 'siang' && -selisih >= ROTASI && slot.pagi > 0) pilihan = 'pagi'
      return slot[pilihan] > 0 ? pilihan : pilihan === 'pagi' ? 'siang' : 'pagi'
    }
    const seleksi = (batas: { pagi: number; siang: number }) => {
      const out: string[] = []
      let lanjutPagi = 0
      let lanjutSiang = 0
      for (const id of boleh) {
        if (out.length >= total) break
        const k = kemarin.get(id)
        if (k === 'pagi') {
          if (lanjutPagi >= batas.pagi) continue
          lanjutPagi++
        } else if (k === 'siang') {
          if (lanjutSiang >= batas.siang) continue
          lanjutSiang++
        }
        out.push(id)
      }
      return out
    }
    let terpilih = seleksi(ruang)
    // Rider yang kembali dari libur dan sudah waktunya pindah shift (selisih pagi–siang ≥ ROTASI) mendapat slot shift lawannya.
    // Slotnya DICADANGKAN dengan mengurangi satu pelanjut di shift itu, selama kuota hari itu tetap penuh dan tidak ada yang
    // dipaksa pindah tanpa libur. Tanpa ini pemegang slot shift lawan selalu menghabiskan slot itu dan rotasi tidak pernah terjadi.
    const lawanDari = (id: string) => {
      const t = terakhir.get(id)
      const selisih = nPagi.get(id)! - nSiang.get(id)!
      return t === 'pagi' && selisih >= ROTASI ? 'siang' : t === 'siang' && -selisih >= ROTASI ? 'pagi' : null
    }
    // yang sudah waktunya pindah shift memilih lebih dulu (supaya slot shift barunya tidak diambil rider lain), lalu yang paling timpang
    const kembali = (ids: string[]) => ids.filter((x) => !kemarin.get(x)).sort((x, y) => Number(!lawanDari(x)) - Number(!lawanDari(y)) || timpang(y) - timpang(x))
    const dasar = terpilih.length
    let batas = { ...ruang }
    for (const id of kembali(terpilih)) {
      const lawan = lawanDari(id)
      if (!lawan || batas[lawan] <= 0) continue
      const baru = { ...batas, [lawan]: batas[lawan] - 1 }
      const calon = seleksi(baru)
      if (calon.length >= dasar && calon.includes(id)) {
        batas = baru
        terpilih = calon
      }
    }
    // Tahap 1b: bagi shift. Yang melanjutkan tetap di shift-nya; yang kembali dari libur memilih sesuai aturan di atas.
    for (const id of terpilih) {
      const k = kemarin.get(id)
      if (k === 'pagi' || k === 'siang') ambil(id, k)
    }
    for (const id of kembali(terpilih)) if (!hariIni.has(id)) ambil(id, pilihShift(id, sisa))
    // Tahap 2 (darurat): kuota belum terpenuhi → rider yang tersisa boleh pindah shift tanpa libur, dicatat sebagai pelanggaran
    for (const id of boleh) {
      if (sisa.pagi <= 0 && sisa.siang <= 0) break
      if (hariIni.has(id)) continue
      ambil(id, sisa.pagi > 0 ? 'pagi' : 'siang')
      langgar.push({ tanggal: tgl, riderId: id })
    }

    for (const id of riderIds) {
      const s = hariIni.get(id)
      if (s) {
        grid[`${id}|${tgl}`] = s
        kerja.set(id, kerja.get(id)! + 1)
        perPekan.set(`${id}|${pekan}`, (perPekan.get(`${id}|${pekan}`) ?? 0) + 1)
        beruntun.set(id, beruntun.get(id)! + 1)
        terakhir.set(id, s)
        kemarin.set(id, s)
        ;(s === 'pagi' ? nPagi : nSiang).set(id, (s === 'pagi' ? nPagi : nSiang).get(id)! + 1)
        if (weekend) nAkhirPekan.set(id, nAkhirPekan.get(id)! + 1)
      } else {
        beruntun.set(id, 0)
        kemarin.set(id, '')
      }
    }
    if (sisa.pagi > 0 || sisa.siang > 0) kurang.push({ tanggal: tgl, pagi: Math.max(0, sisa.pagi), siang: Math.max(0, sisa.siang) })
  }
  return { grid, kurang, langgar }
}

// ───────── ringkasan keadilan: bahan panel "Ringkasan keadilan" ─────────
export type StatRider = { hk: number; pagi: number; siang: number; akhirPekan: number; libur: number }
export function ringkasanKeadilan(grid: Record<string, string>, riderIds: string[], hari: string[]): Record<string, StatRider> {
  const out: Record<string, StatRider> = {}
  for (const id of riderIds) {
    const s: StatRider = { hk: 0, pagi: 0, siang: 0, akhirPekan: 0, libur: 0 }
    for (const d of hari) {
      const v = grid[`${id}|${d}`]
      if (v === 'pagi' || v === 'siang') {
        s.hk++
        s[v]++
        if (akhirPekan(d)) s.akhirPekan++
      } else s.libur++
    }
    out[id] = s
  }
  return out
}

// ───────── cadangan (standby) berdasarkan pola absen nyata ─────────
export type PolaHari = { hari: number; terisi: number; absen: number; tingkat: number } // hari: 0 = Senin … 6 = Minggu
// Tingkat absen per hari dalam seminggu: alpha + izin + sakit dibanding shift terjadwal yang SUDAH diisi absensinya
// (yang belum diisi tidak dihitung agar tidak menggelembungkan angka). 'tukar' bukan absen: itu penggantian yang direncanakan.
export function polaAbsen(jadwal: { rider_id: string; tanggal: string; shift: string }[], actual: { rider_id: string; tanggal: string; status: string }[]): PolaHari[] {
  const dow = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7
  const status = new Map(actual.map((a) => [`${a.rider_id}|${a.tanggal}`, a.status]))
  const out: PolaHari[] = Array.from({ length: 7 }, (_, i) => ({ hari: i, terisi: 0, absen: 0, tingkat: 0 }))
  for (const j of jadwal) {
    if (j.shift !== 'pagi' && j.shift !== 'siang') continue
    const s = status.get(`${j.rider_id}|${j.tanggal}`)
    if (!s) continue
    const o = out[dow(j.tanggal)]
    o.terisi++
    if (s === 'alpha' || s === 'izin' || s === 'sakit') o.absen++
  }
  for (const o of out) o.tingkat = o.terisi ? o.absen / o.terisi : 0
  return out
}
// Berapa rider cadangan yang disarankan di suatu hari. Data kurang dari `minData` → 0 (jangan menebak).
export const cadanganDisarankan = (p: PolaHari, kuotaTotal: number, minData = 20, maks = 2) => (p.terisi < minData ? 0 : Math.min(maks, Math.round(kuotaTotal * p.tingkat)))
// Bagi cadangan ke pagi dan siang sebanding kuotanya
export function bagiCadangan(q: KuotaHari, c: number): KuotaHari {
  const total = q.pagi + q.siang
  const tambahPagi = total ? Math.round((c * q.pagi) / total) : 0
  return { pagi: q.pagi + tambahPagi, siang: q.siang + (c - tambahPagi) }
}
