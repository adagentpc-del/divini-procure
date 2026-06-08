import { supabase } from './supabase';

export async function createCompanyForUser(userId: string, payload: {
  kind: 'buyer' | 'vendor'; name: string; contact_name?: string; email?: string;
  phone?: string; city?: string; region?: string; services?: string[];
}) {
  const { data: company, error } = await supabase
    .from('companies')
    .insert({
      kind: payload.kind, name: payload.name, contact_name: payload.contact_name,
      email: payload.email, phone: payload.phone, city: payload.city, region: payload.region,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: mErr } = await supabase
    .from('company_members')
    .insert({ company_id: company.id, user_id: userId, role: 'owner', seat: 1 });
  if (mErr) throw mErr;

  if (payload.kind === 'vendor') {
    await supabase.from('vendor_profiles').insert({
      company_id: company.id, trust: 70, verify_status: 'pending',
      services: payload.services ?? [],
    });
  }
  return company;
}

export async function getBuildings(companyId: string) {
  const { data } = await supabase
    .from('buildings').select('*').eq('company_id', companyId).order('created_at');
  return data ?? [];
}

export async function getOpenPackages(filter?: { categories?: string[] }) {
  let q = supabase
    .from('packages')
    .select('*, building:buildings(name, location, developer)')
    .in('status', ['open', 'shortlisting']);
  if (filter?.categories?.length) q = q.in('category', filter.categories);
  const { data } = await q.order('deadline');
  return data ?? [];
}

export async function getMyBids(companyId: string) {
  const { data } = await supabase
    .from('bids')
    .select('*, package:packages(category, building:buildings(name))')
    .eq('vendor_company_id', companyId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getVendorProfile(companyId: string) {
  const { data } = await supabase
    .from('vendor_profiles').select('*').eq('company_id', companyId).maybeSingle();
  return data;
}

export async function getBuilding(id: string) {
  const { data } = await supabase.from('buildings').select('*').eq('id', id).maybeSingle();
  return data;
}
export async function getPackages(buildingId: string) {
  const { data } = await supabase.from('packages').select('*').eq('building_id', buildingId).order('created_at');
  return data ?? [];
}
export async function createPackage(buildingId: string, p: { category: string; status?: string; deadline?: string; budget_min?: number; budget_max?: number; }) {
  const { data, error } = await supabase.from('packages').insert({ building_id: buildingId, ...p }).select().single();
  if (error) throw error; return data;
}
export async function getPackage(id: string) {
  const { data } = await supabase.from('packages')
    .select('*, building:buildings(id, name, location, developer, company_id)')
    .eq('id', id).maybeSingle();
  return data;
}
export async function setPackageStatus(id: string, status: string) {
  await supabase.from('packages').update({ status }).eq('id', id);
}

export async function getLineItems(packageId: string) {
  const { data } = await supabase.from('package_line_items').select('*').eq('package_id', packageId).order('sort');
  return data ?? [];
}
export async function addLineItem(packageId: string, li: { description: string; qty?: number; unit?: string; cost_code?: string; item_no?: string; }) {
  const { error } = await supabase.from('package_line_items').insert({ package_id: packageId, ...li });
  if (error) throw error;
}
export async function deleteLineItem(id: string) { await supabase.from('package_line_items').delete().eq('id', id); }

export async function getDocuments(opts: { packageId?: string; buildingId?: string }) {
  let q = supabase.from('documents').select('*').order('created_at', { ascending: false });
  if (opts.packageId) q = q.eq('package_id', opts.packageId);
  else if (opts.buildingId) q = q.eq('building_id', opts.buildingId);
  const { data } = await q;
  return data ?? [];
}
export async function uploadDocument(file: File, opts: { companyId: string; userId: string; buildingId?: string; packageId?: string }) {
  const path = `${opts.companyId}/${opts.packageId ?? opts.buildingId ?? 'misc'}/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from('project-files').upload(path, file, { upsert: false });
  if (upErr) throw upErr;
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const { error } = await supabase.from('documents').insert({
    company_id: opts.companyId, building_id: opts.buildingId ?? null, package_id: opts.packageId ?? null,
    name: file.name, kind: ext, storage_path: path, size: file.size, uploaded_by: opts.userId,
  });
  if (error) throw error;
}
export async function signedUrl(path: string) {
  const { data } = await supabase.storage.from('project-files').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function getBidsForPackage(packageId: string) {
  const { data } = await supabase.from('bids')
    .select('*, vendor:companies(name)')
    .eq('package_id', packageId).order('price');
  return data ?? [];
}
export async function submitPricedBid(packageId: string, vendorCompanyId: string, payload: {
  price: number; days: number; note?: string; items?: { line_item_id: string; unit_price: number; qty: number; amount: number }[];
}) {
  const { data: bid, error } = await supabase.from('bids').insert({
    package_id: packageId, vendor_company_id: vendorCompanyId,
    price: payload.price, days: payload.days, note: payload.note, status: 'submitted', docs_ok: true,
  }).select().single();
  if (error) throw error;
  if (payload.items?.length) {
    await supabase.from('bid_items').insert(payload.items.map(i => ({ bid_id: bid.id, ...i })));
  }
  return bid;
}

export async function getQuestions(packageId: string) {
  const { data } = await supabase.from('rfq_questions').select('*, vendor:companies(name)').eq('package_id', packageId).order('created_at');
  return data ?? [];
}
export async function askQuestion(packageId: string, vendorCompanyId: string, question: string) {
  const { error } = await supabase.from('rfq_questions').insert({ package_id: packageId, vendor_company_id: vendorCompanyId, question });
  if (error) throw error;
}
export async function answerQuestion(id: string, answer: string) {
  await supabase.from('rfq_questions').update({ answer, answered_at: new Date().toISOString() }).eq('id', id);
}
