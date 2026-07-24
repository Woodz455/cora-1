const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    ciphers: 'SSLv3'
  }
});

async function sendEmailWithAttachment({ to, cc, subject, text, attachmentBase64, filename }) {
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'VOTRE_MOT_DE_PASSE_ICI') {
    throw new Error('Le mot de passe SMTP n\'est pas configuré dans le fichier .env');
  }

  // Le format de html2pdf peut inclure le nom du fichier ex: data:application/pdf;filename=generated.pdf;base64,JVBER...
  const base64Parts = attachmentBase64.split('base64,');
  const base64Data = base64Parts.length > 1 ? base64Parts[1] : attachmentBase64;

  const mailOptions = {
    from: `Safehill Technologies <${process.env.SMTP_USER}>`,
    to: to,
    cc: cc,
    subject: subject,
    text: text,
    attachments: [
      {
        filename: filename,
        content: base64Data,
        encoding: 'base64'
      }
    ]
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = { sendEmailWithAttachment };
