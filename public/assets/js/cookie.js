document.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("cookieBanner");
  const overlay = document.getElementById("cookieOverlay");
  const modal = document.getElementById("cookieModal");

  const accept = document.getElementById("cookieAccept");
  const decline = document.getElementById("cookieDecline");
  const settings = document.getElementById("cookieSettings");
  const save = document.getElementById("cookieSave");

  const analytics = document.getElementById("cookieAnalytics");
  const marketing = document.getElementById("cookieMarketing");

  if (!banner || !overlay) return;

  const consent = localStorage.getItem("cookieConsent");

  function showBanner() {
    overlay.classList.remove("hidden");
    overlay.classList.remove("opacity-0");
    overlay.classList.add("opacity-100");

    banner.classList.remove("translate-y-full");
  }

  function hideAll() {
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");

    banner.classList.add("translate-y-full");

    setTimeout(() => {
      overlay.classList.add("hidden");
      modal?.classList.add("hidden");
    }, 300);
  }

  if (!consent) {
    setTimeout(showBanner, 400);
  }

  accept?.addEventListener("click", () => {
    localStorage.setItem("cookieConsent", JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true
    }));
    hideAll();
  });

  decline?.addEventListener("click", () => {
    localStorage.setItem("cookieConsent", JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: false
    }));
    hideAll();
  });

  settings?.addEventListener("click", () => {
    modal?.classList.remove("hidden");
    modal?.classList.add("flex");
  });

  save?.addEventListener("click", () => {
    localStorage.setItem("cookieConsent", JSON.stringify({
      necessary: true,
      analytics: analytics?.checked || false,
      marketing: marketing?.checked || false
    }));
    hideAll();
  });
});