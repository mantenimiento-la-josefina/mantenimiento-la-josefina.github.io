const { GoogleAuth } = require('google-auth-library');
(async () => {
  const p = 'mantenimiento-la-josefina';
  const c = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const base = `https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents`;
  const toks = await c.request({ url: `${base}/tokens?pageSize=300` });
  const lista = toks.data.documents || [];
  console.log('Teléfonos con avisos activados:', lista.length);
  const ahora = new Date(Date.now() - 6 * 3600e3);
  const fecha = ahora.toISOString().slice(0, 10), hora = ahora.toISOString().slice(11, 16);
  const s = v => ({ stringValue: v });
  const r = await c.request({ url: `${base}/registros`, method: 'POST', data: { fields: {
    equipo: s('AMP-LA-001'), tipo: s('Reporte de falla'), tipoFalla: s('Prueba'), fecha: s(fecha), hora: s(hora),
    actividad: s('PRUEBA DEL SISTEMA - ignorar, se puede cerrar'), severidad: s('Sin paro'), paro: s(''), observaciones: s(''),
    estado: s('Pendiente'), tecnico: s('Prueba automática'), tecnicoUid: s('prueba'), rol: s('Operador'),
    refacciones: s(''), minutos: s(''), fotos: { arrayValue: {} }, creadoEn: { timestampValue: new Date().toISOString() } } } });
  console.log('Falla de prueba creada:', r.data.name.split('/').pop());
  console.log('::notice::Telefonos con avisos activados: ' + lista.length);
})().catch(e => { console.error(e.response ? JSON.stringify(e.response.data) : e); process.exit(1); });
