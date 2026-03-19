const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { TIME_SLOTS, isWeekend, isHoliday } = require("../utils/calendar");

// LOCAL dátum → YYYY-MM-DD (nem csúszik el időzónától)
function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// lekér egy napra:
// - globális nap tiltás (blocked_days)
// - napi slot felülírások (daily_slots)
function getAdminOverrides(dateStr, cb) {
  db.get("SELECT date FROM blocked_days WHERE date = ?", [dateStr], (err, blockedRow) => {
    if (err) return cb(err);

    db.all("SELECT slot, enabled FROM daily_slots WHERE date = ?", [dateStr], (err2, slotRows) => {
      if (err2) return cb(err2);

      const dailyMap = new Map();
      (slotRows || []).forEach(r => dailyMap.set(r.slot, !!r.enabled));

      cb(null, {
        dayBlocked: !!blockedRow,
        dailySlots: dailyMap, // slot -> enabled (true/false)
      });
    });
  });
}

// GET /api/availability/days?month=YYYY-MM
router.get("/days", (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "Hiányzó month paraméter" });

  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1) foglalások száma naponként
  db.all(
    "SELECT date, COUNT(*) as count FROM bookings WHERE status = 'confirmed' GROUP BY date",
    [],
    (err, bookingRows) => {
      if (err) return res.status(500).json({ error: "Adatbázis hiba" });

      const bookingsCount = {};
      bookingRows.forEach(r => (bookingsCount[r.date] = r.count));

      // 2) admin által tiltott napok (blocked_days) a hónapra
      db.all(
        "SELECT date FROM blocked_days WHERE substr(date,1,7) = ?",
        [month],
        (err2, blockedRows) => {
          if (err2) return res.status(500).json({ error: "Adatbázis hiba" });

          const blockedSet = new Set((blockedRows || []).map(r => r.date));

          // 3) napi slot felülírások a hónapra -> számoljuk, hány slot van ENGEDÉLYEZVE adott napra
          db.all(
            "SELECT date, slot, enabled FROM daily_slots WHERE substr(date,1,7) = ?",
            [month],
            (err3, dailyRows) => {
              if (err3) return res.status(500).json({ error: "Adatbázis hiba" });

              // enabledCountByDate: ha van override, akkor onnan számolunk
              // ha nincs override, akkor TIME_SLOTS.length az alap
              const enabledCountByDate = {}; // date -> { hasOverride: bool, enabledCount: number }

              (dailyRows || []).forEach(r => {
                if (!enabledCountByDate[r.date]) {
                  enabledCountByDate[r.date] = { hasOverride: true, enabledCount: 0 };
                }
                if (r.enabled) enabledCountByDate[r.date].enabledCount += 1;
              });

              const result = [];

              for (let day = 1; day <= daysInMonth; day++) {
                const d = new Date(year, monthNumber - 1, day);
                const dateStr = toLocalISODate(d);

                let status = "available";

                // hétvége/ünnep/múlt -> unavailable
                if (d < today || isWeekend(dateStr) || isHoliday(dateStr)) {
                  status = "unavailable";
                } else if (blockedSet.has(dateStr)) {
                  // admin nap tiltás -> unavailable
                  status = "unavailable";
                } else {
                  // hány slot érhető el admin szerint?
                  const info = enabledCountByDate[dateStr];
                  const enabledSlotsCount = info && info.hasOverride ? info.enabledCount : TIME_SLOTS.length;

                  // ha 0 engedélyezett slot -> unavailable
                  if (enabledSlotsCount <= 0) {
                    status = "unavailable";
                  } else {
                    const booked = bookingsCount[dateStr] || 0;
                    if (booked >= enabledSlotsCount) status = "full";
                  }
                }

                result.push({ date: dateStr, status });
              }

              res.json(result);
            }
          );
        }
      );
    }
  );
});

// GET /api/availability/slots?date=YYYY-MM-DD&serviceId=1
router.get("/slots", (req, res) => {
  const { date, serviceId } = req.query;

  if (!date) return res.status(400).json({ error: "Hiányzó date paraméter" });

  const selectedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(selectedDate.getTime())) {
    return res.status(400).json({ error: "Hibás date formátum (várt: YYYY-MM-DD)" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // hétvége/ünnep/múlt -> minden false
  if (selectedDate < today || isWeekend(date) || isHoliday(date)) {
    return res.json({
      date,
      slots: TIME_SLOTS.map(s => ({ slot: s, available: false })),
      reason: "unavailable_day",
    });
  }

  // serviceId opcionális, de ha meg van adva, ellenőrizzük létezik-e
  const checkService = (cb) => {
    if (!serviceId) return cb(null);

    db.get("SELECT id FROM services WHERE id = ?", [serviceId], (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(new Error("SERVICE_NOT_FOUND"));
      cb(null);
    });
  };

  checkService((serviceErr) => {
    if (serviceErr) {
      if (serviceErr.message === "SERVICE_NOT_FOUND") {
        return res.status(400).json({ error: "Nincs ilyen serviceId" });
      }
      return res.status(500).json({ error: "Adatbázis hiba" });
    }

    // admin override-ok (nap tiltás + slot tiltások)
    getAdminOverrides(date, (ovErr, ov) => {
      if (ovErr) return res.status(500).json({ error: "Adatbázis hiba" });

      // admin nap tiltás -> minden false
      if (ov.dayBlocked) {
        return res.json({
          date,
          slots: TIME_SLOTS.map(s => ({ slot: s, available: false })),
          reason: "admin_day_blocked",
        });
      }

      // foglalt slotok
      db.all(
        "SELECT slot FROM bookings WHERE date = ? AND status = 'confirmed'",
        [date],
        (err, rows) => {
          if (err) return res.status(500).json({ error: "Adatbázis hiba" });

          const booked = new Set(rows.map(r => r.slot));

          // napi slot felülírás: ha nincs sor a slotra, akkor alapból true
          const slots = TIME_SLOTS.map((slot) => {
            const enabledByAdmin = ov.dailySlots.has(slot) ? ov.dailySlots.get(slot) : true;
            const available = enabledByAdmin && !booked.has(slot);
            return { slot, available };
          });

          res.json({ date, slots });
        }
      );
    });
  });
});

module.exports = router;