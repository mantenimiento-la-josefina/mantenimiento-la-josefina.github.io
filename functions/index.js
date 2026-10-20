// Servidor de Mantenimiento La Josefina DPC (Cloud Functions de Firebase)
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const db = getFirestore();
const URL_BASE = 'https://mantenimiento-la-josefina.github.io/';
const DOMINIO = 'lajosefina-dpc.app';
const PRINCIPAL = 'Administrador principal';
const ROLES_ASIGNABLES = ['Administrador', 'Dirección', 'Gerencia', 'Coordinación', 'Supervisor de mantenimiento', 'Mecánico', 'Operador'];
const ROLES_ALTAS = [PRINCIPAL, 'Administrador', 'Dirección', 'Gerencia', 'Coordinación'];
const ROLES_AVISO = ['Mecánico', 'Supervisor de mantenimiento'];
const MAQUINAS = {
  'AMP-LA-001': { planta: 'AM Pack', zona: 'Línea A', nombre: 'Envasadora vertical' },
  'AMP-LB-001': { planta: 'AM Pack', zona: 'Línea B', nombre: 'Envasadora vertical' },
};

async function perfilDe(uid) {
  if (!uid) return null;
  const s = await db.doc('usuarios/' + uid).get();
  return s.exists ? s.data() : null;
}
async function exigir(req, roles) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const p = await perfilDe(req.auth.uid);
  if (!p || p.activo !== true || !roles.includes(p.rol)) throw new HttpsError('permission-denied', 'No tienes permiso para esta acción.');
  return p;
}
function leDebeLlegar(perfil, equipo) {
  if (!perfil || perfil.activo !== true || !ROLES_AVISO.includes(perfil.rol)) return false;
  const m = MAQUINAS[equipo];
  if (perfil.linea && perfil.linea !== 'todas') return perfil.linea === equipo;
  if (perfil.planta && m) return perfil.planta === m.planta;
  return true;
}

// Envía los avisos push a los teléfonos indicados y limpia los tokens vencidos
async function enviar(tokens, msg) {
  if (!tokens.length) return { enviados: 0 };
  const res = await getMessaging().sendEach(tokens.map(t => Object.assign({ token: t }, msg)));
  const borrar = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const c = r.error && r.error.code;
      logger.warn('Fallo al enviar', c);
      if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') borrar.push(tokens[i]);
    }
  });
  await Promise.all(borrar.map(t => db.doc('tokens/' + t).delete().catch(() => {})));
  return { enviados: res.successCount };
}
function mensaje(titulo, cuerpo, url, tag) {
  return {
    notification: { title: titulo, body: cuerpo },
    data: { url, tag },
    webpush: {
      headers: { Urgency: 'high', TTL: '3600' },
      notification: { title: titulo, body: cuerpo, icon: URL_BASE + 'icono-192.png', badge: URL_BASE + 'icono-192.png', tag, renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 400] },
      fcmOptions: { link: url },
    },
  };
}

// 1) Nueva falla → aviso push a los mecánicos de esa planta o línea
exports.avisarFalla = onDocumentCreated('registros/{id}', async (event) => {
  const r = event.data && event.data.data();
  if (!r || r.tipo !== 'Reporte de falla') return;
  const out = await avisar(r, event.params.id, 1);
  logger.info('Aviso de falla', event.params.id, out);
});

async function destinosPara(equipo) {
  const tokSnap = await db.collection('tokens').get();
  const porUid = {};
  tokSnap.forEach(d => { const t = d.data(); if (t.uid) (porUid[t.uid] = porUid[t.uid] || []).push(d.id); });
  const destinos = [];
  for (const uid of Object.keys(porUid)) {
    const p = await perfilDe(uid);
    if (leDebeLlegar(p, equipo)) destinos.push(...porUid[uid]);
  }
  return destinos;
}
async function avisar(r, id, n) {
  const m = MAQUINAS[r.equipo] || { zona: r.equipo, planta: '', nombre: '' };
  const titulo = (n > 1 ? '🚨🚨 SIN ATENDER (' + n + '/' + MAX_AVISOS + ') ' : '🚨 ') + 'Falla en ' + (m.planta ? m.planta + ' · ' : '') + m.zona + (r.severidad === 'Paro de línea' ? ' (línea detenida)' : '');
  const cuerpo = (r.tipoFalla || 'Falla') + ' — ' + String(r.actividad || '').slice(0, 140) + ' · Reportó ' + (r.tecnico || '');
  return enviar(await destinosPara(r.equipo), mensaje(titulo, cuerpo, URL_BASE + '#alertas', 'falla-' + id + '-' + n));
}

// 1b) Mientras la falla siga sin atender, el aviso se repite cada minuto (máximo 10 veces)
const MAX_AVISOS = 10;
exports.repetirAvisoFalla = onSchedule({ schedule: 'every 1 minutes', timeZone: 'America/Mexico_City' }, async () => {
  const snap = await db.collection('registros').where('tipo', '==', 'Reporte de falla').get();
  const ahora = Date.now();
  for (const d of snap.docs) {
    const r = d.data();
    if (!['Pendiente', 'Abierta'].includes(r.estado)) continue;
    const creado = r.creadoEn && r.creadoEn.toMillis ? r.creadoEn.toMillis() : 0;
    const n = r.avisos || 1;
    if (!creado || n >= MAX_AVISOS || ahora - creado < 50000 || ahora - creado > (MAX_AVISOS + 2) * 60000) continue;
    await d.ref.update({ avisos: n + 1 });
    const out = await avisar(r, d.id, n + 1);
    logger.info('Aviso repetido', d.id, n + 1, out);
  }
});

// 2) Cuenta desactivada/activada en el panel → se bloquea o desbloquea el acceso en el sistema de autenticación
exports.sincronizarCuenta = onDocumentUpdated('usuarios/{uid}', async (event) => {
  const antes = event.data.before.data() || {}, despues = event.data.after.data() || {};
  if (antes.activo === despues.activo) return;
  const uid = event.params.uid;
  await getAuth().updateUser(uid, { disabled: despues.activo !== true });
  if (despues.activo !== true) {
    await getAuth().revokeRefreshTokens(uid);
    const t = await db.collection('tokens').where('uid', '==', uid).get();
    await Promise.all(t.docs.map(d => d.ref.delete()));
  }
});

// 3) Alta de usuarios desde el panel (el registro libre queda bloqueado)
exports.crearUsuario = onCall(async (req) => {
  const yo = await exigir(req, ROLES_ALTAS);
  const d = req.data || {};
  const usuario = String(d.usuario || '').trim().toLowerCase();
  const rol = String(d.rol || '');
  if (!/^[a-z0-9._-]{2,40}$/.test(usuario)) throw new HttpsError('invalid-argument', 'Usuario no válido.');
  if (String(d.contrasena || '').length < 6) throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  if (!ROLES_ASIGNABLES.includes(rol)) throw new HttpsError('invalid-argument', 'Puesto no válido.');
  if (rol === 'Administrador' && yo.rol !== PRINCIPAL) throw new HttpsError('permission-denied', 'Solo el Administrador principal crea administradores.');
  if (d.numEmpleado && !/^[0-9]{1,10}$/.test(String(d.numEmpleado))) throw new HttpsError('invalid-argument', 'Número de empleado no válido.');
  let nuevo;
  try {
    nuevo = await getAuth().createUser({ email: usuario + '@' + DOMINIO, password: String(d.contrasena), displayName: String(d.nombre || '').slice(0, 80), disabled: d.activo === false });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ese nombre de usuario ya está ocupado. Elige otro.');
    throw new HttpsError('internal', 'No se pudo crear la cuenta.');
  }
  await db.doc('usuarios/' + nuevo.uid).set({
    nombre: String(d.nombre || '').trim().slice(0, 80), usuario, numEmpleado: String(d.numEmpleado || ''), rol,
    planta: String(d.planta || ''), linea: String(d.linea || 'todas'), activo: d.activo !== false,
    creadoPor: req.auth.uid, creadoEn: FieldValue.serverTimestamp(),
  });
  return { uid: nuevo.uid };
});

// 4) Restablecer la contraseña de un trabajador (solo Administrador principal)
exports.restablecerContrasena = onCall(async (req) => {
  await exigir(req, [PRINCIPAL]);
  const uid = String((req.data || {}).uid || ''), pass = String((req.data || {}).contrasena || '');
  if (pass.length < 6) throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
  const p = await perfilDe(uid);
  if (!p) throw new HttpsError('not-found', 'No existe ese usuario.');
  if (p.rol === PRINCIPAL) throw new HttpsError('permission-denied', 'Cambia tu propia contraseña en «Mi cuenta».');
  await getAuth().updateUser(uid, { password: pass });
  await getAuth().revokeRefreshTokens(uid);
  await db.doc('usuarios/' + uid).update({ contrasenaRestablecidaEn: FieldValue.serverTimestamp(), contrasenaRestablecidaPor: req.auth.uid });
  return { ok: true };
});

// 5) Notificación de prueba para el teléfono de quien la pide
exports.probarNotificacion = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const t = await db.collection('tokens').where('uid', '==', req.auth.uid).get();
  const out = await enviar(t.docs.map(d => d.id), mensaje('🔔 Prueba de notificación', 'Si ves esto, las alertas de fallas te llegarán aunque el teléfono esté bloqueado.', URL_BASE + '#cuenta', 'prueba'));
  return out;
});
