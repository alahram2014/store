import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { getOwnershipActorId } from './authService.js';

export async function loadRepCustomers(api, repId) {
  const ownerId = String(
    getOwnershipActorId({ sales_rep_id: repId, id: repId }) || repId || ''
  ).trim();

  if (!ownerId) return [];

  return await api.get('customers', {
    select: '*',
    sales_rep_id: `eq.${ownerId}`,
    order: 'created_at.desc',
  }).catch(() => []);
}

export async function createCustomer(api, payload) {
  const rows = await api.post('customers', payload).catch((error) => {
    throw error;
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

export function persistSelectedCustomer(customer) {
  if (!customer) {
    removeValue(storageKeys.selectedCustomer);
    return;
  }

  saveJSON(storageKeys.selectedCustomer, customer);
}

export function loadSelectedCustomer() {
  return loadJSON(storageKeys.selectedCustomer, null);
}
