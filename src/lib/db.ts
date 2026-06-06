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
