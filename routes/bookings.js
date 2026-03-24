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
    // ===== SERVICE CHECK =====
    const serviceRes = await pg.query(
      "SELECT id, name FROM services WHERE id = $1",
      [serviceId]
    );

    if (!serviceRes.rows.length) {
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });
    }

    const serviceName = serviceRes.rows[0].name;

    // ===== VALIDATION =====
    if (!TIME_SLOTS.includes(slot)) {
      return res.status(400).json({ error: "Érvénytelen idősáv" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bookingDate = new Date(`${date}T00:00:00`);

    if (bookingDate < today || isWeekend(date) || isHoliday(date)) {
      return res.status(400).json({ error: "Nem foglalható nap" });
    }

    // ===== ADMIN BLOCK =====
    const blocked = await pg.query(
      "SELECT 1 FROM blocked_days WHERE date = $1",
      [date]
    );

    if (blocked.rows.length) {
      return res.status(400).json({ error: "Ez a nap tiltva van" });
    }

    // ===== SLOT OVERRIDE =====
    const override = await pg.query(
      "SELECT enabled FROM daily_slots WHERE date = $1 AND slot = $2",
      [date, slot]
    );

    if (override.rows.length && !override.rows[0].enabled) {
      return res.status(400).json({ error: "Ez az idősáv tiltva van" });
    }

    // ===== EXISTING BOOKING =====
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

    // ===== INSERT =====
    const cancelToken = crypto.randomBytes(32).toString("hex");

    const insert = await pg.query(`
      INSERT INTO bookings
      (service_id, date, slot, name, phone, email, note, status, cancel_token, deleted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,0)
      RETURNING id
    `, [serviceId, date, slot, name, phone, email, note || null, cancelToken]);

    const bookingId = insert.rows[0].id;

    // ===== RESPONSE (NE VÁRJON EMAILRE) =====
    res.json({ ok: true, bookingId });

    // ===== EMAIL =====
    const cancelLink = `${process.env.BASE_URL}/lemondas.html?token=${cancelToken}`;

    sendMail({
      to: email,
      subject: "Foglalás visszaigazolás",
      html: `
<div style="margin:0;padding:0;background:#0b1f1b;font-family:Arial,sans-serif;">
  
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">

        <table width="100%" cellpadding="0" cellspacing="0"
          style="max-width:480px;background:#123d36;border-radius:16px;padding:24px;color:#ffffff;">

          <tr>
            <td align="center" style="font-size:22px;font-weight:700;">
              🌿 Zöld Tara háza
            </td>
          </tr>

          <tr>
            <td align="center" style="font-size:13px;color:#9fe3c7;padding-bottom:18px;">
              Foglalás visszaigazolás
            </td>
          </tr>

          <tr>
            <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
              Kedves <strong>${name}</strong>!<br><br>
              Az időpontod sikeresen lefoglaltuk. 💚
            </td>
          </tr>

          <tr>
            <td style="background:#0f2e2a;border-radius:12px;padding:16px;font-size:14px;line-height:1.6;">
              <b>📅 Dátum:</b> ${date}<br>
              <b>⏰ Időpont:</b> ${slot}<br>
              <b>🧘 Kezelés:</b> ${serviceName}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:22px;">
              <a href="${cancelLink}" 
                style="
                  display:inline-block;
                  background:#22c55e;
                  color:#ffffff;
                  padding:12px 20px;
                  border-radius:10px;
                  text-decoration:none;
                  font-size:14px;
                  font-weight:600;
                ">
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

</div>
      `
    }).catch(err => console.error("EMAIL ERROR:", err));

  } catch (err) {
    console.error("BOOKING ERROR:", err);
    res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;