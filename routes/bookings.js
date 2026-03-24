const express = require("express");
const router = express.Router();
const pg = require("../db/postgres");
const { TIME_SLOTS, isWeekend, isHoliday } = require("../utils/calendar");
const { sendMail } = require("../utils/mailer");
const crypto = require("crypto");


// ===== ADMIN - Összes foglalás lekérése =====
router.get("/", (req, res) => {
  db.all(
    `
    SELECT 
      bookings.id,
      bookings.date,
      bookings.slot,
      bookings.name,
      bookings.phone,
      bookings.email,
      bookings.note,
      bookings.created_at,
      services.name AS service_name
    FROM bookings
    JOIN services ON bookings.service_id = services.id
    ORDER BY bookings.date ASC, bookings.slot ASC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});


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


// ===== POST /api/bookings =====
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
    return res.status(400).json({ error: "Hibás email formátum" });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Hibás telefonszám" });
  }

  try {

    // service check
    const serviceResult = await pg.query(
      "SELECT id, name FROM services WHERE id = $1",
      [serviceId]
    );

    const service = serviceResult.rows[0];

    if (!service) {
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });
    }

    // foglalt check
    const existing = await pg.query(
      "SELECT id FROM bookings WHERE date = $1 AND slot = $2 AND deleted = 0",
      [date, slot]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Ez az idősáv már foglalt" });
    }

    const cancelToken = crypto.randomBytes(32).toString("hex");

    // INSERT
    const insert = await pg.query(`
      INSERT INTO bookings 
      (service_id, date, slot, name, phone, email, note, status, cancel_token, deleted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,0)
      RETURNING id
    `, [serviceId, date, slot, name, phone, email, note || null, cancelToken]);

    const bookingId = insert.rows[0].id;

    // response
    res.status(201).json({
      ok: true,
      bookingId
    });

    // EMAIL háttérben
    const cancelLink = `${process.env.BASE_URL}/lemondas.html?token=${cancelToken}`;

    sendMail({
      to: process.env.OWNER_EMAIL,
      subject: "Új foglalás",
      text: `${date} ${slot} - ${name}`
    }).catch(console.error);

    sendMail({
      to: email,
      subject: "Foglalás visszaigazolás",
      html: `
        <p>Kedves ${name}!</p>
        <p>Foglalásod rögzítve:</p>
        <p><strong>${date} ${slot}</strong></p>
        <a href="${cancelLink}">Lemondás</a>
      `
    }).catch(console.error);

  } catch (err) {
    console.error("POSTGRES ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }

});


// ===== CANCEL =====
router.post("/cancel", async (req, res) => {

  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  db.get(
    `
    SELECT b.*, s.name as service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.cancel_token = ?
    `,
    [token],
    (err, booking) => {

      if (err) return res.status(500).json({ error: "Adatbázis hiba" });
      if (!booking) return res.status(404).json({ error: "Foglalás nem található" });

      if (booking.status !== "confirmed") {
        return res.status(400).json({ error: "Már lemondva" });
      }

      db.run(
        `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = ?
        `,
        [booking.id],
        function () {

          sendMail({
            to: process.env.OWNER_EMAIL,
            subject: "Lemondás",
            text: `Lemondva: ${booking.date} ${booking.slot}`
          }).catch(console.error);

          res.json({ ok: true });
        }
      );
    }
  );
});


// ===== CANCEL INFO =====
router.get("/cancel-info", (req, res) => {

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  db.get(
    `
    SELECT bookings.*, services.name AS service_name
    FROM bookings
    JOIN services ON bookings.service_id = services.id
    WHERE cancel_token = ?
    `,
    [token],
    (err, booking) => {

      if (err) return res.status(500).json({ error: "Adatbázis hiba" });
      if (!booking) return res.status(404).json({ error: "Foglalás nem található" });

      const now = new Date();
      const bookingDateTime = new Date(
        `${booking.date}T${booking.slot.split("-")[0]}:00`
      );

      const cancellable =
        booking.status === "confirmed" && bookingDateTime > now;

      res.json({
        booking: {
          serviceName: booking.service_name,
          date: booking.date,
          slot: booking.slot,
          status: booking.status,
          cancellable
        }
      });
    }
  );
});

// ===== ADMIN – ALL BOOKINGS (FILTER) =====
router.get("/admin/bookings-all", (req, res) => {
  const filter = req.query.filter;

  let where = "";

  if (filter === "active") {
    where = "WHERE bookings.status = 'confirmed'";
  }

  if (filter === "deleted") {
    where = "WHERE bookings.status != 'confirmed'";
  }

  db.all(`
    SELECT 
      bookings.*,
      services.name AS service_name
    FROM bookings
    JOIN services ON bookings.service_id = services.id
    ${where}
    ORDER BY bookings.date DESC, bookings.slot DESC
  `, [], (err, rows) => {

    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);

  });
});

// ===== ADMIN DELETE =====
router.delete("/admin/bookings/:id", (req, res) => {
  const id = req.params.id;

  db.get(`
    SELECT b.*, s.name as service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.id = ?
  `, [id], async (err, booking) => {

    if (err) return res.status(500).json({ error: "Adatbázis hiba" });
    if (!booking) return res.status(404).json({ error: "Nem található" });

    db.run(`
      UPDATE bookings
      SET status = 'cancelled_by_admin'
      WHERE id = ?
    `, [id], async function () {

      try {
        if (booking.email) {
          await sendMail({
            to: booking.email,
            subject: "Időpont törölve",
            html: `
              <p>Kedves ${booking.name || "Vendég"}!</p>
              <p>Az időpontod törlésre került:</p>
              <p><strong>${booking.date} - ${booking.slot}</strong></p>
            `
          });
        }
      } catch (e) {
        console.error("EMAIL HIBA:", e);
      }

      res.json({ ok: true });
    });

  });
});

// ===== ADMIN RESTORE =====
router.post("/admin/bookings/:id/restore", (req, res) => {
  const id = req.params.id;

  db.run(`
    UPDATE bookings
    SET status = 'confirmed'
    WHERE id = ?
  `, [id], function () {
    res.json({ ok: true });
  });
});


module.exports = router;