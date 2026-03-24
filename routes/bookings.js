const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const pg = require("../db/postgres");
const { TIME_SLOTS, isWeekend, isHoliday } = require("../utils/calendar");
const { sendMail } = require("../utils/mailer");

// =========================
// CREATE BOOKING
// =========================
router.post("/", async (req, res) => {
  const { serviceId, date, slot, name, phone, email, note } = req.body;

  try {
    // service check
    const serviceRes = await pg.query(
      "SELECT id, name FROM services WHERE id = $1",
      [serviceId]
    );

    if (!serviceRes.rows.length) {
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });
    }

    // basic validations
    if (!TIME_SLOTS.includes(slot)) {
      return res.status(400).json({ error: "Érvénytelen idősáv" });
    }

    const today = new Date();
    const bookingDate = new Date(`${date}T00:00:00`);

    if (bookingDate < today || isWeekend(date) || isHoliday(date)) {
      return res.status(400).json({ error: "Nem foglalható nap" });
    }

    // admin block
    const blocked = await pg.query(
      "SELECT 1 FROM blocked_days WHERE date = $1",
      [date]
    );

    if (blocked.rows.length) {
      return res.status(400).json({ error: "Ez a nap tiltva van" });
    }

    // slot override
    const override = await pg.query(
      "SELECT enabled FROM daily_slots WHERE date = $1 AND slot = $2",
      [date, slot]
    );

    if (override.rows.length && !override.rows[0].enabled) {
      return res.status(400).json({ error: "Ez az idősáv tiltva van" });
    }

    // existing booking check
    const existing = await pg.query(`
      SELECT id FROM bookings
      WHERE date = $1
        AND slot = $2
        AND status = 'confirmed'
        AND COALESCE(deleted, 0) = 0
    `, [date, slot]);

    if (existing.rows.length) {
      return res.status(409).json({ error: "Ez az időpont már foglalt" });
    }

    const cancelToken = crypto.randomBytes(32).toString("hex");

    const insert = await pg.query(`
      INSERT INTO bookings
      (service_id, date, slot, name, phone, email, note, status, cancel_token, deleted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,0)
      RETURNING id
    `, [serviceId, date, slot, name, phone, email, note || null, cancelToken]);

    res.json({ ok: true, bookingId: insert.rows[0].id });

  } catch (err) {
    console.error("BOOKING ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;