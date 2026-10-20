// Desactiva el registro libre de cuentas: solo el servidor puede crear usuarios
const { GoogleAuth } = require('google-auth-library');
(async () => {
  const proyecto = 'mantenimiento-la-josefina';
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const cliente = await auth.getClient();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${proyecto}/config?updateMask=client.permissions.disabledUserSignup`;
  const r = await cliente.request({ url, method: 'PATCH', headers: { 'x-goog-user-project': proyecto }, data: { client: { permissions: { disabledUserSignup: true } } } });
  console.log('Registro libre desactivado:', JSON.stringify(r.data.client && r.data.client.permissions));
})().catch(e => { console.error(e.response ? JSON.stringify(e.response.data) : e); process.exit(1); });
