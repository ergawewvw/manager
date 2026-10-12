# Daily Diary

Shaxsiy kundalik: email/parol bilan ro‘yxatdan o‘tish va kirish, yozuvlarni saqlash, qidirish, tahrirlash va o‘chirish.

## Sayt sahifalari

- `index.html` — asosiy kundalik va login sahifasi. Menyuda «Mehmonlar / Ulashish» havolasi mavjud. «Admin panel» faqat maxsus ruxsatga ega akkauntga ko‘rinadi.
- `sharing.html` va `sharing.js` — ruxsat kodi yaratish, kodni bekor qilish va boshqa kishining kundaligini **faqat o‘qish**.
- `admin.html` — faqat administrator uchun foydalanuvchilar ro‘yxati.

## Ulashish

1. Ikkala odam ham akkaunt yaratib, saytga login qiladi.
2. Egasi «Mehmonlar / Ulashish» sahifasida nom va 1/7/30 kunlik kod yaratadi.
3. Egasi nom va kodni ishonchli odamga yuboradi.
4. Mehmon shu nom va kodni o‘z akkaunti orqali kiritib, «Ruxsat berilgan kundaliklar»dan kundalikni ochadi.
5. Egasi kodni yangilashi yoki ruxsatlarni bekor qilishi mumkin; yangi kod eski ruxsatlarni bekor qiladi.

Kodni faqat ishonchli odamlarga bering. Kodni biladigan har qanday login qilgan foydalanuvchi ruxsat olishi mumkin. Yozuvlarni egasidan boshqa foydalanuvchi tahrirlay olmaydi.

## Xavfsizlik

Supabase RLS va `auth.uid()` yozuv egasini aniqlaydi. Kod orqali berilgan ruxsat vaqtinchalik va faqat o‘qish uchun. Admin ruxsati emailga qarab brauzerda emas, server tomonidagi maxsus jadval va ruxsat tekshiruvchi RPC orqali berilgan. Admin API oddiy akkauntga foydalanuvchilar ro‘yxatini qaytarmaydi.

`index.html`, `sharing.html` va `admin.html` GitHub Pages orqali e'lon qilinishi mumkin. GitHub Pages uchun repository Settings → Pages bo‘limida **Deploy from a branch: main / (root)** variantini tanlang. Veb-saytni internetda ochish imkoniyati va Supabase Auth redirect URL sozlamalarini alohida tekshiring.

**Eslatma:** haqiqiy login bilan end-to-end brauzer sinovi hali o'tkazilmagan.
