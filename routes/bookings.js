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
    if (!service)
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });

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

        // ===== ADMIN EMAIL =====
        const adminText = `Új foglalás érkezett

          Szolgáltatás: ${service.name}
          Dátum: ${date}
          Idősáv: ${slot}

          Név: ${name}
          Telefon: ${phone}
          Email: ${email}

          Megjegyzés:
          ${note || "-"}
          `;

        // ===== USER EMAIL (HTML) =====
                  const userHtml = `
          <div style="margin:0;padding:0;background:#e9f3ef;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  
                  <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.08);">
                    
                    <!-- Header -->
                    <tr>
                      <td style="background:linear-gradient(135deg,#0f3f2f 0%,#1e5a45 100%);padding:50px 40px;text-align:center;color:#ffffff;">
                        <div style="font-size:14px;letter-spacing:3px;text-transform:uppercase;opacity:0.8;">
                          Időpont visszaigazolás
                        </div>
                        <h1 style="margin:15px 0 0 0;font-size:26px;font-weight:500;">
                          Zöld Tara háza
                        </h1>
                      </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                      <td style="padding:50px 50px 40px 50px;color:#2f3e38;">
                        
                        <h2 style="margin:0 0 20px 0;font-size:22px;font-weight:500;color:#0f3f2f;">
                          Kedves ${name},
                        </h2>

                        <p style="font-size:16px;line-height:1.7;margin-bottom:30px;">
                          Örömmel visszaigazoljuk a lefoglalt időpontját.
                        </p>

                        <!-- Info Card -->
                        <div style="background:#f5f9f7;border-radius:14px;padding:25px 30px;margin-bottom:35px;border:1px solid #e1ece7;">
                          <div style="font-size:14px;color:#6b7d75;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">
                            Foglalás részletei
                          </div>
                          <div style="font-size:17px;line-height:1.8;">
                            <strong>Szolgáltatás:</strong> ${service.name}<br>
                            <strong>Dátum:</strong> ${date}<br>
                            <strong>Időpont:</strong> ${slot}
                          </div>
                        </div>


                                    <!-- Lemondás blokk -->
                        <div style="margin-top:30px;padding:18px 20px;border:1px solid #e1ece7;background:#fafdfb;border-radius:14px;">
                          <div style="font-size:13px;color:#6b7d75;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
                            Lemondás
                          </div>
                          <p style="margin:0;font-size:14px;line-height:1.6;color:#2f3e38;">
                            Ha mégsem megfelelő az időpont, <strong>legkésőbb 24 órával előtte</strong> ezen a linken tudod lemondani:
                          </p>
                          <p style="margin:12px 0 0 0;">
                            <a href="${cancelLink}" style="display:inline-block;background:#0f3f2f;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:600;">
                              Időpont lemondása
                            </a>
                          </p>
                        </div>

                        <p style="font-size:15px;line-height:1.7;color:#5a6d65;">
                          Amennyiben kérdése merül fel, erre az emailre válaszolva bármikor felveheti a kapcsolatot.
                        </p>

                        <p style="margin-top:40px;font-size:15px;color:#2f3e38;">
                          Szeretettel,<br>
                          <strong style="color:#0f3f2f;">Zöld Tara háza</strong>
                        </p>

                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="padding:25px 40px;text-align:center;font-size:12px;color:#8a9b93;background:#fafdfb;">
                        © ${new Date().getFullYear()} Zöld Tara háza • Minden jog fenntartva
                      </td>
                    </tr>

                  </table>

                </td>
              </tr>
            </table>

          </div>
          `;

        const userText = `Kedves ${name}!

Sikeresen rögzítettük a foglalásodat.

Dátum: ${date}
Idősáv: ${slot}

Zöld Tara háza`;

        sendMail({
          to: process.env.OWNER_EMAIL,
          subject: "Új időpontfoglalás",
          text: adminText,
        }).catch(console.error);

        sendMail({
          to: email,
          subject: "Időpontfoglalás visszaigazolás",
          text: userText,
          html: userHtml,
        }).catch(console.error);

        return res.status(201).json({
          ok: true,
          bookingId: this.lastID,
        });
      }
    );
  });
});

router.post("/cancel", (req, res) => {
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
        return res.status(400).json({ error: "Ez a foglalás már le lett mondva" });
      }

      const now = new Date();
      const bookingDateTime = new Date(
        `${booking.date}T${booking.slot.split("-")[0]}:00`
      );

      const diffHours = (bookingDateTime - now) / (1000 * 60 * 60);

      if (diffHours < 24) {
        return res.status(400).json({
          error: "Lemondás csak 24 órával az időpont előtt lehetséges",
        });
      }

      db.run(
        `
        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [booking.id],
        function (updateErr) {

          if (updateErr) {
            return res.status(500).json({ error: "Adatbázis hiba" });
          }

          // ===== EMAIL AZ ADMINNAK =====
          sendMail({
            to: process.env.OWNER_EMAIL,
            subject: `❌ Lemondás – ${booking.service_name} (${booking.date} ${booking.slot})`,
            text: `
Felhasználó lemondta az időpontját.

Név: ${booking.name}
Email: ${booking.email}
Telefon: ${booking.phone || "-"}

Szolgáltatás: ${booking.service_name}
Dátum: ${booking.date}
Időpont: ${booking.slot}

Zöld Tara háza rendszer
            `
          }).catch(err => {
            console.error("Email hiba:", err);
          });

          res.json({ ok: true });

        }
      );
    }
  );
});


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

      const diffHours = (bookingDateTime - now) / (1000 * 60 * 60);

      const cancellable =
        booking.status === "confirmed" && diffHours >= 24;

      res.json({
        booking: {
          serviceName: booking.service_name,
          date: booking.date,
          slot: booking.slot,
          status: booking.status,
          cancellable,
        },
      });
    }
  );
});

module.exports = router;