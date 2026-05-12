document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("mobileMenuBtn");
  if (!btn) return;

  const current = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  const links = [
    { href: "index.html", label: "Home" },
    { href: "bemutatkozas.html", label: "Bemutatkozás" },
    { href: "szolgaltatasok.html", label: "Szolgáltatások" },
    { href: "arlista.html", label: "Árlista" },
    { href: "foglalas.html", label: "Időpontfoglalás" },
    { href: "kapcsolat.html", label: "Kapcsolat" },
  ];

  const baseLinkClass =
    "rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3.5 text-base font-semibold text-white/90 hover:bg-white/[0.09]";

  const activeLinkClass =
    "rounded-2xl border border-teal-300/30 bg-teal-300/15 px-5 py-3.5 text-base font-semibold text-teal-100 ring-1 ring-teal-300/20";

  const menu = document.createElement("div");
  menu.id = "mobileMenu";
  menu.className = "md:hidden hidden fixed inset-0 z-[100] bg-emerald-950/95 backdrop-blur-xl";

  menu.innerHTML = `
    <div class="flex min-h-screen flex-col px-5 pt-10 pb-5">

      <div class="flex items-center justify-between border-b border-white/10 pb-4">
        <a href="index.html" class="flex items-center gap-3">
          <img
            src="/assets/img/logo.svg"
            alt="Zöld Tara háza logó"
            class="h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.25)]"
          >
        </a>

        <button id="mobileMenuClose"
          type="button"
          aria-label="Menü bezárása"
          class="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/85">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <nav class="mt-8 flex flex-col gap-3">
        ${links.map(link => {
          const page = link.href.toLowerCase();
          const isActive = page === current;

          return `
            <a href="${link.href}"
               class="${isActive ? activeLinkClass : baseLinkClass}"
               ${isActive ? 'aria-current="page"' : ""}>
              ${link.label}
            </a>
          `;
        }).join("")}
      </nav>

      <div class="mt-auto border-t border-white/10 pt-4 text-center text-xs text-white/45">
        Zöld Tara háza
      </div>

    </div>
  `;

  document.body.appendChild(menu);

  const closeBtn = document.getElementById("mobileMenuClose");

  function openMenu() {
    menu.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  }

  function closeMenu() {
    menu.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  }

  btn.addEventListener("click", openMenu);
  closeBtn?.addEventListener("click", closeMenu);

  menu.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
});