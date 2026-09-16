
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const panel = document.getElementById("panel");

const pages = {
  publish: {
    title: "📤 Post joylash",
    text: "Bu yerda yangi post yozish va kanalga yuborish formasi bo‘ladi."
  },

  posts: {
    title: "📝 Postlar",
    text: "Bu yerda kanal postlarini ko‘rish, tahrirlash va o‘chirish bo‘ladi."
  },

  stats: {
    title: "📊 Statistika",
    text: "Bu yerda obunachilar, ko‘rishlar va boshqa kanal ko‘rsatkichlari chiqadi."
  },

  settings: {
    title: "⚙️ Sozlamalar",
    text: "Bu yerda kanal va bot sozlamalari bo‘ladi."
  }
};

document.querySelectorAll(".menu-btn").forEach(button => {
  button.addEventListener("click", () => {
    const page = pages[button.dataset.page];

    panel.innerHTML = `
      <h3>${page.title}</h3>
      <p>${page.text}</p>
    `;
  });
});
