# Daily Diary

Android sinov ilovasi: [android/README.md](android/README.md). APK GitHub Actions’dagi **Android APK** workflow orqali yig‘iladi.

Shaxsiy kundalik: har bir akkaunt o‘z yozuvlarini yaratadi, o‘qiydi, tahrirlaydi va o‘chiradi. Statik sayt GitHub Pages’da, autentifikatsiya va ma’lumotlar Supabase’da ishlaydi.

## Kundalik va tezlik

Dashboarddagi **Kundalik qidirish** bo‘limi orqali akkauntdan chiqmasdan boshqa kundalikning egasi bergan nomini kiritish mumkin. O‘qish sahifasiga faqat nom uzatiladi; ishonch kodi va uchta maxfiy savolning tekshiruvi o‘z joyida qoladi. Desktop va mobil menyuda ham bo‘limga havola bor.

- Ro‘yxat bir so‘rovda ko‘pi bilan **40 ta qisqa yozuv** oladi; to‘liq matn faqat o‘qish/tahrirlash tugmasi bosilganda keladi.
- Sana va ID bo‘yicha cursor pagination chuqur sahifalarda katta OFFSET’dan qochadi.
- Qidiruv va oy filtri serverda ishlaydi. Qidirish 300 ms kutib bajariladi; eski javob yangi natijani almashtirmaydi. `%`, `_` va boshqa belgilar oddiy qidiruv matni hisoblanadi.
- Jami/bugungi/oylik ko‘rsatkichlar sahifalash va qidiruvdan mustaqil hisoblanadi. “Bugun” foydalanuvchi qurilmasining mahalliy sanasidir.
- Yozuv sarlavhasi 120, matni 20 000 belgigacha; server ham bu chegaralarni tekshiradi.
- Supabase JS **2.118.0** MIT litsenziyasi bilan `assets/vendor/` ichida saqlangan. CDN’dan o‘zgaruvchan kod yuklanmaydi.
- JavaScript alohida fayllarda. CSP begona skriptlarni cheklaydi; ma’lumotlar faqat shu Supabase loyihasiga yuboriladi.

## Kirish va email

Kirish, ro‘yxatdan o‘tish, parolni tiklash, email tasdiqlash xatini qayta so‘rash va recovery havolasidan yangi parol o‘rnatish mavjud. Xat so‘rashlar orasida mijozda 60 soniya kutish bor; Supabase serveridagi limitlar ham amal qiladi. Bu UI kutishi serverdagi bot/rate-limit himoyasini almashtirmaydi.

Ommaviy ro‘yxatdan o‘tishdan **oldin** Supabase Dashboard’da quyidagilarni tekshiring:

1. Authentication → URL Configuration → Site URL: `https://ergawewvw.github.io/manager/index.html`. Redirect URLs’da shu **aniq URL** ham ruxsat etilgan bo‘lsin. Kod `emailRedirectTo`/`redirectTo`ni shu manzilga yuboradi. Ruxsat etilmagan redirect Supabase sozlamasidagi Site URL’ga qaytishi mumkin.
2. Email provider’da signup yoqilgan, email confirmation saqlangan bo‘lsin.
3. Production email uchun custom SMTP, yuboruvchi domen va yetkazish limitlarini sozlang. Tasdiqlash/recovery xatini boshqa qurilmada ham sinang. SMTP maxfiy kalitlarini frontend yoki GitHub’ga yozmang.
4. Leaked-password protection mavjud tarifda yoqilishi mumkin. Tarif/pullik xizmat o‘zgarishi avtomatik bajarilmaydi.

Hujjatlar: [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## JSON zaxira

Eksport qidiruv va joriy sahifadan mustaqil: serverdan 100 tadan olib, barcha yozuvlarni bitta JSON faylga yig‘adi. Boshlang‘ich maksimal ID eksport oynasini chegaralaydi; eksport davomida boshqa qurilmadan yozuvlarni o‘zgartirmaslik tavsiya qilinadi. Yozuvlar butun eksport davomida bitta DB snapshot’ida muzlatilmaydi.

Import Daily Diary `version: 1` fayllarini qabul qiladi (20 MB gacha). Fayl barcha yozuvlari tekshirilgach tasdiq so‘raladi. Har bir 100 ta yozuv alohida transaction bilan qo‘shiladi. Bir xil sana/sarlavha/matn takrorlanmaydi; eski yozuvlar ustiga yozilmaydi. Qisman tarmoq xatosidan keyin qayta yuklash mumkin. Importdagi `user_id`, ID va boshqa ortiqcha maydonlar egani o‘zgartira olmaydi. Import tarixiy `created_at`/`updated_at` qiymatlarini qayta tiklamaydi.

JSON fayl ochiq kundalik matnini saqlaydi. Login, parol, sessiya va ishonch kodi unga kiritilmaydi. Hisobdan chiqish kechikkan eksportni yuklab olishdan oldin bekor qiladi. Saqlanmagan tahrir uchun chiqish ogohlantirishi va Ctrl/Cmd+S saqlash mavjud.

## Mehmon rejimi

Avvalgi admin egasining ulashish tizimi saqlangan: nom va 32 belgili ishonch kodi, keyin uchta maxfiy savol serverda tekshiriladi. Oddiy yangi akkauntlarda mehmon kodini yaratish hozircha yo‘q; umumiy savollarni barcha foydalanuvchiga ochish xavfsiz yechim emas.

Mehmon ham 40 tadan sahifalaydi. Har bir sahifa so‘rovida kod va uchala javob qayta tekshiriladi. Sahifalar orasida yurish uchun kod/javoblar faqat faol oynaning xotirasida turadi; yopilganda tozalanadi, URL/localStorage’ga yozilmaydi. Kod yangilanishi, bekor qilinishi va muddati tugashi keyingi server so‘rovini to‘xtatadi. Avval o‘qilgan matnni server qaytarib ola olmaydi.

Bitta kod uchun 5 xato javob barcha mehmonlarni kamida 24 soatga bloklaydi. Bu yagona kodning mavjud cheklovi. `share_access` jadvali eski akkauntli sharing tizimiga tegishli; uni anonim mehmonlar soni sifatida ishlatmang. Anonim o‘qishning ishonchli yakuniy tashrif jurnali hali mavjud emas.

## Xavfsizlik va bazadagi o‘zgarishlar

`diary_entries` RLS siyosatlari `auth.uid() = user_id` bilan barcha amallarni ajratadi. Yangi sahifalash, eksport va import RPC’lari SECURITY INVOKER; faqat `authenticated` ularni chaqira oladi. Ichki `diary_private` jadvallarida ham RLS yoqilgan; oddiy rollarga jadval grantlari yo‘q. Eski kerakli SECURITY DEFINER RPC’lari owner/admin/kod tekshiruvlari bilan ishlaydi.

2026-10-20 o‘zgarishlari server yaratgan versiyalar bilan `supabase/migrations/`da saqlangan. Ular mavjud loyiha sxemasiga mo‘ljallangan; bu papka boshlang‘ich Auth/Supabase loyihasini to‘liq yaratadigan bootstrap emas. Applied migration’ni takror ishga tushirmang.

## Tekshirish va joylashtirish

Node.js 22+:

```sh
node --check app.js
node --check admin.js
node --check visitor.js
node --check sharing.js
node --test tests/privacy.cjs
```

`db/test_global_readiness.sql` — 10 000 ta vaqtinchalik yozuv va ikki vaqtinchalik akkaunt bilan haqiqiy DB/RLS, bounded pagination, literal qidiruv, to‘liq eksport va import assertlari. `db/test_guest_pages.sql` 81 ta yozuvli vaqtinchalik mehmon egasi bilan 40/40/1 sahifalarni, uch savolni, bloklashni va kodni bekor qilishni tekshiradi. Ikkalasi ham **BEGIN / ROLLBACK** bilan tugaydi. Ularni faqat boshqariladigan test oynasida ishga tushiring, yakuniy ROLLBACK’ni olib tashlamang.

GitHub Actions JS testlarini push/PR’da bajaradi. GitHub Pages mavjud `main` manbasidan joylashtiriladi. Baza migration’i frontend yangilanishidan oldin qo‘llanishi kerak. Oldingi frontend yangi bounded RPC bilan mos ishlayveradi, ammo eski mijozlar barcha sahifalarni avtomatik yig‘ishi mumkin; yangi versiyani ko‘rish uchun sahifani yangilang.

## Tekshiruvning amaliy chegarasi

DOM testlari boshqariladigan Supabase javoblari bilan ishlaydi. 10 000 ta fixture yozuv tekshiruvi bir vaqtdagi 10 000 foydalanuvchi sinovi emas. Production SMTP/redirect konfiguratsiyasi, haqiqiy email recovery oqimi va turli davlatlardan bir vaqtdagi yuklama alohida tekshirilishi kerak. Bitta mavjud DB regioni global multi-region baza degani emas. Hozirgi tekshiruvdan cheksiz foydalanuvchi yoki aniq global concurrency kafolati chiqarilmaydi.


## Ekran maxfiyligi

`privacy.js` va `privacy.css` shaxsiy kundalik, mehmonning maxfiy savollari va yozuvlari, recovery, ishonch kodi va admin ro‘yxatini himoyalaydi. Boshqa oyna/tabga o‘tish, sahifani tark etish, Esc va brauzerga yetib kelgan ayrim skrinshot tugmalari maxfiylik pardasini yoqadi. Qaytganda «Davom etish» bosiladi; draft saqlanadi. Bu faqat ekran pardasi, qayta autentifikatsiya emas. Akkaunt sessiyasi tugasa mavjud logout tozalash qoidalari ishlaydi.

Yozuvlar ochiq paytda faqat «Daily Diary» yozuvli suv belgisi bor; shaxsiy identifikatorlar yig‘ilmaydi. Print CSS brauzer menyusi va PDF chop etishda barcha sahifa ma’lumotlarini yashiradi. Egasi uchun JSON backup va ishonch kodini nusxalash saqlangan.

Oddiy veb-sahifa OS/brauzer skrinshotini, ekran yozuvini yoki tashqi kamerani to‘liq bloklay olmaydi. Blur/keyboard hodisalari kafolatli skrinshot detektori emas. CSS/JS’ni o‘zgartira oladigan o‘quvchi bu vizual choralarni chetlab o‘tishi mumkin; o‘qishga ruxsatni faqat ishonchli odamlarga bering.

Tekshirish: `node --check privacy.js` va `node --test tests/*.cjs`.
