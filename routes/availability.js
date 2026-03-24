const express = require("express");
const router = express.Router();
const pg = require("../db/postgres");
const { TIME_SLOTS, isWeekend, isHoliday } = require("../utils/calendar");

// =========================
// HELPEREK
// =========================
function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDateString(dateStr) {
  return typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidMonthString(monthStr) {
  return typeof monthStr === "string" && /^\d{4}-\d{2}$/.test(monthStr);
}

function getSlotStart(slot) {
  return slot.split("-")[0];
}

// =========================
// GET /days
// =========================
router.get("/days", async (req, res) => {
  const { month } = req.query;

  if (!isValidMonthString(month)) {
    return res.status(400).json({ error: "Hibás month" });
  }

  try {
    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 🔥 FOGLALÁSOK (FIX)
    const bookingsRes = await pg.query(`
      SELECT date, COUNT(*) as count
      FROM bookings
      WHERE status = 'confirmed'
        AND COALESCE(deleted, 0) = 0
      GROUP BY date
    `);

    const bookingsCount = {};
    bookingsRes.rows.forEach(r => {
      bookingsCount[r.date] = Number(r.count);
    });

    const blockedRes = await pg.query(`
  SELECT date FROM blocked_days
  WHERE date >= $1::date
    AND date < ($1::date + INTERVAL '1 month')
`, [month + "-01"]);

    const blockedSet = new Set(blockedRes.rows.map(r => r.date));

    const dailyRes = await pg.query(`
    SELECT date, slot, enabled
    FROM daily_slots
    WHERE date >= $1::date
      AND date < ($1::date + INTERVAL '1 month')
  `, [month + "-01"]);

    const enabledCountByDate = {};

    dailyRes.rows.forEach(r => {
      if (!enabledCountByDate[r.date]) {
        enabledCountByDate[r.date] = { hasOverride: true, enabledCount: 0 };
      }
      if (r.enabled) enabledCountByDate[r.date].enabledCount++;
    });

    const result = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, monthNumber - 1, day);
      const dateStr = toLocalISODate(d);

      let status = "available";

      if (d < today || isWeekend(dateStr) || isHoliday(dateStr)) {
        status = "unavailable";
      } else if (blockedSet.has(dateStr)) {
        status = "unavailable";
      } else {
        const info = enabledCountByDate[dateStr];
        const enabledSlots =
          info && info.hasOverride ? info.enabledCount : TIME_SLOTS.length;

        if (enabledSlots <= 0) {
          status = "unavailable";
        } else {
          const booked = bookingsCount[dateStr] || 0;
          if (booked >= enabledSlots) status = "full";
        }
      }

      result.push({ date: dateStr, status });
    }

    res.json(result);

  } catch (err) {
    console.error("DAYS ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// =========================
// GET /slots
// =========================
router.get("/slots", async (req, res) => {
  const { date, serviceId } = req.query;

  if (!isValidDateString(date)) {
    return res.status(400).json({ error: "Hibás date" });
  }

  try {
    const selectedDate = new Date(`${date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today || isWeekend(date) || isHoliday(date)) {
      return res.json({
        date,
        slots: TIME_SLOTS.map(s => ({ slot: s, available: false })),
      });
    }

    // service check
    if (serviceId) {
      const service = await pg.query(
        "SELECT id FROM services WHERE id = $1",
        [serviceId]
      );

      if (!service.rows.length) {
        return res.status(400).json({ error: "Nincs ilyen service" });
      }
    }

    // admin override
    const blocked = await pg.query(
      "SELECT 1 FROM blocked_days WHERE date = $1",
      [date]
    );

    if (blocked.rows.length) {
      return res.json({
        date,
        slots: TIME_SLOTS.map(s => ({ slot: s, available: false })),
      });
    }

    const daily = await pg.query(
      "SELECT slot, enabled FROM daily_slots WHERE date = $1",
      [date]
    );

    const dailyMap = new Map();
    daily.rows.forEach(r => dailyMap.set(r.slot, r.enabled));

    // 🔥 FOGLALT SLOTOK (EZ VOLT A BAJ)
    const bookings = await pg.query(`
      SELECT slot
      FROM bookings
      WHERE date = $1
        AND status = 'confirmed'
        AND COALESCE(deleted, 0) = 0
    `, [date]);

    const booked = new Set(bookings.rows.map(r => r.slot));

    const now = new Date();
    const isToday = toLocalISODate(now) === date;

    const slots = TIME_SLOTS.map(slot => {
      const enabled = dailyMap.has(slot) ? dailyMap.get(slot) : true;

      let isPast = false;
      if (isToday) {
        const start = getSlotStart(slot);
        const slotTime = new Date(`${date}T${start}:00`);
        isPast = slotTime <= now;
      }

      return {
        slot,
        available: enabled && !booked.has(slot) && !isPast
      };
    });

    res.json({ date, slots });

  } catch (err) {
    console.error("SLOTS ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;