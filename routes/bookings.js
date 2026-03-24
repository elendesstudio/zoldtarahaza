const express = require("express");
const router = express.Router();
const pg = require("../db/postgres");
const { TIME_SLOTS } = require("../utils/calendar");
const { sendMail } = require("../utils/mailer");
const crypto = require("crypto");

// ===== VALIDÁLÓK =====
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return typeof phone === "string" && /^\d{9,15}$/.test(phone);
}

function isNonEmptyString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

// ===== GET ALL BOOKINGS =====
router.get("/", async (req, res) => {
  try {
    const result = await pg.query(`
      SELECT 
        b.id,
        b.date,
        b.slot,
        b.name,
        b.phone,
        b.email,
        b.note,
        b.created_at,
        s.name AS service_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      ORDER BY b.date ASC, b.slot ASC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// ===== CREATE BOOKING =====
router.post("/", async (req, res) => {
  const { serviceId, date, slot, name, phone, email, note } = req.body;

  if (
    !serviceId ||
    !isNonEmptyString(date) ||
    !isNonEmptyString(slot) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(phone) ||
    !isNonEmptyString(email)
  ) {
    return res.status(400).json({ error: "Hiányzó kötelező mező" });
  }

  if (!TIME_SLOTS.includes(slot)) {
    return res.status(400).json({ error: "Érvénytelen idősáv" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Hibás email" });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Hibás telefonszám" });
  }

  try {

    const serviceResult = await pg.query(
      "SELECT id, name FROM services WHERE id = $1",
      [serviceId]
    );

    const service = serviceResult.rows[0];

    if (!service) {
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });
    }

    const existing = await pg.query(
      "SELECT id FROM bookings WHERE date = $1 AND slot = $2 AND deleted = 0",
      [date, slot]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Foglalt időpont" });
    }

    const cancelToken = crypto.randomBytes(32).toString("hex");

    const insert = await pg.query(`
      INSERT INTO bookings 
      (service_id, date, slot, name, phone, email, note, status, cancel_token, deleted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,0)
      RETURNING id
    `, [serviceId, date, slot, name, phone, email, note || null, cancelToken]);

    const bookingId = insert.rows[0].id;

    res.status(201).json({ ok: true, bookingId });

    const cancelLink = `${process.env.BASE_URL}/lemondas.html?token=${cancelToken}`;

    sendMail({
      to: email,
      subject: "Foglalás visszaigazolás",
      html: `<p>Sikeres foglalás. <br><a href="${cancelLink}">Lemondás</a></p>`
    }).catch(console.error);

  } catch (err) {
    console.error("BOOKING ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// ===== CANCEL INFO =====
router.get("/cancel-info", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  try {

    const result = await pg.query(`
      SELECT b.*, s.name AS service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.cancel_token = $1
    `, [token]);

    const booking = result.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Nem található" });
    }

    const now = new Date();
    const bookingDateTime = new Date(`${booking.date}T${booking.slot}`);
    const diffHours = (bookingDateTime - now) / (1000 * 60 * 60);

    res.json({
      booking: {
        serviceName: booking.service_name,
        date: booking.date,
        slot: booking.slot,
        status: booking.deleted ? "cancelled" : "confirmed",
        cancellable: diffHours >= 24 && booking.deleted !== 1
      }
    });

  } catch (err) {
    console.error("CANCEL INFO ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

// ===== CANCEL =====
router.post("/cancel", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  try {

    const result = await pg.query(
      "SELECT * FROM bookings WHERE cancel_token = $1",
      [token]
    );

    const booking = result.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Nem található" });
    }

    if (booking.deleted === 1) {
      return res.status(400).json({ error: "Már lemondva" });
    }

    await pg.query(
      "UPDATE bookings SET deleted = 1 WHERE id = $1",
      [booking.id]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("CANCEL ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;