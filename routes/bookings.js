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
      html: `
<div style="margin:0;padding:0;background:#0f2e2a;font-family:Arial,sans-serif;">
  
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">

        <table width="100%" cellpadding="0" cellspacing="0" 
          style="max-width:480px;background:#123d36;border-radius:14px;padding:24px;color:#ffffff;">

          <!-- LOGO / TITLE -->
          <tr>
            <td align="center" style="font-size:20px;font-weight:700;padding-bottom:6px;">
              Zöld Tara háza
            </td>
          </tr>

          <tr>
            <td align="center" style="font-size:13px;color:#9fe3c7;padding-bottom:18px;">
              Foglalás visszaigazolás
            </td>
          </tr>

          <!-- TEXT -->
          <tr>
            <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
              Kedves <strong>${name}</strong>!<br><br>
              A foglalásod sikeresen rögzítettük.
            </td>
          </tr>

          <!-- BOX -->
          <tr>
            <td style="background:#0f2e2a;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;">
              <b>Dátum:</b> ${date}<br>
              <b>Időpont:</b> ${slot}<br>
              <b>Kezelés:</b> ${service.name}
            </td>
          </tr>

          <!-- BUTTON -->
          <tr>
            <td align="center" style="padding-top:22px;">
              <a href="${cancelLink}" 
                style="
                  display:inline-block;
                  background:#16a34a;
                  color:#ffffff;
                  padding:12px 20px;
                  border-radius:8px;
                  text-decoration:none;
                  font-size:14px;
                  font-weight:600;
                ">
                Időpont lemondása
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top:20px;font-size:12px;color:#9fe3c7;text-align:center;">
              Ha kérdésed van, válaszolj erre az emailre.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</div>
`
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

    // ✅ törlés
    await pg.query(
      "UPDATE bookings SET deleted = 1 WHERE id = $1",
      [booking.id]
    );

    // ✅ AZONNAL válasz (UI ne várjon emailre)
    res.json({ ok: true });

    // =========================
    // 📧 USER EMAIL
    // =========================
    if (booking.email) {
      sendMail({
  to: booking.email,
  subject: "Időpont lemondva",
  html: `
  <div style="margin:0;padding:0;background:#0f2e2a;font-family:Arial,sans-serif;">
    
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
      <tr>
        <td align="center">

          <table width="100%" cellpadding="0" cellspacing="0" 
            style="max-width:480px;background:#123d36;border-radius:14px;padding:24px;color:#ffffff;">

            <!-- TITLE -->
            <tr>
              <td align="center" style="font-size:20px;font-weight:700;padding-bottom:6px;">
                Zöld Tara háza
              </td>
            </tr>

            <tr>
              <td align="center" style="font-size:13px;color:#9fe3c7;padding-bottom:18px;">
                Időpont lemondva
              </td>
            </tr>

            <!-- TEXT -->
            <tr>
              <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
                Kedves <strong>${booking.name}</strong>!<br><br>
                A foglalásod sikeresen <strong>lemondtad</strong>.
              </td>
            </tr>

            <!-- BOX -->
            <tr>
              <td style="background:#0f2e2a;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;">
                <b>Dátum:</b> ${booking.date}<br>
                <b>Időpont:</b> ${booking.slot}
              </td>
            </tr>

            <!-- INFO -->
            <tr>
              <td style="padding-top:20px;font-size:13px;color:#9fe3c7;text-align:center;">
                Ha új időpontot szeretnél, bármikor foglalhatsz újra.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>

  </div>
  `
}).catch(err => console.error("USER EMAIL FAIL:", err));
    }

    // =========================
    // 📧 ADMIN EMAIL
    // =========================
    sendMail({
      to: process.env.OWNER_EMAIL,
      subject: "Foglalás lemondva",
      text: `
Név: ${booking.name}
Email: ${booking.email}
Dátum: ${booking.date}
Időpont: ${booking.slot}
      `
    }).catch(err => console.error("ADMIN EMAIL FAIL:", err));

  } catch (err) {
    console.error("CANCEL ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;