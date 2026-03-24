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

  const btnText = el("btnText");
  const btnSpinner = el("btnSpinner");
  const successModal = el("successModal");
  const closeSuccessModal = el("closeSuccessModal");

  // --- STATE ---
  const state = {
    services: [],
    selectedServiceId: null,
    selectedServiceName: null,
    selectedDate: null, // YYYY-MM-DD
    selectedSlot: null, // "10:00-12:00"
    monthCursor: new Date(),
    days: [], // [{date, status}]
  };

  // --- UTILS ---
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function smoothScrollToElement(element, offset = 100) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const absoluteY = window.pageYOffset + rect.top - offset;

    window.scrollTo({
      top: absoluteY,
      behavior: "smooth",
    });
  }

  function toMonthParam(dateObj) {
    const y = dateObj.getFullYear();
    const m = pad2(dateObj.getMonth() + 1);
    return `${y}-${m}`;
  }

  function toHUYearMonth(dateObj) {
    const y = dateObj.getFullYear();
    const m = dateObj.toLocaleString("hu-HU", { month: "long" });
    return `${y}. ${m}`;
  }

  // hétfő=0 ... vasárnap=6
  function mondayIndex(dateObj) {
    const jsDay = dateObj.getDay();
    return (jsDay + 6) % 7;
  }

  function showToast(text, kind = "info") {
    if (!toast) return;

    toast.classList.remove("hidden");
    toast.textContent = text;

    toast.classList.remove("border-rose-200/20", "border-emerald-200/20");
    if (kind === "error") toast.classList.add("border-rose-200/20");
    else toast.classList.add("border-emerald-200/20");
  }

  function clearToast() {
    if (!toast) return;
    toast.classList.add("hidden");
    toast.textContent = "";
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function resetSelectionBelowService() {
    state.selectedDate = null;
    state.selectedSlot = null;

    if (selectedDateLabel) selectedDateLabel.textContent = "—";
    if (summaryDate) summaryDate.textContent = "—";
    if (summarySlot) summarySlot.textContent = "—";

    if (slotsGrid) slotsGrid.innerHTML = "";
    if (slotsHint) slotsHint.textContent = "Válassz előbb napot a naptárban.";
    if (formHint) formHint.textContent = "";
    if (btnSubmit) btnSubmit.disabled = true;
  }

  function updateSummary() {
    if (summaryService) summaryService.textContent = state.selectedServiceName || "—";
    if (summaryDate) summaryDate.textContent = state.selectedDate || "—";
    if (summarySlot) summarySlot.textContent = state.selectedSlot || "—";

    if (btnSubmit) {
      btnSubmit.disabled = !(
        state.selectedServiceId &&
        state.selectedDate &&
        state.selectedSlot
      );
    }
  }

  // --- API ---
  async function apiGet(url) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`.trim());
    }

    return res.json();
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
    if (serviceHint) serviceHint.textContent = "Szolgáltatások betöltése…";
    if (serviceSelect) serviceSelect.disabled = true;
    clearToast();

    try {
      const services = await apiGet("/api/services");
      state.services = services;

      if (serviceSelect) {
        serviceSelect.innerHTML =
          `<option value="">Válassz…</option>` +
          services
            .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
            .join("");
        serviceSelect.disabled = false;
      }

      if (serviceHint) serviceHint.textContent = "Válassz szolgáltatást a folytatáshoz.";
    } catch (e) {
      if (serviceHint) serviceHint.textContent = "Nem sikerült betölteni a szolgáltatásokat.";
      showToast("Hiba a szolgáltatások betöltésénél. (Fut a szerver?)", "error");
      console.error(e);
    }
  }

  // --- CALENDAR ---
  async function loadDaysForMonth() {
    if (calendarHint) calendarHint.textContent = "Naptár betöltése…";
    if (calendarGrid) calendarGrid.innerHTML = "";
    clearToast();

    try {
      const month = toMonthParam(state.monthCursor);
      const days = await apiGet(
        `/api/availability/days?month=${encodeURIComponent(month)}`
      );
      state.days = days;

      renderCalendar();
      if (calendarHint) calendarHint.textContent = "Válassz egy elérhető napot.";
    } catch (e) {
      if (calendarHint) calendarHint.textContent = "Nem sikerült betölteni a naptárat.";
      showToast("Hiba a naptár betöltésénél.", "error");
      console.error(e);
    }
  }

  function renderCalendar() {
    if (!calendarGrid) return;

    if (monthLabel) monthLabel.textContent = toHUYearMonth(state.monthCursor);

    const year = state.monthCursor.getFullYear();
    const month = state.monthCursor.getMonth();

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const offset = mondayIndex(first);
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const dayStatusMap = new Map(state.days.map((d) => [d.date, d.status]));

    calendarGrid.innerHTML = "";

    for (let cell = 0; cell < totalCells; cell++) {
      const dayNum = cell - offset + 1;

      if (dayNum < 1 || dayNum > daysInMonth) {
        const empty = document.createElement("div");
        empty.className = "h-12 rounded-2xl border border-transparent";
        calendarGrid.appendChild(empty);
        continue;
      }

      const dateStr = `${year}-${pad2(month + 1)}-${pad2(dayNum)}`;
      const status = dayStatusMap.get(dateStr) || "unavailable";
      const isSelected = state.selectedDate === dateStr;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.date = dateStr;

      let cls =
        "h-12 w-full rounded-2xl text-sm font-medium ring-1 transition focus:outline-none focus:ring-2 focus:ring-emerald-300/30 ";

      if (status === "available") {
        cls += "bg-emerald-300/10 ring-emerald-200/15 hover:bg-emerald-300/15 ";
      } else if (status === "full") {
        cls += "bg-white/5 ring-white/10 opacity-70 ";
      } else {
        cls += "bg-rose-300/5 ring-rose-200/10 opacity-50 ";
      }

      if (isSelected) {
        cls += "ring-2 ring-emerald-300/50 ";
      }

      btn.className = cls;
      btn.textContent = String(dayNum);
      btn.disabled = status !== "available";

      btn.addEventListener("click", async () => {
        state.selectedDate = dateStr;
        state.selectedSlot = null;

        if (selectedDateLabel) selectedDateLabel.textContent = dateStr;
        if (summaryDate) summaryDate.textContent = dateStr;
        if (summarySlot) summarySlot.textContent = "—";

        renderCalendar();
        await loadSlotsForDate(dateStr);

        if (slotsCard) {
          slotsCard.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });

      calendarGrid.appendChild(btn);
    }
  }

  // --- SLOTS ---
  async function loadSlotsForDate(dateStr) {
    if (slotsHint) slotsHint.textContent = "Idősávok betöltése…";
    if (slotsGrid) slotsGrid.innerHTML = "";
    clearToast();

    if (!state.selectedServiceId) {
      if (slotsHint) slotsHint.textContent = "Válassz előbb szolgáltatást.";
      return;
    }

    try {
      const data = await apiGet(
        `/api/availability/slots?date=${encodeURIComponent(dateStr)}&serviceId=${encodeURIComponent(state.selectedServiceId)}`
      );

      const slots = data?.slots || [];

      if (!slots.length) {
        if (slotsHint) slotsHint.textContent = "Nincs elérhető idősáv.";
        return;
      }

      if (slotsGrid) slotsGrid.innerHTML = "";

      slots.forEach((s) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.slot = s.slot;

        let cls =
          "rounded-2xl px-4 py-3 text-left text-sm ring-1 transition focus:outline-none focus:ring-2 focus:ring-emerald-300/30 ";

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

          if (formHint) {
            formHint.textContent = "Töltsd ki az űrlapot, majd véglegesítsd a foglalást.";
          }

          clearToast();

          setTimeout(() => {
            smoothScrollToElement(bookingForm, 120);
          }, 150);
        });

        slotsGrid.appendChild(btn);
      });

      if (slotsHint) slotsHint.textContent = "Válassz egy szabad idősávot.";
      renderSlotsSelection();
    } catch (e) {
      if (slotsHint) slotsHint.textContent = "Nem sikerült betölteni az idősávokat.";
      showToast("Hiba az idősávok betöltésénél.", "error");
      console.error(e);
    }
  }

  function renderSlotsSelection() {
    if (!slotsGrid) return;

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
    const name = nameInput?.value.trim() || "";
    const phone = phoneInput?.value.trim() || "";
    const email = emailInput?.value.trim() || "";

    if (!name) return "Add meg a neved.";
    if (!/^\d{9,15}$/.test(phone)) {
      return "A telefonszám 9–15 számjegy legyen (csak számok).";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Hibás email formátum.";
    }

    if (!state.selectedServiceId || !state.selectedDate || !state.selectedSlot) {
      return "Válassz szolgáltatást, napot és idősávot.";
    }

    if (!termsCheckbox || !termsCheckbox.checked) {
      return "Az ÁSZF elfogadása kötelező.";
    }

    return null;
  }

  if (bookingForm) {
    bookingForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      await loadSlotsForDate(state.selectedDate);

      const stillExists = Array.from(slotsGrid.querySelectorAll("button"))
      .some(btn => btn.dataset.slot === state.selectedSlot && !btn.disabled);

      if (!stillExists) {
        showToast("Ez az időpont már nem elérhető.", "error");

        if (btnSubmit) btnSubmit.disabled = false;
        if (btnSpinner) btnSpinner.classList.add("hidden");
        if (btnText) btnText.textContent = "Foglalás véglegesítése";

        return;
      }

      clearToast();

      const err = validateFormClient();
      if (err) {
        showToast(err, "error");
        return;
      }

      if (btnSubmit) btnSubmit.disabled = true;
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
          note: noteInput.value.trim() || null,
        };

        await apiPost("/api/bookings", payload);

        const successDetails = el("successDetails");
        const googleLink = el("googleCalendarLink");

        if (successDetails) {
          successDetails.textContent =
            `Az időpont rögzítésre került.\n\n` +
            `Szolgáltatás: ${state.selectedServiceName}\n` +
            `Dátum: ${state.selectedDate}\n` +
            `Idősáv: ${state.selectedSlot}\n\n` +
            `Emailben is küldtünk visszaigazolást.`;
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
            `&text=${encodeURIComponent(state.selectedServiceName || "Időpontfoglalás")}` +
            `&dates=${formatDateLocal(start)}/${formatDateLocal(end)}` +
            `&details=${encodeURIComponent("Időpontfoglalás - Zöld Tara háza")}`;

          googleLink.href = url;
          googleLink.classList.remove("hidden");
        }

        if (successModal) {
          successModal.classList.remove("hidden");
          successModal.classList.add("flex");
        }

        await loadDaysForMonth();

        if (state.selectedDate) {
          await loadSlotsForDate(state.selectedDate);
        }

        state.selectedSlot = null;
        if (summarySlot) summarySlot.textContent = "—";
      } catch (e2) {
        const msg = e2?.message || "Hiba történt.";
        showToast(msg, "error");

        if (e2?.status === 409 && state.selectedDate) {
          await loadSlotsForDate(state.selectedDate);
        }

        console.error(e2);
      } finally {
        if (btnSpinner) btnSpinner.classList.add("hidden");
        if (btnText) btnText.textContent = "Foglalás véglegesítése";
        if (btnSubmit) btnSubmit.disabled = false;
      }
    });
  }

  // --- EVENTS ---
  if (serviceSelect) {
    serviceSelect.addEventListener("change", async () => {
      const val = serviceSelect.value;
      state.selectedServiceId = val ? Number(val) : null;
      state.selectedServiceName =
        state.services.find((s) => String(s.id) === String(val))?.name || null;

      if (serviceHint) {
        serviceHint.textContent = state.selectedServiceId
          ? "Most válassz napot a naptárban."
          : "Válassz szolgáltatást a folytatáshoz.";
      }

      resetSelectionBelowService();
      updateSummary();

      await loadDaysForMonth();

      if (state.selectedServiceId) {
        setTimeout(() => {
          smoothScrollToElement(calendarGrid, 120);
        }, 200);
      }
    });
  }

  if (btnReloadServices) {
    btnReloadServices.addEventListener("click", async () => {
      await loadServices();

      if (state.selectedServiceId) {
        el("calendarGrid")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  }

  if (btnPrevMonth) {
    btnPrevMonth.addEventListener("click", async () => {
      state.monthCursor = new Date(
        state.monthCursor.getFullYear(),
        state.monthCursor.getMonth() - 1,
        1
      );
      resetSelectionBelowService();
      await loadDaysForMonth();
    });
  }

  if (btnNextMonth) {
    btnNextMonth.addEventListener("click", async () => {
      state.monthCursor = new Date(
        state.monthCursor.getFullYear(),
        state.monthCursor.getMonth() + 1,
        1
      );
      resetSelectionBelowService();
      await loadDaysForMonth();
    });
  }

  if (closeSuccessModal && successModal) {
    closeSuccessModal.addEventListener("click", () => {
      successModal.classList.add("hidden");
      successModal.classList.remove("flex");

      if (bookingForm) bookingForm.reset();

      state.selectedServiceId = null;
      state.selectedServiceName = null;
      state.selectedDate = null;
      state.selectedSlot = null;

      if (serviceSelect) serviceSelect.value = "";
      if (selectedDateLabel) selectedDateLabel.textContent = "—";
      if (summaryService) summaryService.textContent = "—";
      if (summaryDate) summaryDate.textContent = "—";
      if (summarySlot) summarySlot.textContent = "—";

      if (slotsGrid) slotsGrid.innerHTML = "";
      if (btnSubmit) btnSubmit.disabled = true;

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  // --- INIT ---
  function init() {
    state.monthCursor = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

    if (slotsHint) slotsHint.textContent = "Válassz előbb napot a naptárban.";
    if (calendarHint) calendarHint.textContent = "Szolgáltatás után tölthető a naptár.";
    if (serviceHint) serviceHint.textContent = "Szolgáltatások betöltése…";

    updateSummary();
    loadServices().then(loadDaysForMonth);
  }

  init();

  setInterval(() => {
  if (state.selectedDate && state.selectedServiceId) {
    loadSlotsForDate(state.selectedDate);
  }
}, 5000);
  
})();