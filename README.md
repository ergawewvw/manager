# Daily Diary — xususiy kundalik

Shaxsiy kundalik uchun yangi rejim: **faqat egasi kiradi, mehmonlar esa maxfiy ishonch kodi bilan faqat o‘qiydi**.

## Sahifalar

- `index.html` — egasi uchun email/parol orqali login. Yangi akkaunt yaratish tugmasi yo‘q.
- `visitor.html` + `visitor.js` — mehmon email/parolsiz, faqat egasi bergan ulashish nomi va 32 belgili kod bilan yozuvlarni o‘qiydi.
- `sharing.html` + `sharing.js` — faqat egasi kod yaratadi, o‘zgartiradi yoki bekor qiladi. Kod 1, 7 yoki 30 kun amal qiladi.
- `admin.html` — faqat administrator uchun foydalanuvchilar ro‘yxati.

## Xavfsizlik

Supabase `public.diary_entries` jadvali RLS orqali faqat admin akkauntining shaxsiy yozuvlarini o‘qish/yozish/tahrirlash/o‘chirishga ruxsat beradi. Avvalgi account-to-account ulashish RPC huquqlari va siyosatlari bekor qilingan. Anonymous mehmonlar jadvalni to‘g‘ridan-to‘g‘ri o‘qiy olmaydi; faqat `read_private_diary_with_code` RPC orqali kod tekshiruvidan o‘tgan yozuvlarni oladi. Kod bazada xesh shaklida saqlanadi va eski kodni almashtirish / bekor qilish server darajasida qo‘llanadi.

**Muhim:** Kodni kimga bersangiz, u kodning amal qilish muddati davomida barcha kundalik yozuvlarini o‘qiy olishi mumkin. Kodni hech qachon GitHub repository yoki ochiq xabarga qo‘ymang.

## Saytning umumiy ochiqligi haqida

Saytning **kirish sahifasi** internetda ochiq bo‘lishi mumkin; **kundalik yozuvlari** esa maxfiy qoladi. GitHub repository hozircha public; uni private qilish alohida GitHub sozlamasi. GitHub Pages'ning alohida *private site* rejimi odatda Enterprise Cloud tashkilotlariga mo‘ljallangan. Oddiy GitHub Pages'da kodli mehmonlarni qabul qilish uchun kirish sahifasi internetdan ochiladigan bo‘lishi kerak.

Supabase'ning o‘zida yangi foydalanuvchilar ro‘yxatdan o‘tishini ham butunlay o‘chirish uchun **Authentication → Settings → Allow new users to sign up** opsiyasini o‘chiring. Bu sozlama frontenddagi tugmani yashirishdan farq qiladi; sayt faqat mavjud owner akkauntini qabul qiladi.

Sayt haqiqiy brauzerda va haqiqiy egasi login ma'lumotlari bilan boshidan oxirigacha sinovdan o‘tkazilmagan.
