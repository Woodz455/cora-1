/**
 * Outils communs aux essais de bout en bout : lancer la vraie application de
 * bureau sur l'interface compilée, lui parler, la fermer comme un utilisateur.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { _electron: electron } = require('playwright-core');

const RACINE = path.join(__dirname, '..', '..');
const DELAI_SORTIE_MS = 30000;

/** Refuse de partir sans l'interface compilée, avec un message qui dit quoi faire. */
function exigerInterfaceCompilee() {
  assert.ok(
    fs.existsSync(path.join(RACINE, 'client', 'dist', 'index.html')),
    "L'interface n'est pas compilée : lancez « npm run build:client » d'abord."
  );
}

/** Dossier de données jetable. */
function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clora-e2e-'));
}

/** Tous les fichiers d'un répertoire, récursivement, en chemins relatifs. */
function fichiersDe(repertoire, base = repertoire) {
  if (!fs.existsSync(repertoire)) return [];
  return fs.readdirSync(repertoire, { withFileTypes: true }).flatMap((entree) => {
    const chemin = path.join(repertoire, entree.name);
    return entree.isDirectory() ? fichiersDe(chemin, base) : [path.relative(base, chemin)];
  });
}

/**
 * Lance l'application sur un dossier de données.
 *
 * `--password-store=basic` fixe le coffre employé sous Linux : sans lui, il
 * dépend du bureau de la machine, et l'essai ne dirait pas la même chose d'un
 * poste à l'autre. Sous Windows, le drapeau est sans effet.
 *
 * @returns {Promise<{application, page, processus, journal: string[], api: Function}>}
 */
async function lancer(donnees) {
  const journal = [];
  const application = await electron.launch({
    // Dans Node, le paquet `electron` rend le chemin de l'exécutable.
    executablePath: require('electron'),
    args: ['--no-sandbox', '--password-store=basic', RACINE],
    env: { ...process.env, CLORA_UI_COMPILEE: '1', CLORA_DATA_DIR: donnees }
  });
  const processus = application.process();
  processus.stdout.on('data', (d) => journal.push(String(d)));
  processus.stderr.on('data', (d) => journal.push(String(d)));

  let page = null;
  for (let essai = 0; essai < 150 && !page; essai += 1) {
    page = application.windows().find((w) => w.url().startsWith('http://127.0.0.1'));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!page) throw new Error("La fenêtre principale ne s'est pas ouverte.");
  await page.waitForLoadState('domcontentloaded');

  /** Appelle l'API depuis la fenêtre, donc avec sa session. */
  const api = (methode, url, corps) => page.evaluate(async ({ methode, url, corps }) => {
    const reponse = await fetch(url, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps)
    });
    return { status: reponse.status, data: await reponse.json().catch(() => null) };
  }, { methode, url, corps });

  return { application, page, processus, journal, api };
}

/**
 * Ferme la fenêtre, comme le ferait l'utilisateur, et attend la sortie.
 *
 * @returns {Promise<{code: ?number, signal: ?string}|null>} null si l'application ne s'est pas fermée à temps
 */
async function fermer({ application, processus }) {
  const sortie = new Promise((resolve) => processus.on('exit', (code, signal) => resolve({ code, signal })));

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((fenetre) => fenetre.close());
  }).catch(() => { /* la connexion se coupe quand l'application sort */ });

  return Promise.race([
    sortie,
    new Promise((resolve) => setTimeout(() => resolve(null), DELAI_SORTIE_MS))
  ]);
}

/** Vérifie qu'une fermeture s'est bien passée. */
function exigerSortiePropre(fin, journal) {
  assert.ok(fin, `l'application doit se fermer en moins de ${DELAI_SORTIE_MS / 1000} s`);
  assert.equal(fin.signal, null, `le processus ne doit pas être tué par un signal (${fin.signal})`);
  assert.equal(fin.code, 0, 'le processus doit sortir avec le code 0');
  assert.ok(!journal.join('').includes('FATAL ERROR'), 'la sortie ne doit pas planter');
}

/** Tue un processus resté en vie après un échec. */
function achever(processus) {
  if (processus && processus.exitCode === null && processus.signalCode === null) processus.kill('SIGKILL');
}

module.exports = {
  RACINE, exigerInterfaceCompilee, dossierTemporaire, fichiersDe, lancer, fermer, exigerSortiePropre, achever
};
