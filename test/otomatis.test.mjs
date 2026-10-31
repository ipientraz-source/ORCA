// Uji penyusun jadwal otomatis (src/otomatis.ts). Node 24 membaca TypeScript langsung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buatDraf, hitungRiwayat, ringkasanKeadilan, polaAbsen, cadanganDisarankan, bagiCadangan } from '../src/otomatis.ts'

const hari7 = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const riders = (n) => Array.from({ length: n }, (_, i) => `r${i + 1}`)
const hitung = (grid, id) => Object.keys(grid).filter((k) => k.startsWith(id + '|')).length
const perHari = (grid, tgl, shift) => Object.entries(grid).filter(([k, s]) => k.endsWith('|' + tgl) && s === shift).length

test('kuota terpenuhi tiap hari, tanpa kekurangan', () => {
  const { grid, kurang } = buatDraf(riders(5), hari7, 2, 1)
  assert.deepEqual(kurang, [])
  for (const d of hari7) {
    assert.equal(perHari(grid, d, 'pagi'), 2)
    assert.equal(perHari(grid, d, 'siang'), 1)
  }
})

test('adil: selisih hari kerja antar rider paling banyak 1, tak ada yang lebih dari 6 hari', () => {
  const ids = riders(5)
  const { grid } = buatDraf(ids, hari7, 2, 1)
  const n = ids.map((id) => hitung(grid, id))
  assert.ok(Math.max(...n) - Math.min(...n) <= 1, `tidak merata: ${n}`)
  assert.ok(Math.max(...n) <= 6)
  assert.equal(n.reduce((a, b) => a + b, 0), 21) // 3 orang × 7 hari
})

test('satu rider tidak pernah dobel shift di hari yang sama', () => {
  const { grid } = buatDraf(riders(4), hari7, 2, 2)
  const kunci = Object.keys(grid)
  assert.equal(new Set(kunci).size, kunci.length)
})

test('rider kurang: kekurangan dilaporkan per hari (siang yang kosong duluan)', () => {
  const { grid, kurang } = buatDraf(riders(2), hari7, 2, 2)
  assert.equal(kurang.length, 7)
  assert.deepEqual(kurang[0], { tanggal: '2026-10-26', pagi: 0, siang: 2 })
  assert.equal(perHari(grid, '2026-10-26', 'pagi'), 2)
})

test('maksimal 6 hari kerja: hari ke-7 kosong bila semua rider sudah 6 hari', () => {
  const { grid, kurang } = buatDraf(riders(3), hari7, 3, 0)
  assert.equal(perHari(grid, '2026-11-01', 'pagi'), 0)
  assert.deepEqual(kurang.at(-1), { tanggal: '2026-11-01', pagi: 3, siang: 0 })
  riders(3).forEach((id) => assert.ok(hitung(grid, id) <= 6))
})

const rentang = (dari, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(dari + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10))
const senin = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) }
const maksPerPekan = (grid, ids) => Math.max(...ids.flatMap((id) => {
  const m = {}
  for (const k of Object.keys(grid)) if (k.startsWith(id + '|')) { const p = senin(k.split('|')[1]); m[p] = (m[p] ?? 0) + 1 }
  return Object.values(m)
}))

test('periode bebas 14 hari: batas 6 hari dihitung per minggu, bukan seluruh rentang', () => {
  const ids = riders(3), hari = rentang('2026-10-26', 14)
  const { grid, kurang } = buatDraf(ids, hari, 3, 0) // 3 rider, kuota 3/hari: semua harus masuk tiap hari kecuali batas mingguan
  assert.ok(maksPerPekan(grid, ids) <= 6)
  assert.equal(Math.max(...ids.map((id) => hitung(grid, id))), 12) // 6 + 6, bukan 6 untuk seluruh 14 hari
  assert.equal(kurang.length, 2) // hari ke-7 dan ke-14 tak terpenuhi (semua sudah 6 hari di minggunya)
})

test('periode mulai di tengah minggu (Rabu–Selasa) tetap menghormati batas per minggu kalender', () => {
  const ids = riders(3), hari = rentang('2026-10-28', 14) // Rabu → Selasa 2 minggu kemudian
  const { grid } = buatDraf(ids, hari, 3, 0)
  assert.ok(maksPerPekan(grid, ids) <= 6)
})

test('periode 1 hari dan periode sebulan berjalan; kuota terpenuhi bila rider cukup', () => {
  const satu = buatDraf(riders(4), ['2026-10-26'], 2, 2)
  assert.equal(Object.keys(satu.grid).length, 4)
  assert.deepEqual(satu.kurang, [])
  const ids = riders(10), bulan = rentang('2026-11-01', 30)
  const { grid, kurang } = buatDraf(ids, bulan, 3, 3)
  assert.deepEqual(kurang, [])
  assert.ok(maksPerPekan(grid, ids) <= 6)
  const n = ids.map((id) => hitung(grid, id))
  assert.ok(Math.max(...n) - Math.min(...n) <= 1, `tidak merata: ${n}`)
})

// ── aturan kondisi rider & keadilan lintas periode ──
const urutan = (grid, id, hari) => hari.map((d) => grid[`${id}|${d}`] ?? '') // mis. ['pagi','pagi','','siang']
const langsungGanti = (seq) => seq.some((s, i) => i > 0 && s && seq[i - 1] && s !== seq[i - 1]) // pagi→siang / siang→pagi tanpa libur
const beruntunMaks = (seq) => seq.reduce((m, s) => { m.cur = s ? m.cur + 1 : 0; m.max = Math.max(m.max, m.cur); return m }, { cur: 0, max: 0 }).max
const barisDari = (grid) => Object.entries(grid).map(([k, shift]) => { const [rider_id, tanggal] = k.split('|'); return { rider_id, tanggal, shift } })

test('shift TIDAK pernah berganti tanpa libur dulu, di berbagai konfigurasi, tanpa pelanggaran darurat', () => {
  for (const [n, p, s, hariN] of [[5, 2, 1, 28], [10, 3, 3, 30], [8, 2, 2, 21], [6, 2, 2, 14], [12, 4, 3, 28]]) {
    const ids = riders(n), hari = rentang('2026-10-26', hariN)
    const { grid, langgar, kurang } = buatDraf(ids, hari, p, s)
    for (const id of ids) assert.equal(langsungGanti(urutan(grid, id, hari)), false, `${n} rider ${p}+${s}: ${id} ganti shift tanpa libur`)
    assert.deepEqual(langgar, [], `${n} rider ${p}+${s}`)
    assert.deepEqual(kurang, [], `${n} rider ${p}+${s}: kuota tidak terpenuhi`)
  }
})

test('batas 6 hari BERTURUT-TURUT (bukan hanya per minggu kalender)', () => {
  const ids = riders(4), hari = rentang('2026-10-26', 28)
  const { grid } = buatDraf(ids, hari, 2, 1)
  for (const id of ids) assert.ok(beruntunMaks(urutan(grid, id, hari)) <= 6, `${id} bekerja lebih dari 6 hari berturut-turut`)
  // berasal dari periode sebelumnya: sudah 6 hari berturut-turut → hari pertama harus libur
  const r = buatDraf(riders(3), ['2026-10-26'], 2, 1, { riwayat: { r1: { hk: 6, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 6, pekanBerjalan: 0 } } })
  assert.equal(r.grid['r1|2026-10-26'], undefined)
})

test('setelah libur rider melanjutkan shift sebelum libur (ritme tidur terjaga), bukan dipaksa pagi', () => {
  const awal = (terakhir) => ({ r1: { hk: 0, shiftKemarin: '', shiftTerakhir: terakhir, beruntun: 0, pekanBerjalan: 0 }, r2: { hk: 9, shiftKemarin: '', shiftTerakhir: 'pagi', beruntun: 0, pekanBerjalan: 0 }, r3: { hk: 9, shiftKemarin: '', shiftTerakhir: 'pagi', beruntun: 0, pekanBerjalan: 0 } })
  assert.equal(buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: awal('siang') }).grid['r1|2026-10-26'], 'siang')
  assert.equal(buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: awal('pagi') }).grid['r1|2026-10-26'], 'pagi')
})

test('melanjutkan dari periode sebelumnya: kemarin siang tidak boleh langsung pagi', () => {
  const riwayat = { r1: { hk: 1, shiftKemarin: 'siang', shiftTerakhir: 'siang', beruntun: 1, pekanBerjalan: 1 } }
  const { grid, langgar } = buatDraf(riders(3), ['2026-10-27'], 2, 0, { riwayat }) // hanya ada slot pagi
  assert.equal(grid['r1|2026-10-27'], undefined) // r1 libur dulu
  assert.equal(grid['r2|2026-10-27'], 'pagi')
  assert.equal(grid['r3|2026-10-27'], 'pagi')
  assert.deepEqual(langgar, [])
})

test('adil lintas minggu walau jadwal dibuat minggu demi minggu: yang minggu lalu lebih banyak kerja, minggu ini lebih sedikit', () => {
  const ids = riders(5), minggu1 = rentang('2026-10-26', 7), minggu2 = rentang('2026-11-02', 7)
  const w1 = buatDraf(ids, minggu1, 2, 1).grid
  const hk1 = ids.map((id) => hitung(w1, id))
  const w2 = buatDraf(ids, minggu2, 2, 1, { riwayat: hitungRiwayat(barisDari(w1), ids, '2026-11-02') }).grid
  const hk2 = ids.map((id) => hitung(w2, id))
  const total = ids.map((_, i) => hk1[i] + hk2[i])
  assert.ok(Math.max(...total) - Math.min(...total) <= 1, `total 2 minggu tidak merata: ${total}`)
  const banyak = hk1.indexOf(Math.max(...hk1)), sedikit = hk1.indexOf(Math.min(...hk1))
  if (hk1[banyak] > hk1[sedikit]) assert.ok(hk2[banyak] <= hk2[sedikit], `minggu 2 harus dibalik: minggu1=${hk1} minggu2=${hk2}`)
  // pembanding: tanpa riwayat, minggu 2 identik dengan minggu 1 (tidak ada ingatan) — itulah yang diperbaiki
  assert.deepEqual(buatDraf(ids, minggu2, 2, 1).grid && ids.map((id) => hitung(buatDraf(ids, minggu2, 2, 1).grid, id)), hk1)
})

test('riwayat yang sangat timpang dikoreksi bertahap: tidak ada rider yang mendadak hanya dapat sedikit hari kerja (HK = penghasilan)', () => {
  const ids = riders(4), hari = rentang('2026-10-26', 7)
  // r1 sudah kerja jauh lebih banyak dari yang lain (40 vs 10 hari dalam 28 hari terakhir)
  const riwayat = Object.fromEntries(ids.map((id, i) => [id, riw({ hk: i === 0 ? 40 : 10 })]))
  const { grid } = buatDraf(ids, hari, 2, 1, { riwayat })
  const hk = ids.map((id) => hitung(grid, id))
  assert.ok(hk[0] <= Math.min(...hk.slice(1)), `r1 seharusnya kebagian paling sedikit: ${hk}`) // arah koreksi benar
  assert.ok(hk[0] >= 3, `r1 tidak boleh terlalu sedikit (koreksi dibatasi): ${hk}`) // tapi dibatasi: bukan 0–1 hari
  assert.ok(Math.min(...hk) >= 3, `tak ada rider di bawah 3 hari kerja: ${hk}`)
})

test('kuota mustahil dipenuhi tanpa melanggar aturan shift: kuota diutamakan, pelanggaran DILAPORKAN (tidak diam-diam)', () => {
  // keduanya kemarin pagi; kuota 1 pagi + 1 siang → salah satu terpaksa pindah ke siang tanpa libur
  const riwayat = { r1: { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 3, pekanBerjalan: 3 }, r2: { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 3, pekanBerjalan: 3 } }
  const { grid, langgar, kurang } = buatDraf(riders(2), ['2026-10-29'], 1, 1, { riwayat })
  assert.equal(grid['r1|2026-10-29'], 'pagi')
  assert.equal(grid['r2|2026-10-29'], 'siang')
  assert.deepEqual(langgar, [{ tanggal: '2026-10-29', riderId: 'r2' }])
  assert.deepEqual(kurang, [])
})

test('hitungRiwayat: hari kerja, shift kemarin/terakhir, berturut-turut, dan minggu berjalan; libur diabaikan', () => {
  const rows = [
    { rider_id: 'r1', tanggal: '2026-10-26', shift: 'pagi' }, { rider_id: 'r1', tanggal: '2026-10-27', shift: 'pagi' },
    { rider_id: 'r1', tanggal: '2026-10-24', shift: 'siang' }, { rider_id: 'r1', tanggal: '2026-10-25', shift: 'off' },
    { rider_id: 'r2', tanggal: '2026-10-20', shift: 'siang' }, { rider_id: 'r2', tanggal: '2026-10-21', shift: 'siang' },
  ]
  const h = hitungRiwayat(rows, ['r1', 'r2', 'r3'], '2026-10-28') // Rabu
  assert.deepEqual(h.r1, { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 2, pekanBerjalan: 2, pagi: 2, siang: 1, akhirPekan: 1 }) // 24 Okt = Sabtu
  assert.deepEqual(h.r2, { hk: 2, shiftKemarin: '', shiftTerakhir: 'siang', beruntun: 0, pekanBerjalan: 0, pagi: 0, siang: 2, akhirPekan: 0 })
  assert.deepEqual(h.r3, { hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0, pagi: 0, siang: 0, akhirPekan: 0 })
})

// ── kebutuhan per hari, isian tetap, keadilan akhir pekan, rotasi, cadangan ──
const akhirPekanSeq = (hari) => hari.filter((d) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()))
const riw = (o) => ({ hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0, pagi: 0, siang: 0, akhirPekan: 0, ...o })

test('kuota per hari mengikuti kebutuhan client: hari tertentu boleh lebih banyak', () => {
  const hari = rentang('2026-10-26', 7)
  const kuotaHari = { '2026-10-31': { pagi: 4, siang: 2 }, '2026-11-01': { pagi: 4, siang: 2 } } // akhir pekan ramai
  const { grid, kurang } = buatDraf(riders(8), hari, 2, 1, { kuotaHari })
  assert.deepEqual(kurang, [])
  for (const d of hari) {
    const ramai = d in kuotaHari
    assert.equal(perHari(grid, d, 'pagi'), ramai ? 4 : 2, d)
    assert.equal(perHari(grid, d, 'siang'), ramai ? 2 : 1, d)
  }
})

test('isian tetap: libur terkunci tidak dijadwalkan; shift terkunci dipertahankan dan dihitung ke kuota; melebihi kuota tetap dihormati', () => {
  const hari = ['2026-10-26'], ids = riders(5)
  // r1 punya hari kerja paling sedikit (seharusnya dipilih pertama) tapi libur terkunci
  const a = buatDraf(ids, hari, 2, 1, { riwayat: { r1: riw({ hk: 0 }), r2: riw({ hk: 3 }), r3: riw({ hk: 3 }), r4: riw({ hk: 3 }), r5: riw({ hk: 3 }) }, tetap: { 'r1|2026-10-26': 'off' } })
  assert.equal(a.grid['r1|2026-10-26'], undefined)
  assert.equal(perHari(a.grid, hari[0], 'pagi') + perHari(a.grid, hari[0], 'siang'), 3)
  // r5 dikunci siang → itu satu-satunya siang (kuota siang 1 sudah terisi olehnya), pagi diisi 2 orang lain
  const b = buatDraf(ids, hari, 2, 1, { tetap: { 'r5|2026-10-26': 'siang' } })
  assert.equal(b.grid['r5|2026-10-26'], 'siang')
  assert.equal(perHari(b.grid, hari[0], 'siang'), 1)
  assert.equal(perHari(b.grid, hari[0], 'pagi'), 2)
  // dua rider dikunci pagi padahal kuota pagi hanya 1: keduanya tetap, tidak ditambah siapa pun
  const c = buatDraf(ids, hari, 1, 0, { tetap: { 'r4|2026-10-26': 'pagi', 'r5|2026-10-26': 'pagi' } })
  assert.equal(perHari(c.grid, hari[0], 'pagi'), 2)
  assert.deepEqual(c.kurang, [])
})

test('libur terkunci dihormati sepanjang periode dan tidak merusak aturan lain', () => {
  const hari = rentang('2026-10-26', 14), ids = riders(6)
  const tetap = { 'r1|2026-10-27': 'off', 'r1|2026-10-28': 'off', 'r2|2026-11-02': 'off' }
  const { grid, langgar } = buatDraf(ids, hari, 2, 2, { tetap })
  for (const k of Object.keys(tetap)) assert.equal(grid[k], undefined)
  assert.deepEqual(langgar, [])
  for (const id of ids) assert.equal(langsungGanti(urutan(grid, id, hari)), false)
})

test('keadilan akhir pekan: kerja Sabtu/Minggu terbagi merata, bukan itu-itu saja', () => {
  const ids = riders(7), hari = rentang('2026-10-26', 28)
  const { grid } = buatDraf(ids, hari, 3, 2)
  const we = akhirPekanSeq(hari)
  const n = ids.map((id) => we.filter((d) => grid[`${id}|${d}`]).length)
  assert.ok(Math.max(...n) - Math.min(...n) <= 2, `akhir pekan tidak merata: ${n}`)
  const hk = ids.map((id) => hitung(grid, id))
  // kompromi yang disadari: mengutamakan pemerataan akhir pekan boleh membuat selisih HK sampai 2 dalam 28 hari
  // (terkoreksi sendiri di periode berikutnya karena riwayat ikut dihitung); tidak boleh lebih dari itu
  assert.ok(Math.max(...hk) - Math.min(...hk) <= 2, `hari kerja tidak merata: ${hk}`)
  // di konfigurasi lain keadilan akhir pekan dan HK tercapai sekaligus
  for (const [n, p, s, hariN] of [[10, 3, 3, 30], [12, 4, 3, 28], [9, 3, 2, 42], [6, 2, 2, 35]]) {
    const idk = riders(n), h = rentang('2026-10-26', hariN), g = buatDraf(idk, h, p, s).grid, w = akhirPekanSeq(h)
    const nw = idk.map((id) => w.filter((d) => g[`${id}|${d}`]).length), nh = idk.map((id) => hitung(g, id))
    assert.ok(Math.max(...nw) - Math.min(...nw) <= 1, `${n} rider: akhir pekan ${nw}`)
    assert.ok(Math.max(...nh) - Math.min(...nh) <= 1, `${n} rider: hari kerja ${nh}`)
  }
})

test('rotasi shift: rider yang sudah terlalu lama di pagi ditukar ke siang setelah libur (bukan sebelum selisihnya besar)', () => {
  const dasar = { r2: riw({ hk: 9 }), r3: riw({ hk: 9 }) }
  const timpang = buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: { ...dasar, r1: riw({ hk: 0, shiftTerakhir: 'pagi', pagi: 10, siang: 0 }) } })
  assert.equal(timpang.grid['r1|2026-10-26'], 'siang')
  const wajar = buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: { ...dasar, r1: riw({ hk: 0, shiftTerakhir: 'pagi', pagi: 3, siang: 0 }) } })
  assert.equal(wajar.grid['r1|2026-10-26'], 'pagi')
})

test('ringkasanKeadilan: hari kerja, pagi, siang, akhir pekan, libur per rider', () => {
  const hari = rentang('2026-10-30', 4) // Jum, Sab, Min, Sen
  const grid = { 'r1|2026-10-30': 'pagi', 'r1|2026-10-31': 'pagi', 'r1|2026-11-01': 'siang', 'r2|2026-11-02': 'siang', 'r2|2026-10-30': 'off' }
  const s = ringkasanKeadilan(grid, ['r1', 'r2', 'r3'], hari)
  assert.deepEqual(s.r1, { hk: 3, pagi: 2, siang: 1, akhirPekan: 2, libur: 1 })
  assert.deepEqual(s.r2, { hk: 1, pagi: 0, siang: 1, akhirPekan: 0, libur: 3 }) // 'off' bukan hari kerja
  assert.deepEqual(s.r3, { hk: 0, pagi: 0, siang: 0, akhirPekan: 0, libur: 4 })
})

test('pola absen & cadangan: hanya dari absensi yang sudah diisi; data sedikit tidak ditebak; cadangan dibatasi', () => {
  const senin8 = Array.from({ length: 8 }, (_, i) => new Date(Date.parse('2026-09-07T00:00:00Z') + i * 7 * 864e5).toISOString().slice(0, 10)) // 8 Senin
  const jadwal = [], actual = []
  for (const [h, hariKe] of [[0, senin8], [1, senin8.map((d) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10))], [2, senin8.map((d) => new Date(Date.parse(d) + 2 * 864e5).toISOString().slice(0, 10))]])
    for (const d of hariKe) for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      jadwal.push({ rider_id: id, tanggal: d, shift: 'pagi' })
      if (h === 0) actual.push({ rider_id: id, tanggal: d, status: id === 'r1' || (id === 'r2' && d <= senin8[2]) ? 'alpha' : 'hadir' }) // Senin: 8 + 3 absen dari 40
      if (h === 1) actual.push({ rider_id: id, tanggal: d, status: 'hadir' }) // Selasa: tak ada yang absen
      // Rabu: absensi tak pernah diisi → tidak dihitung sama sekali
    }
  jadwal.push({ rider_id: 'r1', tanggal: '2026-09-08', shift: 'off' }) // libur tak dihitung
  const p = polaAbsen(jadwal, actual)
  assert.equal(p[0].terisi, 40)
  assert.equal(p[0].absen, 11)
  assert.equal(p[1].absen, 0)
  assert.equal(p[2].terisi, 0) // belum diisi ≠ hadir
  assert.equal(cadanganDisarankan(p[0], 12), 2) // 27,5% × 12 = 3,3 → dibatasi maks 2
  assert.equal(cadanganDisarankan(p[1], 12), 0)
  assert.equal(cadanganDisarankan({ hari: 3, terisi: 10, absen: 5, tingkat: 0.5 }, 12), 0) // data kurang dari 20 → tidak menebak
  assert.deepEqual(bagiCadangan({ pagi: 6, siang: 6 }, 2), { pagi: 7, siang: 7 })
  assert.deepEqual(bagiCadangan({ pagi: 3, siang: 1 }, 1), { pagi: 4, siang: 1 })
})

test('tanpa rider atau kuota 0: draf kosong, tidak error', () => {
  assert.deepEqual(buatDraf([], hari7, 2, 1).grid, {})
  assert.equal(buatDraf([], hari7, 2, 1).kurang.length, 7)
  assert.deepEqual(buatDraf(riders(3), hari7, 0, 0), { grid: {}, kurang: [], langgar: [] })
})

test('shift cenderung konsisten: rider pagi tetap pagi bila memungkinkan', () => {
  const ids = riders(6)
  const { grid } = buatDraf(ids, hari7, 3, 3) // semua rider masuk tiap hari, 6 hari maksimal
  const campur = ids.filter((id) => {
    const s = new Set(Object.entries(grid).filter(([k]) => k.startsWith(id + '|')).map(([, v]) => v))
    return s.size > 1
  })
  assert.ok(campur.length <= 2, `terlalu sering berganti shift: ${campur}`)
})

test('awal tanpa riwayat: pagi tidak dibagikan ke nama-nama pertama saja (urutan abjad tidak menentukan siapa kebagian pagi)', () => {
  const ids = riders(10)
  const { grid } = buatDraf(ids, ['2026-10-26'], 5, 5)
  const pagi = ids.filter((id) => grid[`${id}|2026-10-26`] === 'pagi')
  assert.equal(pagi.length, 5)
  assert.notDeepEqual(pagi, ids.slice(0, 5)) // dulu: r1–r5 semuanya pagi dan r6–r10 semuanya siang
})

test('beberapa minggu berturut-turut: porsi pagi tiap rider berdekatan, hari kerja tetap rata, tanpa pelanggaran shift', () => {
  const ids = riders(15)
  const geserHari = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
  let senin = '2026-10-26'
  let semua = []
  for (let w = 0; w < 12; w++) {
    const hari = Array.from({ length: 7 }, (_, i) => geserHari(senin, i))
    const riwayat = hitungRiwayat(semua.filter((r) => r.tanggal >= geserHari(senin, -28)), ids, senin)
    const { grid, langgar, kurang } = buatDraf(ids, hari, 6, 4, { riwayat })
    assert.deepEqual(langgar, [], `minggu ${w + 1}`)
    assert.deepEqual(kurang, [], `minggu ${w + 1}`)
    semua = semua.concat(barisDari(grid))
    senin = geserHari(senin, 7)
  }
  const porsi = ids.map((id) => semua.filter((r) => r.rider_id === id && r.shift === 'pagi').length / semua.filter((r) => r.rider_id === id).length)
  const hk = ids.map((id) => semua.filter((r) => r.rider_id === id).length)
  assert.ok(Math.max(...porsi) - Math.min(...porsi) <= 0.15, `porsi pagi ${Math.min(...porsi).toFixed(2)}–${Math.max(...porsi).toFixed(2)}`) // dulu 0.29–0.77
  assert.ok(Math.max(...hk) - Math.min(...hk) <= 2, `hari kerja ${Math.min(...hk)}–${Math.max(...hk)}`)
})
