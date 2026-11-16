// Susun jadwal otomatis: membagi shift pagi/siang (dan tengah bila dipakai) sesuai kebutuhan (kuota) tiap hari, adil, dan menjaga kondisi rider.
// Murni (tanpa import) supaya mudah diuji. Hasilnya hanya DRAF — Captain memeriksa lalu menyimpan.
//
// Aturan (urut dari yang paling keras):
//  1. Isian TETAP dihormati: libur terkunci ('off') tidak akan dijadwalkan; shift yang dikunci tetap dan dihitung ke kuota.
//  2. Maksimal `maksHari` hari kerja per MINGGU Senin–Minggu (default 6 → minimal 1 hari libur).
//  3. Maksimal `maksBeruntun` hari kerja BERTURUT-TURUT (default 6), termasuk yang berasal dari periode sebelumnya.
//  4. Shift TIDAK boleh berganti tanpa libur dulu (mis. pagi→siang atau siang→pagi harus melewati minimal 1 hari libur).
//     Kalau kuota tak mungkin terpenuhi tanpa melanggar ini, pelanggaran dilakukan sebagai pilihan terakhir dan dilaporkan (`langgar`).
//  5. Setelah libur, rider melanjutkan shift yang sama seperti sebelum libur (ritme tidur terjaga), kecuali selisih
//     jumlah hari antar shift sudah timpang (`ROTASI` hari): maka ia ditukar ke shift yang paling jarang dikerjakannya. Slot shift barunya
//     dicadangkan dengan mengistirahatkan satu pelanjut di shift itu (selama kuota hari itu tetap penuh), jadi rotasi benar-benar
//     terjadi. Rider yang belum punya riwayat dibagi selang-seling, bukan menurut urutan nama.
//  6. Keadilan: yang total hari kerjanya paling sedikit didahulukan; di akhir pekan, yang akhir pekannya paling sedikit
//     didahulukan di antara yang hari kerjanya sama. Total ikut menghitung `riwayat` (jadwal tersimpan sebelum
//     periode ini, mis. 28 hari terakhir), jadi keadilan berlanjut walau jadwal dibuat minggu demi minggu.
//  Kuota boleh berbeda tiap hari (`kuotaHari`): kebutuhan mengikuti permintaan client.
//  Shift TENGAH opsional: dipakai hanya bila kebutuhannya > 0 (`opsi.kuotaTengah` atau `kuotaHari[tgl].tengah`). Diperlakukan setara dengan
//  pagi dan siang oleh semua aturan di atas. Bila tidak dipakai, hasilnya sama persis seperti sebelum shift tengah ada.
// ponytail: aturan tetap tanpa preferensi per rider; tambahkan bila Captain membutuhkan.

export type Shift = 'pagi' | 'siang' | 'tengah'
export type Kurang = { tanggal: string; pagi: number; siang: number; tengah?: number }
export type Langgar = { tanggal: string; riderId: string }
export type Draf = { grid: Record<string, string>; kurang: Kurang[]; langgar: Langgar[] }
// Keadaan seorang rider tepat sebelum periode dimulai (`tengah` hanya ada bila rider pernah memegang shift tengah)
export type Riwayat = { hk: number; shiftKemarin: string; shiftTerakhir: string; beruntun: number; pekanBerjalan: number; pagi: number; siang: number; tengah?: number; akhirPekan: number }
export type KuotaHari = { pagi: number; siang: number; tengah?: number }
export type Opsi = {
  maksHari?: number
  maksBeruntun?: number
  riwayat?: Record<string, Riwayat>
  kuotaHari?: Record<string, KuotaHari> // tanggal -> kebutuhan hari itu (menimpa kuota bawaan; tengah yang tidak diisi dianggap 0)
  kuotaTengah?: number // kebutuhan shift tengah bawaan DS (0 / kosong = tidak dipakai)
  tetap?: Record<string, Shift | 'off'> // "riderId|tanggal" -> isian yang tidak boleh diubah
}

export const ROTASI = 4 // selisih hari antar shift yang memicu pertukaran shift setelah libur
export const BATAS_RIWAYAT = 0.5 // hari: pengaruh maksimum ketimpangan riwayat terhadap prioritas seorang rider
export const TOLERANSI_HK = 1 // di akhir pekan, selisih hari kerja sebesar ini dianggap "hampir sama" sehingga jumlah akhir pekan yang menentukan
const KOSONG: Riwayat = { hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0, pagi: 0, siang: 0, akhirPekan: 0 }
const adalahShift = (s: string | undefined): s is Shift => s === 'pagi' || s === 'siang' || s === 'tengah'
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
    const hari = new Map(rows.filter((r) => r.rider_id === id && adalahShift(r.shift) && r.tanggal < dari).map((r) => [r.tanggal, r.shift]))
    let beruntun = 0
    for (let d = kemarin; hari.has(d); d = geser(d, -1)) beruntun++
    const urut = [...hari.keys()].sort()
    const nTengah = [...hari.values()].filter((s) => s === 'tengah').length
    out[id] = {
      hk: hari.size,
      shiftKemarin: hari.get(kemarin) ?? '',
      shiftTerakhir: urut.length ? hari.get(urut[urut.length - 1])! : '',
      beruntun,
      pekanBerjalan: urut.filter((t) => t >= awalPekan).length, // hari kerja di minggu yang sama dengan hari pertama periode, sebelum periode
      pagi: [...hari.values()].filter((s) => s === 'pagi').length,
      siang: [...hari.values()].filter((s) => s === 'siang').length,
      ...(nTengah ? { tengah: nTengah } : {}),
      akhirPekan: urut.filter(akhirPekan).length,
    }
  }
  return out
}

export function buatDraf(riderIds: string[], hari: string[], kuotaPagi: number, kuotaSiang: number, opsi: Opsi = {}): Draf {
  const maksHari = opsi.maksHari ?? 6
  const maksBeruntun = opsi.maksBeruntun ?? 6
  const kuotaTengah = opsi.kuotaTengah ?? 0
  // Shift tengah ikut dipakai hanya bila ada kebutuhannya (bawaan, per hari, atau isian tetap). Kalau tidak, semua perhitungan
  // sama persis dengan versi dua shift: S = [pagi, siang] dan urutan prioritas pagi → siang tidak berubah.
  const tengahDipakai = kuotaTengah > 0 || hari.some((d) => (opsi.kuotaHari?.[d]?.tengah ?? 0) > 0) || Object.values(opsi.tetap ?? {}).includes('tengah')
  const S: Shift[] = tengahDipakai ? ['pagi', 'siang', 'tengah'] : ['pagi', 'siang']
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
  // jumlah hari tiap rider di tiap shift (riwayat + yang sudah dijadwalkan di draf ini)
  const n: Record<Shift, Map<string, number>> = {
    pagi: new Map(riderIds.map((id) => [id, awal(id).pagi])),
    siang: new Map(riderIds.map((id) => [id, awal(id).siang])),
    tengah: new Map(riderIds.map((id) => [id, awal(id).tengah ?? 0])),
  }
  const nAkhirPekan = new Map(riderIds.map((id) => [id, awal(id).akhirPekan]))
  const perPekan = new Map<string, number>() // "riderId|Senin" -> jumlah hari kerja di minggu itu
  if (hari.length) for (const id of riderIds) perPekan.set(`${id}|${senin(hari[0])}`, awal(id).pekanBerjalan)
  const grid: Record<string, string> = {}
  const kurang: Kurang[] = []
  const langgar: Langgar[] = []
  // Ketimpangan jumlah hari antar shift yang dipakai (untuk dua shift: |pagi − siang|)
  const timpang = (id: string) => {
    const v = S.map((s) => n[s].get(id)!)
    return Math.max(...v) - Math.min(...v)
  }
  // Shift tujuan rotasi dari `dari`: shift lain yang jauh lebih jarang dikerjakan rider (selisih ≥ ROTASI), dipilih yang paling jarang.
  // `slot` (bila ada) membatasi pilihan ke shift yang masih punya tempat.
  const rotasiKe = (id: string, dari: Shift, slot?: Record<Shift, number>): Shift | null => {
    let terbaik: Shift | null = null
    for (const s of S) {
      if (s === dari || (slot && slot[s] <= 0)) continue
      if (n[dari].get(id)! - n[s].get(id)! >= ROTASI && (terbaik === null || n[s].get(id)! < n[terbaik].get(id)!)) terbaik = s
    }
    return terbaik
  }

  for (const tgl of hari) {
    const pekan = senin(tgl)
    const q = opsi.kuotaHari?.[tgl] ?? { pagi: kuotaPagi, siang: kuotaSiang, tengah: kuotaTengah }
    const sisa: Record<Shift, number> = { pagi: q.pagi, siang: q.siang, tengah: q.tengah ?? 0 }
    const hariIni = new Map<string, Shift>()
    const ambil = (id: string, s: Shift) => {
      hariIni.set(id, s)
      sisa[s]--
    }

    // Tahap 0: isian tetap. Shift yang dikunci langsung terisi (dihitung ke kuota); libur terkunci tidak dijadwalkan.
    const liburKunci = new Set<string>()
    for (const id of riderIds) {
      const t = opsi.tetap?.[`${id}|${tgl}`]
      if (t === 'pagi' || t === 'siang' || t === 'tengah') ambil(id, t)
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
        return dk || Number(!!kemarin.get(a)) - Number(!!kemarin.get(b)) || timpang(b) - timpang(a) || urutan.get(a)! - urutan.get(b)!
      })

    // Tahap 1a: pilih SIAPA yang masuk berdasarkan keadilan. Rider yang kemarin masuk hanya bisa melanjutkan shift-nya,
    // jadi jumlah yang melanjutkan tiap shift dibatasi sebesar ruang yang tersisa; sisanya libur dan tempatnya diambil
    // rider yang lebih segar. (Tanpa batas ini, pemegang slot siang tak pernah libur.)
    const ruang: Record<Shift, number> = { pagi: Math.max(0, sisa.pagi), siang: Math.max(0, sisa.siang), tengah: Math.max(0, sisa.tengah) }
    const total = ruang.pagi + ruang.siang + ruang.tengah
    // Memilih shift untuk rider yang kemarin libur (atau belum punya riwayat): melanjutkan shift terakhirnya (ritme tidur terjaga),
    // kecuali jumlah harinya di shift itu sudah timpang, maka ditukar ke shift yang lebih jarang dikerjakannya. Belum ada riwayat sama
    // sekali: isi shift yang slotnya paling banyak tersisa, jadi nama-nama awal tidak semuanya kebagian shift yang sama.
    const pilihShift = (id: string, slot: Record<Shift, number>): Shift => {
      const t = terakhir.get(id)
      // (hanya bila rider cukup untuk mengisi semua slot; kalau kurang, pagi diisi dulu dan kekurangan jatuh ke shift berikutnya)
      let pilihan: Shift = adalahShift(t) ? t : terpilih.length >= total ? S.reduce((a, s) => (slot[s] > slot[a] ? s : a), S[0]) : 'pagi'
      const lawan = rotasiKe(id, pilihan, slot)
      if (lawan) pilihan = lawan
      if (slot[pilihan] > 0) return pilihan
      return S.find((s) => s !== pilihan && slot[s] > 0) ?? (pilihan === 'pagi' ? 'siang' : 'pagi')
    }
    const seleksi = (batas: Record<Shift, number>) => {
      const out: string[] = []
      const lanjut: Record<Shift, number> = { pagi: 0, siang: 0, tengah: 0 }
      for (const id of boleh) {
        if (out.length >= total) break
        const k = kemarin.get(id)
        if (adalahShift(k)) {
          if (lanjut[k] >= batas[k]) continue
          lanjut[k]++
        }
        out.push(id)
      }
      return out
    }
    let terpilih = seleksi(ruang)
    // Rider yang kembali dari libur dan sudah waktunya pindah shift mendapat slot shift lawannya.
    // Slotnya DICADANGKAN dengan mengurangi satu pelanjut di shift itu, selama kuota hari itu tetap penuh dan tidak ada yang
    // dipaksa pindah tanpa libur. Tanpa ini pemegang slot shift lawan selalu menghabiskan slot itu dan rotasi tidak pernah terjadi.
    const lawanDari = (id: string): Shift | null => {
      const t = terakhir.get(id)
      return adalahShift(t) ? rotasiKe(id, t) : null
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
      if (adalahShift(k)) ambil(id, k)
    }
    for (const id of kembali(terpilih)) if (!hariIni.has(id)) ambil(id, pilihShift(id, sisa))
    // Tahap 2 (darurat): kuota belum terpenuhi → rider yang tersisa boleh pindah shift tanpa libur, dicatat sebagai pelanggaran
    for (const id of boleh) {
      if (S.every((s) => sisa[s] <= 0)) break
      if (hariIni.has(id)) continue
      ambil(id, S.find((s) => sisa[s] > 0)!)
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
        n[s].set(id, n[s].get(id)! + 1)
        if (weekend) nAkhirPekan.set(id, nAkhirPekan.get(id)! + 1)
      } else {
        beruntun.set(id, 0)
        kemarin.set(id, '')
      }
    }
    if (S.some((s) => sisa[s] > 0)) kurang.push({ tanggal: tgl, pagi: Math.max(0, sisa.pagi), siang: Math.max(0, sisa.siang), ...(tengahDipakai ? { tengah: Math.max(0, sisa.tengah) } : {}) })
  }
  return { grid, kurang, langgar }
}

// ───────── ringkasan keadilan: bahan panel "Ringkasan keadilan" ─────────
export type StatRider = { hk: number; pagi: number; siang: number; tengah?: number; akhirPekan: number; libur: number }
export function ringkasanKeadilan(grid: Record<string, string>, riderIds: string[], hari: string[]): Record<string, StatRider> {
  const out: Record<string, StatRider> = {}
  for (const id of riderIds) {
    const s: StatRider = { hk: 0, pagi: 0, siang: 0, akhirPekan: 0, libur: 0 }
    for (const d of hari) {
      const v = grid[`${id}|${d}`]
      if (adalahShift(v)) {
        s.hk++
        s[v] = (s[v] ?? 0) + 1
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
  // isian pengganti (long shift) bukan absensi shift miliknya, jadi tidak ikut dihitung
  const status = new Map(actual.filter((a) => a.status !== 'pengganti').map((a) => [`${a.rider_id}|${a.tanggal}`, a.status]))
  const out: PolaHari[] = Array.from({ length: 7 }, (_, i) => ({ hari: i, terisi: 0, absen: 0, tingkat: 0 }))
  for (const j of jadwal) {
    if (!adalahShift(j.shift)) continue
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
// Bagi cadangan ke pagi, (tengah,) dan siang sebanding kuotanya. Tanpa kuota tengah, hasilnya sama persis seperti dulu.
export function bagiCadangan(q: KuotaHari, c: number): KuotaHari {
  const tengah = q.tengah ?? 0
  const total = q.pagi + q.siang + tengah
  const tambahPagi = total ? Math.round((c * q.pagi) / total) : 0
  const tambahTengah = total && tengah ? Math.min(c - tambahPagi, Math.round((c * tengah) / total)) : 0
  const hasil = { pagi: q.pagi + tambahPagi, siang: q.siang + (c - tambahPagi - tambahTengah) }
  return tengah ? { ...hasil, tengah: tengah + tambahTengah } : hasil
}
