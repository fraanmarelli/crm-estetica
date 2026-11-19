// Certificado de ARCA: clave privada, pedido de certificado (.csr) y firma del acceso (CMS).
// Sin "server-only" para poder probarlo con tsx; en la app lo importa solo arca.ts (servidor).
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

// Clave privada RSA 2048 + pedido de certificado con el CUIT del titular
export function createKeyAndCsr(input: { cuit: string; businessName: string; alias: string }) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const key = forge.pki.privateKeyFromPem(privateKey);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: asciiName(input.businessName) },
    { name: "commonName", value: input.alias },
    { type: "2.5.4.5", value: `CUIT ${input.cuit}` }, // serialNumber
  ]);
  csr.sign(key, forge.md.sha256.create());
  return { privateKeyPem: forge.pki.privateKeyToPem(key), csrPem: forge.pki.certificationRequestToPem(csr) };
}

// ARCA no se lleva bien con tildes en el pedido
function asciiName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 60) || "Titular";
}

export type CertInfo = { notAfter: Date; notBefore: Date; cuit: string | null; matchesKey: boolean; subject: string };

// Lee el certificado que devolvió ARCA y verifica que corresponda a la clave guardada
export function readCertificate(certPem: string, privateKeyPem: string): CertInfo {
  const cert = forge.pki.certificateFromPem(normalizePem(certPem));
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  const serial = cert.subject.attributes.find((a) => a.type === "2.5.4.5")?.value as string | undefined;
  const cuit = serial?.match(/(\d{11})/)?.[1] ?? null;
  return {
    notAfter: cert.validity.notAfter,
    notBefore: cert.validity.notBefore,
    cuit,
    matchesKey: pub.n.equals(key.n) && pub.e.equals(key.e),
    subject: cert.subject.attributes.map((a) => `${a.shortName ?? a.type}=${a.value}`).join(", "),
  };
}

// Acepta el .crt tal cual lo descarga ARCA (con o sin encabezados, con espacios de más)
export function normalizePem(raw: string): string {
  const s = raw.trim();
  if (s.includes("BEGIN CERTIFICATE")) {
    const body = s.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
    return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
  }
  const body = s.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
}

// Firma el pedido de acceso (TRA) en formato CMS, como lo pide WSAA
export function signTra(tra: string, certPem: string, privateKeyPem: string): string {
  const cert = forge.pki.certificateFromPem(normalizePem(certPem));
  const key = forge.pki.privateKeyFromPem(privateKeyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // forge acepta un Date en signingTime aunque el tipo diga string
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}
