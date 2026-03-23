const express = require("express");
const router = express.Router();
const db = require("../db/database");
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
router.post("/", (req, res) => {

  console.log("BASE_URL:", process.env.BASE_URL);

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
    return res.status(400).json({ error: "Hibás telefonszám (9–15 számjegy)" });
  }

  const selectedDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(selectedDate.getTime())) {
    return res.status(400).json({ error: "Hibás date formátum (YYYY-MM-DD)" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (selectedDate < today || isWeekend(date) || isHoliday(date)) {
    return res.status(400).json({ error: "Ez a nap nem foglalható" });
  }

  db.get(
    "SELECT id, name FROM services WHERE id = ?",
    [serviceId],
    (err, service) => {

      if (err) return res.status(500).json({ error: "Adatbázis hiba" });
      if (!service) return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });

      const cancelToken = crypto.randomBytes(32).toString("hex");

      db.run(
        `
        INSERT INTO bookings (service_id, date, slot, name, phone, email, note, status, cancel_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
        `,
        [serviceId, date, slot, name.trim(), phone.trim(), email.trim(), note || null, cancelToken],
        function (insertErr) {

          if (insertErr) {
            if (String(insertErr.message).includes("UNIQUE")) {
              return res.status(409).json({ error: "Ez az idősáv már foglalt" });
            }
            return res.status(500).json({ error: "Adatbázis hiba" });
          }

          const cancelLink = `${process.env.BASE_URL}/lemondas.html?token=${cancelToken}`;

          const adminText = `Új foglalás érkezett

Szolgáltatás: ${service.name}
Dátum: ${date}
Idősáv: ${slot}

Név: ${name}
Telefon: ${phone}
Email: ${email}

Megjegyzés:
${note || "-"}`;

          const userText = `Kedves ${name}!

Dátum: ${date}
Idősáv: ${slot}`;

const userHtml = `
<div style="margin:0;padding:0;background:#e9f3ef;padding:40px 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.1);">

          <!-- HEADER -->
          <tr>
            <td style="background:#0f3f2f;color:#ffffff;padding:30px;text-align:center;">
              <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.8;">
                Időpont visszaigazolás
              </div>
              <h1 style="margin:10px 0 0 0;font-size:22px;">
                Zöld Tara háza
              </h1>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:30px;color:#2f3e38;">

              <h2 style="margin-top:0;">Kedves ${name}!</h2>

              <p>Örömmel visszaigazoljuk a foglalásodat.</p>

              <div style="background:#f5f9f7;border-radius:10px;padding:20px;margin:20px 0;">
                <strong>Szolgáltatás:</strong> ${service.name}<br>
                <strong>Dátum:</strong> ${date}<br>
                <strong>Időpont:</strong> ${slot}
              </div>

              <div style="margin-top:20px;">
                <a href="${cancelLink}" style="background:#0f3f2f;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">
                  Időpont lemondása
                </a>
              </div>

              <p style="margin-top:30px;">
                Szeretettel,<br>
                <strong>Zöld Tara háza</strong>
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</div>
`;

          // ✅ AZONNALI RESPONSE
          res.status(201).json({
            ok: true,
            bookingId: this.lastID,
          });

          // ✅ EMAIL HÁTTÉRBEN
          (async () => {
            try {

              console.log("SMTP USER:", process.env.EMAIL_USER);
              console.log("SMTP PASS:", process.env.EMAIL_PASS ? "OK" : "HIÁNYZIK");

              console.log("EMAIL KÜLDÉS INDUL");

              await sendMail({
                to: process.env.OWNER_EMAIL,
                subject: "Új időpontfoglalás",
                text: adminText,
              });

              await sendMail({
                to: email,
                subject: "Időpontfoglalás visszaigazolás",
                text: userText,
                html: userHtml,
              });

              console.log("EMAIL ELKÜLDVE");

            } catch (err) {
              console.error("EMAIL HIBA FULL:", err);
              console.error("STACK:", err?.stack);
            }
          })();
        }
      ); // db.run vége

    }
  ); // db.get vége

}); // router.post vége


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

      const bookingDate = new Date(booking.date);
      const nowDate = new Date();

      bookingDate.setHours(0,0,0,0);
      nowDate.setHours(0,0,0,0);

      const cancellable =
        booking.status === "confirmed" && bookingDate > nowDate;

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

module.exports = router;