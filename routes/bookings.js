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
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f2e2a;padding:40px 0;font-family:Arial,sans-serif;">
          <tr>
            <td align="center">

              <table width="500" cellpadding="0" cellspacing="0" style="background:#123d36;border-radius:12px;padding:30px;color:#ffffff;">
                
                <tr>
                  <td align="center" style="font-size:22px;font-weight:bold;padding-bottom:10px;">
                    Zöld Tara háza
                  </td>
                </tr>

                <tr>
                  <td align="center" style="font-size:16px;color:#9fe3c7;padding-bottom:20px;">
                    Foglalás visszaigazolás
                  </td>
                </tr>

                <tr>
                  <td style="font-size:14px;line-height:1.6;padding-bottom:20px;">
                    Kedves ${name}!<br><br>
                    A foglalásod sikeresen rögzítettük.
                  </td>
                </tr>

                <tr>
                  <td style="background:#0f2e2a;border-radius:8px;padding:15px;font-size:14px;">
                    <b>Dátum:</b> ${date}<br>
                    <b>Időpont:</b> ${slot}<br>
                    <b>Kezelés:</b> ${service.name}
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding-top:25px;">
                    <a href="${cancelLink}" 
                      style="display:inline-block;background:#16a34a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;">
                      Időpont lemondása
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:20px;font-size:13px;color:#9fe3c7;text-align:center;">
                    Ha kérdésed van, válaszolj erre az emailre.
                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>
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
router.delete("/admin/bookings/:id", async (req, res) => {
  const id = req.params.id;

  try {

    const result = await pg.query(`
      SELECT b.*, s.name as service_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.id = $1
    `, [id]);

    const booking = result.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Nem található" });
    }

    await pg.query(`
      UPDATE bookings
      SET status = 'cancelled_by_admin'
      WHERE id = $1
    `, [id]);

    // EMAIL
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

    res.json({ ok: true });

  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
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