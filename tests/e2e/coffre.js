#!/usr/bin/env node
/**
 * Essai de bout en bout : le coffre des secrets, dans la vraie application.
 *
 * Les secrets de Clora (mot de passe du courriel, clé des sauvegardes) sont
 * confiés au coffre d'Electron. Les tests ordinaires tournent hors Electron et
 * ne voient qu'un faux coffre. Celui-ci vérifie le vrai, d'un lancement au
 * suivant :
 *   - un secret enregistré est réellement protégé par le coffre ;
 *   - après fermeture et relance, il est relu à l'identique ;
 *   - la sauvegarde faite à la fermeture est chiffrée, ce qui suppose que la
 *     clé était lisible à ce moment-là.
 *
 * C'est le filet des mises à jour d'Electron : c'est une version majeure qui a
 * rendu obsolètes les fonctions sur lesquelles reposait le coffre.
 *
 * Sous Linux, le coffre n'est pas celui de Windows : cet essai ne dit rien de
 * la relecture, sur un vrai poste, des secrets d'une installation existante.
 */

const assert = require('node:assert/strict');
const fs = require('fs');

const {
  exigerInterfaceCompilee, dossierTemporaire, fichiersDe, lancer, fermer, exigerSortiePropre, achever
} = require('./outils.js');

const MOT_DE_PASSE = 'motdepasse-essai';

async function principal() {
  exigerInterfaceCompilee();
  const donnees = dossierTemporaire();
  let session = null;

  try {
    // --- Premier lancement : enregistrer deux secrets.
    session = await lancer(donnees);
    const creation = await session.api('POST', '/api/auth/setup', {
      username: 'patron', password: MOT_DE_PASSE, entreprise: 'Essai du coffre'
    });
    assert.equal(creation.status, 200, 'la création du compte doit réussir');

    const generee = await session.api('POST', '/api/sauvegardes/cle/generer');
    assert.equal(generee.status, 200, JSON.stringify(generee.data));
    const cle = generee.data.cle;
    const pose = await session.api('POST', '/api/sauvegardes/cle', { cle, confirmation: cle });
    assert.equal(pose.status, 200, JSON.stringify(pose.data));

    const reglage = await session.api('PUT', '/api/settings', {
      entreprise_nom: 'Essai du coffre',
      smtp_host: 'smtp.exemple.ca',
      smtp_port: 587,
      smtp_user: 'moi@exemple.ca',
      smtp_pass: 'mot-de-passe-du-courriel'
    });
    assert.equal(reglage.status, 200, JSON.stringify(reglage.data));
    assert.equal(reglage.data.settings.coffre_disponible, true, 'le coffre doit être disponible dans l\'application');
    assert.equal(reglage.data.settings.smtp_pass_protege, true, 'le mot de passe doit être protégé par le coffre');

    const avant = await session.api('GET', '/api/sauvegardes');
    assert.deepEqual(
      { active: avant.data.protection.active, lisible: avant.data.protection.lisible },
      { active: true, lisible: true }
    );

    exigerSortiePropre(await fermer(session), session.journal);
    assert.ok(
      !/is deprecated/.test(session.journal.join('')),
      `aucune fonction obsolète d'Electron ne doit être appelée :\n${session.journal.join('').split('\n').filter((l) => /deprecated/.test(l)).join('\n')}`
    );

    // La clé était lisible à la fermeture : la copie du jour est chiffrée.
    const copies = fichiersDe(donnees).filter((f) => /^sauvegardes[\\/]clora-/.test(f));
    assert.ok(copies.length >= 1 && copies.every((f) => f.endsWith('.clora')),
      `les sauvegardes doivent être chiffrées, trouvé : ${copies.join(', ')}`);

    // --- Second lancement : les secrets sont-ils relus ?
    session = await lancer(donnees);
    const connexion = await session.api('POST', '/api/auth/login', { username: 'patron', password: MOT_DE_PASSE });
    assert.equal(connexion.status, 200, JSON.stringify(connexion.data));

    const apres = await session.api('GET', '/api/sauvegardes');
    assert.deepEqual(
      { active: apres.data.protection.active, lisible: apres.data.protection.lisible },
      { active: true, lisible: true },
      'la clé des sauvegardes doit rester lisible après une relance'
    );

    const affichee = await session.api('POST', '/api/sauvegardes/cle/afficher', { motDePasse: MOT_DE_PASSE });
    assert.equal(affichee.status, 200, JSON.stringify(affichee.data));
    assert.equal(affichee.data.cle, cle, 'la clé relue doit être celle qui a été posée');

    const reglages = await session.api('GET', '/api/settings');
    assert.equal(reglages.data.smtp_pass_defini, true);
    assert.equal(reglages.data.smtp_pass_protege, true);

    exigerSortiePropre(await fermer(session), session.journal);
    console.log('ok - secrets protégés par le coffre, relus à l\'identique après une relance');
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
