# Keuangan Keluarga 💰

Aplikasi web sederhana untuk **mencatat pemasukan & pengeluaran keluarga**, lengkap
dengan ringkasan bulanan, grafik per kategori, dan saran keuangan sehat.
Dibuat dengan **HTML + CSS + JavaScript murni** (tanpa framework), data & login
memakai **Supabase**, dan dihosting gratis di **GitHub Pages**. Bisa dipasang ke
layar utama HP ("Add to Home Screen") karena sudah berupa PWA.

## ✨ Fitur

- **Login email + password** dengan fitur **lupa password**.
- **Buat keluarga** (otomatis jadi Admin & dapat **kode undangan unik**) atau
  **gabung keluarga** memakai kode.
- **Privasi berbasis peran** yang ditegakkan di database (Row Level Security):
  - **Anggota** hanya melihat & mengelola transaksi **miliknya sendiri**.
  - **Admin/Kepala Keluarga** melihat data **semua anggota** (total gabungan &
    rincian per anggota), namun **tidak bisa mengubah** transaksi anggota lain.
- **Ringkasan bulanan**: total pemasukan, pengeluaran, saldo, grafik pengeluaran
  per kategori, dan daftar transaksi terbaru.
- **Kelola kategori** keluarga (tambah/edit/hapus), dengan kategori default
  otomatis saat keluarga dibuat.
- **Saran keuangan sehat** berbasis data (rasio tabungan, rasio pengeluaran,
  kategori terbesar, perbandingan dengan bulan lalu, pesan motivasi).
- **Mata uang Rupiah** dengan format ribuan Indonesia, antarmuka Bahasa Indonesia,
  responsif untuk HP & desktop.

---

## 🗂️ Struktur Proyek

```
index.html              Halaman utama (semua tampilan)
css/style.css           Gaya responsif
js/config.js            ISI INI: Supabase URL + anon key
js/supabase.js          Inisialisasi koneksi Supabase
js/utils.js             Format Rupiah/tanggal, helper UI
js/data.js              Lapisan data (auth, RPC, query)
js/auth.js              Alur daftar/login/lupa-password
js/summary.js           Ringkasan + grafik kategori
js/advice.js            Mesin saran keuangan
js/app.js               Navigasi & seluruh UI aplikasi
manifest.webmanifest    Konfigurasi PWA
service-worker.js       Cache untuk PWA/offline
icons/                  Ikon aplikasi (PNG)
supabase/schema.sql     Skema tabel + RLS + fungsi (tempel ke Supabase)
scripts/generate_icons.py  Skrip pembuat ikon (opsional)
```

---

## 🚀 Panduan Setup (lengkap)

### 1) Buat project Supabase
1. Daftar/masuk di <https://supabase.com> → **New project**.
2. Isi nama project & **Database Password** (simpan), pilih region terdekat
   (mis. Singapore), lalu **Create new project**. Tunggu beberapa menit.

### 2) Pasang skema database + RLS
1. Di dashboard Supabase, buka **SQL Editor** → **New query**.
2. Buka berkas [`supabase/schema.sql`](supabase/schema.sql) di repo ini,
   **salin seluruh isinya**, tempel ke editor, lalu klik **Run**.
3. Pastikan muncul "Success". Ini membuat tabel `families`, `profiles`,
   `categories`, `transactions`, beserta seluruh policy keamanan & fungsi.

### 3) Matikan verifikasi email (agar pendaftaran langsung aktif)
1. Buka **Authentication** → **Providers** (atau **Sign In / Providers**) →
   **Email**.
2. **Matikan** opsi **"Confirm email"** (di sebagian dashboard namanya
   *"Enable email confirmations"* di **Authentication → Settings**).
3. Klik **Save**.

> Jika langkah ini dilewati, pengguna harus klik tautan verifikasi di email
> sebelum bisa membuat/gabung keluarga.

### 4) Atur URL aplikasi (penting untuk "lupa password")
1. Buka **Authentication** → **URL Configuration**.
2. **Site URL**: isi URL aplikasi Anda nanti, contoh
   `https://USERNAME.github.io/keuangan-keluarga/`.
3. **Redirect URLs**: tambahkan URL yang sama. (Jika ingin uji lokal, tambahkan
   juga `http://localhost:8000/`.)
4. **Save**.

### 5) Ambil URL + anon key, lalu isi `js/config.js`
1. Buka **Project Settings** → **API** (di sebagian dashboard: **Data API**
   untuk *Project URL* dan **API Keys** untuk kunci).
2. Salin **Project URL** dan kunci **anon public**.
3. Buka [`js/config.js`](js/config.js) dan isi:
   ```js
   window.KK_CONFIG = {
     SUPABASE_URL: "https://abcdwxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi....(kunci anon Anda)"
   };
   ```
4. Simpan, lalu **commit & push** perubahan ini ke GitHub.

> 🔒 **Aman?** Ya. URL dan *anon key* memang dirancang untuk publik. Keamanan
> data dijaga oleh **Row Level Security** di database, bukan oleh kerahasiaan
> kunci ini.

### 6) Aktifkan GitHub Pages
1. Push proyek ini ke repository GitHub Anda (lihat catatan branch di bawah).
2. Di repo GitHub: **Settings** → **Pages**.
3. **Source**: pilih **Deploy from a branch**.
4. **Branch**: pilih branch yang berisi kode ini (mis. `main`) dan folder
   **`/ (root)`**, lalu **Save**.
5. Tunggu 1–2 menit. URL aplikasi akan muncul di halaman itu, biasanya
   `https://USERNAME.github.io/keuangan-keluarga/`.

> Pastikan **Site URL/Redirect URLs** di langkah 4 sesuai dengan URL Pages ini.

### 7) Coba!
1. Buka URL aplikasi → **Daftar** → isi nama, email, password, pilih
   **Buat keluarga baru** → daftar.
2. Anda menjadi **Admin** dan mendapat **kode keluarga** (lihat menu **Keluarga**).
3. Anggota lain mendaftar → pilih **Gabung keluarga** → masukkan kode tersebut.
4. Tambah transaksi lewat tombol **＋ Tambah**.

---

## 📱 Pasang ke Layar Utama (Add to Home Screen)
- **Android (Chrome)**: buka situs → menu ⋮ → **Add to Home screen / Install app**.
- **iPhone (Safari)**: buka situs → tombol **Share** → **Add to Home Screen**.

> Aplikasi juga menampilkan **petunjuk pasang otomatis**: tombol **"Pasang"** di
> Android/Chrome (& desktop), dan **banner langkah** di iPhone/iPad. Petunjuk ini
> hilang setelah ditutup atau setelah aplikasi terpasang.

---

## 🧪 Menjalankan secara lokal (opsional)
Karena memakai `fetch`/service worker, jalankan lewat server kecil (bukan
membuka file langsung):
```bash
# dari folder proyek
python3 -m http.server 8000
# lalu buka http://localhost:8000
```
Tambahkan `http://localhost:8000/` ke **Redirect URLs** Supabase bila ingin
menguji alur lupa password secara lokal.

---

## 🔐 Bagaimana privasi ditegakkan
Semua aturan ada di [`supabase/schema.sql`](supabase/schema.sql) sebagai policy RLS:
- `transactions`: `SELECT` diizinkan bila **milik sendiri** *atau* (peminta
  **admin** dan **sefamili**). `INSERT/UPDATE/DELETE` hanya untuk **milik sendiri** —
  jadi admin pun **tidak bisa** mengubah transaksi anggota lain.
- `profiles`: setiap orang melihat profilnya; admin melihat profil sefamili.
  Kolom `role`/`family_id` dilindungi trigger agar tak bisa diubah lewat API.
- Pendaftaran (`create_family` / `join_family`) lewat fungsi `SECURITY DEFINER`
  sehingga tidak ada kebocoran data antar-keluarga.

Walaupun frontend menyembunyikan tombol tertentu, **database tetap menolak**
akses yang tidak berhak — sesuai permintaan.

---

## 🆘 Pemecahan masalah
| Gejala | Penyebab & solusi |
|---|---|
| Muncul "Konfigurasi diperlukan" | `js/config.js` belum diisi dengan benar. |
| "Library Supabase gagal dimuat" | Jaringan memblokir CDN jsdelivr. Coba jaringan lain. |
| Tidak bisa daftar / harus verifikasi email | Matikan "Confirm email" (langkah 3). |
| Tautan lupa password error/redirect salah | Lengkapi Site URL & Redirect URLs (langkah 4). |
| "Gagal memuat data" setelah login | Skema/RLS belum dipasang (langkah 2). |
| Halaman 404 di GitHub Pages | Branch/folder Pages salah, atau Pages belum aktif. |

---

## 📝 Catatan branch
Kode dikembangkan di branch **`claude/inspiring-shannon-QRLFZ`**. Untuk
mengaktifkan GitHub Pages Anda bisa memilih branch ini langsung, atau merge ke
`main` lalu pilih `main` sebagai sumber Pages.
