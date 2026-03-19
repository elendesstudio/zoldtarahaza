const db = require("./database");

const services = [
  { name: "Mentálhigiénés segítő beszélgetések", duration: 120 },
  { name: "Családállítás", duration: 120 },
  { name: "Önismereti rajz", duration: 120 },
  { name: "Energiakezelés", duration: 120 },
  { name: "Hangfürdő", duration: 120 },
  { name: "Frissítő talp masszázs", duration: 120 },
  { name: "Theta Healing", duration: 120 },
  { name: "Vezetett meditációk", duration: 120 },
  { name: "Metamorf masszázs", duration: 120 },
  { name: "Kismama masszázs", duration: 120 },
  { name: "Párkapcsolati segítő beszélgetés", duration: 120 },
];

services.forEach((service) => {
  db.run(
    `
    INSERT INTO services (name, duration_minutes)
    VALUES (?, ?)
    `,
    [service.name, service.duration]
  );
});

console.log("✅ Szolgáltatások feltöltve (10 db)");
