// ══════════════════════════════════════════════════════════════════
// TAMBAHAN UNTUK Code.gs — JYFC Website Integration
// ══════════════════════════════════════════════════════════════════
// CARA PAKAI:
// 1. Buka Apps Script kamu
// 2. Buka file Code.gs
// 3. Scroll ke paling bawah
// 4. Copy-paste semua kode di bawah ini
// 5. Simpan, lalu Deploy ulang (New Deployment)
// ══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────
// doPost — endpoint untuk website JYFC
// Ini TERPISAH dari doGet yang sudah ada untuk kasir.
// Apps Script bisa handle keduanya sekaligus.
// ──────────────────────────────────────────────────────────────────
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse(e.postData.contents);
    let result = {};

    switch (payload.action) {
      case 'lookupMember':
        result = website_lookupMember(payload.phone);
        break;
      case 'registerMember':
        result = website_registerMember(payload.name, payload.phone);
        break;
      case 'saveOrder':
        result = website_saveOrder(payload);
        break;
      case 'saveVisit':
        result = website_saveVisit(payload.phone, payload.name);
        break;
      default:
        result = { ok: false, error: 'Unknown action: ' + payload.action };
    }

    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }

  return output;
}

// ──────────────────────────────────────────────────────────────────
// website_lookupMember
// Cari member berdasarkan nomor HP.
// Pakai sheet Member yang SUDAH ADA di Code.gs kamu.
// Return: { found, name, phone, lastVisit, totalOrders, lastOrders[] }
// ──────────────────────────────────────────────────────────────────
function website_lookupMember(phone) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); // pakai SPREADSHEET_ID yang sudah ada
  const memberSheet = ss.getSheetByName('Member');
  const trxSheet    = ss.getSheetByName('Transaksi');

  if (!memberSheet) return { found: false, error: 'Sheet Member tidak ditemukan' };

  const telpCari = normTelp(phone); // pakai normTelp() yang sudah ada di Code.gs
  if (!telpCari) return { found: false };

  const data = memberSheet.getDataRange().getValues();
  // Header: Nama | Telepon | Tanggal Daftar | Total Kunjungan | Total Belanja | Riwayat Kehadiran
  for (let i = 1; i < data.length; i++) {
    if (normTelp(data[i][1]) === telpCari) {
      // Ambil 3 transaksi online terakhir
      const lastOrders = trxSheet ? website_getLastOrders(trxSheet, telpCari, 3) : [];

      return {
        found: true,
        name:         String(data[i][0]),
        phone:        telpCari,
        lastVisit:    data[i][2] ? String(data[i][2]) : null,
        totalVisits:  Number(data[i][3]) || 0,
        totalBelanja: Number(data[i][4]) || 0,
        lastOrders
      };
    }
  }
  return { found: false };
}

// ──────────────────────────────────────────────────────────────────
// website_registerMember
// Daftarkan member baru dari website.
// Pakai format kolom yang SAMA dengan sheet Member yang sudah ada.
// ──────────────────────────────────────────────────────────────────
function website_registerMember(name, phone) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Member');
  if (!sheet) return { ok: false, error: 'Sheet Member tidak ditemukan' };

  const telpNorm = normTelp(phone);
  if (!telpNorm) return { ok: false, error: 'Nomor tidak valid' };

  // Cek duplikat
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normTelp(data[i][1]) === telpNorm) {
      return { ok: true, alreadyExists: true };
    }
  }

  // Tambah baris baru — format sama persis dengan daftarMember() yang ada
  const tanggal = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const newRow  = sheet.getLastRow() + 1;

  sheet.getRange(newRow, 1).setValue(name);
  writeTelp(sheet, newRow, 2, telpNorm); // pakai writeTelp() yang sudah ada
  sheet.getRange(newRow, 3).setValue(tanggal);
  sheet.getRange(newRow, 4).setNumberFormat('0').setValue(0);
  sheet.getRange(newRow, 5).setNumberFormat('Rp#,##0').setValue(0);
  sheet.getRange(newRow, 6).setNumberFormat('@').setValue('');

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// website_saveOrder
// Simpan pesanan dari website ke sheet Transaksi.
// Pakai format kolom yang SAMA dengan simpanTransaksi() yang ada.
// ──────────────────────────────────────────────────────────────────
function website_saveOrder(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trxSheet    = ss.getSheetByName('Transaksi');
  const memberSheet = ss.getSheetByName('Member');

  if (!trxSheet) return { ok: false, error: 'Sheet Transaksi tidak ditemukan' };

  const now         = new Date();
  const tanggal     = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd');
  const waktu       = Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm:ss');
  const noTransaksi = 'WEB' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMddHHmmss');
  const telpNorm    = normTelp(payload.phone);

  // Tulis 1 baris ke Transaksi (website order = 1 baris ringkasan)
  const newRow = trxSheet.getLastRow() + 1;
  trxSheet.getRange(newRow, 1, 1, 17).setValues([[
    noTransaksi,
    tanggal,
    waktu,
    payload.items,          // semua item dalam 1 string
    1,                      // qty (sudah termasuk dalam string items)
    Number(payload.total),  // total sebagai harga satuan
    Number(payload.total),  // subtotal
    'Online Order',         // notes
    Number(payload.total),  // total sebelum diskon
    '',                     // nama diskon
    0,                      // nominal diskon
    Number(payload.total),  // total order
    payload.method || 'Online - ' + (payload.channel || 'website'), // metode
    0,                      // voucher
    Number(payload.total),  // jumlah bayar
    0,                      // kembalian
    payload.name || ''      // nama member
  ]]);

  // Tulis nomor HP di kolom 18 sebagai plain text
  if (telpNorm) {
    writeTelp(trxSheet, newRow, 18, telpNorm); // pakai writeTelp() yang sudah ada
  }

  // Update sheet Member: kunjungan + belanja
  if (memberSheet && telpNorm) {
    const mData = memberSheet.getDataRange().getValues();
    for (let i = 1; i < mData.length; i++) {
      if (normTelp(mData[i][1]) === telpNorm) {
        const targetRow = i + 1;

        // Total Kunjungan +1
        memberSheet.getRange(targetRow, 4).setValue((Number(mData[i][3]) || 0) + 1);

        // Total Belanja += total
        memberSheet.getRange(targetRow, 5).setValue((Number(mData[i][4]) || 0) + Number(payload.total));

        // Riwayat Kehadiran — append bullet
        const label      = formatTanggalPendek(now); // pakai formatTanggalPendek() yang sudah ada
        const riwayatLama = mData[i][5] ? mData[i][5].toString().trim() : '';
        const riwayatBaru = riwayatLama ? riwayatLama + ' • ' + label : '• ' + label;
        memberSheet.getRange(targetRow, 6).setNumberFormat('@').setValue(riwayatBaru);

        break;
      }
    }
  }

  return { ok: true, noTransaksi };
}

// ──────────────────────────────────────────────────────────────────
// website_saveVisit
// Catat kunjungan member ke website (saat login, belum tentu order).
// Update Total Kunjungan + Riwayat Kehadiran saja.
// ──────────────────────────────────────────────────────────────────
function website_saveVisit(phone, name) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Member');
  if (!sheet) return { ok: false, error: 'Sheet Member tidak ditemukan' };

  const telpNorm = normTelp(phone);
  if (!telpNorm) return { ok: false, error: 'Nomor tidak valid' };

  const now  = new Date();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (normTelp(data[i][1]) === telpNorm) {
      const row = i + 1;

      // Update Tanggal Daftar kolom 3 (pakai sebagai "last seen")
      sheet.getRange(row, 3).setValue(Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'));

      // Total Kunjungan +1
      sheet.getRange(row, 4).setValue((Number(data[i][3]) || 0) + 1);

      // Riwayat Kehadiran — append
      const label       = formatTanggalPendek(now);
      const riwayatLama = data[i][5] ? data[i][5].toString().trim() : '';
      const riwayatBaru = riwayatLama ? riwayatLama + ' • ' + label : '• ' + label;
      sheet.getRange(row, 6).setNumberFormat('@').setValue(riwayatBaru);

      return { ok: true };
    }
  }

  return { ok: false, error: 'Member tidak ditemukan' };
}

// ──────────────────────────────────────────────────────────────────
// website_getLastOrders
// Ambil N transaksi online terakhir dari sheet Transaksi
// ──────────────────────────────────────────────────────────────────
function website_getLastOrders(trxSheet, phone, n) {
  const data    = trxSheet.getDataRange().getValues();
  const results = [];

  // Cari dari bawah (terbaru dulu)
  for (let i = data.length - 1; i >= 1; i--) {
    const noTrx    = data[i][0] ? String(data[i][0]).trim() : '';
    const telpRow  = normTelp(data[i][17]); // kolom 18 = telepon member
    const metode   = data[i][12] ? String(data[i][12]) : '';

    // Filter: hanya transaksi online (no transaksi mulai WEB)
    if (!noTrx.startsWith('WEB')) continue;
    if (telpRow !== phone) continue;

    results.push({
      date:   data[i][1] ? String(data[i][1]) : '',
      items:  data[i][3] ? String(data[i][3]) : '',
      total:  data[i][11] ? Number(data[i][11]) : 0,
      method: metode
    });

    if (results.length >= n) break;
  }

  return results;
}
