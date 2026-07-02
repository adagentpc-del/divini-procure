/**
 * Data calls - same public API as before, but every call now hits the Express
 * backend (src/lib/api.ts) instead of Supabase PostgREST/Storage. Function
 * signatures are unchanged so the pages need no rewrites for data access.
 */
import { apiGet, apiSend, apiUpload } from './api';

export type CompanyPayload = {
  kind: 'buyer' | 'vendor' | 'investor'; name: string; contact_name?: string; contact_title?: string;
  email?: string; phone?: string; street?: string; city?: string; region?: string;
  services?: string[];
  // richer developer profile (all optional)
  website?: string; description?: string; state?: string; ownership_group?: string;
  development_team?: string; asset_types?: string[]; headquarters?: string;
  // vendor + investor profile arrays (all optional)
  coverage_areas?: string[]; service_categories?: string[]; capabilities?: string[];
  focus_areas?: string[]; geographies?: string[];
};

export async function createCompanyForUser(_userId: string, payload: CompanyPayload) {
  // userId is now derived from the verified token on the backend.
  return apiSend<{ id: string }>('POST', '/companies', payload);
}

// ---- developer onboarding: website extract + brand media upload ----
export type ExtractResult = {
  available: boolean; name?: string | null; description?: string | null;
  services?: string[]; tags?: string[];
};
export async function extractProfileFromUrl(url: string) {
  return apiSend<ExtractResult>('POST', '/onboarding/extract', { url });
}
export type MediaCategory =
  | 'logo' | 'image' | 'deck' | 'brochure'
  | 'doc' | 'cert' | 'insurance' | 'license' | 'w9'
  | 'other';
export async function uploadCompanyMedia(
  file: File,
  opts: { companyId: string; category: MediaCategory },
) {
  const form = new FormData();
  form.append('file', file);
  form.append('companyId', opts.companyId);
  form.append('category', opts.category);
  return apiUpload<any>('/onboarding/media', form);
}

export async function getBuildings(companyId: string) {
  return apiGet<any[]>(`/buildings?companyId=${encodeURIComponent(companyId)}`);
}

export async function createBuilding(payload: { company_id: string; name: string; location?: string; developer?: string }) {
  return apiSend('POST', '/buildings', payload);
}

export async function getOpenPackages(filter?: { categories?: string[] }) {
  const qs = filter?.categories?.length ? `?categories=${encodeURIComponent(filter.categories.join(','))}` : '';
  return apiGet<any[]>(`/packages/open${qs}`);
}

export async function getMyBids(companyId: string) {
  return apiGet<any[]>(`/bids/mine?companyId=${encodeURIComponent(companyId)}`);
}

export async function getVendorProfile(companyId: string) {
  return apiGet<any>(`/vendor-profiles/${encodeURIComponent(companyId)}`);
}

export async function getBuilding(id: string) {
  return apiGet<any>(`/buildings/${encodeURIComponent(id)}`);
}
export async function getPackages(buildingId: string) {
  return apiGet<any[]>(`/buildings/${encodeURIComponent(buildingId)}/packages`);
}
export async function createPackage(buildingId: string, p: { category: string; status?: string; deadline?: string; budget_min?: number; budget_max?: number; }) {
  return apiSend('POST', `/buildings/${encodeURIComponent(buildingId)}/packages`, p);
}
export async function getPackage(id: string) {
  return apiGet<any>(`/packages/${encodeURIComponent(id)}`);
}
export async function setPackageStatus(id: string, status: string) {
  await apiSend('POST', `/packages/${encodeURIComponent(id)}/status`, { status });
}

export async function getLineItems(packageId: string) {
  return apiGet<any[]>(`/packages/${encodeURIComponent(packageId)}/line-items`);
}
export async function addLineItem(packageId: string, li: { description: string; qty?: number; unit?: string; cost_code?: string; item_no?: string; }) {
  await apiSend('POST', `/packages/${encodeURIComponent(packageId)}/line-items`, li);
}
export async function deleteLineItem(id: string) {
  await apiSend('DELETE', `/line-items/${encodeURIComponent(id)}`);
}

export async function getDocuments(opts: { packageId?: string; buildingId?: string }) {
  const params = new URLSearchParams();
  if (opts.packageId) params.set('packageId', opts.packageId);
  else if (opts.buildingId) params.set('buildingId', opts.buildingId);
  const qs = params.toString();
  return apiGet<any[]>(`/documents${qs ? `?${qs}` : ''}`);
}
export async function uploadDocument(file: File, opts: { companyId: string; userId?: string; buildingId?: string; packageId?: string }) {
  const form = new FormData();
  form.append('file', file);
  form.append('companyId', opts.companyId);
  if (opts.buildingId) form.append('buildingId', opts.buildingId);
  if (opts.packageId) form.append('packageId', opts.packageId);
  return apiUpload('/documents', form);
}
export async function signedUrl(path: string) {
  try {
    const { signedUrl } = await apiGet<{ signedUrl: string }>(`/documents/signed-url?path=${encodeURIComponent(path)}`);
    return signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function getBidsForPackage(packageId: string) {
  return apiGet<any[]>(`/packages/${encodeURIComponent(packageId)}/bids`);
}
export async function submitPricedBid(packageId: string, vendorCompanyId: string, payload: {
  price: number; days: number; note?: string; items?: { line_item_id: string; unit_price: number; qty: number; amount: number }[];
}) {
  return apiSend('POST', `/packages/${encodeURIComponent(packageId)}/bids`, { vendorCompanyId, ...payload });
}

export async function getQuestions(packageId: string) {
  return apiGet<any[]>(`/packages/${encodeURIComponent(packageId)}/questions`);
}
export async function askQuestion(packageId: string, vendorCompanyId: string, question: string) {
  await apiSend('POST', `/packages/${encodeURIComponent(packageId)}/questions`, { vendorCompanyId, question });
}
export async function answerQuestion(id: string, answer: string) {
  await apiSend('POST', `/questions/${encodeURIComponent(id)}/answer`, { answer });
}

// ---- RFQ assist (CAD/spec intake + deterministic line-item suggestions) ----
export type SuggestedLine = {
  id?: string; name: string; category?: string; qty?: number; unit?: string;
  spec?: string; notes?: string; status?: string;
};
export async function uploadRfqDocument(file: File, opts: { companyId: string; packageId: string; category: string; }) {
  const form = new FormData();
  form.append('file', file);
  form.append('companyId', opts.companyId);
  form.append('packageId', opts.packageId);
  form.append('category', opts.category);
  return apiUpload<any>('/rfq/documents', form);
}
export async function getRfqDocuments(packageId: string) {
  return apiGet<any[]>(`/rfq/documents/${encodeURIComponent(packageId)}`);
}
export async function suggestRfqLines(packageId: string, body: { needs?: string; specText?: string }) {
  return apiSend<{ suggestions: SuggestedLine[]; sourceUsedDocText: boolean }>('POST', '/rfq/suggest-lines', { packageId, ...body });
}
export async function getRfqSuggestions(packageId: string) {
  return apiGet<{ suggestions: SuggestedLine[] }>(`/rfq/suggest-lines/${encodeURIComponent(packageId)}`);
}
export async function applyRfqLines(packageId: string, payload: { lineIds?: string[]; lines?: SuggestedLine[] }) {
  return apiSend<{ applied: number; lineItems: any[] }>('POST', '/rfq/apply-lines', { packageId, ...payload });
}

// ---- company profile + account ----
export async function updateCompany(id: string, patch: { name?: string; contact_name?: string; phone?: string; city?: string }) {
  return apiSend('PATCH', `/companies/${encodeURIComponent(id)}`, patch);
}
export async function deleteMyAccount() {
  await apiSend('POST', '/account/delete');
}

// ---- owner-email transfer ----
// Hand control of the company to a new email. The backend upserts that user
// (unverified) and emails them a verify/claim link to set a password and take
// over; the company_members owner row and companies.email move to them.
export async function transferOwnership(companyId: string, newEmail: string) {
  return apiSend<{ ok: boolean; newOwner: { id: string; email: string | null } }>(
    'POST',
    '/auth/transfer-ownership',
    { companyId, newEmail },
  );
}

// ---- current engagements ("what you have going on") ----
export type Engagement = {
  id: string; company_id: string; created_by?: string | null;
  title: string; type?: string | null; status?: string | null;
  counterparty?: string | null; value_cents?: number | null;
  location?: string | null; notes?: string | null;
  created_at: string; updated_at?: string | null;
};
export type EngagementPayload = {
  title: string; type?: string; status?: string; counterparty?: string;
  valueCents?: number | null; location?: string; notes?: string;
};
export async function listEngagements() {
  const d = await apiGet<{ engagements: Engagement[] }>('/engagements');
  return d.engagements ?? [];
}
export async function createEngagement(payload: EngagementPayload) {
  const d = await apiSend<{ engagement: Engagement }>('POST', '/engagements', payload);
  return d.engagement;
}
export async function updateEngagement(id: string, patch: Partial<EngagementPayload>) {
  const d = await apiSend<{ engagement: Engagement }>('PATCH', `/engagements/${encodeURIComponent(id)}`, patch);
  return d.engagement;
}

// ---- referral partner revenue (commission ledger + payouts) ----
export type PartnerCommission = {
  id: string; partner_id: string; referred_company_id?: string | null;
  source: string; gross_cents: number; platform_fee_cents: number;
  processing_cost_cents: number; net_profit_cents: number; commission_cents: number;
  status: string; excluded: boolean; created_at: string;
};
export type PartnerPayout = {
  id: string; partner_id: string; period?: string | null;
  gross_volume_cents: number; platform_fees_cents: number; processing_costs_cents: number;
  net_profit_cents: number; commission_pct?: number | null;
  commission_owed_cents: number; commission_paid_cents: number; manual_adjustment_cents: number;
  status: string; created_at: string; updated_at?: string | null;
};
export type PartnerRevTotals = {
  netProfitCents: number; commissionCents: number;
  pendingCommissionCents: number; paidCommissionCents: number;
  payoutOwedCents: number; payoutPaidCents: number;
};
export type PartnerRevView = {
  partner: any; commissions: PartnerCommission[]; payouts: PartnerPayout[]; totals: PartnerRevTotals;
};
export async function getPartnerRev(partnerId: string) {
  return apiGet<PartnerRevView>(`/admin/partner-rev/${encodeURIComponent(partnerId)}`);
}
export async function addPartnerCommission(partnerId: string, body: {
  source: string; grossCents: number; platformFeeCents: number; processingCostCents: number;
  referredCompanyId?: string;
}) {
  return apiSend<{ commission: PartnerCommission }>('POST', `/admin/partner-rev/${encodeURIComponent(partnerId)}/commissions`, body);
}
export async function patchPartnerCommission(id: string, patch: { status?: string; excluded?: boolean }) {
  return apiSend<{ commission: PartnerCommission }>('PATCH', `/admin/partner-rev/commissions/${encodeURIComponent(id)}`, patch);
}
export async function computePartnerPayout(partnerId: string, period: string) {
  return apiSend<{ payout: PartnerPayout; commissionsCounted: number }>('POST', `/admin/partner-rev/${encodeURIComponent(partnerId)}/payouts/compute`, { period });
}
export async function patchPartnerPayout(id: string, patch: { status?: string; manual_adjustment_cents?: number; commission_paid_cents?: number }) {
  return apiSend<{ payout: PartnerPayout }>('PATCH', `/admin/partner-rev/payouts/${encodeURIComponent(id)}`, patch);
}

// ---- feature flags ----
export async function getFeatureFlags() {
  return apiGet<any[]>('/feature-flags');
}
export async function setFeatureFlag(key: string, patch: { enabled?: boolean; audience?: string }) {
  await apiSend('PATCH', `/feature-flags/${encodeURIComponent(key)}`, patch);
}
