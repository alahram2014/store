import { storageKeys, saveJSON, removeValue, loadJSON } from '../core/storage.js';
import { getOwnershipActorId } from './authService.js';

function matchesCustomerOwner(row, ownerId) {
  const target = String(ownerId || '').trim();
  if (!target) return true;
  const candidates = [
    row?.sales_rep_id,
    row?.created_by,
    row?.created_by_rep_id,
    row?.owner_user_id,
  ].map((value) => String(value || '').trim());
  return candidates.some((value) => value && value === target);
}

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
