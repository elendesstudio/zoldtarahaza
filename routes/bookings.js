const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const db = require("../db/database");
const { TIME_SLOTS, isWeekend, isHoliday } = require("../utils/calendar");
const { sendMail } = require("../utils/mailer");

// =========================
// VALIDÁLÓK
// =========================
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return typeof phone === "string" && /^\d{9,15}$/.test(phone);
}

function isNonEmptyString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function isValidDateString(dateStr) {
  return typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getSlotStart(slot) {
  if (typeof slot !== "string" || !slot.includes("-")) return null;
  return slot.split("-")[0];
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// =========================
// GET ALL BOOKINGS
// =========================
router.get("/", async (req, res) => {
  try {
    const rows = await allAsync(
      `
        SELECT 
          b.id,
          b.service_id,
          b.date,
          b.slot,
          b.name,
          b.phone,
          b.email,
          b.note,
          b.status,
          b.deleted,
          b.created_at,
          b.cancelled_by,
          s.name AS service_name
        FROM bookings b
        LEFT JOIN services s ON b.service_id = s.id
        ORDER BY b.date ASC, b.slot ASC
      `
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET BOOKINGS ERROR:", err);
    return res.status(500).json({ error: "Szerver hiba" });
  }
});

// =========================
// CREATE BOOKING
// =========================
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

  if (!isValidDateString(date)) {
    return res.status(400).json({ error: "Hibás dátumformátum" });
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
    const service = await getAsync(
      "SELECT id, name FROM services WHERE id = ?",
      [serviceId]
    );

    if (!service) {
      return res.status(400).json({ error: "Nincs ilyen szolgáltatás" });
    }

    const bookingDate = new Date(`${date}T00:00:00`);
    if (Number.isNaN(bookingDate.getTime())) {
      return res.status(400).json({ error: "Hibás dátum" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (bookingDate < today || isWeekend(date) || isHoliday(date)) {
      return res.status(400).json({ error: "Erre a napra nem foglalható időpont" });
    }

    const slotStart = getSlotStart(slot);
    if (!slotStart) {
      return res.status(400).json({ error: "Hibás slot formátum" });
    }

    const now = new Date();
    if (date === toLocalISODate(now)) {
      const slotStartDate = new Date(`${date}T${slotStart}:00`);
      if (slotStartDate <= now) {
        return res.status(400).json({ error: "Múltbeli időpontra nem lehet foglalni" });
      }
    }

    const blockedDay = await getAsync(
      "SELECT date FROM blocked_days WHERE date = ?",
      [date]
    );

    if (blockedDay) {
      return res.status(400).json({ error: "Ez a nap admin által tiltva van" });
    }

    const slotOverride = await getAsync(
      "SELECT enabled FROM daily_slots WHERE date = ? AND slot = ?",
      [date, slot]
    );

    if (slotOverride && !slotOverride.enabled) {
      return res.status(400).json({ error: "Ez az idősáv nem foglalható" });
    }

    const existingBooking = await getAsync(
      `
        SELECT id
        FROM bookings
        WHERE date = ?
          AND slot = ?
          AND status = 'confirmed'
          AND COALESCE(deleted, 0) = 0
        LIMIT 1
      `,
      [date, slot]
    );

    if (existingBooking) {
      return res.status(409).json({ error: "Ez az időpont már foglalt" });
    }

    const cancelToken = crypto.randomBytes(32).toString("hex");

    const insertResult = await runAsync(
      `
        INSERT INTO bookings
        (
          service_id,
          date,
          slot,
          name,
          phone,
          email,
          note,
          status,
          cancel_token,
          deleted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 0)
      `,
      [serviceId, date, slot, name.trim(), phone.trim(), email.trim(), note || null, cancelToken]
    );

    const bookingId = insertResult.lastID;

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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#123d36;border-radius:14px;padding:24px;color:#ffffff;">
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

          <tr>
            <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
              Kedves <strong>${name}</strong>!<br><br>
              A foglalásod sikeresen rögzítettük.
            </td>
          </tr>

          <tr>
            <td style="background:#0f2e2a;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;">
              <b>Dátum:</b> ${date}<br>
              <b>Időpont:</b> ${slot}<br>
              <b>Kezelés:</b> ${service.name}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:22px;">
              <a href="${cancelLink}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
                Időpont lemondása
              </a>
            </td>
          </tr>

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
      `,
    }).catch((mailErr) => {
      console.error("BOOKING CONFIRM EMAIL ERROR:", mailErr);
    });
  } catch (err) {
    console.error("BOOKING ERROR:", err);
    return res.status(500).json({ error: "Szerver hiba" });
  }
});

// =========================
// CANCEL INFO
// =========================
router.get("/cancel-info", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  try {
    const booking = await getAsync(
      `
        SELECT b.*, s.name AS service_name
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.cancel_token = ?
      `,
      [token]
    );

    if (!booking) {
      return res.status(404).json({ error: "Nem található" });
    }

    const slotStart = getSlotStart(booking.slot);
    const bookingDateTime = slotStart
      ? new Date(`${booking.date}T${slotStart}:00`)
      : null;

    const diffHours = bookingDateTime
      ? (bookingDateTime - new Date()) / (1000 * 60 * 60)
      : -1;

    return res.json({
      booking: {
        serviceName: booking.service_name,
        date: booking.date,
        slot: booking.slot,
        status: booking.deleted ? "cancelled" : "confirmed",
        cancellable: diffHours >= 24 && Number(booking.deleted) !== 1,
      },
    });
  } catch (err) {
    console.error("CANCEL INFO ERROR:", err);
    return res.status(500).json({ error: "Szerver hiba" });
  }
});

// =========================
// CANCEL
// =========================
router.post("/cancel", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Hiányzó token" });
  }

  try {
    const booking = await getAsync(
      `
        SELECT b.*, s.name AS service_name
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.cancel_token = ?
      `,
      [token]
    );

    if (!booking) {
      return res.status(404).json({ error: "Nem található" });
    }

    if (Number(booking.deleted) === 1) {
      return res.status(400).json({ error: "Már lemondva" });
    }

    await runAsync(
      "UPDATE bookings SET deleted = 1, cancelled_by = 'user' WHERE id = ?",
      [booking.id]
    );

    res.json({ ok: true });

    if (booking.email) {
      sendMail({
        to: booking.email,
        subject: "Időpont lemondva",
        html: `
<div style="margin:0;padding:0;background:#0f2e2a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#123d36;border-radius:14px;padding:24px;color:#ffffff;">
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

          <tr>
            <td style="font-size:14px;line-height:1.6;padding-bottom:18px;">
              Kedves <strong>${booking.name}</strong>!<br><br>
              A foglalásod sikeresen <strong>lemondtad</strong>.
            </td>
          </tr>

          <tr>
            <td style="background:#0f2e2a;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;">
              <b>Kezelés:</b> ${booking.service_name}<br>
              <b>Dátum:</b> ${booking.date}<br>
              <b>Időpont:</b> ${booking.slot}
            </td>
          </tr>

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
        `,
      }).catch((err) => console.error("USER EMAIL FAIL:", err));
    }

    if (process.env.OWNER_EMAIL) {
      sendMail({
        to: process.env.OWNER_EMAIL,
        subject: "Foglalás lemondva",
        text: `
Név: ${booking.name}
Email: ${booking.email}
Dátum: ${booking.date}
Időpont: ${booking.slot}
        `,
      }).catch((err) => console.error("ADMIN EMAIL FAIL:", err));
    }
  } catch (err) {
    console.error("CANCEL ERROR:", err);
    return res.status(500).json({ error: "Szerver hiba" });
  }
});

module.exports = router;