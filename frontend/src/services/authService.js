import { supabase } from '../lib/supabaseClient.js'
import {
  ROLES,
  DEFAULT_RESIDENT_PERMISSIONS,
  normalizeMobileNumber,
  sanitizeProfileUpdatePayload,
} from '../utils/authorization.js'

const PENDING_PROFILE_STORAGE_PREFIX = 'ticore_pending_profile_'

/**
 * Fetches the authoritative user profile from public.profiles.
 * Never trusts client role metadata; always reads from the RLS-protected profiles table.
 */
export async function fetchUserProfile(userId) {
  if (!userId) return { profile: null, error: null }

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active, created_at, updated_at'
    )
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return { profile: null, error }
  }

  return { profile: data || null, error: null }
}

/**
 * Ensures a newly authenticated user has a complete profile row in public.profiles.
 * Enforces role = 'resident', verification_status = 'unverified', and default resident permissions.
 */
export async function ensureResidentProfile(authUser, extraDetails = {}) {
  if (!authUser || !authUser.id) return { profile: null, error: null }

  // Check if pending registration address details were stored before email confirmation
  let cachedDetails = {}
  try {
    const rawCached = sessionStorage.getItem(`${PENDING_PROFILE_STORAGE_PREFIX}${authUser.id}`)
    if (rawCached) {
      cachedDetails = JSON.parse(rawCached)
    }
  } catch {
    cachedDetails = {}
  }

  const merged = {
    ...cachedDetails,
    ...extraDetails,
  }

  const { profile: existingProfile, error: fetchError } = await fetchUserProfile(authUser.id)

  const normalizedMobile =
    normalizeMobileNumber(
      merged.mobile_number || authUser.user_metadata?.mobile_number || authUser.phone
    ) || null

  const cleanFullName =
    String(
      merged.full_name ||
        authUser.user_metadata?.full_name ||
        existingProfile?.full_name ||
        'Barangay Resident'
    ).trim()

  if (!existingProfile && !fetchError) {
    // Insert initial resident profile (RLS policy strictly requires role = 'resident')
    const insertPayload = {
      id: authUser.id,
      full_name: cleanFullName,
      email: authUser.email || null,
      mobile_number: normalizedMobile,
      role: ROLES.RESIDENT,
      permissions: DEFAULT_RESIDENT_PERMISSIONS,
      verification_status: 'unverified',
      residency_type: merged.residency_type || 'timugan_resident',
      province: merged.province || 'Laguna',
      city_municipality: merged.city_municipality || 'Los Baños',
      barangay: merged.barangay || 'Timugan',
      purok_street: merged.purok_street ? String(merged.purok_street).trim() : null,
      house_lot_details: merged.house_lot_details
        ? String(merged.house_lot_details).trim()
        : null,
      is_active: true,
    }

    const { data: inserted, error: insertError } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select(
        'id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active, created_at, updated_at'
      )
      .single()

    if (!insertError && inserted) {
      try {
        sessionStorage.removeItem(`${PENDING_PROFILE_STORAGE_PREFIX}${authUser.id}`)
      } catch {
        // Ignore storage errors
      }
      return { profile: inserted, error: null }
    }
  }

  // If the trigger already created the base row and we have additional registration address details, update safe fields
  const hasAdditionalRegistrationDetails = Boolean(
    merged.purok_street ||
      merged.house_lot_details ||
      merged.residency_type ||
      merged.mobile_number
  )

  if (existingProfile && hasAdditionalRegistrationDetails) {
    const safeUpdate = sanitizeProfileUpdatePayload({
      full_name: cleanFullName,
      mobile_number: normalizedMobile || existingProfile.mobile_number,
      residency_type: merged.residency_type || existingProfile.residency_type,
      province: merged.province || existingProfile.province,
      city_municipality: merged.city_municipality || existingProfile.city_municipality,
      barangay: merged.barangay || existingProfile.barangay,
      purok_street: merged.purok_street ?? existingProfile.purok_street,
      house_lot_details: merged.house_lot_details ?? existingProfile.house_lot_details,
    })

    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update(safeUpdate)
      .eq('id', authUser.id)
      .select(
        'id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active, created_at, updated_at'
      )
      .single()

    if (!updateError && updated) {
      try {
        sessionStorage.removeItem(`${PENDING_PROFILE_STORAGE_PREFIX}${authUser.id}`)
      } catch {
        // Ignore storage errors
      }
      return { profile: updated, error: null }
    }
  }

  return { profile: existingProfile, error: fetchError }
}

/**
 * Registers a new resident account via Supabase Auth and initializes their profile in public.profiles.
 * Never allows choosing 'official' during signup.
 */
export async function signUpResident({
  email,
  password,
  fullName,
  mobileNumber,
  residencyType = 'timugan_resident',
  province = 'Laguna',
  cityMunicipality = 'Los Baños',
  barangay = 'Timugan',
  purokStreet = '',
  houseLotDetails = '',
}) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanName = String(fullName || '').trim()
  const cleanMobile = normalizeMobileNumber(mobileNumber)

  const profileDetails = {
    full_name: cleanName,
    mobile_number: cleanMobile,
    residency_type: residencyType,
    province: String(province || 'Laguna').trim(),
    city_municipality: String(cityMunicipality || 'Los Baños').trim(),
    barangay: String(barangay || 'Timugan').trim(),
    purok_street: String(purokStreet || '').trim() || null,
    house_lot_details: String(houseLotDetails || '').trim() || null,
  }

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/#account`,
      data: {
        full_name: cleanName,
        mobile_number: cleanMobile,
      },
    },
  })

  if (error) {
    return { user: null, session: null, profile: null, error }
  }

  if (data?.user?.id) {
    try {
      sessionStorage.setItem(
        `${PENDING_PROFILE_STORAGE_PREFIX}${data.user.id}`,
        JSON.stringify(profileDetails)
      )
    } catch {
      // Ignore storage quota errors
    }
  }

  let profile = null
  if (data?.user && data?.session) {
    const ensured = await ensureResidentProfile(data.user, profileDetails)
    profile = ensured.profile
  }

  return {
    user: data?.user || null,
    session: data?.session || null,
    profile,
    requiresEmailConfirmation: Boolean(data?.user && !data?.session),
    error: null,
  }
}

/**
 * Signs in an existing user with email and password and loads their authoritative profile.
 */
export async function signInWithEmail({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  })

  if (error) {
    return { user: null, session: null, profile: null, error }
  }

  let profile = null
  if (data?.user) {
    const ensured = await ensureResidentProfile(data.user)
    profile = ensured.profile
  }

  return {
    user: data?.user || null,
    session: data?.session || null,
    profile,
    error: null,
  }
}

/**
 * Signs out the current user session.
 */
export async function signOutUser() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

/**
 * Resends the signup confirmation email for an unconfirmed resident account.
 */
export async function resendConfirmationEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanEmail) {
    return { data: null, error: new Error('Please enter a valid email address.') }
  }

  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email: cleanEmail,
    options: {
      emailRedirectTo: `${window.location.origin}/#account`,
    },
  })

  return { data, error }
}

/**
 * Sends a password reset email via Supabase Auth.
 */
export async function requestPasswordReset(email) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const redirectUrl = `${window.location.origin}/#reset-password`

  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: redirectUrl,
  })

  return { error }
}

/**
 * Updates the currently authenticated user's password.
 */
export async function updateCurrentUserPassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  })

  return { user: data?.user || null, error }
}

/**
 * Updates the current user's own allowed profile fields in public.profiles.
 * Explicitly strips role, permissions, verification_status, and is_active.
 */
export async function updateOwnUserProfile(userId, rawProfileUpdates) {
  if (!userId) {
    return { profile: null, error: new Error('Authentication required.') }
  }

  const sanitizedUpdates = sanitizeProfileUpdatePayload(rawProfileUpdates)

  const { data, error } = await supabase
    .from('profiles')
    .update(sanitizedUpdates)
    .eq('id', userId)
    .select(
      'id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active, created_at, updated_at'
    )
    .single()

  return { profile: data || null, error }
}

/**
 * Performs a live Supabase RLS verification check against administrative tables
 * to demonstrate and verify database-enforced authorization boundaries.
 */
export async function verifyDatabaseRlsAccess() {
  const [reservationsResult, verificationsResult, auditLogsResult] = await Promise.all([
    supabase.from('reservations').select('id, status', { count: 'exact', head: true }),
    supabase
      .from('official_verifications')
      .select('id, verification_status', { count: 'exact', head: true }),
    supabase.from('audit_logs').select('id, action', { count: 'exact', head: true }),
  ])

  return {
    reservationsCount: reservationsResult.count ?? 0,
    verificationsCount: verificationsResult.count ?? 0,
    auditLogsCount: auditLogsResult.count ?? 0,
    hasDatabaseError: Boolean(
      reservationsResult.error || verificationsResult.error || auditLogsResult.error
    ),
  }
}

