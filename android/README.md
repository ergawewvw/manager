# Daily Diary Android preview

Android 8.0+ uchun mavjud HTTPS kundalikni ochadigan kichik WebView ilova. Internet talab qilinadi. Mavjud akkaunt, mehmon kodi va yozuvlar ishlatiladi; yangi ma’lumotlar bazasi kerak emas.

- `FLAG_SECURE` barcha ilova oynalarida yoqilgan; Android 13+ recent-app skrinshoti ham o‘chirilgan.
- Faqat `https://ergawewvw.github.io/manager/` manzillari WebView’da ochiladi. TLS tekshiruvi chetlab o‘tilmaydi, HTTP, file access, begona navigatsiya va WebView debugging o‘chirilgan.
- JSON import Android fayl tanlagichidan, eksport origin bilan cheklangan WebMessageListener va Android «Save as» oynasi orqali ishlaydi. Eksport xabari ko‘pi bilan 10 MiB belgidan iborat; undan katta zaxira uchun brauzerdan foydalaning. Android System WebView yangilangan bo‘lsin.
- Sessiya WebView’ning qurilmadagi mahalliy saqlashida qoladi; app backup o‘chirilgan. Saqlanmagan draft jarayon yopilsa yo‘qolishi mumkin.
- Email tasdiqlash va recovery havolalari hozircha odatiy brauzerda ochiladi. Maxsus app/deep link hali yo‘q. Recovery tugagach ilovada qayta login qiling.

## Yig‘ish

JDK 17, Gradle 8.11.1 va Android SDK 35 bilan `android/` ichida:

```sh
gradle testDebugUnitTest lintDebug assembleDebug
```

Yoki GitHub Actions → **Android APK** → eng so‘nggi muvaffaqiyatli run → **Daily-Diary-Android-preview** artifact. APK debug sertifikat bilan imzolangan sinov versiyasi, lekin WebView va app debugging o‘chirilgan. CI’ning keyingi yig‘ilishida sinov sertifikati o‘zgarishi mumkin; bunday holda eski preview ilovani o‘chirib yangisini o‘rnating. Saqlangan yozuvlar serverda qoladi. Ommaviy tarqatishdan oldin alohida barqaror release signing va real qurilma sinovlari kerak; maxfiy signing kalitini repoga qo‘shmang.

`FLAG_SECURE` oddiy Android skrinshot/ekran ulashish yo‘llarini cheklaydi. Root qilingan qurilma, OS xatosi va tashqi kamera uchun kafolat bermaydi. Veb-sayt brauzerda ochilsa bu native himoya qo‘llanmaydi.
