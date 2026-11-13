#!/usr/bin/env node
/**
 * Essai de bout en bout : les écrans, pilotés comme le ferait l'utilisateur.
 *
 * La suite ordinaire exerce l'API ; aucun test ne cliquait dans l'interface.
 * Une régression d'écran n'était donc vue qu'à l'œil, quand elle l'était : la
 * 1.9.1 a déplacé les fenêtres des dépenses hors de l'écran sans qu'aucun test
 * ne bronche.
 *
 * Trois parcours, dans la vraie application et sur l'interface compilée :
 *   1. le premier lancement, un client, une facture, son aperçu et son envoi
 *      par courriel avec un vrai PDF (seul le serveur d'envoi est simulé) ;
 *   2. une dépense avec son reçu, puis la clôture de sa période ;
 *   3. un client supprimé, un autre archivé, et le dossier renommé.
 *
 * Il lui faut un affichage (sous Linux : `xvfb-run -a npm run test:e2e`) et
 * l'interface compilée (`npm run build:client`).
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  exigerInterfaceCompilee, dossierTemporaire, lancer, fermer, exigerSortiePropre, achever
} = require('./outils.js');

const MOT_DE_PASSE = 'motdepasse-essai';

/** Une étape nommée : son nom s'affiche, et accompagne l'erreur si elle échoue. */
async function etape(nom, action) {
  try {
    await action();
    console.log(`ok - ${nom}`);
  } catch (error) {
    error.message = `${nom} : ${error.message}`;
    throw error;
  }
}

/**
 * La fenêtre ouverte tient dans l'écran. C'est ce que la 1.9.1 avait cassé :
 * les fenêtres des dépenses s'ouvraient en partie hors de la vue.
 */
async function exigerFenetreVisible(page) {
  const boite = await page.locator('.modal-content').last().boundingBox();
  const vue = await page.evaluate(() => ({ largeur: window.innerWidth, hauteur: window.innerHeight }));
  assert.ok(boite, 'une fenêtre doit être ouverte');
  assert.ok(boite.y >= 0 && boite.x >= 0, `la fenêtre déborde en haut ou à gauche (${boite.x}, ${boite.y})`);
  assert.ok(boite.x + boite.width <= vue.largeur + 1, 'la fenêtre déborde à droite');
  assert.ok(boite.y < vue.hauteur / 2, 'le haut de la fenêtre doit être visible sans défiler');
}

const naviguer = (page, vue) => page.getByRole('navigation', { name: 'Navigation principale' })
  .getByRole('button', { name: new RegExp(`^${vue}`) }).click();

/** Ce que dit un PDF de lui-même, sans bibliothèque. */
function examinerPdf(octets) {
  const brut = octets.toString('latin1');
  let texte = null;
  try {
    // pdftotext, quand le poste l'a, lit le texte comme le ferait un logiciel
    // comptable. Sinon, la présence de polices suffit à dire qu'il y en a.
    texte = execFileSync('pdftotext', ['-', '-'], { input: octets }).toString('utf8');
  } catch (e) {
    texte = null;
  }
  return {
    estPdf: brut.startsWith('%PDF-'),
    lettre: /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/.test(brut),
    polices: /\/Type\s*\/Font/.test(brut),
    texte
  };
}

async function parcoursFacture(page, donnees) {
  await etape('le compte se crée depuis le premier écran', async () => {
    // Le premier écran suit la langue du système, qui varie d'une machine à
    // l'autre : l'essai choisit le français, comme le ferait l'utilisateur.
    await page.getByRole('button', { name: 'Français' }).click();
    await page.getByLabel("Nom de l'entreprise").fill('Plomberie Tremblay');
    await page.getByRole('radio', { name: /PME établie/ }).check();
    await page.getByLabel("Nom d'utilisateur").fill('patron');
    await page.getByLabel(/^Mot de passe \(au moins/).fill(MOT_DE_PASSE);
    await page.getByLabel('Confirmez le mot de passe').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('checkbox', { name: /J'ai imprimé ou noté ce code/ }).check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Passer la visite' }).click();
    await page.getByText('Plomberie Tremblay').first().waitFor();
  });

  await etape('un client se crée', async () => {
    await naviguer(page, 'Clients');
    await page.getByRole('button', { name: '+ Nouveau client' }).click();
    await exigerFenetreVisible(page);
    await page.getByLabel("Nom de l'entreprise *").fill('Boulangerie Lavoie');
    await page.getByLabel('Courriel *').fill('compta@boulangerie.exemple');
    await page.getByLabel('Province (détermine les taxes)').selectOption('QC');
    await page.getByRole('button', { name: 'Créer le client' }).click();
    await page.getByRole('heading', { name: 'Boulangerie Lavoie' }).waitFor();
  });

  await etape('une facture se crée, avec ses taxes', async () => {
    await naviguer(page, 'Factures');
    await page.getByRole('button', { name: '+ Nouvelle facture' }).click();
    await exigerFenetreVisible(page);
    await page.getByLabel('Client *').selectOption({ label: 'Boulangerie Lavoie (QC)' });
    await page.getByLabel('Description de la ligne 1').fill('Réparation du chauffe-eau');
    await page.getByLabel('Quantité de la ligne 1').fill('2');
    await page.getByLabel('Prix unitaire de la ligne 1').fill('425.50');
    await page.getByRole('button', { name: 'Créer la facture' }).click();
    await page.getByRole('heading', { name: /^FAC-\d{6}-0001$/ }).waitFor();
    // 851,00 $ + TPS 42,55 $ + TVQ 84,89 $
    await page.getByText('978,44', { exact: false }).first().waitFor();
  });

  await etape('l\'aperçu montre la facture, et l\'envoi joint un vrai PDF', async () => {
    let envoi = null;
    // Seul le serveur d'envoi est simulé : le PDF, lui, est réellement fabriqué.
    await page.route('**/api/emails/send', async (route) => {
      envoi = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
    });

    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    const document = page.locator('.print-only');
    await document.waitFor();
    assert.match(await document.innerText(), /978,44/);

    await page.getByRole('button', { name: 'Envoyer par courriel' }).click();
    await exigerFenetreVisible(page);
    assert.equal(await page.getByLabel('À :').inputValue(), 'compta@boulangerie.exemple');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await page.getByText('Courriel envoyé avec succès.').waitFor();
    await page.unroute('**/api/emails/send');

    assert.ok(envoi, 'la demande d\'envoi doit partir');
    assert.match(envoi.filename, /^Facture_FAC-\d{6}-0001\.pdf$/);
    assert.ok(envoi.facture_id, 'l\'envoi est daté sur la facture');
    const octets = Buffer.from(envoi.attachmentBase64.split(',')[1], 'base64');
    fs.writeFileSync(path.join(donnees, 'facture-envoyee.pdf'), octets);
    const pdf = examinerPdf(octets);
    assert.ok(pdf.estPdf, 'la pièce jointe est un PDF');
    assert.ok(pdf.lettre, 'au format lettre');
    assert.ok(pdf.polices, 'avec du texte, et non une image');
    assert.ok(octets.length < 1024 * 1024, `d'un poids raisonnable (${octets.length} octets)`);
    if (pdf.texte !== null) {
      assert.match(pdf.texte, /Boulangerie Lavoie/);
      assert.match(pdf.texte, /978,44/);
    }

    await page.getByRole('button', { name: 'Fermer', exact: true }).first().click();
  });
}

async function parcoursDepense(page, donnees) {
  const recu = path.join(donnees, 'recu-quincaillerie.pdf');
  fs.copyFileSync(path.join(donnees, 'facture-envoyee.pdf'), recu);

  await etape('une dépense s\'inscrit avec son reçu', async () => {
    await naviguer(page, 'Dépenses');
    await page.getByRole('button', { name: '+ Nouvelle dépense' }).click();
    await exigerFenetreVisible(page);
    await page.getByLabel('Date de la dépense *').fill('2025-12-10');
    await page.getByLabel('Fournisseur *').fill('Quincaillerie Bédard');
    await page.getByLabel('Montant HT ($) *').fill('200');
    await page.getByLabel('TPS / TVH ($)').fill('10');
    await page.getByLabel('TVQ / TVP ($)').fill('19.95');
    await page.getByLabel('Reçu (facultatif, PDF ou image)').setInputFiles(recu);
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: 'Pièces justificatives (1)' }).waitFor();
  });

  await etape('la période se verrouille depuis Paramètres', async () => {
    await naviguer(page, 'Paramètres');
    await page.getByLabel("Verrouiller jusqu'au").fill('2025-12-31');
    await page.getByRole('button', { name: 'Verrouiller', exact: true }).click();
    await page.getByText("Périodes verrouillées jusqu'au 2025-12-31.", { exact: true }).waitFor();
  });

  await etape('la dépense close ne se modifie plus, son reçu reste consultable', async () => {
    await naviguer(page, 'Dépenses');
    const ligne = page.getByRole('row', { name: /Quincaillerie Bédard/ });
    await ligne.getByRole('img', { name: 'Période close' }).waitFor();
    assert.equal(await ligne.getByRole('button', { name: 'Modifier la dépense' }).count(), 0);

    await ligne.getByRole('button', { name: 'Pièces justificatives (1)' }).click();
    await exigerFenetreVisible(page);
    await page.getByText('recu-quincaillerie.pdf').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Retirer « / }).count(), 0, 'un reçu d\'une période close ne se retire pas');
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  });
}

async function parcoursArchivage(page) {
  await etape('une fiche créée par erreur se supprime', async () => {
    await naviguer(page, 'Clients');
    await page.getByRole('button', { name: '+ Nouveau client' }).click();
    await page.getByLabel("Nom de l'entreprise *").fill('Créé par erreur');
    await page.getByLabel('Courriel *').fill('erreur@exemple.ca');
    await page.getByRole('button', { name: 'Créer le client' }).click();
    await page.getByRole('heading', { name: 'Créé par erreur' }).waitFor();

    // Le client facturé, lui, n'offre pas la suppression.
    assert.equal(await page.getByRole('button', { name: 'Supprimer « Boulangerie Lavoie »' }).count(), 0);
    await page.getByRole('button', { name: 'Supprimer « Créé par erreur »' }).click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await page.getByRole('heading', { name: 'Créé par erreur' }).waitFor({ state: 'detached' });
  });

  await etape('un client archivé quitte les listes de choix', async () => {
    await page.getByRole('button', { name: 'Archiver « Boulangerie Lavoie »' }).click();
    await page.getByRole('button', { name: 'Archiver', exact: true }).click();
    await page.getByRole('heading', { name: 'Boulangerie Lavoie' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Voir le client archivé (1)' }).click();
    await page.getByRole('heading', { name: 'Boulangerie Lavoie' }).waitFor();
    await page.getByRole('button', { name: 'Revenir aux clients actifs' }).click();

    await naviguer(page, 'Factures');
    await page.getByRole('button', { name: '+ Nouvelle facture' }).click();
    const fenetre = page.getByRole('dialog', { name: 'Nouvelle facture' });
    const choix = await fenetre.getByLabel('Client *').locator('option').allInnerTexts();
    assert.ok(!choix.some((o) => o.includes('Boulangerie Lavoie')), `proposés : ${choix.join(', ')}`);
    await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
  });

  await etape('le dossier se renomme depuis l\'écran de choix', async () => {
    await page.getByRole('button', { name: 'Ajouter une entreprise' }).click();
    await page.getByRole('button', { name: 'Renommer le dossier « Plomberie Tremblay »' }).click();
    await page.getByLabel('Nouveau nom du dossier').fill('Plomberie Tremblay 2026');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('button', { name: /^Plomberie Tremblay 2026/ }).waitFor();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await page.getByText('Plomberie Tremblay 2026', { exact: true }).waitFor();
  });
}

async function principal() {
  exigerInterfaceCompilee();
  const donnees = dossierTemporaire();
  let session = null;

  try {
    session = await lancer(donnees);
    const { page } = session;
    page.setDefaultTimeout(15000);

    await parcoursFacture(page, donnees);
    await parcoursDepense(page, donnees);
    await parcoursArchivage(page);

    exigerSortiePropre(await fermer(session), session.journal);
    console.log('ok - les trois parcours de l\'interface');
  } catch (error) {
    if (session) {
      const capture = path.join(os.tmpdir(), 'clora-echec-interface.png');
      await session.page.screenshot({ path: capture }).catch(() => {});
      console.error(`Capture de l'écran : ${capture}`);
      console.error(session.journal.join('').split('\n').slice(-40).join('\n'));
    }
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
