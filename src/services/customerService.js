import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { getOwnershipActorId } from './authService.js';
import { customerHasOwnership, projectCustomerOwnership } from './ownershipService.js';

export async function loadRepCustomers(api, repId) {
  const ownerId = String(getOwnershipActorId({ sales_rep_id: repId, id: repId }) || repId || '').trim();
  if (!ownerId) return [];
  const rows = await api.get('customers', {
    select: 'id,name,phone,address,location,location_lat,location_lng,username,created_at,sales_rep_id,rep_id,created_by,created_by_rep_id,customer_type',
    or: `(sales_rep_id.eq.${ownerId},rep_id.eq.${ownerId},created_by_rep_id.eq.${ownerId},created_by.eq.${ownerId})`,
    order: 'created_at.desc',
  }).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((customer) => customerHasOwnership(customer, ownerId))
    .map((customer) => projectCustomerOwnership(customer));
}

export async function createCustomer(api, payload) {
  const rows = await api.post('customers', payload).catch((error) => { throw error; });
  const customer = Array.isArray(rows) ? rows[0] : rows;
  return projectCustomerOwnership(customer || {});
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
