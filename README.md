# Daily Diary — xususiy kundalik

Shaxsiy kundalik uchun yangi rejim: **faqat egasi kiradi, mehmonlar esa ishonch kodi va uchta maxfiy savol orqali faqat o‘qiydi**.

## Sahifalar

- `index.html` — egasi uchun email/parol orqali login. Yangi akkaunt yaratish tugmasi yo‘q.
- `visitor.html` + `visitor.js` — mehmon email/parolsiz, egasi bergan ulashish nomi va 32 belgili koddan keyin uchta maxfiy savolga javob berib yozuvlarni o‘qiydi.
- `sharing.html` + `sharing.js` — faqat egasi kod yaratadi, o‘zgartiradi yoki bekor qiladi. Kod 1, 7 yoki 30 kun amal qiladi.
- `admin.html` — faqat administrator uchun foydalanuvchilar ro‘yxati.

## Xavfsizlik

Supabase `public.diary_entries` jadvali RLS orqali faqat admin akkauntining shaxsiy yozuvlarini o‘qish/yozish/tahrirlash/o‘chirishga ruxsat beradi. Avvalgi account-to-account ulashish RPC huquqlari va siyosatlari bekor qilingan. Anonymous mehmonlar jadvalni to‘g‘ridan-to‘g‘ri o‘qiy olmaydi; faqat `read_private_diary_verified` RPC orqali kod va uchala javob tekshirilgandan keyin yozuvlarni oladi. Avvalgi `read_private_diary_with_code` RPC uchun mehmon ruxsati bekor qilingan. Kod bazada xesh shaklida saqlanadi va eski kodni almashtirish / bekor qilish server darajasida qo‘llanadi.

**Muhim:** Kod va uchala savol javoblarini bilgan mehmon kodning amal qilish muddati davomida barcha kundalik yozuvlarini o‘qiy oladi. Kodni hech qachon GitHub repository yoki ochiq xabarga qo‘ymang.

## Saytning umumiy ochiqligi haqida

Saytning **kirish sahifasi** internetda ochiq bo‘lishi mumkin; **kundalik yozuvlari** esa maxfiy qoladi. GitHub repository hozircha public; uni private qilish alohida GitHub sozlamasi. GitHub Pages'ning alohida *private site* rejimi odatda Enterprise Cloud tashkilotlariga mo‘ljallangan. Oddiy GitHub Pages'da kodli mehmonlarni qabul qilish uchun kirish sahifasi internetdan ochiladigan bo‘lishi kerak.

Supabase'ning o‘zida yangi foydalanuvchilar ro‘yxatdan o‘tishini ham butunlay o‘chirish uchun **Authentication → Settings → Allow new users to sign up** opsiyasini o‘chiring. Bu sozlama frontenddagi tugmani yashirishdan farq qiladi; sayt faqat mavjud owner akkauntini qabul qiladi.

Sayt haqiqiy brauzerda va haqiqiy egasi login ma'lumotlari bilan boshidan oxirigacha sinovdan o‘tkazilmagan.

## Sessiya va mehmon oynasini yopish

Sessiya tugaganda yoki egasi hisobdan chiqqanda yozuvlar, tahrir oynasidagi saqlanmagan matn, qidiruv va hisob ma’lumotlari sahifadan tozalanadi. Eski login yoki saqlash so‘rovining kechikkan javobi yopilgan sessiya interfeysini qayta ochmaydi.

Mehmon kodni tekshirish davomida ham “Kundalikni yopish / so‘rovni bekor qilish” tugmasidan foydalanishi mumkin. Bu amal sahifada natijani ko‘rsatishni bekor qiladi; serverga yuborilgan so‘rovni yoki egasi bergan kodni bekor qilmaydi.

### Tekshirish

Node.js 20+ bilan `node --test tests/privacy.cjs` buyrug‘ini bajaring. Testlar haqiqiy HTML/JS kodini soddalashtirilgan DOM va boshqariladigan Supabase javoblari bilan tekshiradi. Haqiqiy brauzer ko‘rinishi yoki jonli Supabase loginini tekshirmaydi.

## Yozish va zaxiralash

- Yangi yozuvga o‘tish, tahrirni bekor qilish yoki hisobdan chiqishdan oldin saqlanmagan matn uchun tasdiq so‘raladi. Sahifadan chiqishda brauzer ham ogohlantirishi mumkin.
- `Ctrl+S` / `Cmd+S` joriy yozuvni saqlaydi. Matn ostida so‘zlar va belgilar soni ko‘rinadi.
- Qidiruvni oy filtri bilan birga ishlatish va filtrlarni bir tugmada tozalash mumkin.
- “JSON zaxira yuklab olish” barcha yuklangan yozuvlarni yuklab beradi; qidiruv filtri zaxirani cheklamaydi. Login, parol, sessiya va ishonch kodi zaxiraga kirmaydi. Faylda kundalik matni ochiq ko‘rinishda bo‘ladi. JSON import hali qo‘shilmagan.
- Yozuvlar bazadan 500 tadan sahifalab olinadi; yuklash xatosidan keyin qayta urinish tugmasi bor.
- Saqlash/o‘chirish vaqtida tahrir tugmalari, kod yaratish/bekor qilish vaqtida esa ikkala amal qulflanadi. Xatoda matn saqlanib qoladi va qayta urinish mumkin.
- Admin va ishonch kodi sahifalari sessiya tugaganda shaxsiy ma’lumotlarni tozalaydi. Kechikkan javoblar ularni qayta ko‘rsata olmaydi.

## Mehmon uchun ikki bosqichli tekshiruv

1. `get_private_diary_questions` amaldagi ishonch kodini tekshiradi va faqat uchta savol matnini qaytaradi.
2. `read_private_diary_verified` har bir so‘rovda kod va uchala javobni serverda tekshiradi. Faqat shundan keyin yozuvlar qaytadi. To‘g‘ri kod bilan savollarni chetlab o‘tib bo‘lmaydi.

Avvaldan `diary_questions`da belgilangan savollar va SHA-256 javob xeshlari ishlatiladi; xeshlar mijozga yuborilmaydi. Javoblar bosh/oxir bo‘shliqlarsiz tekshiriladi; mavjud xeshlarga moslik uchun kichik harfga o‘tkazilgan va asl harfli variantlar qabul qilinadi. Bu mustaqil autentifikatsiya faktori (TOTP) emas, qo‘shimcha bilim tekshiruvidir.

5 xato urinishdan keyin **shu ishonch kodi uchun barcha mehmonlar** kamida 24 soatga bloklanadi. Kod yangilansa yangi urinishlar oynasi boshlanadi. Kod va javoblar brauzer xotirasidagina ushlanadi; localStorage yoki URLga yozilmaydi. Yopishda ular tozalanadi. Avval o‘qib olingan matnni server qaytarib ola olmaydi.

`db/guest_verification.sql` hosted Supabase uchun sxema o‘zgarishi. `db/test_guest_verification.sql` sun’iy ma’lumotlar va SQL assertlarini o‘z ichiga oladi; skript o‘zi `BEGIN` / `ROLLBACK` bilan tugaydi. Uni sxema qo‘llangandan keyin ishlating; vaqtinchalik savol xeshlari, kod va yozuv yakunda saqlanmaydi.

### Javob yozilishlarini moslashtirish

`db/normalize_guest_answers.sql` yangilanishi sanalarning matnli (iyun/June/июнь), raqamli kun-oy-yil va ISO yil-oy-kun shakllarini bir xil qiymatga aylantiradi. Ismlarda Unicode shakli, katta-kichik harf, bo‘shliq va tinish belgilari birxillashtiriladi. Noto‘g‘ri sana yoki boshqa ism qabul qilinmaydi. Eski javob xeshlari bilan moslik ham saqlanadi. Shaxsiy javoblar kodga yoki repozitoriyga yozilmaydi; ular alohida bazada xeshlanadi.

`db/test_guest_normalization.sql` sinovlari sun’iy javoblar bilan o‘tadi va barcha o‘zgarishlarni rollback qiladi.
