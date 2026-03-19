(() => {
  // --- DOM ---
  const el = (id) => document.getElementById(id);

  const termsCheckbox = el("termsCheckbox");

  const serviceSelect = el("serviceSelect");
  const btnReloadServices = el("btnReloadServices");
  const serviceHint = el("serviceHint");

  const btnPrevMonth = el("btnPrevMonth");
  const btnNextMonth = el("btnNextMonth");
  const monthLabel = el("monthLabel");
  const calendarGrid = el("calendarGrid");
  const calendarHint = el("calendarHint");

  const slotsCard = el("slotsCard");
  const selectedDateLabel = el("selectedDateLabel");
  const slotsGrid = el("slotsGrid");
  const slotsHint = el("slotsHint");

  const bookingForm = el("bookingForm");
  const nameInput = el("name");
  const phoneInput = el("phone");
  const emailInput = el("email");
  const noteInput = el("note");
  const btnSubmit = el("btnSubmit");
  const formHint = el("formHint");

  const summaryService = el("summaryService");
  const summaryDate = el("summaryDate");
  const summarySlot = el("summarySlot");

  const toast = el("toast");

  const btnText = document.getElementById("btnText");
  const btnSpinner = document.getElementById("btnSpinner");
  const successModal = document.getElementById("successModal");
  const closeSuccessModal = document.getElementById("closeSuccessModal");

  // --- STATE ---
  const state = {
    services: [],
    selectedServiceId: null,
    selectedServiceName: null,
    selectedDate: null, // YYYY-MM-DD
    selectedSlot: null, // "10:00-12:00"
    monthCursor: new Date(), // aktuális megjelenített hónap
    days: [], // [{date, status}]
  };

  // --- UTILS ---
  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function smoothScrollToElement(element, offset = 100) {
  const rect = element.getBoundingClientRect();
  const absoluteY = window.pageYOffset + rect.top - offset;

  window.scrollTo({
    top: absoluteY,
    behavior: "smooth"
  });
}
  function toMonthParam(dateObj) {
    const y = dateObj.getFullYear();
    const m = pad2(dateObj.getMonth() + 1);
    return `${y}-${m}`; // YYYY-MM
  }

  function toHUYearMonth(dateObj) {
    const y = dateObj.getFullYear();
    const m = dateObj.toLocaleString("hu-HU", { month: "long" });
    return `${y}. ${m}`;
  }

  // hétfő=0 ... vasárnap=6
  function mondayIndex(dateObj) {
    const jsDay = dateObj.getDay(); // 0 vasárnap, 1 hétfő...
    return (jsDay + 6) % 7;
  }

  function showToast(text, kind = "info") {
    toast.classList.remove("hidden");
    toast.textContent = text;

    // finom “szín” osztályok (a te designodhoz igazodva)
    toast.classList.remove("border-rose-200/20", "border-emerald-200/20");
    if (kind === "error") toast.classList.add("border-rose-200/20");
    else toast.classList.add("border-emerald-200/20");
  }

  function clearToast() {
    toast.classList.add("hidden");
    toast.textContent = "";
  }

  function resetSelectionBelowService() {
    state.selectedDate = null;
    state.selectedSlot = null;

    selectedDateLabel.textContent = "—";
    summaryDate.textContent = "—";
    summarySlot.textContent = "—";

    slotsGrid.innerHTML = "";
    slotsHint.textContent = "Válassz előbb napot a naptárban.";
    formHint.textContent = "";
    btnSubmit.disabled = true;
  }

  function updateSummary() {
    summaryService.textContent = state.selectedServiceName || "—";
    summaryDate.textContent = state.selectedDate || "—";
    summarySlot.textContent = state.selectedSlot || "—";

    btnSubmit.disabled = !(state.selectedServiceId && state.selectedDate && state.selectedSlot);
  }

  // --- API ---
  async function apiGet(url) {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`.trim());
    }
    return res.json();
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // --- SERVICES ---
  async function loadServices() {
    serviceHint.textContent = "Szolgáltatások betöltése…";
    serviceSelect.disabled = true;
    clearToast();

    try {
      const services = await apiGet("/api/services");
      state.services = services;

      serviceSelect.innerHTML = `<option value="">Válassz…</option>` +
        services.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");

      serviceSelect.disabled = false;
      serviceHint.textContent = "Válassz szolgáltatást a folytatáshoz.";
    } catch (e) {
      serviceHint.textContent = "Nem sikerült betölteni a szolgáltatásokat.";
      showToast("Hiba a szolgáltatások betöltésénél. (Fut a szerver?)", "error");
      console.error(e);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // --- CALENDAR ---
  async function loadDaysForMonth() {
    calendarHint.textContent = "Naptár betöltése…";
    calendarGrid.innerHTML = "";
    clearToast();

    try {
      const month = toMonthParam(state.monthCursor);
      const days = await apiGet(`/api/availability/days?month=${encodeURIComponent(month)}`);
      state.days = days;

      renderCalendar();
      calendarHint.textContent = "Válassz egy elérhető napot.";
    } catch (e) {
      calendarHint.textContent = "Nem sikerült betölteni a naptárat.";
      showToast("Hiba a naptár betöltésénél.", "error");
      console.error(e);
    }
  }

  function renderCalendar() {
    monthLabel.textContent = toHUYearMonth(state.monthCursor);

    const year = state.monthCursor.getFullYear();
    const month = state.monthCursor.getMonth(); // 0..11

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const offset = mondayIndex(first); // hány üres cella hétfő alapú
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const dayStatusMap = new Map(state.days.map(d => [d.date, d.status]));

    calendarGrid.innerHTML = "";

    for (let cell = 0; cell < totalCells; cell++) {
      const dayNum = cell - offset + 1;

      if (dayNum < 1 || dayNum > daysInMonth) {
        const empty = document.createElement("div");
        empty.className = "h-12 rounded-2xl border border-transparent";
        calendarGrid.appendChild(empty);
        continue;
      }

      const dateObj = new Date(year, month, dayNum);
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(dayNum)}`;

      const status = dayStatusMap.get(dateStr) || "unavailable";
      const isSelected = state.selectedDate === dateStr;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.date = dateStr;

      // base
      let cls = "h-12 w-full rounded-2xl text-sm font-medium ring-1 transition focus:outline-none focus:ring-2 focus:ring-emerald-300/30 ";

      // status styling
      if (status === "available") {
        cls += "bg-emerald-300/10 ring-emerald-200/15 hover:bg-emerald-300/15 ";
      } else if (status === "full") {
        cls += "bg-white/5 ring-white/10 opacity-70 ";
      } else {
        cls += "bg-rose-300/5 ring-rose-200/10 opacity-50 ";
      }

      // selected
      if (isSelected) {
        cls += "ring-2 ring-emerald-300/50 ";
      }

      btn.className = cls;
      btn.textContent = String(dayNum);
      btn.disabled = status !== "available";

      btn.addEventListener("click", async () => {
        state.selectedDate = dateStr;
        state.selectedSlot = null;
        selectedDateLabel.textContent = dateStr;

        summaryDate.textContent = dateStr;
        summarySlot.textContent = "—";

        renderCalendar(); // hogy látszódjon a kijelölés
        await loadSlotsForDate(dateStr);

        // scroll a slots kártyára
        slotsCard.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      calendarGrid.appendChild(btn);
    }
  }

  // --- SLOTS ---
  async function loadSlotsForDate(dateStr) {
    slotsHint.textContent = "Idősávok betöltése…";
    slotsGrid.innerHTML = "";
    clearToast();

    if (!state.selectedServiceId) {
      slotsHint.textContent = "Válassz előbb szolgáltatást.";
      return;
    }

    try {
      const data = await apiGet(`/api/availability/slots?date=${encodeURIComponent(dateStr)}&serviceId=${encodeURIComponent(state.selectedServiceId)}`);

      // data: { date, slots: [{slot, available}] }
      const slots = data?.slots || [];

      if (!slots.length) {
        slotsHint.textContent = "Nincs elérhető idősáv.";
        return;
      }

      slotsGrid.innerHTML = "";
      slots.forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.slot = s.slot;

        let cls = "rounded-2xl px-4 py-3 text-left text-sm ring-1 transition focus:outline-none focus:ring-2 focus:ring-emerald-300/30 ";
        if (s.available) {
          cls += "bg-emerald-300/10 ring-emerald-200/15 hover:bg-emerald-300/15 ";
        } else {
          cls += "bg-white/5 ring-white/10 opacity-60 cursor-not-allowed ";
        }

        if (state.selectedSlot === s.slot) {
          cls += "ring-2 ring-emerald-300/50 ";
        }

        btn.className = cls;
        btn.disabled = !s.available;
        btn.innerHTML = `
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold">${escapeHtml(s.slot)}</span>
            <span class="text-xs text-emerald-100/70">${s.available ? "Szabad" : "Foglalt"}</span>
          </div>
        `;

                btn.addEventListener("click", () => {
          state.selectedSlot = s.slot;
          updateSummary();
          renderSlotsSelection();

          formHint.textContent = "Töltsd ki az űrlapot, majd véglegesítsd a foglalást.";
          clearToast();
          btn.addEventListener("click", () => {
              state.selectedSlot = s.slot;
              updateSummary();
              renderSlotsSelection();

              formHint.textContent = "Töltsd ki az űrlapot, majd véglegesítsd a foglalást.";
              clearToast();

              // ===== AUTO SCROLL AZ ŰRLAPHOZ =====
              setTimeout(() => {
                smoothScrollToElement(bookingForm, 120);
              }, 150);
            });
          // ===== AUTO SCROLL AZ ŰRLAPHOZ =====
          setTimeout(() => {
            bookingForm.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }, 150);
        });
        slotsGrid.appendChild(btn);
      });

      slotsHint.textContent = "Válassz egy szabad idősávot.";
      renderSlotsSelection();
    } catch (e) {
      slotsHint.textContent = "Nem sikerült betölteni az idősávokat.";
      showToast("Hiba az idősávok betöltésénél.", "error");
      console.error(e);
    }
  }

  function renderSlotsSelection() {
    // “újrarajzolás” helyett végigmegyünk a gombokon és beállítjuk a kijelölést
    const buttons = slotsGrid.querySelectorAll("button[data-slot]");
    buttons.forEach((b) => {
      const slot = b.dataset.slot;
      if (!slot) return;

      b.classList.remove("ring-2", "ring-emerald-300/50");
      if (state.selectedSlot === slot) {
        b.classList.add("ring-2", "ring-emerald-300/50");
      }
    });

    updateSummary();
  }

  // --- FORM SUBMIT ---
  function validateFormClient() {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const email = emailInput.value.trim();

  if (!name) return "Add meg a neved.";
  if (!/^\d{9,15}$/.test(phone)) return "A telefonszám 9–15 számjegy legyen (csak számok).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Hibás email formátum.";

  if (!state.selectedServiceId || !state.selectedDate || !state.selectedSlot) {
    return "Válassz szolgáltatást, napot és idősávot.";
  }

  // ✅ EZ MOST JÓ HELYEN VAN
  if (!termsCheckbox || !termsCheckbox.checked) {
    return "Az ÁSZF elfogadása kötelező.";
  }

  return null;
}

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearToast();

  const err = validateFormClient();
  if (err) {
    showToast(err, "error");
    return;
  }

  // ===== LOADING UI =====
  btnSubmit.disabled = true;

  if (btnText) btnText.textContent = "Feldolgozás...";
  if (btnSpinner) btnSpinner.classList.remove("hidden");

  try {
    const payload = {
      serviceId: Number(state.selectedServiceId),
      date: state.selectedDate,
      slot: state.selectedSlot,
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
      note: noteInput.value.trim() || null
    };



    const res = await apiPost("/api/bookings", payload);

  // ===== SUCCESS =====

const successDetails = document.getElementById("successDetails");
const googleLink = document.getElementById("googleCalendarLink");

if (successDetails) {
  successDetails.textContent =
    `Az időpont rögzítésre került.

Szolgáltatás: ${state.selectedServiceName}
Dátum: ${state.selectedDate}
Idősáv: ${state.selectedSlot}

Emailben is küldtünk visszaigazolást.`;
}

if (googleLink && state.selectedDate && state.selectedSlot) {

  const [startHour, endHour] = state.selectedSlot.split("-");

  const start = new Date(`${state.selectedDate}T${startHour}:00`);
  const end = new Date(`${state.selectedDate}T${endHour}:00`);

 const formatDateLocal = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${y}${m}${d}T${h}${min}00`;
};

  const url =
    `https://www.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(state.selectedServiceName)}` +
    `&dates=${formatDateLocal(start)}/${formatDateLocal(end)}` +
    `&details=${encodeURIComponent("Időpontfoglalás - Zöld Tara háza")}`;

  googleLink.href = url;
  googleLink.classList.remove("hidden");
}

if (successModal) {
  successModal.classList.remove("hidden");
  successModal.classList.add("flex");
}

// ===== GOOGLE CALENDAR LINK =====


    await loadDaysForMonth();
    if (state.selectedDate) {
      await loadSlotsForDate(state.selectedDate);
    }

    state.selectedSlot = null;
    summarySlot.textContent = "—";

  } catch (e2) {
    if (btnSpinner) btnSpinner.classList.add("hidden");
    if (btnText) btnText.textContent = "Foglalás véglegesítése";

    btnSubmit.disabled = false;

    const msg = e2?.message || "Hiba történt.";
    showToast(msg, "error");

    if (e2?.status === 409 && state.selectedDate) {
      await loadSlotsForDate(state.selectedDate);
    }
  }
});

  // --- EVENTS ---
  serviceSelect.addEventListener("change", async () => {
  const val = serviceSelect.value;
  state.selectedServiceId = val ? Number(val) : null;
  state.selectedServiceName =
    state.services.find((s) => String(s.id) === String(val))?.name || null;

  serviceHint.textContent = state.selectedServiceId
    ? "Most válassz napot a naptárban."
    : "Válassz szolgáltatást a folytatáshoz.";

  resetSelectionBelowService();
  updateSummary();

  await loadDaysForMonth();

  // ===== AUTO SCROLL A NAPTÁRHOZ =====
  if (state.selectedServiceId) {
    setTimeout(() => {
      smoothScrollToElement(calendarGrid, 120);
      
    }, 200);
  }
});

  btnReloadServices.addEventListener("click", async () => {
    await loadServices();
        if (state.selectedServiceId) {
      document.getElementById("calendarGrid")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  btnPrevMonth.addEventListener("click", async () => {
    state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() - 1, 1);
    resetSelectionBelowService();
    await loadDaysForMonth();
  });

  btnNextMonth.addEventListener("click", async () => {
    state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + 1, 1);
    resetSelectionBelowService();
    await loadDaysForMonth();
  });

  if (closeSuccessModal && successModal) {
  closeSuccessModal.addEventListener("click", () => {
    successModal.classList.add("hidden");
    successModal.classList.remove("flex");

    // ===== FORM RESET =====
    bookingForm.reset();

    state.selectedServiceId = null;
    state.selectedServiceName = null;
    state.selectedDate = null;
    state.selectedSlot = null;

    serviceSelect.value = "";
    selectedDateLabel.textContent = "—";
    summaryService.textContent = "—";
    summaryDate.textContent = "—";
    summarySlot.textContent = "—";

    slotsGrid.innerHTML = "";
    btnSubmit.disabled = true;

    // smooth scroll vissza a tetejére
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}

  // --- INIT ---
  function init() {
    // default: aktuális hónap első napja
    state.monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    slotsHint.textContent = "Válassz előbb napot a naptárban.";
    calendarHint.textContent = "Szolgáltatás után tölthető a naptár.";
    serviceHint.textContent = "Szolgáltatások betöltése…";

    updateSummary();
    loadServices().then(loadDaysForMonth);
  }

  init();


})();
