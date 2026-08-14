'use strict';

const fs = require('fs');
const path = require('path');
const { erstelleKinoprogramm } = require('./lib/kino');

async function main() {
  console.log('Lade Kinoprogramme...');
  const daten = await erstelleKinoprogramm();

  const zielordner = path.join(__dirname, 'data');
  fs.mkdirSync(zielordner, { recursive: true });
  const zielpfad = path.join(zielordner, 'kino.json');
  fs.writeFileSync(zielpfad, JSON.stringify(daten, null, 2), 'utf8');

  console.log(`Fertig: ${zielpfad}`);
  daten.kinos.forEach((k) => {
    console.log(`  ${k.name}: ${k.fehler ? 'Fehler - ' + k.fehler : k.filme.length + ' Filme'}`);
  });
}

main().catch((err) => {
  console.error('Abbruch:', err);
  process.exit(1);
});
