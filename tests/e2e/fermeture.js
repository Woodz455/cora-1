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
const path = require('path');

const {
  exigerInterfaceCompilee, dossierTemporaire, fichiersDe, lancer, fermer, exigerSortiePropre, achever
} = require('./outils.js');

async function principal() {
  exigerInterfaceCompilee();
  const donnees = dossierTemporaire();
  let session = null;

  try {
    session = await lancer(donnees);

    const creation = await session.api('POST', '/api/auth/setup', {
      username: 'patron', password: 'motdepasse-essai', entreprise: 'Essai de fermeture'
    });
    assert.equal(creation.status, 200, 'la création du compte doit réussir');

    exigerSortiePropre(await fermer(session), session.journal);

    const fichiers = fichiersDe(donnees);
    const sauvegardes = fichiers.filter((f) => /^sauvegardes[\\/]clora-[0-9a-f]{12}-.*\.sqlite$/.test(f));
    assert.equal(sauvegardes.length, 1, `une sauvegarde de fin de journée est attendue, trouvé : ${fichiers.join(', ')}`);
    assert.ok(fs.statSync(path.join(donnees, sauvegardes[0])).size > 0, 'la sauvegarde ne doit pas être vide');

    const journaux = fichiers.filter((f) => /-(wal|shm)$/.test(f));
    assert.deepEqual(journaux, [], 'les journaux WAL doivent être consolidés à la fermeture');

    console.log(`ok - fermeture propre, sauvegarde créée : ${sauvegardes[0]}`);
  } catch (error) {
    if (session) console.error(session.journal.join(''));
    throw error;
  } finally {
    if (session) achever(session.processus);
    fs.rmSync(donnees, { recursive: true, force: true });
  }
}

principal().catch((error) => {
  console.error(`échec - ${error.message}`);
  process.exitCode = 1;
});
