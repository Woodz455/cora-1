#!/usr/bin/env node
/**
 * Essai de bout en bout : fermer la fenêtre de l'application de bureau.
 *
 * La suite ordinaire exerce le serveur, jamais Electron. Elle a donc laissé
 * passer un défaut qui ne vit que dans `main.js` : à la fermeture, le processus
 * s'arrêtait avant la sauvegarde de fin de journée, en plantant.
 *
 * Cet essai lance la vraie application sur l'interface compilée, crée un
 * compte, ferme la fenêtre comme le ferait l'utilisateur, puis vérifie que :
 *   - le processus sort proprement ;
 *   - la sauvegarde de fin de journée existe ;
 *   - les journaux WAL sont consolidés.
 *
 * Il lui faut un affichage (sous Linux : `xvfb-run -a npm run test:e2e`) et
 * l'interface compilée (`npm run build:client`). Il ne porte pas le suffixe
 * `.test.js` : `npm test` doit rester exécutable sans l'un ni l'autre.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { _electron: electron } = require('playwright-core');

const RACINE = path.join(__dirname, '..', '..');
const DELAI_SORTIE_MS = 30000;

/** Tous les fichiers d'un répertoire, récursivement, en chemins relatifs. */
function fichiersDe(repertoire, base = repertoire) {
  if (!fs.existsSync(repertoire)) return [];
  return fs.readdirSync(repertoire, { withFileTypes: true }).flatMap((entree) => {
    const chemin = path.join(repertoire, entree.name);
    return entree.isDirectory() ? fichiersDe(chemin, base) : [path.relative(base, chemin)];
  });
}

async function fenetrePrincipale(application) {
  for (let essai = 0; essai < 150; essai += 1) {
    const page = application.windows().find((w) => w.url().startsWith('http://127.0.0.1'));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("La fenêtre principale ne s'est pas ouverte.");
}

async function principal() {
  assert.ok(
    fs.existsSync(path.join(RACINE, 'client', 'dist', 'index.html')),
    "L'interface n'est pas compilée : lancez « npm run build:client » d'abord."
  );

  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'clora-e2e-'));
  const journal = [];

  const application = await electron.launch({
    // Dans Node, le paquet `electron` rend le chemin de l'exécutable.
    executablePath: require('electron'),
    args: ['--no-sandbox', RACINE],
    env: { ...process.env, CLORA_UI_COMPILEE: '1', CLORA_DATA_DIR: donnees }
  });
  const processus = application.process();
  processus.stdout.on('data', (d) => journal.push(String(d)));
  processus.stderr.on('data', (d) => journal.push(String(d)));

  try {
    const page = await fenetrePrincipale(application);
    await page.waitForLoadState('domcontentloaded');

    const creation = await page.evaluate(async () => {
      const reponse = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'patron', password: 'motdepasse-essai', entreprise: 'Essai de fermeture' })
      });
      return reponse.status;
    });
    assert.equal(creation, 200, 'la création du compte doit réussir');

    const sortie = new Promise((resolve) => processus.on('exit', (code, signal) => resolve({ code, signal })));

    // Le geste de l'utilisateur : fermer la fenêtre.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((fenetre) => fenetre.close());
    }).catch(() => { /* la connexion se coupe quand l'application sort */ });

    const fin = await Promise.race([
      sortie,
      new Promise((resolve) => setTimeout(() => resolve(null), DELAI_SORTIE_MS))
    ]);
    assert.ok(fin, `l'application doit se fermer en moins de ${DELAI_SORTIE_MS / 1000} s`);
    assert.equal(fin.signal, null, `le processus ne doit pas être tué par un signal (${fin.signal})`);
    assert.equal(fin.code, 0, 'le processus doit sortir avec le code 0');

    const fichiers = fichiersDe(donnees);
    const sauvegardes = fichiers.filter((f) => /^sauvegardes[\\/]clora-[0-9a-f]{12}-.*\.sqlite$/.test(f));
    assert.equal(sauvegardes.length, 1, `une sauvegarde de fin de journée est attendue, trouvé : ${fichiers.join(', ')}`);
    assert.ok(fs.statSync(path.join(donnees, sauvegardes[0])).size > 0, 'la sauvegarde ne doit pas être vide');

    const journaux = fichiers.filter((f) => /-(wal|shm)$/.test(f));
    assert.deepEqual(journaux, [], 'les journaux WAL doivent être consolidés à la fermeture');

    assert.ok(!journal.join('').includes('FATAL ERROR'), 'la sortie ne doit pas planter');

    console.log(`ok - fermeture propre, sauvegarde créée : ${sauvegardes[0]}`);
  } catch (error) {
    console.error(journal.join(''));
    throw error;
  } finally {
    if (processus.exitCode === null && processus.signalCode === null) processus.kill('SIGKILL');
    fs.rmSync(donnees, { recursive: true, force: true });
  }
}

principal().catch((error) => {
  console.error(`échec - ${error.message}`);
  process.exitCode = 1;
});
