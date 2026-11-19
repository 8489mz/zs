export function getDriverAuthHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_driver_portal_token') : null;
  return { Authorization: `Bearer ${token || ''}` };
}
